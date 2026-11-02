// SEO Bandwagon — the worker's side of the figures under Google results (1.11.0)
//
// The overlay can't call seobandwagon.com itself (a content script runs
// under google.com's origin), so it asks the worker ('serpFigures'), which
// asks this. In order, each request:
//   1. needs a key: without one, nothing is sent ('no_key': "Connect free
//      to see figures"; core features need no account);
//   2. goes through the consent module (src/lib/consent.js): the figures'
//      switch is on and the person accepted sending result addresses in
//      Options, or nothing is sent ('needs_consent');
//   3. is answered from this session's figures where it can be. Figures are
//      kept in chrome.storage.session only (cleared when the browser
//      closes): the site caches DataForSEO's figures, the extension never
//      does beyond the session;
//   4. sends what's left, 10 results a call, to POST /api/v1/serp/metrics,
//      and keeps the plan, the allowance and `lookups` of the last answer
//      for the popup ('serpFiguresStatus').
// A 429 holds every request until its Retry-After has passed, so a page
// that keeps changing can't spend the account's 30 a minute.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpFiguresService` when loaded via importScripts, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpFiguresService = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const CACHE_PREFIX = 'serpFig:';
  const STATUS_KEY = 'serpFiguresStatus';
  const HOLD_KEY = 'serpFiguresHold';
  // Figures kept for at most this many results a session; the oldest go.
  const CACHE_MAX = 600;

  /**
   * deps:
   *   figures      SBWSerpFigures (src/lib/serp-figures.js)
   *   hasKey()     → Promise<boolean>
   *   consent(flow, { hasKey }) → Promise<{ ok, reason }>
   *   post(results) → Promise<sbwFetch result> (SBW.serpMetrics)
   *   storage      chrome.storage.session
   *   now()        → ms
   */
  function createSerpFiguresService(deps) {
    const F = deps.figures;
    const now = deps.now || (() => Date.now());

    async function readCache(items) {
      const keys = items.map((i) => CACHE_PREFIX + F.cacheKey(i));
      let got = {};
      try { got = (await deps.storage.get(keys)) || {}; } catch (e) { got = {}; }
      return got;
    }

    async function writeCache(entries) {
      const keys = Object.keys(entries);
      if (!keys.length) return;
      try {
        await deps.storage.set(entries);
        const all = await deps.storage.get(null);
        const cached = Object.entries(all || {}).filter(([k]) => k.startsWith(CACHE_PREFIX));
        if (cached.length > CACHE_MAX) {
          cached.sort((a, b) => ((a[1] && a[1].at) || 0) - ((b[1] && b[1].at) || 0));
          await deps.storage.remove(cached.slice(0, cached.length - CACHE_MAX).map(([k]) => k));
        }
      } catch (e) { /* session storage full or gone: the figures still show */ }
    }

    async function status() {
      try {
        const got = await deps.storage.get(STATUS_KEY);
        return (got && got[STATUS_KEY]) || null;
      } catch (e) {
        return null;
      }
    }

    async function hold() {
      try {
        const got = await deps.storage.get(HOLD_KEY);
        const until = got && got[HOLD_KEY];
        return typeof until === 'number' && until > now() ? until : 0;
      } catch (e) {
        return 0;
      }
    }

    /**
     * `items`: [{ key, url, domain }] (SBWSerpFigures.requestItems). Answers
     *   { state: 'ok', results: { [key]: figures }, plan, allowance, lookups, notice }
     *   { state: 'no_key' | 'needs_consent', reason? }
     *   { state: 'error', code, retryAfter?, results } (results: what the session had)
     */
    async function lookup(items, opts) {
      const list = (items || []).filter((i) => i && i.key && i.domain);
      const hasKey = await deps.hasKey();
      if (!hasKey) return { state: 'no_key' };
      const consent = await deps.consent('serpFigures', { hasKey });
      if (!consent.ok) return { state: 'needs_consent', reason: consent.reason };

      const results = {};
      const cached = await readCache(list);
      const misses = [];
      list.forEach((item) => {
        const hit = cached[CACHE_PREFIX + F.cacheKey(item)];
        if (hit && hit.figures && !(opts && opts.fresh)) results[item.key] = hit.figures;
        else misses.push(item);
      });

      let last = await status();
      if (!misses.length) return Object.assign({ state: 'ok', results }, answerStanding(last));

      const heldUntil = await hold();
      if (heldUntil) return { state: 'error', code: 'rate_limited', retryAfter: Math.ceil((heldUntil - now()) / 1000), results };

      const fresh = {};
      for (const batch of F.batches(misses, F.MAX_PER_CALL)) {
        const res = await deps.post(batch.map((i) => ({ url: i.url, domain: i.domain })));
        if (!res || !res.ok) {
          const code = (res && res.code) || 'network';
          if (code === 'rate_limited') {
            try { await deps.storage.set({ [HOLD_KEY]: now() + 1000 * (Number(res.retryAfter) || 60) }); } catch (e) { /* noop */ }
          }
          await writeCache(fresh);
          return { state: 'error', code, retryAfter: res && res.retryAfter, results };
        }
        const data = res.data || {};
        const s = F.standing(data);
        last = { plan: s.plan, allowance: s.allowance, lookups: s.lookups, at: now() };
        try { await deps.storage.set({ [STATUS_KEY]: last }); } catch (e) { /* noop */ }
        const answered = Array.isArray(data.results) ? data.results : [];
        batch.forEach((item, i) => {
          const figures = F.resultFigures(answered[i]);
          results[item.key] = figures;
          if (F.keepable(s.lookups)) fresh[CACHE_PREFIX + F.cacheKey(item)] = { figures, at: now() };
        });
      }
      await writeCache(fresh);
      return Object.assign({ state: 'ok', results }, answerStanding(last));
    }

    function answerStanding(last) {
      const s = last || {};
      const out = { plan: s.plan || null, allowance: s.allowance || null, lookups: s.lookups || null };
      out.notice = F.lookupNotice(out);
      return out;
    }

    return { lookup, status, CACHE_PREFIX, STATUS_KEY, HOLD_KEY };
  }

  return { createSerpFiguresService, CACHE_PREFIX, STATUS_KEY, HOLD_KEY, CACHE_MAX };
});
