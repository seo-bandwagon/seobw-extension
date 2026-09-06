// SEO Bandwagon — pure row-selection for the popup's headings/images/links
// exports (fix round 1, item 8).
//
// A cached analysis captured before Task 7 shipped has no `headings.outline`
// / `images.list` / `links.list` field at all (older `analyze()` responses
// simply didn't compute them). Exporting from an absent field would either
// throw or silently produce a header-only CSV / an empty clipboard write —
// both confusing, since it looks like "this page has none" rather than
// "re-run the analysis to get this." Each function here returns `null` in
// that case so the popup can disable the corresponding button instead
// (title: "Re-run the analysis to export this"), and a real (possibly
// empty) array otherwise.
//
// `headingsRows` is the one exception with a real fallback: pre-Task-7
// cached data still has the classic h1-h6 arrays (heading extraction
// itself isn't new), just not the combined, ARIA-aware, document-order
// `outline` field — so it's reconstructed from those arrays, in level
// order (not true document order, but still useful, and never disables the
// button unless there's no heading data at all to fall back to).
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWExportRows` when loaded as a classic <script>, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWExportRows = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const HEADING_KEYS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  function headingsRows(data) {
    const h = data && data.headings;
    if (!h) return null;
    if (Array.isArray(h.outline)) return h.outline;

    const hasAnyArray = HEADING_KEYS.some(function (k) { return Array.isArray(h[k]); });
    if (!hasAnyArray) return null;

    const fallback = [];
    HEADING_KEYS.forEach(function (key, i) {
      (h[key] || []).forEach(function (text) {
        fallback.push({ level: i + 1, text: String(text), order: fallback.length + 1 });
      });
    });
    return fallback;
  }

  function imagesRows(data) {
    return (data && data.images && Array.isArray(data.images.list)) ? data.images.list : null;
  }

  function linksRows(data) {
    return (data && data.links && Array.isArray(data.links.list)) ? data.links.list : null;
  }

  return {
    headingsRows: headingsRows,
    imagesRows: imagesRows,
    linksRows: linksRows
  };
});
