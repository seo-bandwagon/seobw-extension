// 1.14.0: the popup's first screen (src/lib/first-screen.js) and the words
// behind it: each issue's why and what to change (ISSUES in
// lib/content-analysis.js), the first-run guide (src/lib/first-run.js).
//
// The grade is an on-page checklist, never a ranking factor (owner; the
// grade ordered Google's organic results right 50.6% of the time, vault
// Organic_Grade_Accuracy_Study_2026-10), so no line a user reads about an
// issue may claim rankings, positions or traffic.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../../extension/lib/content-analysis.js');
const F = require('../../extension/src/lib/first-screen.js');
const R = require('../../extension/src/lib/first-run.js');

// A claim about where a page ranks or what it earns from search.
const RANKING_CLAIM = /\brank(s|ed|ing|ings)?\b|\bposition(s|ed)?\b|ranking factor|\bboost|\bhigher\b|\btop of\b|\btraffic\b|\bvisibility\b|\bguarantee|\bpenali[sz]/i;
// The brand guide: "what to change", never "fix".
const FIX_WORD = /\bfix(es|ed|ing)?\b/i;
// American English only.
const BRITISH = /\b(colour|behaviour|recognis|organis|optimis|analys(e|ed|ing)\b|favour|honour|centre|licence\b)/i;

// Data that makes every issue's own text computable.
const DATA = {
  url: 'http://example.com/a',
  meta: {
    title: { text: 'Hi', length: 2, count: 2 },
    description: { text: 'Short', length: 5, count: 1 },
    canonical: 'https://example.com/a',
    canonicalUrls: ['https://example.com/a', 'https://example.com/b'],
    canonicalCount: 2,
    noindex: true,
    noindexSource: 'robots',
    viewport: '',
    lang: '',
    charset: { document: 'windows-1252', declared: 'windows-1252' },
    openGraph: {},
    structuredData: { jsonLd: 0, microdata: 0, rdfa: 0 }
  },
  headings: { h1: ['One', 'Two'] },
  content: { wordCount: 120, readability: { fleschKincaid: 15.2, level: 'College' } },
  images: { total: 4, missingAlt: { count: 3 }, decorative: 1 },
  links: { internal: { count: 1 } },
  technical: { domElements: 3100 },
  mixedContent: { mixedCount: 2 }
};

describe('each issue says why it matters and what to change', () => {
  const labels = Object.keys(A.ISSUES);

  it('covers all 26 issue labels, one for every outcome of the 18 checks', () => {
    expect(A.CHECKS).toHaveLength(18);
    expect(labels).toHaveLength(26);
    const outcomes = A.CHECKS.flatMap((c) => Object.keys(c.outcomes));
    expect(outcomes.sort()).toEqual([...labels].sort());
  });

  it.each(labels)('%s: a why line and a what-to-change line', (label) => {
    const fix = A.fixFor(label, DATA);
    expect(fix.why.length).toBeGreaterThan(30);
    expect(fix.why).toMatch(/[.]$/);
    expect(fix.body.length).toBeGreaterThan(15);
    expect(fix.body).toMatch(/[.>]$/);
    // The why line is about the page and its readers, never the body again.
    expect(fix.why).not.toBe(fix.body);
  });

  it.each(labels)('%s: no claim about rankings, positions or traffic, no "fix", American English', (label) => {
    const fix = A.fixFor(label, DATA);
    for (const text of [fix.why, fix.body, fix.title]) {
      expect(text).not.toMatch(RANKING_CLAIM);
      expect(text).not.toMatch(FIX_WORD);
      expect(text).not.toMatch(BRITISH);
    }
  });

  it('tells the test pattern catches a ranking claim, so the test above means something', () => {
    for (const bad of ['This hurts your rankings.', 'Pages rank higher with one.', 'A ranking factor.', 'More traffic from Google.', 'Fix it now.']) {
      expect(RANKING_CLAIM.test(bad) || FIX_WORD.test(bad)).toBe(true);
    }
  });
});

describe('the first screen', () => {
  it('orders issues: what keeps the page out of search first, then the points each costs, ties in checklist order', () => {
    const order = F.orderedIssues(DATA);
    expect(order[0]).toMatchObject({ issue: 'Set to noindex', blocksIndex: true, points: 15 });
    const rest = order.slice(1);
    for (let i = 1; i < rest.length; i++) {
      expect(rest[i - 1].points).toBeGreaterThanOrEqual(rest[i].points);
      if (rest[i - 1].points === rest[i].points) {
        const at = (id) => A.CHECKS.findIndex((c) => c.id === id);
        expect(at(rest[i - 1].check)).toBeLessThan(at(rest[i].check));
      }
    }
    expect(order.map((i) => i.issue).sort()).toEqual([...A.evaluateChecks(DATA).issues].sort());
  });

  it('puts noindex first even where another issue costs more', () => {
    const order = F.orderedIssues({ ...DATA, meta: { ...DATA.meta, title: { text: '', length: 0, count: 1 } } });
    expect(order[0].issue).toBe('Set to noindex');
    expect(order[1].issue).toBe('Missing title');
  });

  it('splits the top 3 from the rest', () => {
    const s = F.splitIssues(DATA);
    expect(s.top).toHaveLength(3);
    expect(s.top.concat(s.rest)).toEqual(s.all);
  });

  it('counts only the checks that apply in "N of M checks passed", and says how many don\'t', () => {
    const line = F.checksLine({ url: 'https://example.com/', meta: { title: { text: 'A title that is long enough to pass', length: 35 } } });
    expect(line.total).toBe(18);
    expect(line.of + line.na).toBe(18);
    expect(line.na).toBeGreaterThan(0);
    const text = F.checksLineText({ passed: 14, of: 17, na: 1 });
    expect(text).toEqual({ passed: '14 of 17 checks passed', na: '1 doesn’t apply to this page' });
    expect(F.checksLineText({ passed: 18, of: 18, na: 0 }).na).toBe('');
    expect(F.checksLineText({ passed: 15, of: 16, na: 2 }).na).toBe('2 don’t apply to this page');
  });

  it('says what each sub-score covers, read from the checks in its group', () => {
    expect(F.groupCovers()).toEqual({
      Meta: 'Title, description, canonical, structured data, duplicate tags, Open Graph',
      Content: 'H1, words, reading level, language',
      Links: 'Images without alt, internal links',
      Tech: 'Indexable, HTTPS, viewport, mixed content, DOM nodes, charset'
    });
  });

  it('says what the score is and that it is not rankings', () => {
    expect(F.SCORE_LINE).toMatch(/^An on-page checklist: 100 minus the points the issues cost\./);
    expect(F.SCORE_LINE).toMatch(/doesn.t measure or predict rankings/);
  });

  it('copies every issue as plain text, worst first, with why and what to change', () => {
    const text = F.issuesText(DATA);
    const lines = text.split('\n');
    const r = A.evaluateChecks(DATA);
    expect(lines[0]).toBe('SEO Bandwagon: http://example.com/a');
    expect(lines[1]).toMatch(new RegExp(`^Score ${r.score} \\(${r.grade}\\) · \\d+ of \\d+ checks passed`));
    expect(lines[2]).toBe(F.SCORE_LINE);
    const numbered = lines.filter((l) => /^\d+\. /.test(l));
    expect(numbered).toHaveLength(r.issues.length);
    expect(numbered[0]).toBe('1. Set to noindex (−15)');
    expect(text).toContain('   Why it matters: ' + A.ISSUES['Set to noindex'].why);
    expect(text).toContain('   What to change: ');
  });

  it('copies a clean page as a clean page', () => {
    const text = F.issuesText({ url: 'https://example.com/' });
    expect(text).toMatch(/No issues: every check that applies passed\.$/);
  });
});

describe('the first-run guide', () => {
  it('is marked on a fresh install only, never on an update or a browser update', () => {
    expect(R.installRecord('install', Date.UTC(2026, 10, 17))).toEqual({ pending: true, at: '2026-11-17T00:00:00.000Z' });
    expect(R.installRecord('update')).toBeNull();
    expect(R.installRecord('chrome_update')).toBeNull();
    expect(R.installRecord('shared_module_update')).toBeNull();
  });

  it('shows while pending, and once dismissed never again', () => {
    expect(R.shouldShow({ pending: true })).toBe(true);
    expect(R.shouldShow(R.dismissedRecord())).toBe(false);
    expect(R.shouldShow(undefined)).toBe(false);
    expect(R.shouldShow({})).toBe(false);
  });

  it('says what the score is, where the checks are and what an account adds, and that none of it needs one', () => {
    expect(R.GUIDE.steps.map((s) => s.id)).toEqual(['score', 'checks', 'account']);
    const words = R.GUIDE.steps.map((s) => s.text).join(' ');
    expect(words).toMatch(/doesn.t measure or predict rankings/);
    expect(words).toMatch(/All checks/);
    expect(R.GUIDE.steps[2].text).toMatch(/^Nothing here needs an account\./);
    expect(words).not.toMatch(/\b(Chrome|Firefox|Edge)\b/);
    expect(words).not.toMatch(BRITISH);
    expect(words).not.toMatch(/\b(upgrade|trial|paid|pro plan|subscribe)\b/i);
  });

  it('counts the checks the scorer has', () => {
    expect(R.GUIDE.steps[0].text).toContain(`${A.CHECKS.length} checks`);
  });
});
