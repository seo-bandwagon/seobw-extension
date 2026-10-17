// research/organic-grade/score-core.js — the popup's score path on any document.
//
// The organic-grade study scores about 28,000 fetched pages in jsdom and a
// sample in Chromium with scoreDocument(), and compares the grades with
// Google's positions. That only means something if scoreDocument() gives the
// number the popup gives, so the first test runs the real analyzer.js, the way
// the popup injects it, and holds the two to the same score, grade and issues.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import analysis from '../../extension/lib/content-analysis.js';
import extraction from '../../extension/lib/dom-extraction.js';
import subScores from '../../extension/src/lib/sub-scores.js';
import { CHECK_DEDUCTIONS, checksFromIssues, scoreDocument } from '../../research/organic-grade/score-core.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION = resolve(REPO, 'extension');
const deps = { analysis, extraction, subScores };

// The points each check starts from (the checks' maximums; 95 in all, because
// the readability comment says 10 points and its deduction is 5).
const START = {
  title: 15, description: 15, h1: 10, imageAlt: 10, canonical: 5, jsonLd: 10,
  ogTitle: 5, wordCount: 10, internalLinks: 5, domSize: 5, readability: 5
};

// ---------------------------------------------------------------- fixtures

const EASY = 'Good pages answer a question. They use plain words and short lines. Readers stay when the page helps them. ';
// One 22-word sentence of long words: Flesch-Kincaid far above 14.
const HARD = 'Organizational interoperability considerations notwithstanding, comprehensive implementation methodologies necessitate substantial administrative coordination, particularly regarding infrastructure modernization requirements and international regulatory harmonization initiatives across heterogeneous institutional environments. ';

const paragraphs = (sentence, count, perParagraph) =>
  Array.from({ length: count }, () => `<p>${sentence.repeat(perParagraph)}</p>`).join('\n');

const page = ({ head = '', body = '' }) => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

// A rich page: every check passes, the text is inside <main>.
const RICH = {
  name: 'rich',
  url: 'https://www.example.com/guide/organic-search',
  html: page({
    head: `
      <title>Organic Search Guide: How Pages Earn Rankings</title>
      <meta name="description" content="A plain guide to how pages earn organic rankings, covering titles, descriptions, headings, links and the checks that matter most.">
      <link rel="canonical" href="https://www.example.com/guide/organic-search">
      <meta property="og:title" content="Organic Search Guide">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Organic Search Guide"}</script>`,
    body: `
      <header><nav><a href="/">Home</a> <a href="/blog">Blog</a> <a href="/about">About</a></nav></header>
      <main>
        <h1>How pages earn organic rankings</h1>
        ${paragraphs(EASY, 7, 5)}
        <img src="/a.png" alt="A ranking chart"><img src="/b.png" alt="A page outline">
        <p><a href="/guide/titles">Titles</a> <a href="/guide/links">Links</a> <a href="https://developers.google.com/search">Google</a></p>
      </main>
      <footer><a href="/contact">Contact</a></footer>`
  })
};

// A thin page on http: short title and description, two H1s, bare images, no
// canonical, Open Graph or structured data, one internal link, 2,100 elements.
const THIN = {
  name: 'thin',
  url: 'http://thin.example.org/p',
  html: page({
    head: `
      <title>Hi</title>
      <meta name="description" content="Short.">`,
    body: `
      <header><nav><a href="/">Home</a></nav></header>
      <h1>First heading</h1><h1>Second heading</h1>
      <p>A short page with very little to read on it at all.</p>
      <img src="/x.png"><img src="/y.png" alt=""><img src="/z.png" alt="Fine">
      ${'<i></i>'.repeat(2100)}
      <footer><a href="https://other.example.net/">Elsewhere</a></footer>`
  })
};

// No <title> and no description. Text sits in [role=main]; it is light (about
// 350 words) and hard to read; canonical, Open Graph and JSON-LD are there.
const NO_TITLE = {
  name: 'no-title-no-description',
  url: 'https://example.org/',
  html: page({
    head: `
      <link rel="canonical" href="https://example.org/">
      <meta property="og:title" content="Untitled">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>`,
    body: `
      <div role="main">
        <h1>An untitled page</h1>
        <p>${HARD.repeat(16)}</p>
        <img src="/c.png" alt="Diagram">
        <a href="/one">One</a> <a href="/two">Two</a> <a href="/three">Three</a>
      </div>`
  })
};

const FIXTURES = [RICH, THIN, NO_TITLE];

// ----------------------------------------------------------------- the paths

/** The score path in Node: a fresh JSDOM and scoreDocument(). */
function scoreFixture({ html, url }) {
  const dom = new JSDOM(html, { url });
  try {
    return scoreDocument(dom.window.document, dom.window, deps);
  } finally {
    dom.window.close();
  }
}

/** The files the popup injects, read from popup.js as tests/e2e/canary.spec.mjs reads them. */
function popupInjectionFiles() {
  const src = readFileSync(resolve(EXTENSION, 'src/popup/popup.js'), 'utf8');
  const m = /executeScript\(\{\s*target:\s*\{\s*tabId:\s*tab\.id\s*\},\s*files:\s*(\[[^\]]+\])/.exec(src);
  if (!m) throw new Error('could not find the analysis executeScript files list in popup.js');
  return JSON.parse(m[1].replace(/'/g, '"'));
}

/**
 * The full path: the popup's injection files evaluated in a JSDOM window, in
 * order, then { action: 'analyze' } sent to the listener analyzer.js registers.
 * Its Web Vitals wait (2 s) runs out in real time.
 */
async function runFullAnalyzer({ html, url }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  let listener = null;
  window.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };

  // Only chrome is stubbed. jsdom has no PerformanceObserver, no
  // performance.getEntriesByType/ByName and no crypto.subtle, but analyzer.js
  // reaches every one of them inside a try/catch (its Web Vitals, performance
  // and content-hash sections), so nothing else needed a no-op to run, and
  // nothing the score reads is replaced.
  const context = dom.getInternalVMContext();
  for (const file of popupInjectionFiles()) {
    new vm.Script(readFileSync(resolve(EXTENSION, file), 'utf8'), { filename: file }).runInContext(context);
  }
  expect(listener, 'analyzer.js registered an onMessage listener').toBeTypeOf('function');

  const response = await new Promise((done) => listener({ action: 'analyze' }, {}, done));
  window.close();
  // Out of the window's realm, so the comparisons below are plain data.
  return JSON.parse(JSON.stringify(response));
}

const subScoreMap = (groups) => Object.fromEntries(groups.map((g) => [g.k, g.v]));

// -------------------------------------------------------------------- tests

describe('scoreDocument', () => {
  it('gives the same score as the full analyzer.js on three fixtures', async () => {
    const fulls = await Promise.all(FIXTURES.map(runFullAnalyzer));

    FIXTURES.forEach((fixture, i) => {
      const full = fulls[i];
      const record = scoreFixture(fixture);
      expect(full.error, `${fixture.name}: the full analyzer answered`).toBeUndefined();

      expect(record.error, fixture.name).toBeNull();
      expect(record.score, `${fixture.name}: score`).toBe(full.seoScore.score);
      expect(record.grade, `${fixture.name}: grade`).toBe(full.seoScore.grade);
      expect(record.issues, `${fixture.name}: issues`).toEqual(full.seoScore.issues);

      // The fields around the score come from the same extraction.
      expect(record.url, fixture.name).toBe(full.url);
      expect(record.wordCount, `${fixture.name}: wordCount`).toBe(full.content.wordCount);
      expect(record.subScores, `${fixture.name}: sub-scores`).toEqual(subScoreMap(subScores.computeSubScores(full)));
    });

    // The fixtures differ, so a function returning one constant would not pass.
    expect(fulls.map((f) => f.seoScore.score)).toEqual([100, 29, 60]);
  }, 20_000);

  it('records the title, the word count, the four sub-scores and the points kept per check', () => {
    const rich = scoreFixture(RICH);
    expect(rich).toMatchObject({
      url: RICH.url,
      score: 100,
      grade: 'A',
      issues: [],
      subScores: { Meta: 100, Content: 100, Links: 100, Tech: 100 },
      titleText: 'Organic Search Guide: How Pages Earn Rankings',
      titleLength: 45,
      error: null
    });
    expect(rich.wordCount).toBeGreaterThanOrEqual(600);
    expect(rich.checks).toEqual(START);

    // The thin page, worked by hand from sub-scores.js: Meta 0 of 5 (short
    // title and description, no canonical, Open Graph or schema); Content 1 of 3
    // (thin, two H1s, but easy to read); Links 1 of 3 (one internal link and
    // bare images, but one external link); Tech 1 of 3 (2,100 elements, http,
    // and mixed content counts as passed).
    const thin = scoreFixture(THIN);
    expect(thin.subScores).toEqual({ Meta: 0, Content: 33, Links: 33, Tech: 33 });
    expect(thin.checks).toEqual({
      title: 7, description: 7, h1: 5, imageAlt: 0, canonical: 0, jsonLd: 0,
      ogTitle: 0, wordCount: 0, internalLinks: 0, domSize: 0, readability: 5
    });

    // No <title>: null, not '' and not 0.
    const bare = scoreFixture(NO_TITLE);
    expect(bare.titleText).toBeNull();
    expect(bare.titleLength).toBeNull();
    expect(bare.issues).toEqual(expect.arrayContaining(['Missing title', 'Missing meta description']));
  });

  it('counts mixed content as passed, because the document is not asked about it', () => {
    // An http image on an https page: the popup's Tech sub-score counts it,
    // this path does not compute it (the study summary notes it).
    const record = scoreFixture({
      url: 'https://example.com/m',
      html: page({ body: '<main><h1>Mixed</h1><img src="http://example.com/i.png" alt="x"></main>' })
    });
    expect(record.subScores.Tech).toBe(100);
  });

  it('the points taken add up to 100 minus the score', () => {
    expect(Object.values(START).reduce((a, b) => a + b, 0)).toBe(95);
    for (const fixture of FIXTURES) {
      const { score, checks } = scoreFixture(fixture);
      expect(Object.keys(checks).sort(), fixture.name).toEqual(Object.keys(START).sort());
      const taken = Object.keys(START).reduce((sum, name) => sum + (START[name] - checks[name]), 0);
      expect(taken, `${fixture.name}: points taken`).toBe(100 - score);
    }
  });

  it('scores an empty document without throwing', () => {
    const dom = new JSDOM('', { url: 'https://empty.example.com/' });
    const record = scoreDocument(dom.window.document, dom.window, deps);
    expect(record.error).toBeNull();
    expect(record.score).toBeTypeOf('number');
    expect(record.url).toBe('https://empty.example.com/');
    expect(record.wordCount).toBe(0);
    expect(record.issues).toContain('Missing title');
  });

  it('never throws: a failure comes back as a record with the message in error', () => {
    const record = scoreDocument(null, null, deps);
    expect(record.error).toBeTypeOf('string');
    expect(record.error.length).toBeGreaterThan(0);
    expect(record).toMatchObject({ score: null, grade: null, issues: [], wordCount: null, titleText: null, titleLength: null });

    const boom = { ...deps, analysis: { ...analysis, calculateSEOScore: () => { throw new Error('boom'); } } };
    const dom = new JSDOM('<p>x</p>', { url: 'https://boom.example.com/' });
    const failed = scoreDocument(dom.window.document, dom.window, boom);
    expect(failed.error).toBe('boom');
    expect(failed.url).toBe('https://boom.example.com/');
    expect(failed.score).toBeNull();
  });
});

describe('CHECK_DEDUCTIONS', () => {
  const source = readFileSync(resolve(EXTENSION, 'lib/content-analysis.js'), 'utf8');

  it('maps every issue label calculateSEOScore can emit', () => {
    const labels = [...source.matchAll(/issues\.push\('([^']+)'\)/g)].map((m) => m[1]);
    expect(labels).toHaveLength(18);
    expect(Object.keys(CHECK_DEDUCTIONS).sort()).toEqual([...labels].sort());
  });

  it('takes the points calculateSEOScore takes, from checks that exist', () => {
    const taken = Object.fromEntries(
      [...source.matchAll(/score -= (\d+);\s*issues\.push\('([^']+)'\)/g)].map((m) => [m[2], Number(m[1])])
    );
    expect(Object.keys(taken)).toHaveLength(18);
    for (const [label, [check, points]] of Object.entries(CHECK_DEDUCTIONS)) {
      expect(START, `${label}: a known check`).toHaveProperty(check);
      expect(points, `${label}: points`).toBe(taken[label]);
      expect(points, `${label}: no more than the check has`).toBeLessThanOrEqual(START[check]);
    }
  });
});

describe('checksFromIssues', () => {
  it('keeps every check at its start when there are no issues', () => {
    expect(checksFromIssues([])).toEqual(START);
  });

  it('takes each issue\'s points off its own check', () => {
    expect(checksFromIssues(['Title too short', 'Many images missing alt', 'Large DOM'])).toEqual({
      ...START, title: 15 - 8, imageAlt: 0, domSize: 0
    });
  });

  it('refuses a label it does not know, rather than leaving the points on', () => {
    expect(() => checksFromIssues(['Slow server'])).toThrow(/Slow server/);
  });
});
