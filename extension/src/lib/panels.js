// SEO Bandwagon — the one way to open a panel (1.13.10)
//
// Two panels ship and each opens the other: the page checks (src/panel/,
// "checks"; Citations' "Page checks →") and Citations and Link Building
// (src/sidepanel/, "citations"; the checks panel's "Citations →"). Until
// 1.13.10 each did it in its own code, both with an `await` before
// sidePanel.open(), and the Citations one first awaited tabs.query() for the
// tab. Both call openPanel() now.
//
// Why there is no `await` before open():
//   - Chrome: sidePanel.open() "may only be called in response to a user
//     action" (chrome.sidePanel reference). It keeps a click's user action
//     for a few seconds: measured in Chromium 156.0.8078.4, open() after
//     awaiting tabs.query() or 1 s opened, after 6 s it was refused ("may
//     only be called in response to a user gesture"). That is why 1.13.9's
//     awaits worked in Chrome.
//   - Firefox, whose sidebar comes with 2.0.0: "if a user input handler
//     waits on a promise, then its status as a user input handler is lost"
//     (MDN, "User actions"; sidebarAction.open is on its list).
// So openPanel() makes both calls in the click's own task, setOptions() and
// then open(), and the caller passes a tab ID it already holds: a
// tabs.query() inside the click would be an await. The panel that opens is
// the one setOptions() named (tests/e2e/panels.spec.mjs opens each from the
// other in Chromium and reads which document is open).
//
// Per-tab setOptions() swaps between the two, so neither replaces the other
// and the manifest's default panel is untouched.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWPanels` as a classic <script> (the two panel pages, before
// their own code), and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') globalThis.SBWPanels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(function () {
  'use strict';

  const PATHS = Object.freeze({
    checks: 'src/panel/panel.html',
    citations: 'src/sidepanel/sidepanel.html'
  });

  /**
   * Shows `which` panel ('checks' or 'citations'; anything else is
   * 'checks') for the tab `tabId`. Call it straight from the click handler.
   * Resolves true when both calls succeeded, false when the browser has no
   * side panel, no tab ID was given, or either call was refused. S34: no
   * fallback to the worker, which has no user action to open with.
   */
  function openPanel(which, tabId, chromeApi) {
    const c = chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    const sp = c && c.sidePanel;
    if (!sp || typeof sp.open !== 'function' || typeof tabId !== 'number') return Promise.resolve(false);
    const path = PATHS[which] || PATHS.checks;
    let set;
    let open;
    try {
      set = sp.setOptions({ tabId, path, enabled: true });
      open = sp.open({ tabId });
    } catch (e) {
      return Promise.resolve(false);
    }
    return Promise.all([set, open]).then(() => true, () => false);
  }

  return { PATHS, openPanel };
});
