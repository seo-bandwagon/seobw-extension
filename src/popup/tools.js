// TOOLS row — popup UI (Task 7, item C)
//
// Renders the same list of tool links the "SEO Bandwagon tools" context
// menu offers (src/background/service-worker.js), as a row of small links
// under the popup's own header, above the score hero. Unlike every other
// 1.6.0 feature module, this one isn't a collapsible `section(...)` block —
// it's a plain row, mounted by inserting itself as the first child of
// #content each time renderResults() rebuilds it (see popup.js).
//
// The selection-based "Search Google for the selected text in quotes" tool
// is deliberately NOT included here — the popup has no live text selection
// from the analyzed page to offer, only the context menu (right-click on
// selected text) does. That leaves exactly the 7 page-scoped kinds.
//
// Every URL comes from `globalThis.SBWToolLinks.toolUrl()` (src/lib/
// tool-links.js) — never built here — and every string reaching the DOM,
// URLs included, passes through SBWPopup.esc first.
//
// Dual pattern with the other src/popup/<feature>.js modules: reads shared
// render helpers off `globalThis.SBWPopup` (esc/getCurrentTab — classic
// <script> loads before this file, see popup.html) and pure logic off
// `globalThis.SBWToolLinks`.

(function () {

  const TOOLS = [
    { kind: 'gsc', label: 'Search Console' },
    { kind: 'wayback', label: 'Wayback Machine' },
    { kind: 'pagespeed', label: 'PageSpeed Insights' },
    { kind: 'rich-results', label: 'Rich Results Test' },
    { kind: 'site-search', label: 'site: search' },
    { kind: 'sitemap', label: 'sitemap.xml' },
    { kind: 'robots', label: 'robots.txt' }
  ];

  function popup() {
    return globalThis.SBWPopup || {};
  }

  function esc(s) {
    return (popup().esc || (x => String(x)))(s);
  }

  function mount(container, data) {
    if (!container || typeof globalThis.SBWToolLinks === 'undefined') return;

    const tab = popup().getCurrentTab ? popup().getCurrentTab() : null;
    const pageUrl = (tab && tab.url) || (data && data.url) || '';

    const links = TOOLS
      .map(({ kind, label }) => {
        const url = globalThis.SBWToolLinks.toolUrl(kind, { pageUrl });
        if (!url) return '';
        return `<a href="${esc(url)}" target="_blank" rel="noopener" data-kind="${esc(kind)}">${esc(label)}</a>`;
      })
      .filter(Boolean)
      .join('');

    // A non-http(s) page (chrome://, file://, an extension page) makes
    // every toolUrl() call return null — nothing renders rather than a row
    // of dead links.
    if (!links) return;

    const row = document.createElement('div');
    row.className = 'tools';
    row.innerHTML = links;
    container.insertBefore(row, container.firstChild);
  }

  globalThis.SBWToolsUI = { mount };
})();
