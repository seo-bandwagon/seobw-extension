// SEO Bandwagon — pure redirect-chain / HTTP-header / indexability logic
//
// The background service worker (src/background/service-worker.js) is the
// only thing that can OBSERVE another origin's response headers and
// Location hops (via chrome.webRequest — a manual-redirect fetch() can't
// read a cross-origin Location header, it's opaque). This module owns
// everything pure that happens to those observed events afterward: picking
// the handful of headers the Indexability panel cares about, parsing
// X-Robots-Tag and Link headers, summarizing an observed chain into hops,
// and deciding whether the page is indexable from the DOM + HTTP signals
// together. No chrome/fetch dependency here.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWRedirects` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWRedirects = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Headers whose actual value we keep. content-security-policy and
  // strict-transport-security are handled separately below — the panel
  // only ever shows "present/absent" for those two, never the raw value
  // (a CSP string is long and not actionable for indexability at a glance).
  const VALUE_HEADERS = ['x-robots-tag', 'cache-control', 'content-type', 'link', 'location'];
  const PRESENCE_HEADERS = ['content-security-policy', 'strict-transport-security'];

  // headers: [{ name, value }] as chrome.webRequest hands them (repeated
  // header names appear as separate array entries, not pre-joined).
  function pickHeaders(headers) {
    const list = Array.isArray(headers) ? headers : [];
    const byLower = {};
    list.forEach(h => {
      if (!h || !h.name) return;
      const key = String(h.name).toLowerCase();
      const value = h.value === undefined || h.value === null ? '' : String(h.value);
      if (byLower[key]) byLower[key].push(value);
      else byLower[key] = [value];
    });

    const out = {};
    VALUE_HEADERS.forEach(key => {
      if (byLower[key]) out[key] = byLower[key].join(', ');
    });
    PRESENCE_HEADERS.forEach(key => {
      out[key] = !!byLower[key];
    });
    return out;
  }

  // Known robots directives that themselves carry a `: value` (unlike a
  // user-agent prefix, whose token before the colon is a crawler name, not
  // one of these) — e.g. "unavailable_after: 25-Jun-2026 15:00:00 EST" or
  // "max-snippet: -1" is one directive, not a UA prefix for "-1".
  const KNOWN_DIRECTIVES = [
    'noindex', 'nofollow', 'noarchive', 'nosnippet', 'noodp', 'notranslate',
    'noimageindex', 'none', 'all', 'unavailable_after', 'max-snippet',
    'max-image-preview', 'max-video-preview'
  ];

  function parseXRobotsTag(value) {
    const empty = { directives: [], noindex: false, nofollow: false, agents: [] };
    if (!value) return empty;

    const directiveSet = new Set();
    const agentSet = new Set();

    String(value).split(',').map(s => s.trim()).filter(Boolean).forEach(segment => {
      const m = segment.match(/^([a-z0-9_.-]+)\s*:\s*(.+)$/i);
      if (m && KNOWN_DIRECTIVES.includes(m[1].toLowerCase())) {
        // A known directive that happens to carry its own colon-separated
        // value — keep it whole rather than splitting on the colon.
        directiveSet.add(segment.toLowerCase().replace(/\s+/g, ' ').trim());
        return;
      }

      let body = segment;
      if (m) {
        agentSet.add(m[1].toLowerCase());
        body = m[2];
      }
      body.split(/\s+/).filter(Boolean).forEach(tok => directiveSet.add(tok.toLowerCase()));
    });

    const directives = Array.from(directiveSet);
    return {
      directives,
      noindex: directives.includes('noindex'),
      nofollow: directives.includes('nofollow'),
      agents: Array.from(agentSet)
    };
  }

  // RFC 8288 basics: split on a comma that starts a new "<url>" entry (a
  // comma can legally appear inside a quoted param, but never inside the
  // <...> URL reference itself), then pull url/rel/hreflang out of each.
  function parseLinkHeader(value) {
    if (!value) return [];
    const parts = String(value).split(/,(?=\s*<)/);
    const out = [];

    parts.forEach(part => {
      const urlMatch = part.match(/<([^>]*)>/);
      if (!urlMatch) return;
      const url = urlMatch[1].trim();
      if (!url) return;

      const entry = { url };
      const relMatch = part.match(/;\s*rel\s*=\s*"?([^";]*)"?/i);
      if (relMatch) entry.rel = relMatch[1].trim();
      const hreflangMatch = part.match(/;\s*hreflang\s*=\s*"?([^";]*)"?/i);
      if (hreflangMatch) entry.hreflang = hreflangMatch[1].trim();

      out.push(entry);
    });

    return out;
  }

  // events: ordered { url, statusCode, location?, headers, kind: 'redirect'
  // | 'response' } plus an optional { kind: 'client_redirect', url }. A
  // loop is any URL (redirect `from` or the final `response` url) seen
  // more than once — three hops bouncing A -> B -> A -> B never reaches a
  // 'response' event on its own, so this has to watch every URL, not just
  // compare finalUrl to the first hop.
  function chainSummary(events) {
    const list = Array.isArray(events) ? events : [];
    const hops = [];
    let finalUrl = null;
    let finalStatus = null;
    let hasClientRedirect = false;
    const seen = new Set();
    let loops = false;

    const markSeen = (url) => {
      if (!url) return;
      if (seen.has(url)) loops = true;
      else seen.add(url);
    };

    list.forEach(ev => {
      if (!ev || !ev.kind) return;
      if (ev.kind === 'redirect') {
        hops.push({ from: ev.url, to: ev.location, status: ev.statusCode });
        markSeen(ev.url);
      } else if (ev.kind === 'client_redirect') {
        hasClientRedirect = true;
      } else if (ev.kind === 'response') {
        finalUrl = ev.url;
        finalStatus = ev.statusCode;
        markSeen(ev.url);
      }
    });

    // No explicit terminal 'response' event was recorded (e.g. the capture
    // window closed mid-chain) — fall back to where the last redirect
    // pointed, so the panel still has something to show.
    if (finalUrl === null && hops.length) {
      finalUrl = hops[hops.length - 1].to;
    }

    return { hops, finalUrl, finalStatus, hopCount: hops.length, hasClientRedirect, loops };
  }

  // Drop protocol, a leading "www.", and a trailing slash so
  // https://www.example.com/page/ and http://example.com/page compare
  // equal — a canonical differing only in those is not "pointing
  // elsewhere" in any way a site owner would recognize.
  function normalizeUrlForCompare(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      const path = u.pathname.replace(/\/+$/, '') || '/';
      return `${host}${path}${u.search}`;
    } catch (e) {
      return String(url).trim().replace(/\/+$/, '') || null;
    }
  }

  // { metaRobots, xRobotsTag, finalStatus, canonicalDom, canonicalHeader,
  // pageUrl }. xRobotsTag may be the raw header string or an already-parsed
  // parseXRobotsTag() result — accept both so the popup can pass through
  // whichever it already has on hand.
  function indexability(input) {
    const opts = input || {};
    const reasons = [];

    const metaRobots = String(opts.metaRobots || '').toLowerCase();
    const metaNoindex = /(^|[,\s])noindex([,\s]|$)/.test(metaRobots);

    const xrt = !opts.xRobotsTag ? null
      : (typeof opts.xRobotsTag === 'string' ? parseXRobotsTag(opts.xRobotsTag) : opts.xRobotsTag);
    const headerNoindex = !!(xrt && xrt.noindex);
    const headerNofollow = !!(xrt && xrt.nofollow);

    const finalStatus = typeof opts.finalStatus === 'number' ? opts.finalStatus : null;
    const isErrorStatus = finalStatus !== null && finalStatus >= 400;

    const canonicalRaw = opts.canonicalDom || opts.canonicalHeader || null;
    const canonicalNorm = normalizeUrlForCompare(canonicalRaw);
    const pageNorm = normalizeUrlForCompare(opts.pageUrl);
    const canonicalMatches = (canonicalNorm && pageNorm) ? (canonicalNorm === pageNorm) : null;

    if (metaNoindex) reasons.push('noindex (meta robots)');
    if (headerNoindex) reasons.push('noindex (X-Robots-Tag)');
    if (isErrorStatus) reasons.push(`HTTP ${finalStatus}`);
    if (canonicalMatches === false) reasons.push('canonical points to another URL');

    return {
      indexable: reasons.length === 0,
      reasons,
      canonicalMatches,
      signals: {
        metaNoindex,
        headerNoindex,
        headerNofollow,
        finalStatus,
        canonicalDom: opts.canonicalDom || null,
        canonicalHeader: opts.canonicalHeader || null
      }
    };
  }

  return {
    pickHeaders,
    parseXRobotsTag,
    parseLinkHeader,
    chainSummary,
    indexability
  };
});
