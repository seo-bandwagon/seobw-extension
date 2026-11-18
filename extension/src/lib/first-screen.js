// SEO Bandwagon — the popup's first screen (1.14.0)
//
// What a first-time user sees before anything else, worked out from the
// score's own checks (SEOBWAnalysis in lib/content-analysis.js) so it can't
// disagree with the score:
//
//   - the checks line, "N of M checks passed", where M counts only the checks
//     that apply to this page (a check that doesn't apply costs no points, but
//     it didn't pass either), with how many don't apply;
//   - what each sub-score covers, read from the checks in its group;
//   - the issues worst first: what keeps the page out of search (noindex),
//     then the points each costs, ties in the checklist's own order;
//   - the plain text "Copy issues" puts on the clipboard.
//
// Pure: no DOM, no chrome, no network. Dual-export pattern (see
// src/lib/sub-scores.js): attaches to `globalThis.SBWFirstScreen` when loaded
// as a classic <script> after lib/content-analysis.js, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var analysis = (typeof globalThis !== 'undefined' && globalThis.SEOBWAnalysis) ||
    (typeof require === 'function' ? require('../../lib/content-analysis.js') : null);
  var api = factory(analysis);
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWFirstScreen = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function (analysis) {

  // The line under the score. It says what the number is and what it isn't:
  // the grade ordered Google's results right about half the time (vault
  // Organic_Grade_Accuracy_Study_2026-10), so it never stands for rankings.
  const SCORE_LINE = 'An on-page checklist: 100 minus the points the issues cost. It doesn’t measure or predict rankings.';

  // How many issues the first screen shows before "All N issues".
  const TOP_COUNT = 3;

  // Checks whose failure keeps the page out of search altogether. They come
  // first whatever their points.
  const BLOCKS_INDEX = new Set(['indexable']);

  // Each sub-score's line, from the labels of the checks in its group, in
  // the checklist's order: "Title, description, canonical, ...".
  function groupCovers() {
    const out = {};
    if (!analysis) return out;
    analysis.GROUPS.forEach(function (g) {
      const labels = analysis.CHECKS.filter(function (c) { return c.group === g; })
        .map(function (c, i) { return i === 0 ? c.label : lowerFirst(c.label); });
      out[g] = labels.join(', ');
    });
    return out;
  }

  // "Images without alt" reads "images without alt" mid-line; an
  // abbreviation such as "H1", "HTTPS" or "DOM nodes", and a name such as
  // "Open Graph", keeps its capitals.
  function lowerFirst(label) {
    const s = String(label);
    if (/^[A-Z][A-Z\d]/.test(s) || /^\S+ [A-Z]/.test(s)) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  /** `{ passed, of, na, total }`: checks passed, checks that apply, those that don't, all checks. */
  function checksLine(data) {
    if (!analysis) return { passed: 0, of: 0, na: 0, total: 0 };
    const checks = analysis.evaluateChecks(data).checks;
    const applying = checks.filter(function (c) { return c.status !== 'na'; });
    return {
      passed: applying.filter(function (c) { return c.status === 'pass'; }).length,
      of: applying.length,
      na: checks.length - applying.length,
      total: checks.length
    };
  }

  /** "14 of 17 checks passed" and, apart, "1 doesn't apply" (or ''). */
  function checksLineText(line) {
    const passed = line.passed + ' of ' + line.of + ' check' + (line.of === 1 ? '' : 's') + ' passed';
    const na = line.na ? line.na + (line.na === 1 ? ' doesn’t apply' : ' don’t apply') + ' to this page' : '';
    return { passed: passed, na: na };
  }

  /**
   * The page's issues, worst first. Each:
   * `{ issue, check, points, blocksIndex, title, body, why }`.
   */
  function orderedIssues(data) {
    if (!analysis) return [];
    const checks = analysis.evaluateChecks(data).checks;
    const list = [];
    checks.forEach(function (c, order) {
      if (!c.issue) return;
      const fix = analysis.fixFor(c.issue, data) || {};
      list.push({
        issue: c.issue,
        check: c.id,
        order: order,
        points: c.lost,
        blocksIndex: BLOCKS_INDEX.has(c.id),
        title: fix.title || c.issue,
        body: fix.body || '',
        why: fix.why || ''
      });
    });
    list.sort(function (a, b) {
      if (a.blocksIndex !== b.blocksIndex) return a.blocksIndex ? -1 : 1;
      if (a.points !== b.points) return b.points - a.points;
      return a.order - b.order;
    });
    return list.map(function (i) {
      return { issue: i.issue, check: i.check, points: i.points, blocksIndex: i.blocksIndex, title: i.title, body: i.body, why: i.why };
    });
  }

  /** `{ top, rest }`: the first TOP_COUNT issues and the others, in order. */
  function splitIssues(data) {
    const all = orderedIssues(data);
    return { top: all.slice(0, TOP_COUNT), rest: all.slice(TOP_COUNT), all: all };
  }

  /** What "Copy issues" puts on the clipboard. */
  function issuesText(data) {
    const d = data || {};
    const r = analysis ? analysis.evaluateChecks(d) : { score: 0, grade: 'F' };
    const line = checksLineText(checksLine(d));
    const issues = orderedIssues(d);
    const head = [
      'SEO Bandwagon: ' + (d.url || ''),
      'Score ' + r.score + ' (' + r.grade + ') · ' + line.passed + (line.na ? ' · ' + line.na : ''),
      SCORE_LINE
    ];
    if (!issues.length) return head.concat(['', 'No issues: every check that applies passed.']).join('\n');
    const rows = issues.map(function (i, n) {
      const out = [(n + 1) + '. ' + i.title + ' (−' + i.points + ')'];
      if (i.why) out.push('   Why it matters: ' + i.why);
      if (i.body) out.push('   What to change: ' + i.body);
      return out.join('\n');
    });
    return head.concat(['', issues.length + (issues.length === 1 ? ' issue, the worst first:' : ' issues, the worst first:')]).concat(rows).join('\n');
  }

  return {
    SCORE_LINE,
    TOP_COUNT,
    groupCovers,
    checksLine,
    checksLineText,
    orderedIssues,
    splitIssues,
    issuesText,
    analysis
  };
});
