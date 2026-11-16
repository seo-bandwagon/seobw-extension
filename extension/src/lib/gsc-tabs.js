// SEO Bandwagon — Search Console tabs already open (1.13.8, #158)
//
// Chromium injects a manifest content script only into documents that load
// after the extension is installed, updated or reloaded. Search Console is a
// single-page app that people keep open for hours, so a tab open across an
// install or an update had no row icons until it was reloaded. The worker
// calls injectOpenTabs on onInstalled: it finds the open Search Console tabs
// and injects the same files the manifest does. gsc-serp.js starts only where
// no live runner is, so a tab that got the manifest's copy keeps that one.
//
// Scripting a tab needs the host in `host_permissions`; content-script matches
// alone don't allow it ("Extension manifest must request permission to access
// this host"). `https://search.google.com/*` adds no install warning: the
// content script already reads and changes that host's pages (measured with
// getPermissionWarningsByManifest, tests/e2e/gsc-icons.spec.mjs).
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') globalThis.SBWGscTabs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(function () {
  'use strict';

  // The manifest's Search Console content script: its matches and its files,
  // in order. tests/unit/gsc-tabs.test.js holds these to the manifest.
  //
  // `search-console*`, not `search-console/*`: the overview, where the
  // extension's own Search Console links land and where Search Console opens,
  // is /search-console?resource_id=…, with no slash after the name. Until
  // 1.13.8 the runner never started there, and Performance is reached from it
  // in the page. /u/N/ is a signed-in second Google account.
  const MATCHES = [
    'https://search.google.com/search-console*',
    'https://search.google.com/u/*/search-console*'
  ];
  const FILES = ['src/lib/gsc-inject.js', 'src/lib/gsc-compare.js', 'src/content/gsc-serp.js'];

  /**
   * Inject the runner into every open Search Console tab. Returns the number
   * of tabs injected. A tab that refuses (discarded, still loading an error
   * page, closed meanwhile) is skipped: it loads afresh when it is next
   * shown, and the manifest's content script runs then.
   */
  async function injectOpenTabs(chromeApi) {
    const c = chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    if (!c || !c.tabs || !c.scripting) return 0;
    let tabs = [];
    try {
      tabs = await c.tabs.query({ url: MATCHES });
    } catch (e) {
      return 0;
    }
    let n = 0;
    for (const tab of tabs) {
      if (!tab || typeof tab.id !== 'number' || tab.discarded) continue;
      try {
        await c.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
        n++;
      } catch (e) {
        // skipped; see above
      }
    }
    return n;
  }

  return { MATCHES, FILES, injectOpenTabs };
});
