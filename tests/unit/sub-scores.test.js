// src/lib/sub-scores.js — Meta / Content / Links / Tech, from the score's own
// checks (lib/content-analysis.js's CHECKS, since 1.10.4).
//
// These thresholds are what every surface reports about a page, so the point
// of these tests is the boundaries: one character either side of a range has
// to flip the check, and a group's percentage is the points it kept of the
// points of its checks that apply. And the one-list rule: https, mixed
// content and noindex move the score and the sub-scores together.
import { describe, it, expect } from 'vitest';
import { computeSubScores, checkTotals } from '../../extension/src/lib/sub-scores.js';
import analysis from '../../extension/lib/content-analysis.js';

/** A page that passes all 18 checks. Individual tests break one thing at a time. */
function perfect() {
  return {
    url: 'https://example.com/page',
    meta: {
      title: { text: 'A'.repeat(45), length: 45, count: 1 },
      description: { text: 'B'.repeat(140), length: 140, count: 1 },
      canonical: 'https://example.com/page',
      canonicalUrls: ['https://example.com/page'],
      canonicalCount: 1,
      robots: null,
      noindex: false,
      lang: 'en',
      viewport: 'width=device-width, initial-scale=1',
      charset: { document: 'UTF-8', declared: 'utf-8' },
      openGraph: { title: 'A' },
      schema: [{ '@type': 'Article' }],
      structuredData: { jsonLd: 1, microdata: 0, rdfa: 0 },
    },
    content: { wordCount: 900, readability: { fleschKincaid: 9, level: 'Fairly easy' } },
    headings: { h1: ['One'] },
    links: { internal: { count: 12 }, external: { count: 4 } },
    images: { total: 5, missingAlt: { count: 0 } },
    technical: { domElements: 900 },
    mixedContent: { isHttps: true, mixedCount: 0 },
  };
}
const group = (data, k) => computeSubScores(data).find((g) => g.k === k);
const score = (data) => analysis.evaluateChecks(data).score;

describe('computeSubScores', () => {
  it('returns four groups summing to 18 checks and 100 points, in a fixed order', () => {
    const groups = computeSubScores(perfect());
    expect(groups.map((g) => g.k)).toEqual(['Meta', 'Content', 'Links', 'Tech']);
    expect(groups.map((g) => g.of)).toEqual([6, 4, 2, 6]);
    expect(groups.map((g) => g.points)).toEqual([34, 24, 11, 31]);
    expect(groups.reduce((n, g) => n + g.of, 0)).toBe(18);
    expect(groups.reduce((n, g) => n + g.points, 0)).toBe(100);
  });

  it('scores a complete page 100 in every group and as a score', () => {
    expect(computeSubScores(perfect()).map((g) => g.v)).toEqual([100, 100, 100, 100]);
    expect(checkTotals(perfect())).toEqual({ passed: 18, of: 18 });
    expect(score(perfect())).toBe(100);
  });

  it('the groups keep exactly the points the score keeps', () => {
    const d = perfect();
    d.url = 'http://example.com/page';
    d.meta.noindex = true;
    d.content.wordCount = 400;
    d.images = { total: 4, missingAlt: { count: 3 } };
    const kept = computeSubScores(d).reduce((n, g) => n + g.kept, 0);
    // Mixed content doesn't apply to http, so its 3 points are in neither.
    expect(kept).toBe(score(d) - 3);
  });

  it('survives empty, partial and undefined input without throwing', () => {
    for (const input of [undefined, null, {}, { meta: {}, links: {} }]) {
      const groups = computeSubScores(input);
      expect(groups).toHaveLength(4);
      expect(groups.every((g) => Number.isFinite(g.v))).toBe(true);
    }
    // Nothing to read: every check is "doesn't apply", none counted.
    expect(checkTotals({})).toEqual({ passed: 0, of: 0 });
  });

  it('title and description pass only inside their ranges', () => {
    const at = (len) => {
      const d = perfect();
      d.meta.title = { text: 'A'.repeat(len), length: len, count: 1 };
      return group(d, 'Meta').passed;
    };
    expect(at(29)).toBe(5);
    expect(at(30)).toBe(6);
    expect(at(60)).toBe(6);
    expect(at(61)).toBe(5);

    const desc = (len) => {
      const d = perfect();
      d.meta.description = { text: 'B'.repeat(len), length: len, count: 1 };
      return group(d, 'Meta').passed;
    };
    expect(desc(119)).toBe(5);
    expect(desc(120)).toBe(6);
    expect(desc(160)).toBe(6);
    expect(desc(161)).toBe(5);
  });

  it('a wide-character title counts each character twice', () => {
    const d = perfect();
    // 25 characters of Japanese read 50 wide: inside 30 to 60.
    d.meta.title = { text: 'あ'.repeat(25), length: 25, displayLength: 50, count: 1 };
    expect(group(d, 'Meta').passed).toBe(6);
  });

  it('word count keeps half its points between 300 and 599', () => {
    const words = (n) => {
      const d = perfect();
      d.content.wordCount = n;
      return group(d, 'Content');
    };
    expect(words(600)).toMatchObject({ passed: 4, kept: 24 });
    expect(words(599)).toMatchObject({ passed: 3, kept: 19 });
    expect(words(300)).toMatchObject({ passed: 3, kept: 19 });
    expect(words(299)).toMatchObject({ passed: 3, kept: 14 });
    // 19 of 24 points.
    expect(words(400).v).toBe(79);
  });

  it('readability does not apply to a page that is not in English', () => {
    const d = perfect();
    d.content.readability = null;
    expect(group(d, 'Content')).toMatchObject({ of: 3, points: 20, v: 100 });
  });

  it('images don\'t apply when there are none, and a single missing alt costs 3', () => {
    const d = perfect();
    d.images = { total: 0, missingAlt: { count: 0 } };
    expect(group(d, 'Links')).toMatchObject({ of: 1, v: 100 });
    d.images = { total: 4, missingAlt: { count: 1 } };
    expect(group(d, 'Links')).toMatchObject({ passed: 1, of: 2, kept: 8 });
    expect(score(d)).toBe(97);
  });

  it('http, noindex and mixed content cost points in the score and their sub-score both', () => {
    const http = perfect();
    http.url = 'http://example.com/page';
    expect(score(http)).toBe(95);
    // Mixed content doesn't apply to an http page: 23 of 28.
    expect(group(http, 'Tech')).toMatchObject({ passed: 4, of: 5, v: 82 });

    const noindex = perfect();
    noindex.meta.noindex = true;
    expect(score(noindex)).toBe(85);
    expect(group(noindex, 'Tech').v).toBe(52);

    const mixed = perfect();
    mixed.mixedContent = { isHttps: true, mixedCount: 3 };
    expect(score(mixed)).toBe(97);
    expect(group(mixed, 'Tech').passed).toBe(5);
  });

  it('a capture from before 1.10.4 reads noindex from its robots text', () => {
    const d = perfect();
    delete d.meta.noindex;
    d.meta.robots = 'NONE';
    expect(score(d)).toBe(85);
    // Its missing lang, viewport, charset and duplicate counts don't apply.
    delete d.meta.lang;
    delete d.meta.viewport;
    delete d.meta.charset;
    delete d.meta.title.count;
    expect(group(d, 'Meta').of).toBe(5);
    expect(group(d, 'Tech').of).toBe(4);
  });

  it('exactly one H1 passes; zero or two do not', () => {
    const h1 = (n) => {
      const d = perfect();
      d.headings.h1 = Array.from({ length: n }, (_, i) => 'H' + i);
      return group(d, 'Content').passed;
    };
    expect(h1(0)).toBe(3);
    expect(h1(1)).toBe(4);
    expect(h1(2)).toBe(3);
  });

  it('DOM size passes at the 2000 boundary and fails above it', () => {
    const dom = (n) => {
      const d = perfect();
      d.technical.domElements = n;
      return group(d, 'Tech').passed;
    };
    expect(dom(2000)).toBe(6);
    expect(dom(2001)).toBe(5);
  });
});
