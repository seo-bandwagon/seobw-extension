// src/lib/sub-scores.js — the 14 checks behind Meta / Content / Links / Tech.
//
// These thresholds are what every surface reports about a page, so the point
// of these tests is the boundaries: one character either side of a range has
// to flip the check, and the half-point content rule has to survive rounding.
import { describe, it, expect } from 'vitest';
import { computeSubScores, checkTotals } from '../../extension/src/lib/sub-scores.js';

/** A page that passes all 14 checks. Individual tests break one thing at a time. */
function perfect() {
  return {
    url: 'https://example.com/page',
    meta: {
      title: { text: 'A'.repeat(45), length: 45 },
      description: { text: 'B'.repeat(140), length: 140 },
      canonical: 'https://example.com/page',
      openGraph: { title: 'A' },
      schema: [{ '@type': 'Article' }],
    },
    content: { wordCount: 900, readability: { fleschKincaid: 9, level: 'Fairly easy' } },
    headings: { h1: ['One'] },
    links: { internal: { count: 12 }, external: { count: 4 } },
    images: { total: 5, missingAlt: { count: 0 } },
    technical: { domElements: 900 },
    mixedContent: { mixedCount: 0 },
  };
}
const group = (data, k) => computeSubScores(data).find((g) => g.k === k);

describe('computeSubScores', () => {
  it('returns four groups summing to 14 checks, in a fixed order', () => {
    const groups = computeSubScores(perfect());
    expect(groups.map((g) => g.k)).toEqual(['Meta', 'Content', 'Links', 'Tech']);
    expect(groups.map((g) => g.of)).toEqual([5, 3, 3, 3]);
    expect(groups.reduce((n, g) => n + g.of, 0)).toBe(14);
  });

  it('scores a complete page 100 in every group', () => {
    expect(computeSubScores(perfect()).map((g) => g.v)).toEqual([100, 100, 100, 100]);
    expect(checkTotals(perfect())).toEqual({ passed: 14, of: 14 });
  });

  it('survives empty, partial and undefined input without throwing', () => {
    for (const input of [undefined, null, {}, { meta: {}, links: {} }]) {
      const groups = computeSubScores(input);
      expect(groups).toHaveLength(4);
      expect(groups.every((g) => Number.isFinite(g.v))).toBe(true);
    }
    // No url, no images, no mixedContent block: https fails, the other two
    // Tech checks pass by absence — 2 of 3.
    expect(group({}, 'Tech')).toMatchObject({ passed: 2, of: 3, v: 67 });
  });

  it('title and description pass only inside their ranges', () => {
    const at = (len) => {
      const d = perfect();
      d.meta.title = { text: 'A'.repeat(len), length: len };
      return group(d, 'Meta').passed;
    };
    expect(at(29)).toBe(4);
    expect(at(30)).toBe(5);
    expect(at(60)).toBe(5);
    expect(at(61)).toBe(4);

    const desc = (len) => {
      const d = perfect();
      d.meta.description = { text: 'B'.repeat(len), length: len };
      return group(d, 'Meta').passed;
    };
    expect(desc(119)).toBe(4);
    expect(desc(120)).toBe(5);
    expect(desc(160)).toBe(5);
    expect(desc(161)).toBe(4);
  });

  it('word count is worth a half between 300 and 599', () => {
    const words = (n) => {
      const d = perfect();
      d.content.wordCount = n;
      return group(d, 'Content');
    };
    expect(words(900).passed).toBe(3);
    expect(words(600).passed).toBe(3);
    expect(words(599).passed).toBe(2.5);
    expect(words(300).passed).toBe(2.5);
    expect(words(299).passed).toBe(2);
    // 2.5 of 3 rounds to 83 in the ring, and the half survives to the total.
    expect(words(400).v).toBe(83);
    const d = perfect();
    d.content.wordCount = 400;
    expect(checkTotals(d)).toEqual({ passed: 14, of: 14 }); // 13.5 rounds to 14
  });

  it('images pass when there are none at all, and fail on a single missing alt', () => {
    const d = perfect();
    d.images = { total: 0, missingAlt: { count: 0 } };
    expect(group(d, 'Links').passed).toBe(3);
    d.images = { total: 4, missingAlt: { count: 1 } };
    expect(group(d, 'Links').passed).toBe(2);
  });

  it('http fails the https check and mixed content fails its own', () => {
    const d = perfect();
    d.url = 'http://example.com/page';
    expect(group(d, 'Tech').passed).toBe(2);
    const e = perfect();
    e.mixedContent = { mixedCount: 3 };
    expect(group(e, 'Tech').passed).toBe(2);
  });

  it('exactly one H1 passes; zero or two do not', () => {
    const h1 = (n) => {
      const d = perfect();
      d.headings.h1 = Array.from({ length: n }, (_, i) => 'H' + i);
      return group(d, 'Content').passed;
    };
    expect(h1(0)).toBe(2);
    expect(h1(1)).toBe(3);
    expect(h1(2)).toBe(2);
  });

  it('DOM size passes at the 2000 boundary and fails above it', () => {
    const dom = (n) => {
      const d = perfect();
      d.technical.domElements = n;
      return group(d, 'Tech').passed;
    };
    expect(dom(2000)).toBe(3);
    expect(dom(2001)).toBe(2);
  });
});
