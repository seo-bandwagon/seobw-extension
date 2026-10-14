// SEO Bandwagon — what to say when a page can't be analyzed (#89, #63)
//
// src/content/analyzer.js answers `{ action: 'analyze' }` with
// `{ error: 'not-html', kind }` for a tab that isn't an HTML page (a PDF,
// an SVG, a sitemap) and `{ error: 'analysis-failed' }` when the analysis
// throws. Until 1.7.9 the first was scored as a page (a PDF got 25 and
// "Missing title") and the second never answered, so the popup sat on
// "Analyzing page…". The popup and the page-checks panel word both here.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWAnalysisErrors = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // `contentType` is document.contentType. null means "an HTML page".
  function nonHtmlKind(contentType) {
    const t = String(contentType || '').toLowerCase();
    if (!t || t === 'text/html' || t === 'application/xhtml+xml') return null;
    if (t === 'application/pdf') return 'a PDF';
    if (t === 'image/svg+xml') return 'an SVG image';
    if (t.startsWith('image/')) return 'an image';
    if (/(^|[/+])xml$/.test(t)) return 'an XML file, such as a sitemap or a feed';
    if (t === 'application/json' || t.endsWith('+json')) return 'a JSON file';
    if (t.startsWith('text/')) return 'a plain text file';
    return 'a file, not a web page';
  }

  // The analyzer's reply → { title, body } to show, or null for a real result.
  function describe(reply) {
    if (!reply || !reply.error) return null;
    if (reply.error === 'not-html') {
      return {
        title: 'NOT A WEB PAGE',
        body: `This tab shows ${reply.kind || 'a file, not a web page'}. The on-page analysis covers web pages; the tools above still open for this address.`
      };
    }
    return {
      title: "COULDN'T FINISH THE ANALYSIS",
      body: 'Something on this page stopped the analysis. Reload the page and try again.'
    };
  }

  return { nonHtmlKind, describe };
});
