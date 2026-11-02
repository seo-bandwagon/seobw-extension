// SEO Bandwagon — the worker's side of keyword data on Google (1.13.0)
//
// The keyword strip (src/overlay/serp-keywords.js) can't call
// seobandwagon.com itself, so it asks the worker ('serpKeywords',
// 'serpKeywordAdd'), which asks this. Like the figures
// (src/lib/serp-figures-service.js), each request:
//   1. needs a key: without one, nothing is sent ('no_key': "Connect free
//      to see keyword data"; core features need no account);
//   2. goes through the consent module (src/lib/consent.js): the keyword
//      data switch is on and the person said yes to sending the search
//      (`keywordData`), or nothing is sent ('needs_consent');
//   3. is answered from this session's keyword data where it can be, kept
//      in chrome.storage.session only (cleared when the browser closes);
//   4. sends what's left in one POST /api/v1/keywords/metrics, the search
//      first, and keeps the plan, the allowance and `lookups` of the last
//      answer for the popup ('serpKeywordsStatus').
// A 429 holds every request until its Retry-After has passed. "Add to my
// keywords" (POST /api/v1/keywords) passes the same two gates.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpKeywordsService` when loaded via importScripts, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpKeywordsService = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const CACHE_PREFIX = 'kw:';
  const TRACKED_PREFIX = 'kwTracked:';
  const STATUS_KEY = 'serpKeywordsStatus';
  const HOLD_KEY = 'serpKeywordsHold';
  // Keywords kept for at most this many a session; the oldest go.
  const CACHE_MAX = 2000;

  /**
   * deps:
   *   keywords     SBWSerpKeywords (src/lib/serp-keywords.js)
   *   figures      SBWSerpFigures (plan, allowance and `lookups`)
   *   hasKey()     → Promise<boolean>
   *   consent(flow, { hasKey }) → Promise<{ ok, reason }>
   *   post(body)   → Promise<sbwFetch result> (SBW.keywordMetrics)
   *   add(body)    → Promise<sbwFetch result> (SBW.addKeyword)
   *   storage      chrome.storage.session
   *   now()        → ms
   */
  function createSerpKeywordsService(deps) {
    const K = deps.keywords;
    const F = deps.figures;
    const now = deps.now || (() => Date.now());

    const cacheKey = (mk, keyword) => CACHE_PREFIX + mk + ':' + keyword;
    const trackedKey = (mk, keyword) => TRACKED_PREFIX + mk + ':' + keyword;

    async function read(keys) {
      try { return (await deps.storage.get(keys)) || {}; } catch (e) { return {}; }
    }

    async function writeCache(entries) {
      if (!Object.keys(entries).length) return;
      try {
        await deps.storage.set(entries);
        const all = await deps.storage.get(null);
        const cached = Object.entries(all || {}).filter(([k]) => k.startsWith(CACHE_PREFIX));
        if (cached.length > CACHE_MAX) {
          cached.sort((a, b) => ((a[1] && a[1].at) || 0) - ((b[1] && b[1].at) || 0));
          await deps.storage.remove(cached.slice(0, cached.length - CACHE_MAX).map(([k]) => k));
        }
      } catch (e) { /* session storage full or gone: the keyword data still shows */ }
    }

    async function status() {
      const got = await read(STATUS_KEY);
      return got[STATUS_KEY] || null;
    }

    async function hold() {
      const got = await read(HOLD_KEY);
      const until = got[HOLD_KEY];
      return typeof until === 'number' && until > now() ? until : 0;
    }

    function answerStanding(last) {
      const s = last || {};
      const out = { plan: s.plan || null, allowance: s.allowance || null, lookups: s.lookups || null, market: s.market || null };
      out.notice = K.lookupNotice(out);
      return out;
    }

    /**
     * Has this browser a key, and did the person say yes to keyword data?
     * Read here only; nothing is sent. The strip says "Connect free" up
     * front from it.
     */
    async function ready() {
      const hasKey = await deps.hasKey();
      const consent = await deps.consent('keywordData', { hasKey });
      return { hasKey, accepted: !!consent.ok, reason: consent.ok ? null : consent.reason };
    }

    /**
     * `req`: { query, related: [text], paa: [text], gl?, hl? } as shown on
     * the page. Answers
     *   { state: 'ok', results: { [keyword]: figures }, tracked, market, plan, allowance, lookups, notice }
     *   { state: 'no_key' | 'needs_consent' | 'not_a_keyword', reason? }
     *   { state: 'error', code, retryAfter?, results, tracked }
     */
    async function lookup(req, opts) {
      const r = req || {};
      const asked = K.request(r.query, r.related, r.paa);
      if (!asked.search) return { state: 'not_a_keyword' };
      const hasKey = await deps.hasKey();
      if (!hasKey) return { state: 'no_key' };
      const consent = await deps.consent('keywordData', { hasKey });
      if (!consent.ok) return { state: 'needs_consent', reason: consent.reason };

      const market = {};
      if (typeof r.gl === 'string' && /^[a-z]{2}$/.test(r.gl)) market.gl = r.gl;
      if (typeof r.hl === 'string' && /^[a-z]{2}$/.test(r.hl)) market.hl = r.hl;
      const mk = K.marketKey(market);
      const search = asked.search.keyword;
      const fresh = !!(opts && opts.fresh);

      const got = await read(asked.keywords.map((k) => cacheKey(mk, k)).concat(trackedKey(mk, search)));
      const results = {};
      const misses = [];
      asked.keywords.forEach((k) => {
        const hit = got[cacheKey(mk, k)];
        if (hit && hit.figures && !fresh) results[k] = hit.figures;
        else misses.push(k);
      });
      const trackedHit = got[trackedKey(mk, search)];
      let last = await status();
      if (!misses.length && trackedHit && !fresh) {
        return Object.assign({ state: 'ok', results, tracked: trackedHit.tracked || null }, answerStanding(last));
      }

      const heldUntil = await hold();
      if (heldUntil) {
        return { state: 'error', code: 'rate_limited', retryAfter: Math.ceil((heldUntil - now()) / 1000), results, tracked: trackedHit ? trackedHit.tracked : null };
      }

      // The search goes first, as the route reads it, even when it was kept.
      const body = Object.assign({ keywords: [search].concat(misses.filter((k) => k !== search)) }, market);
      const res = await deps.post(body);
      if (!res || !res.ok) {
        const details = res && res.status === 400 && res.data && res.data.details;
        const code = details && (details.gl || details.hl) ? 'unsupported_market' : (res && res.code) || 'network';
        if (code === 'rate_limited') {
          try { await deps.storage.set({ [HOLD_KEY]: now() + 1000 * (Number(res.retryAfter) || 60) }); } catch (e) { /* noop */ }
        }
        return { state: 'error', code, retryAfter: res && res.retryAfter, results, tracked: trackedHit ? trackedHit.tracked : null };
      }
      const data = res.data || {};
      const s = K.standing(data);
      last = { plan: s.plan, allowance: s.allowance, lookups: s.lookups, market: K.marketAnswered(data), at: now() };
      try { await deps.storage.set({ [STATUS_KEY]: last }); } catch (e) { /* noop */ }

      const answered = K.resultsByKeyword(data);
      const keep = {};
      body.keywords.forEach((k) => {
        if (answered[k]) {
          results[k] = answered[k];
          if (F.keepable(s.lookups)) keep[cacheKey(mk, k)] = { figures: answered[k], at: now() };
        }
      });
      const tracked = K.trackedOf(data.tracked);
      keep[trackedKey(mk, search)] = { tracked, at: now() };
      await writeCache(keep);
      return Object.assign({ state: 'ok', results, tracked }, answerStanding(last));
    }

    /**
     * "Add to my keywords": `req` { keyword (as shown), gl?, hl?, trackerId? }.
     * Answers SBWSerpKeywords.addResult's states, or 'no_key',
     * 'needs_consent', 'not_a_keyword'.
     */
    async function add(req) {
      const r = req || {};
      const keyword = K.keywordOf(r.keyword);
      if (!keyword) return { state: 'not_a_keyword' };
      const hasKey = await deps.hasKey();
      if (!hasKey) return { state: 'no_key' };
      const consent = await deps.consent('keywordData', { hasKey });
      if (!consent.ok) return { state: 'needs_consent', reason: consent.reason };
      const body = { keyword };
      if (typeof r.gl === 'string' && /^[a-z]{2}$/.test(r.gl)) body.gl = r.gl;
      if (typeof r.hl === 'string' && /^[a-z]{2}$/.test(r.hl)) body.hl = r.hl;
      if (typeof r.trackerId === 'string' || typeof r.trackerId === 'number') body.trackerId = r.trackerId;
      const out = K.addResult(await deps.add(body));
      if (out.state === 'added' || out.state === 'already') {
        // Its rank history is asked again next time, not read from the session.
        try { await deps.storage.remove(trackedKey(K.marketKey(body), keyword)); } catch (e) { /* noop */ }
      }
      return out;
    }

    return { lookup, add, ready, status, CACHE_PREFIX, TRACKED_PREFIX, STATUS_KEY, HOLD_KEY };
  }

  return { createSerpKeywordsService, CACHE_PREFIX, TRACKED_PREFIX, STATUS_KEY, HOLD_KEY, CACHE_MAX };
});
