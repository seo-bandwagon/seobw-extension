// SEO Bandwagon — the first-run guide (1.14.0)
//
// A short guide the first time the popup opens after a fresh install: what
// the score is, where the checks are, what an account adds. The worker
// marks it pending on `onInstalled` with reason 'install' (never on an
// update: 1.15.0's welcome page is what tells updating users what's new);
// the popup shows it while it is pending (src/popup/guide.js), and "Got it"
// clears it. About & credits reopens it at any time.
//
// Pure: the storage key, the decision and the words. No DOM. Dual-export
// pattern (see src/lib/sync-state.js): attaches to `globalThis.SBWFirstRun`
// when loaded as a classic <script> or via importScripts, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWFirstRun = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // chrome.storage.local: { pending: true, at } after a fresh install;
  // { pending: false, seenAt } once dismissed.
  const KEY = 'sbwGuide';

  /** What onInstalled writes under KEY for `reason`, or null for none. */
  function installRecord(reason, now) {
    if (reason !== 'install') return null;
    return { pending: true, at: new Date(now || Date.now()).toISOString() };
  }

  /** Whether the popup opens with the guide showing. */
  function shouldShow(record) {
    return !!(record && record.pending === true);
  }

  function dismissedRecord(now) {
    return { pending: false, seenAt: new Date(now || Date.now()).toISOString() };
  }

  // The words. Every core feature works without an account (no paywall
  // after install); the score is an on-page checklist, never a ranking.
  const GUIDE = {
    title: 'Welcome to SEO Bandwagon',
    steps: [
      {
        id: 'score',
        heading: 'The score',
        text: 'An on-page checklist of 18 checks: 100 minus the points the issues cost, with a letter grade. It doesn’t measure or predict rankings.'
      },
      {
        id: 'checks',
        heading: 'Where the checks are',
        text: 'The top 3 problems come first, each with why it matters and what to change. Everything else is under All checks: page meta, indexability, hreflang, rendering, structured data, headings, links, content and the link check. The Citations tab checks business listings.'
      },
      {
        id: 'account',
        heading: 'What an account adds',
        text: 'Nothing here needs an account. A free SEO Bandwagon account saves your analyses with their history, adds link, traffic and keyword figures on Google’s results pages once you turn them on, and checks your business listings against your own record.'
      }
    ],
    dataLine: 'What stays on this device, what is sent and what is kept: Your data.'
  };

  return {
    KEY,
    GUIDE,
    installRecord,
    shouldShow,
    dismissedRecord
  };
});
