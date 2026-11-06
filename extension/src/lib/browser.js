// SEO Bandwagon — the browser this build is for (1.13.6)
//
// One package per store: `npm run zip -- --target chrome|edge`. Everything
// that differs between them for a user lives here: the browser's name, its
// store and the review page there, what it calls a private window and the
// switch that lets an extension into one, the store pages no extension may
// read, the default shortcut, the utm_source on links to seobandwagon.com,
// the name of seobandwagon.com's Connect button the options page points to,
// and which Chrome-only parts ship (the new tab with its Neon themes, the
// welcome and uninstall pages on the site). Every user-facing string that
// would name a browser or a store reads it from here, so the Edge package
// names no other browser (Microsoft Edge Add-ons policy 1.1.2).
//
// The source holds the Chrome values, so extension/ loads unpacked as the
// Chrome build. scripts/build-zip.mjs writes the target's values from
// scripts/targets/<target>.mjs over the block between the two TARGET
// lines; tests/unit/browser.test.js fails when the block and
// scripts/targets/chrome.json differ.
//
// Content scripts on Google and Search Console don't load this file (that
// would change the Chrome manifest's script lists): the worker's answers
// carry the words those few messages need.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWBrowser` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWBrowser = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // BEGIN TARGET VALUES
  const VALUES = {
    "target": "chrome",
    "name": "Chrome",
    "storeName": "Chrome Web Store",
    "storeUrl": "https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj",
    "reviewUrl": "https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj/reviews",
    "themeStoreUrl": "https://chromewebstore.google.com/detail/",
    "privateWindow": "Incognito",
    "privateSwitches": "\"Allow in Private\" (Brave) or \"Allow in Incognito\" (Chrome)",
    "storeHosts": [
      { "host": "chromewebstore.google.com", "path": "/" },
      { "host": "chrome.google.com", "path": "/webstore" }
    ],
    "shortcut": { "default": "Ctrl+Shift+S", "mac": "Command+Shift+S" },
    "utmSource": "chrome_extension",
    "connectButton": "Connect Chrome extension",
    "newTab": true,
    "sitePages": true
  };
  // END TARGET VALUES

  // The API over a set of values; withValues() gives another target's, for
  // tests.
  function make(values) {
    const v = Object.freeze(JSON.parse(JSON.stringify(values)));

    // A page of the browser's own store, which no extension may read or
    // fetch. `path` is a prefix ending at a segment: "/webstore" matches
    // "/webstore" and "/webstore/…", not "/webstores".
    function isStorePage(url) {
      let u;
      try { u = new URL(String(url || '')); } catch (_) { return false; }
      const host = u.hostname.toLowerCase();
      return v.storeHosts.some(({ host: h, path }) => {
        if (host !== h) return false;
        if (!path || path === '/') return true;
        return u.pathname === path || u.pathname.startsWith(path + '/');
      });
    }

    return Object.freeze({
      VALUES: v,
      target: v.target,
      name: v.name,
      storeName: v.storeName,
      storeUrl: v.storeUrl,
      reviewUrl: v.reviewUrl,
      themeStoreUrl: v.themeStoreUrl,
      privateWindow: v.privateWindow,
      privateSwitches: v.privateSwitches,
      storeHosts: v.storeHosts,
      shortcut: v.shortcut,
      utmSource: v.utmSource,
      connectButton: v.connectButton,
      newTab: v.newTab,
      sitePages: v.sitePages,
      isStorePage,
      withValues: make
    });
  }

  return make(VALUES);
});
