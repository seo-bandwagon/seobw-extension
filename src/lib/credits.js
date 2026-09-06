// SEO Bandwagon — attribution/credits data for the popup's "About &
// credits" panel (src/popup/structured-data.js)
//
// The ledger's binding attribution rule: required-property lists that
// derive from schema.org (CC BY-SA 3.0) and Google Search Central
// structured-data documentation (CC BY 4.0) must be credited in an
// About/credits view. This module is that credit list — data only, no DOM
// — so the popup UI can render it without hardcoding a single URL or type
// name inline (and so Task 7's additional credits lines are one more
// entry here, not a UI rewrite).
//
// `entries` mixes three `section`s:
//   - 'license'  — the two licenses themselves (schema.org, Google Search
//     Central), each with its own `note` (the license name/version).
//   - 'type'     — one row per structured-data type category
//     src/lib/structured-data.js validates against, `url` pointing at
//     exactly the page (Google Search Central feature doc or schema.org
//     type page) that category's required/recommended list and `sourceUrl`
//     were derived from — read straight off SBWSchema.SOURCE_URLS so this
//     list can never drift from the one the validator actually uses.
//   - 'tool'     — the third-party tools the "SEO Bandwagon tools" context
//     menu and popup TOOLS row (Task 7, src/lib/tool-links.js) link out
//     to. Named nominatively, no logos (ledger ruling); each carries the
//     same disclaimer text so nobody reads a linked-to tool as an
//     endorsement or a partnership.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWCredits` when loaded as a classic <script> (after
// src/lib/structured-data.js — see popup.html), and exports via CommonJS
// when loaded by Vitest / Node (after an explicit `await
// import('../../src/lib/structured-data.js')` in the test file, for the
// same reason).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWCredits = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  function schemaSourceUrls() {
    if (typeof globalThis !== 'undefined' && globalThis.SBWSchema && globalThis.SBWSchema.SOURCE_URLS) {
      return globalThis.SBWSchema.SOURCE_URLS;
    }
    return {};
  }

  // One label per type category the brief lists (Review + AggregateRating
  // share a row — both derive from the same Google "review-snippet" doc).
  const TYPE_ROWS = [
    { type: 'Article', title: 'Article (incl. NewsArticle, BlogPosting)' },
    { type: 'Product', title: 'Product' },
    { type: 'LocalBusiness', title: 'LocalBusiness (incl. Restaurant, Store, Attorney, Dentist, and other subtypes)' },
    { type: 'Organization', title: 'Organization' },
    { type: 'Person', title: 'Person' },
    { type: 'BreadcrumbList', title: 'BreadcrumbList' },
    { type: 'FAQPage', title: 'FAQPage' },
    { type: 'HowTo', title: 'HowTo' },
    { type: 'Recipe', title: 'Recipe' },
    { type: 'Event', title: 'Event' },
    { type: 'VideoObject', title: 'VideoObject' },
    { type: 'Review', title: 'Review / AggregateRating' },
    { type: 'WebSite', title: 'WebSite' },
    { type: 'WebPage', title: 'WebPage' },
    { type: 'JobPosting', title: 'JobPosting' }
  ];

  // Task 7, item F — the tool links opened by the context menu / popup
  // TOOLS row (src/lib/tool-links.js). Not affiliated with, endorsed by,
  // or partnered with SEO Bandwagon; linked purely for identification.
  const TOOL_ROWS = [
    { title: 'Google Search Console', url: 'https://search.google.com/search-console' },
    { title: 'PageSpeed Insights', url: 'https://pagespeed.web.dev/' },
    { title: 'Rich Results Test', url: 'https://search.google.com/test/rich-results' },
    { title: 'Wayback Machine', url: 'https://web.archive.org/' }
  ];

  const TOOL_NOTE = 'named for identification; not affiliated';

  function buildEntries() {
    const urls = schemaSourceUrls();
    const licenses = [
      {
        section: 'license',
        title: 'schema.org type and property definitions',
        url: 'https://schema.org/docs/terms.html',
        note: 'CC BY-SA 3.0'
      },
      {
        section: 'license',
        title: 'Google Search Central structured-data documentation',
        url: 'https://developers.google.com/search/docs/appearance/structured-data',
        note: 'CC BY 4.0'
      }
    ];
    const types = TYPE_ROWS.map(row => ({
      section: 'type',
      title: row.title,
      url: urls[row.type] || ''
    }));
    const tools = TOOL_ROWS.map(row => ({
      section: 'tool',
      title: row.title,
      url: row.url,
      note: TOOL_NOTE
    }));
    return licenses.concat(types).concat(tools);
  }

  return {
    entries: buildEntries()
  };
});
