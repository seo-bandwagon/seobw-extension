// SEO Bandwagon — SERP overlay domain stats, worker side (#50)
//
// The results-page overlay (src/overlay/serp-overlay.js) shows a stat per
// result domain. Until 1.7.6 it cached those in chrome.storage.session from
// the content script, which Chrome refuses ("Access to storage is not allowed
// from this context"): every read missed, every set threw, and every results
// page re-requested every domain. It also reached the API through a generic
// `sbwFetch` bridge that skipped the "no key, no request" rule, so a
// signed-out user's result domains were POSTed anyway (and answered 401).
//
// Now the overlay sends only bare domains to the worker ({ action:
// 'serpStats', domains }) and this module answers: a 10-minute per-domain
// cache in chrome.storage.session (the worker may use it, and one cache now
// serves every tab), then SBW.quickBatch for the rest, which returns
// `no_key` without a request when no API key is stored.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpStats` when loaded via importScripts, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpStats = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const CACHE_TTL_MS = 10 * 60 * 1000;
  const MAX_DOMAINS = 20; // quick-batch's own per-request cap
  const KEY_PREFIX = 'sbwSerpStat::';
  // A bare hostname only: the overlay must never send a query, title or URL.
  const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

  function statKey(domain) {
    return KEY_PREFIX + domain;
  }

  function createSerpStats(deps) {
    const { quickBatch, storage, now = () => Date.now() } = deps;

    // -> { ok, status, code, data: { results: { domain: stat|null }, invalid } }
    // or the failed quick-batch reply ({ ok: false, code: 'no_key' | … }).
    async function lookup(domains) {
      const wanted = [];
      const seen = new Set();
      (Array.isArray(domains) ? domains : []).forEach((d) => {
        const domain = String(d || '').toLowerCase();
        if (DOMAIN_RE.test(domain) && !seen.has(domain) && wanted.length < MAX_DOMAINS) {
          seen.add(domain);
          wanted.push(domain);
        }
      });
      if (!wanted.length) return { ok: true, status: 200, code: 'ok', data: { results: {}, invalid: [] } };

      let cached = {};
      try {
        cached = (await storage.get(wanted.map(statKey))) || {};
      } catch (e) {
        cached = {};
      }
      const results = {};
      const missing = [];
      const t = now();
      wanted.forEach((domain) => {
        const entry = cached[statKey(domain)];
        if (entry && typeof entry.at === 'number' && t - entry.at < CACHE_TTL_MS) results[domain] = entry.stat;
        else missing.push(domain);
      });
      if (!missing.length) return { ok: true, status: 200, code: 'ok', data: { results, invalid: [] } };

      const reply = await quickBatch(missing);
      if (!reply || reply.ok === false) return reply || { ok: false, status: 0, data: null, code: 'network' };

      const fetched = (reply.data && reply.data.results) || {};
      const toStore = {};
      missing.forEach((domain) => {
        const stat = Object.prototype.hasOwnProperty.call(fetched, domain) ? fetched[domain] : null;
        results[domain] = stat;
        toStore[statKey(domain)] = { at: t, stat };
      });
      try { await storage.set(toStore); } catch (e) { /* stats just aren't cached this time */ }
      return { ok: true, status: reply.status, code: 'ok', data: { results, invalid: (reply.data && reply.data.invalid) || [] } };
    }

    return { lookup };
  }

  return { createSerpStats, statKey, CACHE_TTL_MS, MAX_DOMAINS };
});
