// SEO Bandwagon — render a sample of an organic-grade run's pages in Chromium and
// score what rendered (organic grade study)
//
//   OGS_BRIDGE=http://127.0.0.1:<port> node research/organic-grade/render-check.mjs [runDir]
//
// score-run.mjs scores the raw HTML of every fetched page. This renders a
// seeded 5% of them in headless Chromium, runs score-core.js's scoreDocument()
// on the page as it renders, and appends one ScoreRecord per page to
// rendered.ndjson, so the study can say how far scoring the raw HTML is from
// scoring the rendered page. A run that is stopped picks up where it left off:
// URLs already in rendered.ndjson are skipped.
//
// The browser never reaches the web itself. Every request it makes is caught
// (context.route) and answered by the botFetch bridge, a localhost server in
// the website repo (scripts/organic-grade-study/bridge.ts) that applies the
// honest-bot rules: SEOBandwagonBot, robots.txt, Crawl-delay, at least a second
// between requests to a host, Web Bot Auth signing.
//
//   GET /identity                      { userAgent }: the browser sends it
//   GET /fetch?url=<abs>&accept=<hdr>  the page's status, content-type and body
//
// A request the bridge refuses (451 for robots.txt or Crawl-delay, 502 for a
// failure) carries x-ogs-reason; a site that really answered 451 or 502 does
// not, and is relayed as the page it is. Only GETs go to the bridge. A POST (or
// any other method) is aborted, and so are images, media and fonts, which the
// score does not read. context.route() does not see everything a browser can
// open (a WebSocket handshake never reaches it), so more doors are shut: WebSockets
// are closed, and name resolution is switched off (--host-resolver-rules), so a
// request that is not routed fails instead of going out. WebRTC and WebTransport
// send UDP to an IP address with no lookup, so they are removed from the page and
// WebRTC's non-proxied UDP is disabled at launch. Service workers are blocked:
// theirs are not routed.
//
// Chromium is Playwright's, or the one OGS_CHROMIUM names (the run uses the
// copy already installed; nothing here downloads a browser).

import { appendFileSync, existsSync, realpathSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_RUN_DIR, dropUnfinishedLine, errorRecord, readNdjson } from './score-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const SAMPLE_SHARE = 0.05;
export const SAMPLE_SEED = 20261017;
export const MAX_IN_FLIGHT = 4;
export const LOAD_TIMEOUT_MS = 30_000;
const MOVES_FOLLOWED = 3; // times a page may move on, by itself, while it is scored
const PROGRESS_EVERY = 50;
const IDENTITY_TIMEOUT_MS = 10_000;

// The fields of a record for a url no page was opened for.
const NOT_OPENED = Object.freeze({ loadTimedOut: false, status: null, subresourcesRefused: 0, subresourcesFailed: 0 });

// Requests that never reach the bridge: the score reads none of them.
const SKIPPED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// What scoreDocument() needs in the page, in the order it needs it: the three
// libraries analyzer.js uses, then the study's score-core.js.
const SCORER_FILES = [
  '../../extension/lib/content-analysis.js',
  '../../extension/lib/dom-extraction.js',
  '../../extension/src/lib/sub-scores.js',
  './score-core.js'
].map((file) => resolve(HERE, file));

// ---------------------------------------------------------------- the sample

/** mulberry32, the same seeded generator the website's study scripts use: floats in [0, 1). */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The urls to render: `share` of the fetched pages (rounded, and at least one
 * when there are any), drawn at random but repeatably for one `seed`. The urls
 * are deduplicated and sorted before the draw, so the sample depends on which
 * pages were fetched and not on the order pages.ndjson lists them. Only
 * `outcome === 'fetched'` pages are drawn from.
 */
export function pickRenderSample(pages, share = SAMPLE_SHARE, seed = SAMPLE_SEED) {
  const urls = [...new Set(pages.filter((page) => page.outcome === 'fetched').map((page) => page.url))].sort();
  if (urls.length === 0) return [];
  const take = Math.min(urls.length, Math.max(1, Math.round(share * urls.length)));
  const random = seededRandom(seed);
  // Partial Fisher-Yates: the first `take` slots end up a uniform draw.
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(random() * (urls.length - i));
    [urls[i], urls[j]] = [urls[j], urls[i]];
  }
  return urls.slice(0, take);
}

// ---------------------------------------------------------------- the bridge

const bridgeBase = (bridge) => String(bridge).replace(/\/+$/, '');

/** The User-Agent the bridge's botFetch sends, which the browser sends too. Throws a plain message if the bridge does not answer. */
export async function fetchIdentity(bridge) {
  const where = `the bridge at ${bridge}`;
  let reply;
  try {
    const response = await fetch(`${bridgeBase(bridge)}/identity`, { signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    reply = await response.json();
  } catch (e) {
    const why = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e;
    throw new Error(
      `${where} did not answer /identity (${why}); start scripts/organic-grade-study/bridge.ts in the website repo and point OGS_BRIDGE at it`
    );
  }
  if (!reply || typeof reply.userAgent !== 'string' || reply.userAgent === '') {
    throw new Error(`${where} answered /identity without a userAgent`);
  }
  return reply.userAgent;
}

/**
 * One GET through the bridge. `refusal` is the x-ogs-reason when the bridge
 * would not fetch it (its answers carry the header whatever the status; a site's
 * own never do), else null. Rejects when the bridge itself cannot be reached.
 */
async function bridgeGet(bridge, url, accept, signal) {
  const query = new URLSearchParams({ url });
  if (accept) query.set('accept', accept);
  // 'manual': a redirect is never followed from here, which would reach the web
  // without the bridge. botFetch follows them itself.
  const response = await fetch(`${bridgeBase(bridge)}/fetch?${query}`, { redirect: 'manual', signal });
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    refusal: response.headers.get('x-ogs-reason'),
    body: Buffer.from(await response.arrayBuffer())
  };
}

// ---------------------------------------------------------------- one page

const firstLine = (e) => String((e && e.message) || e).split('\n')[0].trim();

/** `promise`, or a rejection once `ms` have passed. */
function within(promise, ms, what) {
  promise.catch(() => {}); // if the limit wins, a later failure of it is not news
  let timer;
  const limit = new Promise((resolveLimit, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took more than ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * Page side, before the page's own scripts. WebRTC sends UDP straight to the
 * address of an ICE server, and WebTransport is QUIC: neither is a request
 * context.route() sees, and the resolver rule does not apply to an IP address
 * in an ICE server list. None of them is a thing the score reads, so they are
 * not there. (Together with --webrtc-ip-handling-policy at launch: each alone
 * stopped a STUN request from the main frame, an iframe and a popup; a worker has
 * neither API.)
 */
function removeUdpApis() {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport']) {
    try {
      Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false });
    } catch (e) {
      // Already defined as not configurable: nothing more can be done from here.
    }
  }
}

/**
 * Renders `job.target` in a fresh context and returns the record: a ScoreRecord
 * under `job.url`, the result URL the analysis joins on (Ruling 17; the page
 * opened is the final URL, so the document's own URL is right), and the four
 * fields that say how complete the render was (see `finish`). Never throws for
 * a page that fails: that is a record with an error. It throws only when the
 * run cannot go on (the bridge or the browser is gone), so that no page is
 * recorded as failed for a fault that is not the page's.
 */
async function renderPage(browser, job, run) {
  const { url, target } = job;
  const fetching = new AbortController();

  // What the page asked for and did not get. `nav` follows the main frame's
  // navigations (the first document, and any the page makes by itself later);
  // the last one is the page that is there to be scored.
  const seen = { loadTimedOut: false, refused: 0, failed: 0 };
  const nav = { last: null };

  // The fields beyond a ScoreRecord, on every record:
  //   loadTimedOut         the load did not finish in time (what had rendered was scored)
  //   status               the main document's HTTP status as the bridge relayed it, else null
  //   subresourcesRefused  files the bridge would not fetch (451 or 502 with x-ogs-reason: robots.txt, Crawl-delay, a failed fetch)
  //   subresourcesFailed   files that got no answer at all (the bridge unreachable, or its own error);
  //                        not the ones this aborts on purpose (images, media, fonts, anything but GET),
  //                        and not a site's own 404 or 500, which is its answer
  const finish = (record) => ({
    ...record,
    url,
    loadTimedOut: seen.loadTimedOut,
    status: nav.last ? nav.last.status : null,
    subresourcesRefused: seen.refused,
    subresourcesFailed: seen.failed
  });

  let context;
  try {
    context = await browser.newContext({
      userAgent: run.userAgent,
      serviceWorkers: 'block', // a service worker's requests would not be routed
      acceptDownloads: false
      // No bypassCSP: the scorer goes in through the debugger (below), which a
      // page's Content-Security-Policy does not touch, and a page keeps the
      // policy it would have for a visitor.
    });
    await context.addInitScript(removeUdpApis);
    await context.routeWebSocket(/.*/, (socket) => socket.close()); // route() does not see these

    await context.route('**/*', async (route) => {
      const request = route.request();
      let entry = null; // this request, if it is a navigation of the main frame
      try {
        if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
          entry = { refusal: null, bridgeError: null, status: null };
          nav.last = entry;
        }
        if (request.method() !== 'GET' || SKIPPED_RESOURCE_TYPES.has(request.resourceType())) {
          await route.abort('blockedbyclient');
          return;
        }

        let reply;
        try {
          reply = await bridgeGet(run.bridge, request.url(), request.headers().accept, fetching.signal);
        } catch (e) {
          if (!fetching.signal.aborted) {
            if (entry) entry.bridgeError = e;
            else seen.failed++;
          }
          await route.abort('failed');
          return;
        }
        if (reply.refusal !== null) {
          if (entry) entry.refusal = reply.refusal;
          else if (reply.status === 451 || reply.status === 502) seen.refused++;
          else seen.failed++;
          await route.abort('blockedbyclient');
          return;
        }
        if (entry) entry.status = reply.status;
        const headers = {};
        if (reply.contentType !== null) headers['content-type'] = reply.contentType;
        await route.fulfill({ status: reply.status, headers, body: reply.body });
      } catch (e) {
        // The page was closed under the request: nothing left to answer.
      }
    });

    // The last navigation of the main frame, if the bridge would not serve it:
    // `bridge:<reason>`. Throws if the bridge could not be reached.
    const refusedByBridge = () => {
      const entry = nav.last;
      if (entry && entry.bridgeError) throw new Error(`the bridge stopped answering: ${firstLine(entry.bridgeError)}`);
      return entry && entry.refusal !== null ? `bridge:${entry.refusal}` : null;
    };

    const page = await context.newPage();
    let loadError = null;
    try {
      await page.goto(target, { waitUntil: 'load', timeout: run.loadTimeoutMs });
    } catch (e) {
      loadError = e;
    }

    const refused = refusedByBridge();
    if (refused !== null) return finish(errorRecord(url, refused));
    if (!browser.isConnected()) throw new Error('the browser closed');
    if (loadError) {
      // A load that ran out of time still has whatever rendered. Any other
      // failure, or no document at all, has nothing to score.
      if (loadError.name !== 'TimeoutError') return finish(errorRecord(url, `render:${firstLine(loadError)}`));
      seen.loadTimedOut = true;
      if (page.url() === 'about:blank') return finish(errorRecord(url, 'render:timeout'));
    }

    // The scorer goes in as evaluated source, not as <script> tags: tags would
    // add elements to the DOM it is about to count, and a page's policy could
    // refuse them.
    const scoreHere = async () => {
      for (const source of run.sources) await page.evaluate(`${source}\n;void 0;`);
      return page.evaluate(() =>
        globalThis.OGSScore.scoreDocument(document, window, {
          analysis: self.SEOBWAnalysis,
          extraction: self.SEOBWExtraction,
          subScores: globalThis.SBWSubScores
        })
      );
    };

    // What is there to score is where the page ended up. If its last navigation
    // was refused, or left Chromium's own error page (a POST this aborts, a
    // request that failed), that is the answer: the error page is not a page.
    const notAPage = () => {
      const refusedNow = refusedByBridge();
      if (refusedNow !== null) return refusedNow;
      return page.url().startsWith('chrome-error:') ? 'navigation-failed' : null;
    };

    const scoring = (async () => {
      for (let attempt = 1; ; attempt++) {
        const unscorable = notAPage();
        if (unscorable !== null) return errorRecord(url, unscorable);
        try {
          return await scoreHere();
        } catch (e) {
          // A meta refresh or a script moved the page on while it was being
          // scored: wait for where it landed, and score that.
          if (attempt === MOVES_FOLLOWED || !/Execution context was destroyed/.test(e.message)) throw e;
          try {
            await page.waitForLoadState('load', { timeout: run.loadTimeoutMs });
          } catch (waiting) {
            if (waiting.name === 'TimeoutError') seen.loadTimedOut = true;
            throw waiting;
          }
        }
      }
    })();
    return finish(await within(scoring, run.loadTimeoutMs, 'scoring'));
  } catch (e) {
    if (e && /^the (bridge|browser) /.test(e.message)) throw e;
    if (browser.isConnected()) return finish(errorRecord(url, `render:${firstLine(e)}`));
    throw new Error('the browser closed');
  } finally {
    fetching.abort(); // a bridge request still queued behind its host goes with the page
    if (context) await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- the run

/** The host a job is paced by; '' when the target is not a URL (that job fails fast). */
function hostOf(target) {
  try {
    return new URL(target).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * Runs `work(job)` over `jobs`, at most `limit` at once and never two jobs of
 * one host at once. The first failure stops new jobs from starting; the ones in
 * flight finish, and then the failure is thrown.
 */
function runPool(jobs, limit, work) {
  const queue = [...jobs];
  const busyHosts = new Set();
  let active = 0;
  let failure = null;
  return new Promise((done, fail) => {
    let settled = false;
    const pump = () => {
      while (failure === null && active < limit) {
        const next = queue.findIndex((job) => !busyHosts.has(job.host));
        if (next === -1) break;
        const [job] = queue.splice(next, 1);
        active++;
        busyHosts.add(job.host);
        work(job).then(
          () => {},
          (e) => { if (failure === null) failure = e; }
        ).then(() => {
          active--;
          busyHosts.delete(job.host);
          pump();
        });
      }
      if (!settled && active === 0 && (failure !== null || queue.length === 0)) {
        settled = true;
        if (failure !== null) fail(failure);
        else done();
      }
    };
    pump();
  });
}

/**
 * Chromium's launch options. OGS_CHROMIUM names the browser (else Playwright's
 * own). OGS_CHROMIUM_SANDBOX=1 turns Chromium's sandbox on: Playwright launches
 * with --no-sandbox by default, and in GitHub Actions the rendered check runs
 * beside the bot's signing key (website repo,
 * .github/workflows/organic-grade-study.yml), so a page's script must not get
 * past the renderer sandbox there.
 */
export function launchOptions(env = process.env) {
  return {
    headless: true,
    executablePath: env.OGS_CHROMIUM || undefined,
    chromiumSandbox: env.OGS_CHROMIUM_SANDBOX === '1',
    args: [
      // Whatever the routing missed fails to resolve (even an IP address, as
      // Chromium maps those too) rather than reaching the web.
      '--host-resolver-rules=MAP * ~NOTFOUND',
      // WebRTC's UDP goes to an ICE server's address without a lookup: with no
      // proxy to send it through, it is not sent. (--force-webrtc-ip-handling-policy
      // takes the same value and did not stop a STUN request in the Chrome for
      // Testing the run uses; this spelling did.)
      '--webrtc-ip-handling-policy=disable_non_proxied_udp'
    ]
  };
}

async function launchBrowser() {
  // Loaded here, so reading the sample needs no browser library.
  const { chromium } = await import('@playwright/test');
  return chromium.launch(launchOptions());
}

/**
 * Renders each of `urls` (the sample), one fresh context per page, and appends
 * its ScoreRecord to <runDir>/rendered.ndjson as soon as it is done. A URL
 * already in that file is skipped. The page opened is the PageRecord's
 * finalUrl, else the url. `bridge` is the bridge's base URL.
 *
 * Up to MAX_IN_FLIGHT pages at once, never two of one host. Each gets
 * `loadTimeoutMs` (30 s) to load, and the same to be scored; what rendered by
 * then is scored. A page the bridge refuses is a record with error
 * `bridge:<reason>` and null scores, and so is one that moves on, by itself, to
 * a url the bridge refuses or that fails (`navigation-failed`). Every record
 * carries four fields beyond a ScoreRecord, to tell a partial render from a
 * complete one: loadTimedOut, status, subresourcesRefused, subresourcesFailed
 * (see `renderPage`). Throws, with nothing recorded for the page in hand, if the
 * bridge or the browser stops working.
 *
 * `log` takes the progress lines.
 */
export async function renderAndScore(urls, runDir, bridge, { log = console.log, loadTimeoutMs = LOAD_TIMEOUT_MS } = {}) {
  const renderedFile = join(runDir, 'rendered.ndjson');
  const pagesFile = join(runDir, 'pages.ndjson');

  let have = new Set();
  if (existsSync(renderedFile)) {
    dropUnfinishedLine(renderedFile);
    have = new Set(readNdjson(renderedFile).map((record) => record.url));
  }

  const finalUrls = new Map();
  if (existsSync(pagesFile)) {
    for (const page of readNdjson(pagesFile)) if (page.finalUrl) finalUrls.set(page.url, page.finalUrl);
  }

  const todo = [...new Set(urls)].filter((url) => !have.has(url));
  const append = (record) => appendFileSync(renderedFile, JSON.stringify(record) + '\n');
  let rendered = 0;
  let errors = 0;
  const done = (record) => {
    append(record);
    if (record.error === null) rendered++;
    else errors++;
    if ((rendered + errors) % PROGRESS_EVERY === 0) log(`${rendered + errors} of ${todo.length} pages done, ${errors} errors`);
  };

  const jobs = [];
  for (const url of todo) {
    const target = finalUrls.get(url) || url;
    // Only http(s) goes to a browser that is meant to reach nothing but the bridge.
    if (!URL.canParse(target) || !/^https?:$/.test(new URL(target).protocol)) {
      done({ ...errorRecord(url, `render:not an http(s) url: ${target}`), ...NOT_OPENED });
      continue;
    }
    jobs.push({ url, target, host: hostOf(target) });
  }
  if (jobs.length === 0) return;

  const userAgent = await fetchIdentity(bridge);
  const sources = SCORER_FILES.map((file) => readFileSync(file, 'utf8'));
  log(`rendering ${jobs.length} pages in ${runDir} (${have.size} already in rendered.ndjson)`);

  const browser = await launchBrowser();
  try {
    const run = { bridge, userAgent, sources, loadTimeoutMs };
    await runPool(jobs, MAX_IN_FLIGHT, async (job) => done(await renderPage(browser, job, run)));
  } finally {
    await browser.close().catch(() => {});
  }
  log(`${rendered + errors} pages done into ${renderedFile}: ${rendered} scored, ${errors} with an error`);
}

// ---------------------------------------------------------------- command line

// Run directly, not imported by the tests.
function isMain() {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch (e) {
    return false;
  }
}

async function main() {
  const bridge = process.env.OGS_BRIDGE;
  if (!bridge) {
    throw new Error(
      'OGS_BRIDGE is not set: start scripts/organic-grade-study/bridge.ts in the website repo and run\n' +
        '  OGS_BRIDGE=http://127.0.0.1:<port> node research/organic-grade/render-check.mjs [runDir]'
    );
  }
  // `|| ` rather than `??`: "$OGS_RUN_DIR" is an empty argument when unset.
  const runDir = process.argv[2] || process.env.OGS_RUN_DIR || DEFAULT_RUN_DIR;
  await fetchIdentity(bridge); // fail before anything is read or launched
  const pagesFile = join(runDir, 'pages.ndjson');
  if (!existsSync(pagesFile)) throw new Error(`no pages.ndjson in ${runDir}`);
  const sample = pickRenderSample(readNdjson(pagesFile));
  console.log(`${sample.length} pages in the ${SAMPLE_SHARE * 100}% sample (seed ${SAMPLE_SEED})`);
  await renderAndScore(sample, runDir, bridge);
}

if (isMain()) {
  main().catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exitCode = 1;
  });
}
