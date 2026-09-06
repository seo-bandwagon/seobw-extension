// SEO Bandwagon — optional <all_urls> permission helper
//
// Broad host access is OPTIONAL and requested on first use, never at
// install. This module owns the two chrome.permissions calls every
// third-party-fetching feature (link checker, and later hreflang, redirect
// probe, HTML-vs-DOM diff, UA switcher) gates on.
//
// requestAllUrls() MUST be called synchronously from a user gesture (a
// button's click handler) — chrome.permissions.request() only succeeds when
// invoked that way; calling it from a timer, page load, or the background
// service worker will reject or resolve false. Callers are responsible for
// wiring it to an actual click.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWPerms` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWPerms = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Amended in Task 2's fix round (ruling I-8) to cover both ways this
  // permission gets used — a plain fetch (link checker, hreflang, redirect
  // probe) AND opening a URL in a background tab (Indexability's
  // "trace-a-URL"), which the original wording ("fetch pages... from your
  // browser") didn't describe. Later features reuse this string verbatim.
  const ALL_URLS_REASON = 'To check links, hreflang alternates and redirects, the extension has to look at pages on other sites from your browser: it fetches them without cookies, and when you ask it to trace a URL it opens that URL in a background tab like any normal visit. Nothing it sees on those sites is sent to SEO Bandwagon. You can revoke this at any time from the extensions page.';

  function hasAllUrls() {
    return chrome.permissions.contains({ origins: ['<all_urls>'] });
  }

  // Must be invoked from a user gesture — see the module comment above.
  function requestAllUrls() {
    return chrome.permissions.request({ origins: ['<all_urls>'] });
  }

  return {
    ALL_URLS_REASON,
    hasAllUrls,
    requestAllUrls
  };
});
