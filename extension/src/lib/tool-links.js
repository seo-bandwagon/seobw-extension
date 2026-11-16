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

  // Fix round 1, item 2: never forward the raw `opts.pageUrl` string — a
  // page URL with embedded HTTP Basic Auth credentials
  // (`http://user:pw@host/path`) would otherwise carry `user`/`pw` straight
  // into a GSC/PageSpeed/Wayback/Rich-Results URL we open in a new tab.
  // Clearing `username`/`password` on the parsed URL and using its `.href`
  // everywhere (instead of the original string) strips them, and as a
  // side effect normalizes scheme/host casing the same way the browser
  // would.
  function parsePageUrl(pageUrl) {
    if (!pageUrl) return null;
    let parsed;
    try {
      parsed = new URL(pageUrl);
    } catch (e) {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.username = '';
    parsed.password = '';
    return parsed;
  }

  // 1.13.8: the one list of tools, for the right-click menu, the popup's
  // TOOLS row and the page-checks panel. Until 1.13.8 they were three lists
  // (8, 7 and 5 tools). `label` is the short name the rows show, `title` the
  // menu's wording; a `selection` tool needs selected text, so only the menu
  // offers it. `menuId` keeps a menu item's id from before 1.13.8.
  const TOOLS = [
    { kind: 'gsc', label: 'Search Console', title: 'Inspect in Search Console (Domain property)' },
    { kind: 'gsc-prefix', label: 'Search Console (URL prefix)', title: 'Inspect in Search Console (URL-prefix property)' },
    { kind: 'wayback', label: 'Wayback Machine', title: 'Open in Wayback Machine' },
    { kind: 'pagespeed', label: 'PageSpeed Insights', title: 'Open in PageSpeed Insights' },
    { kind: 'rich-results', label: 'Rich Results Test', title: 'Test with Rich Results Test' },
    { kind: 'site-search', label: 'site: search', title: 'site: search for this domain' },
    { kind: 'quoted-search', label: 'Search the selection', title: 'Search Google for the selected text in quotes', selection: true, menuId: 'selection-search' },
    { kind: 'sitemap', label: 'sitemap.xml', title: 'Open sitemap.xml' },
    { kind: 'robots', label: 'robots.txt', title: 'Open robots.txt' }
  ];

  function pageTools() {
    return TOOLS.filter(t => !t.selection);
  }

  function menuId(tool) {
    return 'sbw-tools-' + (tool.menuId || tool.kind);
  }

  // A Domain property is named for the domain: the host in lower case with
  // one leading "www." dropped (the website's rule for picking a property,
  // sc-domain first). Until 1.13.8 the link named only the URL-prefix
  // property, and failed for everyone who verified the domain.
  function domainProperty(hostname) {
    return 'sc-domain:' + String(hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function toolUrl(kind, opts) {
    opts = opts || {};
    const parsed = parsePageUrl(opts.pageUrl);
    if (!parsed) return null;

    const origin = parsed.origin;
    const pageUrl = parsed.href;

    switch (kind) {
      case 'gsc':
        return 'https://search.google.com/search-console/inspect?resource_id=' +
          encodeURIComponent(domainProperty(parsed.hostname)) + '&id=' + encodeURIComponent(pageUrl);

      case 'gsc-prefix':
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
        // Fix round 1, item 13: a literal `"` inside the selection would
        // otherwise close the wrapping quotes early once encoded/decoded by
        // Google's own query parsing — replace with a space before capping
        // and quoting, then trim so a quote at either edge doesn't leave a
        // stray trailing/leading space.
        const raw = (opts.selection || '').slice(0, SELECTION_MAX_CHARS).replace(/"/g, ' ').trim();
        if (!raw) return null;
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
    TOOLS,
    pageTools,
    menuId,
    domainProperty,
    toolUrl
  };
});
