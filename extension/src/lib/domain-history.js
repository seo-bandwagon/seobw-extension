// SEO Bandwagon — Page history summarizer (the popup's history strip)
//
// Pure logic, no chrome/fetch dependency, so it's fully unit-testable and
// shareable between the popup and (later) any other surface that wants a
// "what do we already know about this URL" strip.
//
// Dual-export pattern (see src/lib/api.js / src/lib/sync-state.js): attaches
// to `globalThis.SBWDomainHistory` when loaded as a classic <script>, and
// exports via CommonJS when loaded by Vitest / Node.
//
// Input comes from one server call (src/lib/api.js: SBW.capturesForUrl):
//   captures = { url, domain, totalCaptures, captures: [{ id, url, createdAt,
//              overallScore | seoScore: { score }, ... }] }
//
// 1.10.3:
// - Only this page's captures count. The route falls back to the account's
//   captures of other pages on the domain when the page has none, and the
//   strip showed those as this URL's history; now each capture's own `url`
//   must be this page (samePage below), and the line says "this page".
// - No "Domain avg": it came from GET /api/domain/:domain/quick, whose
//   `domain_stats` pools every account's captures of the host (the table has
//   no user column), the same pooled figure 1.10.2 took off the Google
//   results bar. The popup no longer asks for it; nothing on the website
//   changed.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWDomainHistory = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const CACHE_TTL_MS = 10 * 60 * 1000;

  // How much clock skew (client vs. server) to tolerate when deciding
  // whether a capture returned by the server is actually "prior" history vs.
  // the capture the popup itself just posted moments ago. See `excludeSince`
  // on summarize().
  const EXCLUDE_SKEW_MS = 5000;

  function cacheKey(kind, value) {
    return `dh:${kind}:${value}`;
  }

  function isFresh(entry, now) {
    if (!entry) return false;
    return (now - entry.at) < CACHE_TTL_MS;
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  // A capture's score: overallScore first, then seoScore.score. Returns
  // null when neither field carries a number.
  function captureScore(capture) {
    if (!capture) return null;
    if (typeof capture.overallScore === 'number') return capture.overallScore;
    if (capture.seoScore && typeof capture.seoScore.score === 'number') return capture.seoScore.score;
    return null;
  }

  // Newest-first by createdAt; falls back to array order when dates tie or
  // are unparseable.
  function newestCapture(captures) {
    if (!captures || !captures.length) return null;
    return captures.reduce((newest, c) => {
      if (!newest) return c;
      const a = Date.parse(c.createdAt) || 0;
      const b = Date.parse(newest.createdAt) || 0;
      return a > b ? c : newest;
    }, null);
  }

  function signed(n) {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  // A page address as the captures route matches it: http and https, with
  // and without `www.`, with and without a trailing slash are one page; the
  // query counts, the fragment does not. '' for anything unparseable.
  function pageKey(url) {
    if (!url) return '';
    try {
      const u = new URL(/^https?:\/\//i.test(String(url)) ? url : `https://${url}`);
      const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
      return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${u.search}`;
    } catch (e) {
      return '';
    }
  }

  function samePage(a, b) {
    const ka = pageKey(a);
    return !!ka && ka === pageKey(b);
  }

  // The route's answer cut to the captures of `pageUrl` itself.
  function onlyThisPage(captures, pageUrl) {
    const list = ((captures && captures.captures) || []).filter(c => c && samePage(c.url, pageUrl));
    return { captures: list, totalCaptures: list.length };
  }

  // Drops any capture the server returned that was actually created at/after
  // `excludeSince` (minus a skew allowance) — i.e. the capture the popup's
  // own autoSaveCapture()/syncCapture() just posted for *this* analysis,
  // which can land before capturesForUrl() is read back (see popup.js's
  // loadDomainHistory). Without this, a never-before-seen URL can render its
  // own just-posted capture as "1 prior capture", and that gets cached for
  // CACHE_TTL_MS. `totalCaptures` is reduced by the same count so the
  // "N prior captures" line stays consistent with what's actually prior.
  function excludeJustPosted(captures, excludeSince) {
    const list = (captures && captures.captures) || [];
    const total = (captures && captures.totalCaptures) || 0;

    if (typeof excludeSince !== 'number') {
      return { captures: list, totalCaptures: total };
    }

    const threshold = excludeSince - EXCLUDE_SKEW_MS;
    const kept = list.filter(c => !(Date.parse(c.createdAt) >= threshold));
    const excludedCount = list.length - kept.length;

    return { captures: kept, totalCaptures: Math.max(0, total - excludedCount) };
  }

  function buildUrlLine(captures, currentScore, excludeSince) {
    if (!captures || !captures.totalCaptures) return { urlLine: null, delta: null };

    const filtered = excludeJustPosted(captures, excludeSince);
    if (!filtered.totalCaptures) return { urlLine: null, delta: null };

    const base = `This page: ${plural(filtered.totalCaptures, 'earlier capture')}`;
    const last = newestCapture(filtered.captures);
    const lastScore = captureScore(last);

    if (lastScore === null) {
      return { urlLine: base, delta: null };
    }

    if (typeof currentScore !== 'number') {
      return { urlLine: `${base} · last ${lastScore}`, delta: null };
    }

    const delta = currentScore - lastScore;
    return { urlLine: `${base} · last ${lastScore} (${signed(delta)})`, delta };
  }

  // pageUrl: the page the popup analyzed; only its own captures count.
  // excludeSince: ms timestamp of when the current analysis started (see
  // popup.js's loadDomainHistory). Optional — omitting it disables the
  // just-posted filter (used by callers that don't have a race to guard
  // against, and by existing tests that predate it).
  function summarize({ captures, pageUrl, currentScore, excludeSince } = {}) {
    const own = onlyThisPage(captures, pageUrl);
    const { urlLine, delta } = buildUrlLine(own, currentScore, excludeSince);
    return { urlLine, delta, hasHistory: !!urlLine };
  }

  return {
    CACHE_TTL_MS,
    cacheKey,
    isFresh,
    pageKey,
    samePage,
    summarize
  };
});
