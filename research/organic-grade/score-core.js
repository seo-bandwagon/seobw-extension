// SEO Bandwagon — the popup's score path on any document (organic grade study)
//
// The study asks whether the extension's SEO grade predicts Google's organic
// positions. It scores about 28,000 fetched pages in jsdom and a sample in
// Chromium, and that only answers the question if the score is the one the
// popup shows. Since 1.10.4 both take one path: SEOBWAnalysis.analyzeDocument
// (extension/lib/content-analysis.js), which src/content/analyzer.js calls on
// the live page. This file takes the three libraries (SEOBWAnalysis,
// SEOBWExtraction, SBWSubScores) as arguments: the caller loads them the same
// way for jsdom, Node or a browser, and this file holds no copy of a
// threshold or a point value.
//
// Until 1.10.4 this followed analyzePage() line for line and left mixed
// content out (it lived in analyzer.js); it is part of the document path now.
// Records from 1.10.4 on have the 1.10.4 checks (scores before it are not
// comparable: https, noindex, mixed content, viewport, language, charset and
// duplicate tags count, and the points changed).
//
// Pure: no network, no chrome. Dual-export pattern (see
// extension/src/lib/sync-state.js): `globalThis.OGSScore` in a browser,
// `module.exports` in Node.

(function (factory) {
  var analysis = (typeof globalThis !== 'undefined' && globalThis.SEOBWAnalysis) ||
    (typeof require === 'function' ? require('../../extension/lib/content-analysis.js') : null);
  var api = factory(analysis);
  if (typeof globalThis !== 'undefined') {
    globalThis.OGSScore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function (analysis) {

  // The points each check keeps when nothing is wrong, from the checks
  // themselves: they add up to 100, so for any page
  // sum(CHECK_START - kept) === 100 - score.
  const CHECK_START = Object.freeze(Object.fromEntries(
    ((analysis && analysis.CHECKS) || []).map(function (c) { return [c.id, c.points]; })
  ));

  // Each issue label to the check it belongs to and the points it takes.
  const CHECK_DEDUCTIONS = Object.freeze(Object.fromEntries(
    Object.keys((analysis && analysis.POINTS) || {}).map(function (label) {
      return [label, [analysis.CHECK_OF_ISSUE[label], analysis.POINTS[label]]];
    })
  ));

  // issues -> points kept per check. An unknown label throws: a label the
  // table lacks would leave its points on the check without a word, and the
  // identity above would quietly stop holding.
  function checksFromIssues(issues) {
    const kept = Object.assign({}, CHECK_START);
    (issues || []).forEach(function (label) {
      const entry = Object.prototype.hasOwnProperty.call(CHECK_DEDUCTIONS, label) ? CHECK_DEDUCTIONS[label] : null;
      if (!entry) throw new Error('unmapped issue label: ' + label);
      kept[entry[0]] -= entry[1];
    });
    return kept;
  }

  const SUB_SCORE_KEYS = ['Meta', 'Content', 'Links', 'Tech'];

  function nullChecks() {
    const out = {};
    Object.keys(CHECK_START).forEach(function (name) { out[name] = null; });
    return out;
  }

  function nullSubScores() {
    const out = {};
    SUB_SCORE_KEYS.forEach(function (k) { out[k] = null; });
    return out;
  }

  function documentUrl(doc, win) {
    try {
      return (doc && doc.URL) || (win && win.location && win.location.href) || '';
    } catch (e) {
      return '';
    }
  }

  // doc/win: a Document and the Window it belongs to (a JSDOM window, or the
  // page's own). deps: { analysis: SEOBWAnalysis, extraction: SEOBWExtraction,
  // subScores: SBWSubScores }. Never throws: a failure comes back as a record
  // with nulls (checks and subScores keyed, every value null) and the message
  // in `error`.
  function scoreDocument(doc, win, deps) {
    try {
      const extraction = deps.extraction;

      // analyzePage()'s score path: the same call analyzer.js makes.
      const analyzed = deps.analysis.analyzeDocument(doc, win, extraction).data;
      const url = analyzed.url;
      const meta = analyzed.meta;
      const content = analyzed.content;
      const seoScore = analyzed.seoScore;
      const groups = deps.subScores.computeSubScores(analyzed);

      const subScores = {};
      SUB_SCORE_KEYS.forEach(function (k) {
        const group = groups.filter(function (g) { return g.k === k; })[0];
        if (!group || typeof group.v !== 'number') throw new Error('no ' + k + ' sub-score');
        subScores[k] = group.v;
      });

      // extractMeta gives { text: '', length: 0 } for a page with no title.
      const hasTitle = !!(meta.title && meta.title.text);

      return {
        url: url,
        score: seoScore.score,
        grade: seoScore.grade,
        issues: seoScore.issues,
        checks: checksFromIssues(seoScore.issues),
        subScores: subScores,
        wordCount: content.wordCount,
        titleText: hasTitle ? meta.title.text : null,
        titleLength: hasTitle ? meta.title.length : null,
        error: null
      };
    } catch (e) {
      return {
        url: documentUrl(doc, win),
        score: null,
        grade: null,
        issues: [],
        checks: nullChecks(),
        subScores: nullSubScores(),
        wordCount: null,
        titleText: null,
        titleLength: null,
        error: String((e && e.message) || e)
      };
    }
  }

  return {
    CHECK_START: CHECK_START,
    CHECK_DEDUCTIONS: CHECK_DEDUCTIONS,
    checksFromIssues: checksFromIssues,
    scoreDocument: scoreDocument
  };
});
