// SEO Bandwagon — the offscreen document's one job (1.12.0)
//
// The service worker has no DOMParser, so Analyze on Google reads a
// result's HTML here: parsed as the page at its final address, then turned
// into the row under the result by the same analyzer the popup runs
// (src/lib/page-row.js). Only messages addressed to it are answered; the
// HTML came from the result's own site and goes nowhere else.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'sbw-offscreen' || msg.action !== 'pageRow') return;
  try {
    const doc = SBWPageRow.parse(msg.html, msg.fetchInfo.finalUrl);
    sendResponse({ row: SBWPageRow.fromDocument(doc, msg.fetchInfo, msg.site) });
  } catch (e) {
    sendResponse({ error: String((e && e.message) || e) });
  }
});
