// SEO Bandwagon — open a link and analyze it
//
// The flow behind the results overlay's Analyze button and the context menu's
// "Analyze linked page": open the link in a new tab, and once the page it
// lands on has loaded, open the popup, which analyzes that tab like a click on
// the icon. A person's click starts each one (owner's rule 2026-10-14, "a
// person starts every scan"); nothing here reads a page by itself.
//
// The new tab has no activeTab grant (that comes only from the icon, the
// shortcut or the context menu on the tab itself), so without "access to all
// sites" the popup offers "Allow access to analyze other tabs" (popup.js, S29)
// instead of a result; once that is granted, every Analyze runs straight
// through.
//
// A result on a signed-out Google page links through Google's own redirect
// (`/goto?url=…`, `/url?q=…`, see src/lib/serp.js resolveResultUrl), so the
// tab can finish loading on Google first. The popup waits for the page the
// link lands on: on a Google results host the popup shows its "Google results
// page" notice, not an analysis.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWAnalyzeLink` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWAnalyzeLink = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // The context menu's delay before openPopup(), kept: the popup reads the
  // active tab as it opens.
  const POPUP_DELAY_MS = 500;
  // Stop waiting for a page that never finishes loading.
  const GIVE_UP_MS = 60 * 1000;

  // Same host rule and redirect paths as src/lib/serp.js (GOOGLE_HOST_RE,
  // REDIRECT_PATH_RE).
  const GOOGLE_HOST_RE = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;
  const REDIRECT_PATH_RE = /^\/(goto|url)$/;

  function isGoogleRedirect(url) {
    try {
      const u = new URL(url);
      return GOOGLE_HOST_RE.test(u.hostname) && REDIRECT_PATH_RE.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  // `tabs` and `action` are chrome.tabs and chrome.action (stubs in tests).
  function createAnalyzeLink({ tabs, action, setTimer = setTimeout, clearTimer = clearTimeout }) {
    async function open(url) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        return { ok: false, error: 'invalid_url' };
      }
      const tab = await tabs.create({ url });

      let giveUp = null;
      const listener = (tabId, changeInfo, updated) => {
        if (tabId !== tab.id || changeInfo.status !== 'complete') return;
        if (isGoogleRedirect((updated && updated.url) || '')) return;
        stop();
        setTimer(() => {
          Promise.resolve()
            .then(() => action.openPopup())
            .catch(() => {}); // no focused window: the tab is open, the icon still works
        }, POPUP_DELAY_MS);
      };
      function stop() {
        tabs.onUpdated.removeListener(listener);
        if (giveUp !== null) clearTimer(giveUp);
      }
      tabs.onUpdated.addListener(listener);
      giveUp = setTimer(stop, GIVE_UP_MS);
      return { ok: true, tabId: tab.id };
    }

    return { open };
  }

  return {
    POPUP_DELAY_MS,
    GIVE_UP_MS,
    isGoogleRedirect,
    createAnalyzeLink
  };
});
