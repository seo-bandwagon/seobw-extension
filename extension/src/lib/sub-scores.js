// SEO Bandwagon — the four sub-scores, in one place
//
// "Meta / Content / Links / Tech" and the popup's "N of M checks" line. This
// used to live inline in src/popup/popup.js as computeSubScores(); it moved
// here so the themed surfaces can show the same numbers without a second
// copy of the thresholds. A copy is how a surface starts quietly disagreeing
// with the popup about the same page.
//
// 1.10.4: and it no longer keeps a list of its own. Until then these were 14
// checks beside the score's 11, so https, mixed content and noindex counted
// here and not in the score, and an http or noindex page could score 100.
// The groups now come from the score's own checks (SEOBWAnalysis.CHECKS in
// lib/content-analysis.js): a group's `v` is the points it kept out of the
// points of its checks that apply, and `passed`/`of` count those checks.
// Every page that loads this loads lib/content-analysis.js before it.
//
// Pure: no DOM, no chrome, no network. Dual-export pattern (see src/lib/csv.js):
// attaches to `globalThis.SBWSubScores` when loaded as a classic <script>, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var analysis = (typeof globalThis !== 'undefined' && globalThis.SEOBWAnalysis) ||
    (typeof require === 'function' ? require('../../lib/content-analysis.js') : null);
  var api = factory(analysis);
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSubScores = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function (analysis) {

  /**
   * The four groups for an analyzer result, in a fixed order.
   * `[{ k, passed, of, points, kept, v }]` — `v` is the percentage the popup
   * ring shows, `passed`/`of` are what "N of M checks" is summed from.
   */
  function computeSubScores(data) {
    if (!analysis) return [];
    return analysis.groupChecks(analysis.evaluateChecks(data).checks);
  }

  /** `{ passed, of }` across all four groups — the "N of M checks" line. */
  function checkTotals(data) {
    const groups = computeSubScores(data);
    return {
      passed: groups.reduce((n, g) => n + g.passed, 0),
      of: groups.reduce((n, g) => n + g.of, 0)
    };
  }

  return {
    computeSubScores,
    checkTotals,
    analysis
  };
});
