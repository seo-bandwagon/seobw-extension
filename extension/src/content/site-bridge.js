// SEO Bandwagon — the Connect bridge on seobandwagon.com (1.13.6)
//
// The site's API keys page and the extension's welcome page talk to the
// extension. Until 1.13.6 they could only do it with
// chrome.runtime.sendMessage(EXTENSION_ID, …) over externally_connectable,
// which needs the store's item ID; Microsoft Edge Add-ons assigns its own ID
// at the first upload, so on Edge that call reaches nothing. This content
// script lets the page reach the extension without knowing its ID, in every
// browser (vault design, decision 4). externally_connectable stays, for
// pages that still call by ID.
//
// The protocol, which the site builds against (keepkalm/platform,
// src/lib/extension/browser-messaging.ts):
//   1. Here (top frame only, from document_start, on /dashboard/api-keys* and
//      /seo-chrome-extension/welcome* only, by the manifest), the root element
//      gets data-sbw-bridge="1", so the page knows the bridge is there.
//   2. The page posts { sbwBridge: 1, message } to its own window with one
//      MessageChannel port transferred. `message` is what it would send by ID:
//      { type: 'ping' | 'connect' | 'status', … }.
//   3. A window message is taken only when it comes from this window, from
//      https://seobandwagon.com, with sbwBridge === 1 and exactly one port.
//      Anything else is ignored, unanswered.
//   4. The message goes to the worker as { action: 'siteBridge', message },
//      which answers it exactly as it answers the same message sent by ID.
//   5. The answer goes back on the port as { response }, or { error } when the
//      worker can't be reached. The reply is on the port, never on the window,
//      because the connect answer carries the account's email.
(function () {
  const ORIGIN = 'https://seobandwagon.com';
  if (window.top !== window || location.origin !== ORIGIN) return;

  function mark() {
    document.documentElement.setAttribute('data-sbw-bridge', '1');
  }
  if (document.documentElement) {
    mark();
  } else {
    // Not expected at document_start, but cheap to cover.
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      observer.disconnect();
      mark();
    }).observe(document, { childList: true });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.sbwBridge !== 1) return;
    if (!event.ports || event.ports.length !== 1) return;
    const port = event.ports[0];

    const reply = (answer) => {
      try { port.postMessage(answer); } catch (_) { /* the page closed its end */ }
      port.close();
    };
    try {
      chrome.runtime.sendMessage({ action: 'siteBridge', message: data.message }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reply({ error: err.message || 'The extension did not answer.' });
        else reply({ response });
      });
    } catch (e) {
      // The extension was updated or reloaded under this page.
      reply({ error: (e && e.message) || 'The extension could not be reached.' });
    }
  });
})();
