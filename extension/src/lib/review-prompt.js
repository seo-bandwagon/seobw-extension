// SEO Bandwagon — one-time review-prompt state machine
//
// Ledger ruling (binding): the review prompt shows once, un-incentivized,
// after the 5th analysis, with no outcome-based gating — shouldPrompt()
// depends only on `analyses` (a count) and `prompted` (a boolean) and must
// never look at a score, grade, or error state. `installedAt` is part of
// the persisted shape (src/popup/review.js stamps it once, the first time
// state is read with none present) but is not part of the shouldPrompt
// formula the ledger specifies.
//
// Pure logic only — no chrome.storage, no DOM. The popup module
// (src/popup/review.js) owns reading/writing chrome.storage.local and
// rendering the `.review-strip`.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWReview` when loaded as a classic <script>, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWReview = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const ANALYSES_THRESHOLD = 5;
  // 1.13.8: "Later" asks again after this many more fresh analyses, once.
  const LATER_AFTER = 10;

  // The store's reviews page for this build (src/lib/browser.js). null where
  // the listing doesn't exist yet (the Edge build until the owner creates the
  // product in Partner Center): the prompt and the "Rate us" links stay off.
  const reviewUrl = () => (globalThis.SBWBrowser && globalThis.SBWBrowser.reviewUrl) || null;

  function defaultState() {
    return { analyses: 0, prompted: false, installedAt: null };
  }

  // 1.13.8: "Later" is on offer the first time only; the second time the
  // strip offers a review or No thanks.
  function canLater(state) {
    return !(state && state.laterAt);
  }

  // Deliberately reads only `analyses`/`prompted` — extra fields on `state`
  // (score, grade, error, whatever a caller might be tempted to pass) are
  // ignored, per the ledger's "no outcome-based gating" ruling.
  function shouldPrompt(state) {
    const s = state || {};
    const analyses = s.analyses || 0;
    const prompted = !!s.prompted;
    return analyses >= ANALYSES_THRESHOLD && !prompted && analyses >= (s.laterAt || 0);
  }

  function nextState(state, event) {
    const current = Object.assign(defaultState(), state || {});
    const ev = event || {};
    switch (ev.type) {
      case 'analyzed':
        return Object.assign({}, current, { analyses: (current.analyses || 0) + 1 });
      case 'reviewed':
      case 'dismissed':
        return Object.assign({}, current, { prompted: true });
      case 'later':
        // A second Later is a No thanks: the strip shows at most twice.
        if (!canLater(current)) return Object.assign({}, current, { prompted: true });
        return Object.assign({}, current, { laterAt: (current.analyses || 0) + LATER_AFTER });
      default:
        return Object.assign({}, current);
    }
  }

  return {
    get REVIEW_URL() { return reviewUrl(); },
    LATER_AFTER,
    shouldPrompt,
    canLater,
    nextState
  };
});
