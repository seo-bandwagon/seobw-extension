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
  const HTML_TYPE_RE = /^(text\/html|application\/xhtml\+xml)\b/i;
  // Google's own search, redirect and settings paths: never fetched.
  const GOOGLE_SEARCH_RE = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;
  const GOOGLE_PATH_RE = /^\/(search|url|goto|imgres|aclk|setprefs|sorry)(\/|$)/i;

  function fetchable(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (GOOGLE_SEARCH_RE.test(u.hostname) && GOOGLE_PATH_RE.test(u.pathname)) return null;
    u.hash = '';
    return u;
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
    const working = new Set();
    const siteLookups = new Map(); // origin -> Promise, so a site is read once
    let running = 0;

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
        facts.robots = { found: r.status === 200 && !/html/i.test(type), status: r.status, text: r.status === 200 && !/html/i.test(type) ? r.text : '' };
      } catch (e) { facts.robots = { found: false, status: 0, text: '' }; }
      try {
        const l = await deps.fetchText(origin + '/llms.txt', { limit: 64 * 1024, timeoutMs: SITE_TIMEOUT_MS });
        const type = String((l.headers && l.headers['content-type']) || '');
        // A soft 404 answers 200 with an HTML page: that is no llms.txt.
        facts.llms = { found: l.status === 200 && !/html/i.test(type) && /\S/.test(l.text || ''), status: l.status };
      } catch (e) { facts.llms = { found: false, status: 0 }; }
      await write({ [key]: facts });
      return facts;
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
      let final;
      try { final = new URL(res.finalUrl || u.href); } catch (e) { final = u; }
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
      let all = {};
      try { all = (await deps.storage.get(null)) || {}; } catch (e) { all = {}; }
      const kept = Object.keys(all || {}).filter((k) => k.startsWith(ROW_PREFIX));
      if (kept.length >= ROW_KEEP) {
        try { await deps.storage.remove(kept.slice(0, kept.length - ROW_KEEP + 1)); } catch (e) { /* noop */ }
      }
      await write({ [ROW_PREFIX + url]: row });
    }

    function pump() {
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
          working.delete(req.key);
          pump();
        });
      }
    }

    function enqueue(req) {
      if (working.has(req.key)) return;
      working.add(req.key);
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
        const pending = (await read(PENDING_KEY, [])).filter((p) => !list.some((r) => r.key === p.key));
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
        else enqueue(req);
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

    return { check, accessAnswered, fetchable, siteFacts };
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
      let text = '';
      let truncated = false;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          text += decoder.decode(value, { stream: true });
          if (bytes >= limit) { truncated = true; try { await reader.cancel(); } catch (e) { /* noop */ } break; }
        }
        text += decoder.decode();
      } else {
        text = await res.text();
      }
      return { status: res.status, finalUrl: res.url || url, redirected: res.redirected, headers, text, truncated };
    } finally {
      clearTimeout(timer);
    }
  }

  return { createSerpPageCheck, fetchText, ROW_PREFIX, SITE_PREFIX, PENDING_KEY, CONCURRENCY };
});
