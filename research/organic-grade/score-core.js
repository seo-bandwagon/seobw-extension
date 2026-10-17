// SEO Bandwagon — the popup's score path on any document (organic grade study)
//
// The study asks whether the extension's SEO grade predicts Google's organic
// positions. It scores about 28,000 fetched pages in jsdom and a sample in
// Chromium, and that only answers the question if the score is the one the
// popup shows. So this follows analyzePage() in src/content/analyzer.js line
// for line for everything the score reads, and takes the three libraries
// (SEOBWAnalysis, SEOBWExtraction, SBWSubScores) as arguments: the caller
// loads them the same way for jsdom, Node or a browser, and this file holds no
// copy of a threshold.
//
// One difference from the popup, on purpose: `mixedContent` is not computed
// (analyzeMixedContent() lives inside analyzer.js and needs the live page), so
// computeSubScores() counts its Tech check as passed. A study summary must say
// so; the score, grade and issues are not affected, only the Tech sub-score of
// an https page that loads http resources.
//
// Pure: no network, no chrome. Dual-export pattern (see
// extension/src/lib/sync-state.js): `globalThis.OGSScore` in a browser,
// `module.exports` in Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.OGSScore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // The points each check keeps when nothing is wrong. calculateSEOScore
  // starts at 100 but its checks add up to 95 (the readability comment says
  // 10 points, its deduction is 5), so no page scores below 5, and for any
  // page: sum(CHECK_START - kept) === 100 - score.
  const CHECK_START = Object.freeze({
    title: 15,
    description: 15,
    h1: 10,
    imageAlt: 10,
    canonical: 5,
    jsonLd: 10,
    ogTitle: 5,
    wordCount: 10,
    internalLinks: 5,
    domSize: 5,
    readability: 5
  });

  // Each issue label calculateSEOScore can push (extension/lib/content-analysis.js,
  // read 2026-10-17), to the check it belongs to and the points it takes.
  // tests/unit/organic-grade-score.test.js reads the scorer's source and fails
  // if a label or a point value drifts from this table.
  const CHECK_DEDUCTIONS = Object.freeze({
    'Missing title': ['title', 15],
    'Title too short': ['title', 8],
    'Title too long': ['title', 5],
    'Missing meta description': ['description', 15],
    'Description too short': ['description', 8],
    'Description too long': ['description', 5],
    'Missing H1': ['h1', 10],
    'Multiple H1 tags': ['h1', 5],
    'Many images missing alt': ['imageAlt', 10],
    'Some images missing alt': ['imageAlt', 5],
    'No canonical URL': ['canonical', 5],
    'No structured data': ['jsonLd', 10],
    'Missing Open Graph': ['ogTitle', 5],
    'Thin content': ['wordCount', 10],
    'Light content': ['wordCount', 5],
    'Few internal links': ['internalLinks', 5],
    'Large DOM': ['domSize', 5],
    'Hard to read': ['readability', 5]
  });

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
      const analysis = deps.analysis;
      const extraction = deps.extraction;

      // analyzePage(), minus what the score does not read (top words and
      // phrases, tech stack, hash, web vitals and the other advanced analyzers).
      const mainContent = extraction.getMainContent(doc);
      const text = analysis.cleanText(mainContent);
      const words = analysis.getWords(text);

      const content = {
        title: doc.title,
        wordCount: words.length,
        charCount: text.length,
        sentenceCount: analysis.countSentences(text),
        readability: analysis.calculateReadability(text, words)
      };

      const url = doc.URL;
      const meta = extraction.extractMeta(doc);
      const headings = extraction.extractHeadings(doc);
      const links = extraction.extractLinks(doc, win.location);
      const images = extraction.extractImages(doc);
      const technical = extraction.extractTechnical(doc, win);

      const seoScore = analysis.calculateSEOScore(content, meta, headings, links, images, technical);
      const groups = deps.subScores.computeSubScores({ url, meta, content, headings, links, technical, images });

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
