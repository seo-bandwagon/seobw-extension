// @vitest-environment node
//
// research/organic-grade/render-check.mjs — the rendered check of the organic
// grade study: a seeded 5% of the fetched pages are rendered in headless
// Chromium and scored with scoreDocument(), so the study can say how far
// scoring the raw HTML is from scoring the page as it renders.
//
// The one thing that must hold is that the browser never reaches the web
// itself: every request it makes goes to a localhost bridge (website repo,
// scripts/organic-grade-study/bridge.ts) that applies the honest-bot rules. A
// fake bridge stands in for it here, and a second local server stands in for
// "the web": if a request escapes the routing, that server sees it.
//
// Node environment, not jsdom: jsdom replaces AbortSignal, which Node's fetch
// then rejects.
//
// The Chromium tests need a browser Playwright can launch (OGS_CHROMIUM names
// one; a download is never run) and skip when none starts, e.g. in CI.
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launchOptions, pickRenderSample, renderAndScore } from '../../research/organic-grade/render-check.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO, 'research/organic-grade/render-check.mjs');
const execFileAsync = promisify(execFile);

async function browserLaunches() {
  try {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ executablePath: process.env.OGS_CHROMIUM || undefined });
    await browser.close();
    return true;
  } catch (e) {
    return false;
  }
}
const haveBrowser = await browserLaunches();

// ------------------------------------------------------------ the sample

describe('pickRenderSample', () => {
  const SEED = 20261017;
  const page = (n, outcome = 'fetched') => ({
    url: `https://site${String(n).padStart(3, '0')}.example.com/page`,
    outcome,
    reason: outcome === 'fetched' ? null : 'x',
    finalUrl: null,
    htmlFile: null
  });
  // 100 fetched pages, plus 40 that were not (so a sample drawn from all 140
  // would be 7 pages and would sometimes include one of them).
  const pages = [
    ...Array.from({ length: 100 }, (_, i) => page(i)),
    ...Array.from({ length: 10 }, (_, i) => page(200 + i, 'not_checked')),
    ...Array.from({ length: 10 }, (_, i) => page(300 + i, 'failed')),
    ...Array.from({ length: 10 }, (_, i) => page(400 + i, 'not_html')),
    ...Array.from({ length: 10 }, (_, i) => page(500 + i, 'http_error'))
  ];
  const fetchedUrls = new Set(pages.filter((p) => p.outcome === 'fetched').map((p) => p.url));

  it('draws the same 5% sample for the same seed, from fetched pages only', () => {
    const sample = pickRenderSample(pages, 0.05, SEED);

    // 5% of the 100 fetched pages, every one of them fetched, none twice.
    expect(sample).toHaveLength(5);
    expect(new Set(sample).size).toBe(5);
    sample.forEach((url) => expect(fetchedUrls.has(url), url).toBe(true));

    // Same seed, same sample; the order the records come in does not matter
    // (the urls are sorted before the shuffle).
    expect(pickRenderSample(pages, 0.05, SEED)).toEqual(sample);
    expect(pickRenderSample([...pages].reverse(), 0.05, SEED)).toEqual(sample);

    // Another seed draws another sample, still from fetched pages.
    const other = pickRenderSample(pages, 0.05, SEED + 1);
    expect(other).not.toEqual(sample);
    other.forEach((url) => expect(fetchedUrls.has(url), url).toBe(true));

    // Pinned, so a change to the shuffle or the generator shows up here: the
    // study's sample must not move between runs of the same code.
    expect(sample).toEqual([
      'https://site017.example.com/page',
      'https://site039.example.com/page',
      'https://site005.example.com/page',
      'https://site062.example.com/page',
      'https://site001.example.com/page'
    ]);
  });

  it('rounds the size, takes at least one page, and takes none from none', () => {
    const fetched = (count) => pages.filter((p) => p.outcome === 'fetched').slice(0, count);
    expect(pickRenderSample(fetched(30), 0.05, SEED)).toHaveLength(2); // 1.5 rounds up
    expect(pickRenderSample(fetched(29), 0.05, SEED)).toHaveLength(1); // 1.45 rounds down
    expect(pickRenderSample(fetched(3), 0.05, SEED)).toHaveLength(1); // 0.15 is raised to one
    expect(pickRenderSample(pages.filter((p) => p.outcome !== 'fetched'), 0.05, SEED)).toEqual([]);
    expect(pickRenderSample([], 0.05, SEED)).toEqual([]);
  });

  it('counts a url listed twice once', () => {
    const doubled = [...pages, ...pages.filter((p) => p.outcome === 'fetched')];
    expect(pickRenderSample(doubled, 0.05, SEED)).toEqual(pickRenderSample(pages, 0.05, SEED));
  });
});

// ------------------------------------------------------------ test servers

const BOT_UA = 'OGSTestBot/1.0 (+https://bot.test/about)';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

describe('renderAndScore', () => {
  const servers = [];
  const udpSockets = [];
  const temps = [];
  afterEach(() => {
    while (udpSockets.length) udpSockets.pop().close();
    while (servers.length) {
      const server = servers.pop();
      server.closeAllConnections();
      server.close();
    }
    while (temps.length) rmSync(temps.pop(), { recursive: true, force: true });
  });

  /**
   * A local HTTP server; `requests` lists "METHOD /path" for each request it
   * got, `upgrades` each WebSocket handshake, `connections` each TCP connection
   * (a WebSocket the browser opened and gave up on still made one).
   */
  function listen(handler) {
    const requests = [];
    const upgrades = [];
    const connections = [];
    const server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      handler(req, res);
    });
    server.on('upgrade', (req, socket) => {
      upgrades.push(req.url);
      socket.destroy();
    });
    server.on('connection', (socket) => connections.push(socket.remoteAddress));
    servers.push(server);
    return new Promise((done) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        done({ server, port, requests, upgrades, connections, base: `http://127.0.0.1:${port}` });
      });
    });
  }

  /** A UDP listener on 127.0.0.1; `packets` collects what it receives (a STUN binding request, say). */
  function listenUdp() {
    const packets = [];
    const socket = createSocket('udp4');
    socket.on('message', (message) => packets.push(message));
    udpSockets.push(socket);
    return new Promise((done) => {
      socket.bind(0, '127.0.0.1', () => done({ port: socket.address().port, packets }));
    });
  }

  /**
   * A bridge that answers from `site(url)`: undefined is a 404; `{ type, body }`
   * is a page; `{ reason, status }` is a refusal (the x-ogs-reason header is
   * what marks it); `delayMs` waits before answering, `hang` never answers and
   * `drop` closes the connection.
   * Records each /fetch (what the browser asked for), and how many requests
   * were being answered at once in all and to one host.
   */
  async function fakeBridge(site) {
    const seen = { identity: 0, fetches: [], peak: 0, peakByHost: {} };
    let inFlight = 0;
    const byHost = {};
    const bridge = await listen(async (req, res) => {
      const url = new URL(req.url, 'http://bridge.invalid');
      if (url.pathname === '/identity') {
        seen.identity++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ userAgent: BOT_UA }));
        return;
      }
      const target = url.searchParams.get('url');
      seen.fetches.push({ method: req.method, url: target, accept: url.searchParams.get('accept') });
      const host = new URL(target).host;
      inFlight++;
      byHost[host] = (byHost[host] || 0) + 1;
      seen.peak = Math.max(seen.peak, inFlight);
      seen.peakByHost[host] = Math.max(seen.peakByHost[host] || 0, byHost[host]);
      res.on('close', () => {
        inFlight--;
        byHost[host]--;
      });

      const answer = site(target) || { status: 404, type: 'text/plain', body: 'nothing here' };
      if (answer.hang) return;
      if (answer.drop) {
        req.socket.destroy();
        return;
      }
      if (answer.delayMs) await sleep(answer.delayMs);
      const headers = { 'content-type': answer.type || 'text/plain' };
      if (answer.reason) headers['x-ogs-reason'] = answer.reason;
      if (answer.location) headers.location = answer.location;
      res.writeHead(answer.status || (answer.reason ? 451 : 200), headers);
      res.end(answer.body || '');
    });
    return { ...bridge, seen };
  }

  const html = (body, head = '<title>A page about organic search results</title>') =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
  const ok = (body, head) => ({ type: 'text/html; charset=utf-8', body: html(body, head) });

  /** A run folder whose pages.ndjson lists these PageRecords (a bare string is a fetched page). */
  function makeRun(pages) {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-render-'));
    temps.push(dir);
    const records = pages.map((p) =>
      typeof p === 'string' ? { url: p, outcome: 'fetched', reason: null, finalUrl: p, htmlFile: 'html/x.html' } : p
    );
    writeFileSync(join(dir, 'pages.ndjson'), records.map((r) => JSON.stringify(r) + '\n').join(''));
    return dir;
  }
  const renderedOf = (dir) =>
    readFileSync(join(dir, 'rendered.ndjson'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const byUrl = (records, url) => records.find((r) => r.url === url);
  const quiet = { log: () => {} };

  // -------------------------------------------------- needs no browser

  it('does nothing, and needs neither bridge nor browser, when every page is already rendered', async () => {
    const url = 'https://done.example.com/';
    const dir = makeRun([url]);
    const line = JSON.stringify({ url, score: 80, error: null }) + '\n';
    writeFileSync(join(dir, 'rendered.ndjson'), line);

    // Nothing listens on port 1, and no executablePath is given.
    await renderAndScore([url, url], dir, 'http://127.0.0.1:1', quiet);
    expect(readFileSync(join(dir, 'rendered.ndjson'), 'utf8')).toBe(line);
  });

  it('says so, and renders nothing, when the bridge does not answer /identity', async () => {
    const dir = makeRun(['https://a.example.com/']);
    await expect(renderAndScore(['https://a.example.com/'], dir, 'http://127.0.0.1:1', quiet)).rejects.toThrow(
      /identity/
    );
    expect(existsSync(join(dir, 'rendered.ndjson'))).toBe(false);
  });

  it('opens nothing but http(s) urls: anything else is an error record, with no bridge or browser needed', async () => {
    const odd = ['file:///etc/hosts', 'about:blank', 'javascript:alert(1)', 'not a url'];
    const dir = makeRun([
      ...odd.map((url) => ({ url, outcome: 'fetched', reason: null, finalUrl: null, htmlFile: 'html/x.html' })),
      // The page opened is the final url, so that is what is checked.
      { url: 'https://fine.example.com/', outcome: 'fetched', reason: null, finalUrl: 'file:///etc/passwd', htmlFile: 'html/y.html' }
    ]);

    await renderAndScore([...odd, 'https://fine.example.com/'], dir, 'http://127.0.0.1:1', quiet);

    const records = renderedOf(dir);
    expect(records).toHaveLength(5);
    for (const record of records) {
      expect(record.error, record.url).toMatch(/^render:not an http\(s\) url/);
      expect(record, record.url).toMatchObject({
        score: null, grade: null, titleText: null, loadTimedOut: false, status: null, subresourcesRefused: 0, subresourcesFailed: 0
      });
    }
    expect(records.map((r) => r.url)).toEqual([...odd, 'https://fine.example.com/']);
  });

  // -------------------------------------------------- the CLI

  describe('the command line', () => {
    const run = (env, dir) => {
      const clean = { ...process.env };
      delete clean.OGS_BRIDGE;
      delete clean.OGS_RUN_DIR;
      return execFileAsync(process.execPath, [CLI, dir], { env: { ...clean, ...env } }).then(
        (out) => ({ code: 0, ...out }),
        (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr })
      );
    };

    it('fails clearly when OGS_BRIDGE is not set', async () => {
      const result = await run({}, makeRun(['https://a.example.com/']));
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/OGS_BRIDGE/);
    });

    it('fails clearly when the bridge does not answer /identity', async () => {
      const dir = makeRun(['https://a.example.com/']);
      const closed = await listen(() => {});
      const base = closed.base;
      closed.server.close();
      const result = await run({ OGS_BRIDGE: base }, dir);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/identity/);
      expect(existsSync(join(dir, 'rendered.ndjson'))).toBe(false);

      // An answer that is not { userAgent } is as good as none.
      const odd = await listen((req, res) => res.end('{"hello":"world"}'));
      const second = await run({ OGS_BRIDGE: odd.base }, dir);
      expect(second.code).toBe(1);
      expect(second.stderr).toMatch(/identity/);
    });
  });

  // -------------------------------------------------- in Chromium

  describe.skipIf(!haveBrowser)('in Chromium', { timeout: 90_000 }, () => {
    const PAGE = html(
      `<script>window.__post = fetch('/submit', { method: 'POST', body: 'x' }).then(() => 'post-sent', () => 'post-blocked');</script>
       <h1>Rendered check page</h1>
       <p>One script builds the title, one image is never loaded, one POST is never sent.</p>
       <img src="/pic.png" alt="">
       <script src="/app.js"></script>`,
      '<title>Raw title from the HTML</title>'
    );
    const APP_JS =
      "window.__post.then(function (post) { document.title = 'Rendered by script | ' + post + ' | ' + navigator.userAgent; });";

    it('routes nothing to the web directly', async () => {
      // "The web": a server the page's own URLs point at. Anything the browser
      // sent past the routing would land here.
      const web = await listen((req, res) => res.end('this came straight from the web'));
      const pageUrl = `${web.base}/page`;
      const bridge = await fakeBridge((url) => {
        if (url === pageUrl) return { type: 'text/html; charset=utf-8', body: PAGE };
        if (url === `${web.base}/app.js`) return { type: 'text/javascript', body: APP_JS };
        if (url === `${web.base}/pic.png`) return { type: 'image/png', body: 'not really a png' };
        if (url === `${web.base}/submit`) return { type: 'text/plain', body: 'posted' };
        return undefined;
      });
      const dir = makeRun([pageUrl]);

      await renderAndScore([pageUrl], dir, bridge.base, quiet);

      // Nothing went past the bridge...
      expect(web.requests).toEqual([]);
      expect(web.connections).toEqual([]);
      // ...the document and the script went through it, as GETs, with the
      // browser's Accept header...
      expect(bridge.seen.fetches.map((f) => f.url).sort()).toEqual([`${web.base}/app.js`, pageUrl].sort());
      expect(bridge.seen.fetches.every((f) => f.method === 'GET')).toBe(true);
      expect(bridge.seen.fetches.find((f) => f.url === pageUrl).accept).toMatch(/text\/html/);
      // ...and the image (never asked for) and the POST (never sent) did not.
      const record = byUrl(renderedOf(dir), pageUrl);
      expect(record.titleText).toBe(`Rendered by script | post-blocked | ${BOT_UA}`);
      expect(bridge.seen.identity).toBeGreaterThan(0);

      // A ScoreRecord of the rendered page, under the page's own url.
      expect(record).toMatchObject({ url: pageUrl, error: null });
      expect(record.score).toBeTypeOf('number');
      expect(record.grade).toBeTypeOf('string');
      expect(Object.keys(record).slice(0, 10)).toEqual(
        ['url', 'score', 'grade', 'issues', 'checks', 'subScores', 'wordCount', 'titleText', 'titleLength', 'error']
      );
      expect(Object.keys(record).slice(10).sort()).toEqual(['loadTimedOut', 'status', 'subresourcesFailed', 'subresourcesRefused']);
      expect(Object.keys(record.checks)).toHaveLength(11);
      expect(Object.keys(record.subScores)).toEqual(['Meta', 'Content', 'Links', 'Tech']);
      expect(record.wordCount).toBeGreaterThan(0);
      // A complete render, and the image and the POST this aborts on purpose are not failures.
      expect(record).toMatchObject({ loadTimedOut: false, status: 200, subresourcesRefused: 0, subresourcesFailed: 0 });
    });

    it('shuts the browser\'s other ways to the web: WebSockets, a beacon, and a redirect the bridge passes on', async () => {
      // A WebSocket handshake is not a request context.route() sees (without
      // the closing of WebSockets and the resolver rule it connects). The web
      // server counts every connection and handshake it gets; there must be none.
      const web = await listen((req, res) => res.end('this came straight from the web'));
      const pageUrl = 'http://sneaky.test/page';
      const redirectUrl = 'http://redirects.test/page';
      const bridge = await fakeBridge((url) => {
        if (url === redirectUrl) return { status: 302, type: 'text/plain', location: `${web.base}/elsewhere`, body: '' };
        if (url !== pageUrl) return undefined;
        return ok(
          `<h1>Sneaky</h1>
           <script>
             try { new WebSocket('ws://127.0.0.1:${web.port}/socket'); } catch (e) {}
             try { new WebSocket('ws://localhost:${web.port}/socket'); } catch (e) {}
             try { navigator.sendBeacon('${web.base}/beacon', 'x'); } catch (e) {}
           </script>`,
          '<title>A page that tries other ways out</title>'
        );
      });
      const dir = makeRun([pageUrl, redirectUrl]);

      await renderAndScore([pageUrl, redirectUrl], dir, bridge.base, quiet);
      await sleep(500); // a connection opened late would still be one

      expect(web.requests).toEqual([]);
      expect(web.upgrades).toEqual([]);
      expect(web.connections).toEqual([]);
      const records = renderedOf(dir);
      expect(records).toHaveLength(2);
      expect(byUrl(records, pageUrl).error).toBeNull();
      // The redirect was not followed by anyone: not by the page, not by the runner.
      expect(bridge.seen.fetches.map((f) => f.url)).not.toContain(`${web.base}/elsewhere`);
    });

    it('sends no UDP to an address a page names: WebRTC and WebTransport are shut', async () => {
      // ICE gathering sends a STUN request straight to the server's IP address,
      // which neither route() nor the resolver rule sees. The page asks a
      // listener on 127.0.0.1 for a binding, and reports which of the APIs it
      // still has.
      const udp = await listenUdp();
      const url = 'http://webrtc.test/page';
      const bridge = await fakeBridge((u) =>
        u === url
          ? ok(
              `<h1>Peer</h1>
               <script>
                 var apis = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport'];
                 try {
                   var peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udp.port}' }] });
                   peer.createDataChannel('x');
                   peer.createOffer().then(function (offer) { return peer.setLocalDescription(offer); });
                 } catch (e) {}
                 try { new WebTransport('https://127.0.0.1:${udp.port}/wt'); } catch (e) {}
                 document.title = apis.map(function (name) { return name + '=' + typeof window[name]; }).join(' ');
               </script>`
            )
          : undefined
      );
      const dir = makeRun([url]);

      await renderAndScore([url], dir, bridge.base, quiet);
      await sleep(1500); // gathering on a loopback address is quick; a late packet would still count

      expect(udp.packets).toEqual([]);
      expect(renderedOf(dir)[0]).toMatchObject({
        error: null,
        titleText: 'RTCPeerConnection=undefined webkitRTCPeerConnection=undefined RTCDataChannel=undefined WebTransport=undefined'
      });
    });

    it('records a refused main document as bridge:<reason> with no scores, and fails only a refused subresource', async () => {
      const refusedRobots = 'http://refused-robots.test/page';
      const refusedNetwork = 'http://refused-network.test/page';
      const upstream451 = 'http://really-451.test/page';
      const blockedScript = 'http://blocked-script.test/page';
      const brokenScripts = 'http://broken-scripts.test/page';
      const bridge = await fakeBridge((url) => {
        if (url === refusedRobots) return { reason: 'robots', status: 451, body: 'not checked: robots' };
        if (url === refusedNetwork) return { reason: 'network', status: 502, body: 'failed: network' };
        // The site itself answered 451: no x-ogs-reason, so it is a page.
        if (url === upstream451) return { ...ok('<h1>Unavailable</h1>', '<title>Unavailable for legal reasons</title>'), status: 451 };
        if (url === blockedScript) {
          return ok(
            '<h1>Hello</h1><script src="/blocked.js"></script>',
            '<title>Raw title stays, the script was refused</title>'
          );
        }
        if (url === 'http://blocked-script.test/blocked.js') {
          return { reason: 'crawl-delay', status: 451, body: 'not checked: crawl-delay' };
        }
        // Five files: one refused for Crawl-delay, one for a failed fetch (502), one the bridge
        // dropped, one the site itself answers 404, one that is fine.
        if (url === brokenScripts) {
          return ok(
            `<h1>Hello</h1><script src="/refused.js"></script><script src="/failed.js"></script>
             <script src="/dropped.js"></script><script src="/missing.js"></script><script src="/fine.js"></script>`,
            '<title>A page with five files, four of them missing</title>'
          );
        }
        if (url === 'http://broken-scripts.test/refused.js') return { reason: 'crawl-delay', status: 451, body: 'x' };
        if (url === 'http://broken-scripts.test/failed.js') return { reason: 'timeout', status: 502, body: 'x' };
        if (url === 'http://broken-scripts.test/dropped.js') return { drop: true };
        if (url === 'http://broken-scripts.test/missing.js') return { status: 404, type: 'text/plain', body: 'gone' };
        if (url === 'http://broken-scripts.test/fine.js') return { type: 'text/javascript', body: '' };
        return undefined;
      });
      const pages = [refusedRobots, refusedNetwork, upstream451, blockedScript, brokenScripts];
      const dir = makeRun(pages);

      await renderAndScore(pages, dir, bridge.base, quiet);

      const records = renderedOf(dir);
      expect(records).toHaveLength(5);
      for (const [url, reason] of [[refusedRobots, 'robots'], [refusedNetwork, 'network']]) {
        const record = byUrl(records, url);
        expect(record.error).toBe(`bridge:${reason}`);
        // Null, never 0: same keys as a scored record.
        expect(record).toMatchObject({ score: null, grade: null, issues: [], wordCount: null, titleText: null, titleLength: null });
        expect(Object.values(record.checks).every((v) => v === null)).toBe(true);
        expect(Object.values(record.subScores).every((v) => v === null)).toBe(true);
        // Nothing was served, so there is no status.
        expect(record).toMatchObject({ loadTimedOut: false, status: null, subresourcesRefused: 0, subresourcesFailed: 0 });
      }
      // A real 451 is the page the site served.
      expect(byUrl(records, upstream451)).toMatchObject({ error: null, titleText: 'Unavailable for legal reasons', status: 451 });
      expect(byUrl(records, upstream451).score).toBeTypeOf('number');
      // A refused script is a script that did not load; the page is still scored, and says so.
      expect(byUrl(records, blockedScript)).toMatchObject({
        error: null,
        titleText: 'Raw title stays, the script was refused',
        status: 200,
        loadTimedOut: false,
        subresourcesRefused: 1,
        subresourcesFailed: 0
      });
      expect(byUrl(records, blockedScript).score).toBeTypeOf('number');
      // 451 and 502 from the bridge are refused, a connection it dropped is failed, and a site's own 404 is neither.
      expect(byUrl(records, brokenScripts)).toMatchObject({ error: null, status: 200, subresourcesRefused: 2, subresourcesFailed: 1 });
    });

    it('opens the final url of a redirected page but keeps the result url on the record (Ruling 17)', async () => {
      const resultUrl = 'http://old-name.test/guide';
      const finalUrl = 'http://www.new-name.test/docs/guide/';
      const bridge = await fakeBridge((url) =>
        url === finalUrl ? ok('<script>document.title = "at " + location.href;</script><h1>Guide</h1>') : undefined
      );
      const dir = makeRun([{ url: resultUrl, outcome: 'fetched', reason: null, finalUrl, htmlFile: 'html/x.html' }]);

      await renderAndScore([resultUrl], dir, bridge.base, quiet);

      expect(bridge.seen.fetches.map((f) => f.url)).toEqual([finalUrl]);
      const [record] = renderedOf(dir);
      expect(record.url).toBe(resultUrl);
      expect(record.titleText).toBe(`at ${finalUrl}`);
      expect(record.error).toBeNull();
    });

    it('scores what has rendered when the load does not finish in time', async () => {
      const url = 'http://slow-load.test/page';
      const bridge = await fakeBridge((u) => {
        if (u === url) return ok('<h1>Slow</h1><p>Some text before the stall.</p><script src="/never.js"></script>', '<title>Title before the stall</title>');
        if (u.endsWith('/never.js')) return { hang: true };
        return undefined;
      });
      const dir = makeRun([url]);

      const started = Date.now();
      await renderAndScore([url], dir, bridge.base, { ...quiet, loadTimeoutMs: 1500 });

      expect(Date.now() - started).toBeLessThan(20_000);
      const [record] = renderedOf(dir);
      expect(record).toMatchObject({ url, error: null, titleText: 'Title before the stall' });
      expect(record.score).toBeTypeOf('number');
      // A partial render, marked as one: the document came, the load never finished.
      expect(record).toMatchObject({ loadTimedOut: true, status: 200, subresourcesRefused: 0, subresourcesFailed: 0 });
    });

    it('records a page that never produced a document as an error, not as a score of about:blank', async () => {
      const url = 'http://no-document.test/page';
      const bridge = await fakeBridge((u) => (u === url ? { hang: true } : undefined));
      const dir = makeRun([url]);

      await renderAndScore([url], dir, bridge.base, { ...quiet, loadTimeoutMs: 1000 });

      const [record] = renderedOf(dir);
      expect(record.url).toBe(url);
      expect(record.error).toBe('render:timeout');
      expect(record).toMatchObject({ score: null, grade: null, titleText: null, loadTimedOut: true, status: null });
    });

    it('records a page that is now a download, or a script that never lets go, as an error', async () => {
      const download = 'http://now-a-file.test/page';
      const stuck = 'http://stuck-script.test/page';
      const bridge = await fakeBridge((url) => {
        if (url === download) return { type: 'application/octet-stream', body: 'PK\u0003\u0004 not a page' };
        if (url === stuck) return ok('<h1>Stuck</h1><script>for (;;) {}</script>', '<title>Never finishes</title>');
        return undefined;
      });
      const dir = makeRun([download, stuck]);

      await renderAndScore([download, stuck], dir, bridge.base, { ...quiet, loadTimeoutMs: 2000 });

      const records = renderedOf(dir);
      expect(byUrl(records, download).error).toMatch(/^render:.*Download is starting/);
      expect(byUrl(records, stuck).error).toMatch(/^render:scoring took more than 2 s/);
      for (const url of [download, stuck]) {
        expect(byUrl(records, url), url).toMatchObject({ score: null, grade: null, titleText: null });
      }
    });

    it('stops, with nothing recorded for the page in hand, when the bridge stops answering', async () => {
      const url = 'http://bridge-gone.test/page';
      const bridge = await fakeBridge(() => ({ drop: true }));
      const dir = makeRun([url]);

      await expect(renderAndScore([url], dir, bridge.base, quiet)).rejects.toThrow(/bridge stopped answering/);
      expect(existsSync(join(dir, 'rendered.ndjson'))).toBe(false);
    });

    it('scores where a page landed when it moved on by itself while being scored', async () => {
      const stub = 'http://meta-refresh.test/page';
      const bridge = await fakeBridge((url) => {
        if (url === stub) return ok('<h1>Moving</h1>', '<title>The stub</title><meta http-equiv="refresh" content="0;url=http://meta-refresh.test/final">');
        if (url === 'http://meta-refresh.test/final') return ok('<h1>Landed</h1>', '<title>Where the refresh led</title>');
        return undefined;
      });
      const dir = makeRun([stub]);

      await renderAndScore([stub], dir, bridge.base, quiet);

      const [record] = renderedOf(dir);
      expect(record).toMatchObject({ url: stub, error: null, titleText: 'Where the refresh led' });
    });

    it('records a page that moves on to a refused url as that refusal, not as the browser\'s error page', async () => {
      const viaRefresh = 'http://refresh-to-refused.test/page';
      const viaScript = 'http://script-to-refused.test/page';
      const viaForm = 'http://form-post.test/page';
      const bridge = await fakeBridge((url) => {
        if (url === viaRefresh) return ok('<h1>Moving</h1>', '<title>The stub</title><meta http-equiv="refresh" content="0;url=http://refused.test/">');
        if (url === viaScript) return ok('<h1>Moving</h1><script>location.replace("http://refused.test/");</script>', '<title>The stub</title>');
        // A form posted to the page itself: the POST is aborted, and the page is left on the browser's error page.
        if (url === viaForm) return ok('<h1>Posting</h1><form method="post" action="/in"></form><script>document.forms[0].submit();</script>', '<title>The stub</title>');
        if (url === 'http://refused.test/') return { reason: 'robots', status: 451, body: 'not checked: robots' };
        return undefined;
      });
      const dir = makeRun([viaRefresh, viaScript, viaForm]);

      await renderAndScore([viaRefresh, viaScript, viaForm], dir, bridge.base, quiet);

      const records = renderedOf(dir);
      for (const url of [viaRefresh, viaScript]) {
        expect(byUrl(records, url), url).toMatchObject({ error: 'bridge:robots', score: null, grade: null, titleText: null, status: null });
      }
      expect(byUrl(records, viaForm)).toMatchObject({ error: 'navigation-failed', score: null, grade: null, titleText: null });
    });

    it('leaves the document as it found it, so a page at the Large DOM limit is not pushed over it', async () => {
      // domElements > 2000 is "Large DOM". html, head, title and body are four
      // elements; the scorer must add none (a <script> tag would).
      const filler = (n) => '<i></i>'.repeat(n);
      const at = 'http://dom-2000.test/page';
      const over = 'http://dom-2001.test/page';
      const bridge = await fakeBridge((url) => {
        const head = '<title>A page with exactly this many elements</title>';
        const page = (n) => `<!doctype html><html><head>${head}</head><body>${filler(n)}</body></html>`;
        if (url === at) return { type: 'text/html', body: page(1996) };
        if (url === over) return { type: 'text/html', body: page(1997) };
        return undefined;
      });
      const dir = makeRun([at, over]);

      await renderAndScore([at, over], dir, bridge.base, quiet);

      const records = renderedOf(dir);
      expect(byUrl(records, at).issues).not.toContain('Large DOM');
      expect(byUrl(records, over).issues).toContain('Large DOM');
    });

    it("scores a page whose own Content-Security-Policy forbids scripts, and leaves that policy in force", async () => {
      // The scorer is injected by the browser's debugger, not as a <script>, so
      // the page's policy neither blocks it nor is switched off to let it in:
      // a script the policy forbids stays unrun, as it would for a visitor.
      const url = 'http://csp-page.test/page';
      const bridge = await fakeBridge((u) =>
        u === url
          ? ok(
              '<h1>Policy page</h1><script>document.title = "the policy was ignored";</script>',
              `<title>Raw title, policy honoured</title><meta http-equiv="Content-Security-Policy" content="script-src 'none'">`
            )
          : undefined
      );
      const dir = makeRun([url]);

      await renderAndScore([url], dir, bridge.base, quiet);

      const [record] = renderedOf(dir);
      expect(record).toMatchObject({ error: null, titleText: 'Raw title, policy honoured' });
      expect(record.score).toBeTypeOf('number');
    });

    it('renders up to 4 pages at once and never two pages of one host at once', async () => {
      // 6 hosts, 2 pages each, every request to the bridge held for 250 ms. A
      // page asks for its document and then its script, so the requests being
      // answered at any moment are at most the pages in flight.
      const urls = [];
      // The two pages of a host are neighbours, so a runner that ignored hosts would start them together.
      for (let h = 0; h < 6; h++) for (let n = 0; n < 2; n++) urls.push(`http://host${h}.test/page${n}`);
      const bridge = await fakeBridge((u) => {
        if (u.endsWith('/s.js')) return { type: 'text/javascript', body: '', delayMs: 250 };
        return { ...ok('<h1>Hello</h1><script src="/s.js"></script>'), delayMs: 250 };
      });
      const dir = makeRun(urls);

      await renderAndScore(urls, dir, bridge.base, quiet);

      expect(renderedOf(dir)).toHaveLength(12);
      expect(Math.max(...Object.values(bridge.seen.peakByHost))).toBe(1);
      expect(bridge.seen.peak).toBeGreaterThanOrEqual(3);
      expect(bridge.seen.peak).toBeLessThanOrEqual(4);
    });

    it('skips the urls already in rendered.ndjson and renders again a page whose line was cut off', async () => {
      const done = 'http://done-page.test/page';
      const cut = 'http://cut-page.test/page';
      const fresh = 'http://fresh-page.test/page';
      const bridge = await fakeBridge(() => ok('<h1>Fresh</h1>'));
      const dir = makeRun([done, cut, fresh]);
      const doneLine = JSON.stringify({ url: done, score: 77, error: null }) + '\n';
      // The second line stops part-way, as a killed process would leave it.
      writeFileSync(join(dir, 'rendered.ndjson'), doneLine + '{"url":"http://cut-page.test/pa');

      await renderAndScore([done, cut, fresh], dir, bridge.base, quiet);

      expect(bridge.seen.fetches.map((f) => f.url).sort()).toEqual([cut, fresh].sort());
      const text = readFileSync(join(dir, 'rendered.ndjson'), 'utf8');
      expect(text.startsWith(doneLine)).toBe(true);
      const records = renderedOf(dir);
      expect(records.map((r) => r.url).sort()).toEqual([done, cut, fresh].sort());
      expect(byUrl(records, done).score).toBe(77);
      expect(byUrl(records, cut).error).toBeNull();
      expect(byUrl(records, fresh).error).toBeNull();
    });

    it('renders the seeded 5% sample of a run folder from the command line', async () => {
      const pages = [];
      for (let i = 0; i < 20; i++) {
        const url = `http://sample-${String(i).padStart(2, '0')}.test/page`;
        pages.push({ url, outcome: 'fetched', reason: null, finalUrl: url, htmlFile: `html/${i}.html` });
      }
      pages.push({ url: 'http://not-fetched.test/', outcome: 'not_checked', reason: 'robots.txt', finalUrl: null, htmlFile: null });
      const expected = pickRenderSample(pages, 0.05, 20261017);
      expect(expected).toHaveLength(1);

      const bridge = await fakeBridge(() => ok('<h1>Sampled</h1>'));
      const dir = makeRun(pages);
      const result = await execFileAsync(process.execPath, [CLI, dir], {
        env: { ...process.env, OGS_BRIDGE: bridge.base }
      });

      expect(result.stderr).toBe('');
      expect(renderedOf(dir).map((r) => r.url)).toEqual(expected);
      expect(statSync(join(dir, 'rendered.ndjson')).size).toBeGreaterThan(0);
    });
  });
});

// In GitHub Actions the rendered check runs beside the bot's signing key, so
// Chromium's sandbox must be on there (Playwright turns it off by default);
// the workflow sets OGS_CHROMIUM_SANDBOX=1. Locally it stays as Playwright sets it.
describe('launchOptions', () => {
  it('turns on the Chromium sandbox only when OGS_CHROMIUM_SANDBOX is 1', () => {
    expect(launchOptions({}).chromiumSandbox).toBe(false);
    expect(launchOptions({ OGS_CHROMIUM_SANDBOX: '0' }).chromiumSandbox).toBe(false);
    expect(launchOptions({ OGS_CHROMIUM_SANDBOX: '1' }).chromiumSandbox).toBe(true);
  });

  it('keeps the network shut whatever the sandbox setting', () => {
    for (const env of [{}, { OGS_CHROMIUM_SANDBOX: '1' }]) {
      const opts = launchOptions(env);
      expect(opts.headless).toBe(true);
      expect(opts.args).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
      expect(opts.args).toContain('--webrtc-ip-handling-policy=disable_non_proxied_udp');
    }
  });

  it('passes OGS_CHROMIUM as the executable, or leaves it to Playwright', () => {
    expect(launchOptions({ OGS_CHROMIUM: '/x/chrome' }).executablePath).toBe('/x/chrome');
    expect(launchOptions({}).executablePath).toBeUndefined();
  });
});
