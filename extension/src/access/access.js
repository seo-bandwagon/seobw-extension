// SEO Bandwagon — the page that asks for site access for Analyze on Google (1.10.2)
//
// Analyze on a Google results page opens the result in a background tab and
// reads it there (src/lib/serp-analyze.js). A tab nobody clicked the icon on
// can be read only with the optional all-sites access, and a content script
// on google.com can't call chrome.permissions.request(), so the worker opens
// this page in a small window, once, with the reason (SBWPerms.ALL_URLS_REASON,
// the same words the popup's Allow card shows). The person's click asks
// Chrome; the answer goes back to the worker, which analyzes the waiting
// results or tells the results page access wasn't given, and the window
// closes.

(function () {
  'use strict';

  const status = document.getElementById('accessStatus');
  document.getElementById('accessReason').textContent = SBWPerms.ALL_URLS_REASON;

  function answer(granted) {
    try {
      chrome.runtime.sendMessage({ action: 'serpAccess', granted }, () => {
        void chrome.runtime.lastError;
        window.close();
      });
    } catch (e) {
      window.close();
    }
  }

  // Granted some other way while this window was opening.
  SBWPerms.hasAllUrls().then((has) => { if (has) answer(true); }, () => {});

  document.getElementById('accessAllow').addEventListener('click', () => {
    // Straight from the click: permissions.request needs the gesture.
    SBWPerms.requestAllUrls().then((granted) => {
      if (granted) answer(true);
      else status.textContent = 'Chrome did not give access. Click Allow access to ask again, or Not now to stay as you are.';
    }, () => {
      status.textContent = 'Chrome could not ask for access here. Allow it from the popup on the result\'s tab instead.';
    });
  });

  document.getElementById('accessNotNow').addEventListener('click', () => answer(false));
})();
