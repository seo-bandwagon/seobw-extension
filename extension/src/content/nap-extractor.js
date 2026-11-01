// NAP Extractor — injected on demand to extract business NAP data from the current page.
// The reading itself is src/lib/nap-extract.js (SBWNapExtract), injected just
// before this file by the worker's extractNap action, so it is unit-tested.

(function() {
  // Guard against double-injection
  if (window.__napExtractorLoaded) return;
  window.__napExtractorLoaded = true;

  // Listen for extraction requests from the popup/service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractNap') {
      const nap = globalThis.SBWNapExtract ? globalThis.SBWNapExtract.extractNap(document, window.location.href) : null;
      sendResponse(nap || { error: 'Could not extract NAP data from this page' });
    }
  });
})();
