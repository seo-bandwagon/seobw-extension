// SEO Bandwagon — Analyze on Google: a result's page checks, fetched (1.12.0)
//
// The owner chose "Stay on Google" (2026-11-01): Analyze opens a row under
// the result with that page's checks, and no tab opens. On the person's
// click (Analyze, or "Analyze top 10"), the worker:
//   1. needs the optional all-sites access, asked once from the extension's
//      own window (1.10.2's access page), as Chrome lets only an extension
//      page ask;
//   2. fetches the result's page from the user's browser, without cookies,
//      three pages at a time, and its site's robots.txt and llms.txt once a
//      session;
//   3. hands the HTML to the analyzer (the offscreen document on Chrome and
//      Edge, the background page on Firefox: SBWPageRow) and sends the row
//      back to the results page.
// Nothing goes to SEO Bandwagon: the requests go to the result's own site.
// A result Google hides behind its redirect never gets here (the overlay
// asks the person to sign in to Google or open it), and no Google page is
// ever fetched.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpPageCheck` when loaded via importScripts, and exports
// via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpPageCheck = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const ROW_PREFIX = 'pageCheck:';
  const SITE_PREFIX = 'siteCheck:';
  const PENDING_KEY = 'pageCheckPending';
  const CONCURRENCY = 3;
  const PAGE_LIMIT_BYTES = 3 * 1024 * 1024;
  const TEXT_LIMIT_BYTES = 512 * 1024;
  const PAGE_TIMEOUT_MS = 20000;
  const SITE_TIMEOUT_MS = 8000;
  const ROW_KEEP = 300;
  const SITE_KEEP = 100;
  const HTML_TYPE_RE = /^(text\/html|application\/xhtml\+xml)\b/i;
  // Google's own pages are never fetched as a "result": its search,
  // redirect, settings and vertical paths on google.<tld> (and its home
  // page), its account and internal hosts, and any Google address carrying a
  // search (q=, dq=…), as Books and Scholar results do. The same paths as
  // src/lib/serp.js's GOOGLE_INTERNAL_PATH_RE.
  const GOOGLE_ANY_RE = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;
  const GOOGLE_SEARCH_RE = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;
  const GOOGLE_PATH_RE = /^\/(search|url|goto|imgres|aclk|setprefs|preferences|webhp|advanced_search|maps|travel|shopping|finance|sorry|intl)?(\/|$)/i;
  const GOOGLE_INTERNAL_HOST_RE = /^(accounts|consent|myaccount|policies|webcache|maps|news|books|scholar|images|translate|shopping)\./i;
  const SEARCH_PARAMS = ['q', 'dq', 'as_q', 'oq', 'query', 'search_query'];
  // Session rules 900000+ are "View as" (src/lib/ua-switch.js).
  const LOCAL_RULE_ID = 4801;

  // Hosts that are this computer or the network it sits on: loopback,
  // private, link-local, shared (CGNAT) and unique-local addresses written
  // as literals, and names that only resolve inside a network. A result,
  // its redirect or a pinned address is never fetched there: the page's
  // own site is on the public web, and the extension's access to all sites
  // must not reach a router or an internal service.
  function isPrivateIpv4(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }

  function isLocalHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    if (!host) return true;
    if (host.startsWith('[')) {
      const v6 = host.slice(1, -1);
      if (v6 === '::1' || v6 === '::') return true;
      if (/^(fc|fd)/.test(v6) || /^fe[89ab]/.test(v6)) return true;
      const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
      return mapped ? isPrivateIpv4(mapped[1]) : /^::ffff:/.test(v6);
    }
    if (isPrivateIpv4(host)) return true;
    if (/^\d+$/.test(host) || /^0x/i.test(host)) return true; // 2130706433, 0x7f000001
    if (!host.includes('.')) return true; // "router", "localhost"
    return /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/.test(host);
  }

  function isGooglePage(u) {
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!GOOGLE_ANY_RE.test(host)) return false;
    if (GOOGLE_SEARCH_RE.test(host) && GOOGLE_PATH_RE.test(u.pathname)) return true;
    if (GOOGLE_INTERNAL_HOST_RE.test(host) && (u.search || /^accounts|^consent|^myaccount/.test(host))) return true;
    return SEARCH_PARAMS.some((k) => u.searchParams.has(k));
  }

  function fetchable(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (isLocalHost(u.hostname)) return null;
    if (isGooglePage(u)) return null;
    u.hash = '';
    return u;
  }

  /**
   * declarativeNetRequest session rules that stop the extension's own
   * requests (no tab) to a local or private address, on every hop of a
   * redirect, which a fetch can't see: Chrome hands a redirect back to the
   * extension only as an opaque answer. The worker puts them in place while
   * Analyze's pages are read and takes them away after, so a developer's
   * localhost API address keeps working the rest of the time. Several small
   * rules, since Chrome refuses one pattern that compiles past 2 KB
   * (`memoryLimitExceeded`); names go by `requestDomains`, which matches
   * subdomains too. A public name that resolves to a private address can't
   * be told from here.
   */
  const PORT_AND_REST = '(:[0-9]+)?([/?#]|$)';
  const LOCAL_PATTERNS = [
    '^https?://(127|10|0)\\.[0-9]+\\.[0-9]+\\.[0-9]+' + PORT_AND_REST,
    '^https?://(192\\.168|169\\.254)\\.[0-9]+\\.[0-9]+' + PORT_AND_REST,
    '^https?://172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]+\\.[0-9]+' + PORT_AND_REST,
    '^https?://100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.[0-9]+\\.[0-9]+' + PORT_AND_REST,
    '^https?://\\[(::1?|::ffff:[^\\]]*|f[cd][0-9a-f]*:[^\\]]*|fe[89ab][0-9a-f]*:[^\\]]*)\\]',
    '^https?://[^/:?#.]+\\.?' + PORT_AND_REST
  ];
  const LOCAL_DOMAINS = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'home.arpa',
    'nip.io', 'sslip.io', 'xip.io', 'localtest.me', 'lvh.me'];

  function localBlockRules() {
    const base = { priority: 1, action: { type: 'block' } };
    const where = { tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] };
    const rules = LOCAL_PATTERNS.map((regexFilter, i) => Object.assign({ id: LOCAL_RULE_ID + i }, base, {
      condition: Object.assign({ regexFilter }, where)
    }));
    rules.push(Object.assign({ id: LOCAL_RULE_ID + LOCAL_PATTERNS.length }, base, {
      condition: Object.assign({ requestDomains: LOCAL_DOMAINS.slice() }, where)
    }));
    return rules;
  }

  function failure(code, extra) {
    return Object.assign(new Error(code), { code }, extra || {});
  }

  /**
   * deps:
   *   fetchText(url, { limit, timeoutMs }) → { status, finalUrl, redirected, headers, text, truncated }
   *   analyze(html, fetchInfo, site) → row (SBWPageRow.fromDocument's)
   *   robots   SBWRobotsAi
   *   hasAccess(), openAccessPage()
   *   storage  chrome.storage.session
   *   notify(req, msg)  to the results page that asked
   */
  function createSerpPageCheck(deps) {
    const now = deps.now || (() => Date.now());
    const queue = [];
    const working = new Set(); // tab:frame:key, so two tabs never wait on each other
    const siteLookups = new Map(); // origin -> Promise, so a site is read once
    let running = 0;
    let guarded = false;
    let unguardTimer = null;
    const guard = deps.guard || (async () => {});

    const slot = (req) => `${req.serpTabId}:${req.frameId || 0}:${req.key}`;

    async function read(key, fallback) {
      try {
        const got = await deps.storage.get(key);
        return got && got[key] !== undefined ? got[key] : fallback;
      } catch (e) {
        return fallback;
      }
    }

    async function write(obj) {
      try { await deps.storage.set(obj); } catch (e) { /* not kept this time */ }
    }

    // robots.txt and llms.txt of one site, once a session, however many of
    // its pages are checked at the same time.
    function siteFacts(origin) {
      if (!siteLookups.has(origin)) {
        siteLookups.set(origin, readSite(origin).finally(() => siteLookups.delete(origin)));
      }
      return siteLookups.get(origin);
    }

    async function readSite(origin) {
      const key = SITE_PREFIX + origin;
      const kept = await read(key, null);
      if (kept) return kept;
      const facts = { robots: { found: false, text: '' }, llms: { found: false } };
      try {
        const r = await deps.fetchText(origin + '/robots.txt', { limit: TEXT_LIMIT_BYTES, timeoutMs: SITE_TIMEOUT_MS });
        const type = String((r.headers && r.headers['content-type']) || '');
        // A robots.txt that redirected somewhere it may not be read from is
        // no robots.txt; its text is kept to 128 KB.
        const ok = r.status === 200 && !/html/i.test(type) && !!fetchable(r.finalUrl || origin + '/robots.txt');
        facts.robots = { found: ok, status: r.status, text: ok ? String(r.text || '').slice(0, 128 * 1024) : '' };
      } catch (e) { facts.robots = { found: false, status: 0, text: '' }; }
      try {
        const l = await deps.fetchText(origin + '/llms.txt', { limit: 64 * 1024, timeoutMs: SITE_TIMEOUT_MS });
        const type = String((l.headers && l.headers['content-type']) || '');
        // A soft 404 answers 200 with an HTML page: that is no llms.txt.
        facts.llms = { found: l.status === 200 && !/html/i.test(type) && /\S/.test(l.text || '') && !!fetchable(l.finalUrl || origin + '/llms.txt'), status: l.status };
      } catch (e) { facts.llms = { found: false, status: 0 }; }
      facts.at = now();
      await evict(SITE_PREFIX, SITE_KEEP - 1);
      await write({ [key]: facts });
      return facts;
    }

    // Keeps at most `keep` entries of `prefix` this session, the oldest
    // going first, so the session's 10 MB never fills.
    async function evict(prefix, keep) {
      let all = {};
      try { all = (await deps.storage.get(null)) || {}; } catch (e) { return; }
      const kept = Object.entries(all).filter(([k]) => k.startsWith(prefix))
        .sort((a, b) => ((a[1] && a[1].at) || 0) - ((b[1] && b[1].at) || 0));
      if (kept.length > keep) {
        try { await deps.storage.remove(kept.slice(0, kept.length - keep).map(([k]) => k)); } catch (e) { /* noop */ }
      }
    }

    function siteSummary(facts, path) {
      const ai = facts.robots.found ? deps.robots.aiCrawlerStatus(facts.robots.text, path) : { blocked: [], allowed: [] };
      return {
        robots: { found: facts.robots.found, status: facts.robots.status || 0, blocked: ai.blocked, allowed: ai.allowed },
        llms: { found: facts.llms.found }
      };
    }

    async function checkOne(req) {
      const u = fetchable(req.url);
      if (!u) throw failure('invalid_url');
      const res = await deps.fetchText(u.href, { limit: PAGE_LIMIT_BYTES, timeoutMs: PAGE_TIMEOUT_MS });
      const type = String((res.headers && res.headers['content-type']) || '');
      if (type && !HTML_TYPE_RE.test(type)) throw failure('not_html', { contentType: type.split(';')[0], status: res.status });
      // A page that redirected somewhere it may not be fetched from (a
      // local address, a Google search page) is not read, and neither is
      // that site's robots.txt or llms.txt.
      const final = fetchable(res.finalUrl || u.href);
      if (!final) throw failure('blocked_redirect', { status: res.status });
      const facts = await siteFacts(final.origin);
      const fetchInfo = {
        url: u.href,
        finalUrl: final.href,
        status: res.status,
        redirected: !!res.redirected || final.href !== u.href,
        headers: res.headers || {},
        truncated: !!res.truncated
      };
      const row = await deps.analyze(res.text || '', fetchInfo, siteSummary(facts, final.pathname + final.search));
      row.truncated = !!res.truncated;
      row.checkedAt = new Date(now()).toISOString();
      return row;
    }

    async function remember(url, row) {
      await evict(ROW_PREFIX, ROW_KEEP - 1);
      await write({ [ROW_PREFIX + url]: Object.assign({ at: now() }, row) });
    }

    // The local-address rules are in place from the first page read to a
    // moment after the last. If Chrome won't take them, nothing is read:
    // a redirect could then reach a local address unseen.
    async function startGuard() {
      if (unguardTimer) { clearTimeout(unguardTimer); unguardTimer = null; }
      if (guarded) return true;
      try {
        await guard(true);
        guarded = true;
      } catch (e) {
        guarded = false;
      }
      return guarded;
    }

    function stopGuardSoon() {
      if (unguardTimer) clearTimeout(unguardTimer);
      unguardTimer = setTimeout(() => {
        unguardTimer = null;
        if (running || queue.length) return;
        guarded = false;
        Promise.resolve(guard(false)).catch(() => {});
      }, 2000);
    }

    function pump() {
      if (!running && !queue.length) { stopGuardSoon(); return; }
      while (running < CONCURRENCY && queue.length) {
        const req = queue.shift();
        running += 1;
        checkOne(req).then(
          async (row) => {
            await remember(req.url, row);
            deps.notify(req, { state: 'done', row });
          },
          (e) => deps.notify(req, { state: 'error', code: (e && e.code) || 'failed', contentType: e && e.contentType, status: e && e.status })
        ).finally(() => {
          running -= 1;
          working.delete(slot(req));
          pump();
        });
      }
    }

    async function enqueue(req) {
      if (working.has(slot(req))) return;
      if (!(await startGuard())) {
        deps.notify(req, { state: 'error', code: 'unprotected' });
        return;
      }
      working.add(slot(req));
      deps.notify(req, { state: 'working' });
      queue.push(req);
      pump();
    }

    /**
     * `reqs`: [{ key, url, serpTabId, frameId }]. Answers what happens now:
     * `{ state: 'queued', count }`, `{ state: 'needs_access' }`. Each row's
     * outcome goes to notify(): working, done (with the row), or error.
     * `fresh` checks again a page this session already has.
     */
    async function check(reqs, opts) {
      const list = (reqs || []).filter((r) => r && typeof r.key === 'string' && r.key && typeof r.url === 'string');
      if (!list.length) return { state: 'queued', count: 0 };
      if (!(await deps.hasAccess())) {
        const pending = (await read(PENDING_KEY, [])).filter((p) => !list.some((r) => slot(r) === slot(p)));
        await write({ [PENDING_KEY]: pending.concat(list) });
        await deps.openAccessPage();
        return { state: 'needs_access' };
      }
      for (const req of list) {
        if (!fetchable(req.url)) {
          deps.notify(req, { state: 'error', code: 'invalid_url' });
          continue;
        }
        const kept = !(opts && opts.fresh) ? await read(ROW_PREFIX + req.url, null) : null;
        if (kept) deps.notify(req, { state: 'done', row: kept, kept: true });
        else await enqueue(req);
      }
      return { state: 'queued', count: list.length };
    }

    // The access window answered (or closed): run what waited, or say no.
    async function accessAnswered(granted) {
      const pending = await read(PENDING_KEY, []);
      if (!pending.length) return 0;
      if (granted && !(await deps.hasAccess())) return 0;
      await write({ [PENDING_KEY]: [] });
      if (granted) await check(pending);
      else pending.forEach((req) => deps.notify(req, { state: 'declined' }));
      return pending.length;
    }

    return { check, accessAnswered, fetchable, siteFacts, isLocalHost };
  }

  /**
   * The worker's fetch for the checks: the user's browser, no cookies, no
   * cache, a time limit, and at most `limit` bytes read. Throws `timeout`
   * or `network`.
   */
  async function fetchText(url, opts) {
    const o = opts || {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs || PAGE_TIMEOUT_MS);
    try {
      let res;
      try {
        res = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: controller.signal });
      } catch (e) {
        throw failure(e && e.name === 'AbortError' ? 'timeout' : 'network');
      }
      const headers = {};
      ['content-type', 'x-robots-tag', 'last-modified', 'content-language'].forEach((h) => {
        const v = res.headers.get(h);
        if (v) headers[h] = v;
      });
      const limit = o.limit || PAGE_LIMIT_BYTES;
      const chunks = [];
      let bytes = 0;
      let truncated = false;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          bytes += value.byteLength;
          if (bytes >= limit) { truncated = true; try { await reader.cancel(); } catch (e) { /* noop */ } break; }
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        bytes = buf.byteLength;
      }
      const all = new Uint8Array(bytes);
      let at = 0;
      chunks.forEach((c) => { all.set(c, at); at += c.byteLength; });
      const text = decode(all, headers['content-type']);
      return { status: res.status, finalUrl: res.url || url, redirected: res.redirected, headers, text, truncated };
    } finally {
      clearTimeout(timer);
    }
  }

  // The page's own character set: the Content-Type header's, else a
  // <meta charset> or http-equiv in its first 2 KB, else UTF-8. A Shift_JIS
  // or windows-1251 page read as UTF-8 had garbled titles and wrong counts.
  function charsetOf(bytes, contentType) {
    const header = /charset\s*=\s*["']?([\w-]+)/i.exec(String(contentType || ''));
    if (header) return header[1];
    let head = '';
    for (let i = 0; i < Math.min(bytes.length, 2048); i++) head += String.fromCharCode(bytes[i]);
    const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
    return meta ? meta[1] : 'utf-8';
  }

  function decode(bytes, contentType) {
    let decoder;
    try { decoder = new TextDecoder(charsetOf(bytes, contentType)); } catch (e) { decoder = new TextDecoder('utf-8'); }
    return decoder.decode(bytes);
  }

  return { createSerpPageCheck, fetchText, isLocalHost, localBlockRules, LOCAL_DOMAINS, charsetOf, decode, ROW_PREFIX, SITE_PREFIX, PENDING_KEY, CONCURRENCY };
});
