// SEO Bandwagon — "SEO Bandwagon tools" URL builder
//
// Pure helper shared by the context-menu handler
// (src/background/service-worker.js's onClicked listener) and the popup's
// TOOLS row (src/popup/tools.js). Every URL is built from `new URL(pageUrl)`
// — never a string-split of the origin — and every user-controlled part
// (the page URL itself, its hostname, a text selection) is percent-encoded
// before it lands in the built URL. A non-http(s) `pageUrl` (chrome://,
// file://, an unparseable string, or none at all) returns null for every
// kind — callers treat null as "do nothing" (the context-menu click and the
// popup row both skip rendering/opening anything for a null result).
//
// Google tools here (Search Console, PageSpeed Insights, Rich Results Test)
// are named nominatively — no logos, per the ledger's binding ruling.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWToolLinks` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWToolLinks = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // A selected-text search is capped at 200 characters BEFORE encoding —
  // a huge selection shouldn't turn into a multi-kilobyte query string.
  const SELECTION_MAX_CHARS = 200;

  function parsePageUrl(pageUrl) {
    if (!pageUrl) return null;
    let parsed;
    try {
      parsed = new URL(pageUrl);
    } catch (e) {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  }

  function toolUrl(kind, opts) {
    opts = opts || {};
    const parsed = parsePageUrl(opts.pageUrl);
    if (!parsed) return null;

    const origin = parsed.origin;
    const pageUrl = opts.pageUrl;

    switch (kind) {
      case 'gsc':
        return 'https://search.google.com/search-console/inspect?resource_id=' +
          encodeURIComponent(origin + '/') + '&id=' + encodeURIComponent(pageUrl);

      case 'wayback':
        return 'https://web.archive.org/web/*/' + encodeURIComponent(pageUrl);

      case 'pagespeed':
        return 'https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(pageUrl);

      case 'rich-results':
        return 'https://search.google.com/test/rich-results?url=' + encodeURIComponent(pageUrl);

      case 'site-search':
        return 'https://www.google.com/search?q=site:' + encodeURIComponent(parsed.hostname);

      case 'quoted-search': {
        const raw = (opts.selection || '').slice(0, SELECTION_MAX_CHARS);
        if (!raw.trim()) return null;
        return 'https://www.google.com/search?q=%22' + encodeURIComponent(raw) + '%22';
      }

      case 'sitemap':
        return origin + '/sitemap.xml';

      case 'robots':
        return origin + '/robots.txt';

      default:
        return null;
    }
  }

  return {
    toolUrl
  };
});
