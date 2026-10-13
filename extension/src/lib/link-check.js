// SEO Bandwagon — broken-link checker: pure logic
//
// No fetch/chrome dependency in this module — it's the scheduler,
// classifier and CSV-row shaper the service worker and popup call into.
// The worker (src/background/service-worker.js) owns the actual `fetch`
// probing and feeds its raw {url,status,finalUrl,redirected,ms,error}
// results back in here, merged with the original link's {text,rel,internal}
// so classify()/groupResults()/resultRows() see one flat object per link.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWLinkCheck` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWLinkCheck = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const DEFAULT_MAX = 300;
  const DEFAULT_PER_HOST = 2;
  const DEFAULT_GLOBAL = 6;

  // Absolute http(s) only; strips #fragment, keeps the query string.
  // Anything else (relative, mailto:, javascript:, tel:, garbage) -> null.
  function normalizeUrl(href) {
    if (!href) return null;
    let u;
    try {
      u = new URL(href);
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  }

  // Hostname lowercased, leading "www." stripped — used both to bucket
  // per-host concurrency and to compare internal/external.
  function hostKey(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  // links: [{ url, text, rel, internal }]. Dedupes by normalized URL,
  // keeping the first anchor text/rel seen for each. Returns a queue capped
  // at `max`, the deduped total (pre-cap), and whether it was truncated.
  function planChecks(links, options) {
    // Nullish, not falsy — { max: 0 } is a deliberate "check nothing" call
    // (dry-run/UI-disabled paths) and must not silently fall back to 300.
    const max = options?.max ?? DEFAULT_MAX;
    const seen = new Map();
    for (const link of links || []) {
      const norm = normalizeUrl(link && link.url);
      if (!norm) continue;
      if (!seen.has(norm)) {
        seen.set(norm, { url: norm, text: link.text, rel: link.rel, internal: link.internal });
      }
    }
    const all = Array.from(seen.values());
    const total = all.length;
    const queue = all.slice(0, max);
    return { queue, total, truncated: total > max };
  }

  // Pure scheduler: returns the first queue item whose host is under
  // `perHost` inflight requests, while total inflight stays under `global`.
  // Returns null when nothing can be started right now. Never mutates
  // `queue` or `inflightByHost` — the worker removes/updates on dispatch.
  function pickNext(queue, inflightByHost, options) {
    // Nullish, not falsy — an explicit 0 (e.g. testing a fully-saturated
    // scheduler) must behave as zero capacity, not "unset, use default".
    const perHost = options?.perHost ?? DEFAULT_PER_HOST;
    const global = options?.global ?? DEFAULT_GLOBAL;
    const byHost = inflightByHost || {};
    const totalInflight = Object.values(byHost).reduce((a, b) => a + b, 0);
    if (totalInflight >= global) return null;

    for (const item of queue || []) {
      const host = hostKey(item.url);
      const count = byHost[host] || 0;
      if (count < perHost) return item;
    }
    return null;
  }

  // #46: Chrome never lets an extension fetch the Chrome Web Store (old and
  // new hosts), so a probe there always failed and read as a broken
  // NETWORK link, including our own "Install free extension" link. The
  // worker skips these and records `error: 'uncheckable'`.
  function isUncheckable(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return false;
    }
    const host = u.hostname.toLowerCase();
    if (host === 'chromewebstore.google.com') return true;
    return host === 'chrome.google.com' && /^\/webstore(\/|$)/.test(u.pathname);
  }

  // 2xx/3xx/4xx/5xx by status; a status of 0 (fetch threw/aborted) reads
  // `error` — 'timeout' for the AbortController timeout, 'uncheckable' for
  // a host Chrome won't let us fetch (#46), everything else (DNS failure,
  // connection refused, CORS-opaque, etc.) is 'network'.
  function classify(result) {
    const status = result && result.status;
    if (status === 0) {
      if (result.error === 'uncheckable') return 'uncheckable';
      return result.error === 'timeout' ? 'timeout' : 'network';
    }
    if (status >= 200 && status < 300) return 'ok';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client';
    if (status >= 500 && status < 600) return 'server';
    return 'network';
  }

  function groupResults(results) {
    // 'uncheckable' is neither OK nor broken: it never counts in `broken`.
    const groups = { ok: [], redirect: [], client: [], server: [], timeout: [], network: [], uncheckable: [] };
    for (const r of results || []) {
      groups[classify(r)].push(r);
    }
    Object.keys(groups).forEach(k => {
      groups[k].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    });
    const counts = {};
    Object.keys(groups).forEach(k => { counts[k] = groups[k].length; });
    const broken = counts.client + counts.server + counts.timeout + counts.network;
    return { groups, counts, broken };
  }

  // CSV-ready rows: url, status, class, finalUrl, anchor, rel, type
  // (internal/external), ms, error.
  function resultRows(results) {
    return (results || []).map(r => ({
      url: r.url,
      status: r.status,
      class: classify(r),
      finalUrl: r.finalUrl || null,
      anchor: r.text || '',
      rel: r.rel != null ? r.rel : null,
      type: r.internal ? 'internal' : 'external',
      ms: r.ms,
      error: r.error || null
    }));
  }

  // True once every planned URL has produced a result AND nothing is still
  // in flight. The worker's pump() uses this — rather than a bare
  // `doneCount >= total` — as the single source of truth for when to post
  // `{ type: 'done' }`, so a scheduler change can't accidentally fire it
  // while a probe is still outstanding.
  function isComplete(doneCount, total, inflight) {
    return (inflight || 0) <= 0 && doneCount >= total;
  }

  return {
    normalizeUrl,
    hostKey,
    isUncheckable,
    planChecks,
    pickNext,
    classify,
    groupResults,
    resultRows,
    isComplete
  };
});
