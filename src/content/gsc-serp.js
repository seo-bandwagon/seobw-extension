// SEO Bandwagon — Google Search Console row actions (runner)
//
// Loads after src/lib/gsc-inject.js (manifest content_scripts order). Watches
// the Performance report (GSC is an SPA) and adds two icons to each data row:
// "Open in Google Search" (new tab) and "Open in Google Search (private
// window)". The worker owns window/tab creation; when the browser refuses an
// incognito window (the extension is not allowed in Private/Incognito), the
// worker falls back to a normal window and tells us, and we show a one-time
// hint explaining how to enable it.

(function () {
  'use strict';

  if (window.__seoBwGscSerpLoaded) return;
  window.__seoBwGscSerpLoaded = true;

  const inject = window.SBWGscInject;
  if (!inject) return;

  let hinted = false;
  function hint(text) {
    if (hinted) return;
    hinted = true;
    const el = document.createElement('div');
    el.className = 'seo-bw-gsc-toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 9000);
  }

  const handlers = {
    open(query) {
      chrome.runtime.sendMessage({ action: 'openSearch', query });
    },
    openPrivate(query) {
      chrome.runtime.sendMessage({ action: 'openIncognitoSearch', query }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.ok && res.incognito === false) {
          hint(
            'Opened in a normal window: this browser does not let SEO Bandwagon open private windows. ' +
              'Enable "Allow in Private" (Brave) or "Allow in Incognito" (Chrome) for the extension on the extensions page.',
          );
        }
      });
    },
  };

  function ensureStyles() {
    if (document.getElementById('seo-bw-gsc-styles')) return;
    const style = document.createElement('style');
    style.id = 'seo-bw-gsc-styles';
    style.textContent = inject.CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function scan() {
    if (!/\/performance\b/.test(location.pathname)) return;
    ensureStyles();
    inject.injectAll(document, handlers);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
