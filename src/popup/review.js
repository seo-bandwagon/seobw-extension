// Review prompt strip — popup UI (Task 7, item E)
//
// Ledger ruling (binding): the prompt shows once, un-incentivized, after
// the 5th analysis, with no outcome-based gating. That last part drives
// this module's shape: `.review-strip`'s visibility is a pure function of
// what's already in `chrome.storage.local.sbwReview` (via
// `globalThis.SBWReview.shouldPrompt()`, src/lib/review-prompt.js) — never
// of this popup open's own score, grade, or error state. Concretely:
//
//   - `recordAnalysis()` — called only when an analysis actually completed
//     this popup open (the cached-hit and fresh-analyze paths in
//     popup.js's bootstrap) — increments `analyses` and re-renders from the
//     result.
//   - `renderFromStorage()` — called unconditionally, INCLUDING from the
//     "can't read this page" error branch and the Google-SERP notice
//     branch — reads whatever is already stored and renders (or doesn't)
//     purely from that. A popup open that fails to analyze anything still
//     shows the strip if a *previous* successful analysis already crossed
//     the threshold.
//
// Both buttons persist `prompted: true` BEFORE opening anything (the
// "Leave a review" tab, in this case) — never re-prompts either way.
//
// Mounts into the always-present `#reviewStrip` container (see popup.html)
// rather than into `#content`, since `#content` gets fully replaced on
// every renderResults() call and the error/SERP branches never call it.

(function () {

  const STORAGE_KEY = 'sbwReview';

  function popup() {
    return globalThis.SBWPopup || {};
  }

  function esc(s) {
    return (popup().esc || (x => String(x)))(s);
  }

  function containerEl() {
    return document.getElementById('reviewStrip');
  }

  async function readState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const state = stored && stored[STORAGE_KEY];
    return state || { analyses: 0, prompted: false, installedAt: Date.now() };
  }

  async function writeState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function recordAnalysis() {
    const state = await readState();
    const next = globalThis.SBWReview.nextState(state, { type: 'analyzed' });
    await writeState(next);
    render(next);
  }

  async function renderFromStorage() {
    const state = await readState();
    render(state);
  }

  function render(state) {
    const el = containerEl();
    if (!el || typeof globalThis.SBWReview === 'undefined') return;

    if (!globalThis.SBWReview.shouldPrompt(state)) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = `<div class="review-strip">
      <span class="review-strip-copy">Finding this useful? A short review on the Chrome Web Store helps others find it.</span>
      <span class="review-strip-actions">
        <button type="button" class="review-strip-btn review-strip-leave" id="reviewLeaveBtn">Leave a review</button>
        <button type="button" class="review-strip-btn review-strip-dismiss" id="reviewNoBtn">No thanks</button>
      </span>
    </div>`;
    el.querySelector('#reviewLeaveBtn')?.addEventListener('click', onLeaveClick);
    el.querySelector('#reviewNoBtn')?.addEventListener('click', onDismissClick);
  }

  async function markPrompted(eventType) {
    const state = await readState();
    const next = globalThis.SBWReview.nextState(state, { type: eventType });
    await writeState(next);
    render(next);
    return next;
  }

  // Persists prompted:true FIRST, then opens the review tab — the ledger's
  // "no outcome gating" ruling extends to this: a failed/blocked tab open
  // must not leave the strip re-prompt-able.
  async function onLeaveClick() {
    await markPrompted('reviewed');
    chrome.tabs.create({ url: globalThis.SBWReview.REVIEW_URL });
  }

  async function onDismissClick() {
    await markPrompted('dismissed');
  }

  globalThis.SBWReviewUI = { recordAnalysis, renderFromStorage };
})();
