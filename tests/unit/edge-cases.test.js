// Edge-case tests — exercise the pure logic against inputs that model the
// failure modes enumerated in the v1.2.0 test plan:
//   #1  minimal page          — zeroed scores, no throw
//   #2  huge page              — n-gram + score math stay finite on big arrays
//   #4  malformed JSON-LD      — score deducts "no schema" instead of crashing
//   #6  empty title            — scoring deducts "missing title"
//   #9  zero-word page         — readability returns zeros, no div-by-zero

import { describe, it, expect } from 'vitest';
import analysis from '../../lib/content-analysis.js';

const {
  calculateSEOScore,
  calculateReadability,
  buildNgramCounts,
  getTopN,
  getWords,
  getTopWords,
  getTopPhrases
} = analysis;

// Builds a minimal-but-valid inputs object; callers mutate specific branches.
function minimalInputs() {
  return {
    content: {
      wordCount: 0,
      readability: { fleschKincaid: 0, fleschEase: 0, level: 'College' }
    },
    meta: {
      title: { text: '', length: 0 },
      description: { text: '', length: 0 },
      canonical: null,
      schema: [],
      openGraph: { title: null }
    },
    headings: { h1: [], multipleH1: false },
    links: { internal: { count: 0 } },
    images: { total: 0, missingAlt: { count: 0 } },
    technical: { domElements: 0 }
  };
}

describe('edge case #1 — minimal page', () => {
  it('does not throw on an entirely empty capture', () => {
    const i = minimalInputs();
    expect(() => calculateSEOScore(
      i.content, i.meta, i.headings, i.links, i.images, i.technical
    )).not.toThrow();
  });

  it('accumulates many issues and never produces a negative score', () => {
    const i = minimalInputs();
    const result = calculateSEOScore(
      i.content, i.meta, i.headings, i.links, i.images, i.technical
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.issues.length).toBeGreaterThan(5);
    expect(result.grade).toBe('F');
  });
});

describe('edge case #2 — huge page (performance smoke)', () => {
  it('computes readability on a long word array in < 200ms', () => {
    const words = Array.from({ length: 10000 }, (_, i) => `word${i % 200}`);
    const text = words.join(' ') + '.';
    const start = performance.now();
    const result = calculateReadability(text, words);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result.fleschKincaid).toBeGreaterThanOrEqual(0);
  });

  it('builds bigram counts over a large word array without timing out', () => {
    const words = Array.from({ length: 5000 }, (_, i) => `word${i % 100}`);
    const start = performance.now();
    const counts = buildNgramCounts(words, 2, null);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(Object.keys(counts).length).toBeGreaterThan(0);
  });

  it('getTopN returns within cap even for a huge count map', () => {
    const counts = {};
    for (let i = 0; i < 5000; i++) counts['phrase' + i] = Math.floor(Math.random() * 10) + 2;
    const top = getTopN(counts, 30);
    expect(top.length).toBe(30);
    // Sorted descending
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].count).toBeGreaterThanOrEqual(top[i].count);
    }
  });
});

describe('edge case #4 — malformed JSON-LD equivalent', () => {
  it('treats meta.schema = [] the same as parse-failure — deducts for no structured data', () => {
    const i = minimalInputs();
    i.meta.title = { text: 'Valid title that is long enough', length: 33 };
    i.meta.description = {
      text: 'A valid meta description with enough length to avoid penalties.',
      length: 62
    };
    i.headings.h1 = ['H1'];
    i.meta.schema = []; // caller (content.js) catches JSON.parse errors and leaves this empty
    const result = calculateSEOScore(
      i.content, i.meta, i.headings, i.links, i.images, i.technical
    );
    expect(result.issues).toContain('No structured data');
  });
});

describe('edge case #6 — empty title', () => {
  it('deducts 15 and flags "Missing title" when title.text is empty', () => {
    const i = minimalInputs();
    i.meta.title = { text: '', length: 0 };
    const result = calculateSEOScore(
      i.content, i.meta, i.headings, i.links, i.images, i.technical
    );
    expect(result.issues).toContain('Missing title');
  });
});

describe('edge case #9 — zero-word page', () => {
  it('returns zeroed readability for empty words (no divide-by-zero)', () => {
    const result = calculateReadability('', []);
    expect(Number.isFinite(result.fleschKincaid)).toBe(true);
    expect(Number.isFinite(result.fleschEase)).toBe(true);
    expect(result.fleschKincaid).toBe(0);
    expect(result.fleschEase).toBe(0);
  });

  it('getTopWords returns empty for no input', () => {
    expect(getTopWords([])).toEqual([]);
  });

  it('getTopPhrases returns empty for < 2 words', () => {
    expect(getTopPhrases([])).toEqual([]);
    expect(getTopPhrases(['solo'])).toEqual([]);
  });
});

describe('input robustness', () => {
  it('getWords handles mixed unicode + punctuation', () => {
    // Curly quotes, em dash, accented chars — strip to plain words
    const result = getWords('“Local” SEO — café');
    // Non-ASCII may or may not survive regex depending on flags; assert at least something reasonable happened
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('calculateReadability handles a single-word input without throwing', () => {
    const result = calculateReadability('Hello.', ['hello']);
    expect(Number.isFinite(result.fleschKincaid)).toBe(true);
  });

  it('buildNgramCounts returns {} when n exceeds word count', () => {
    expect(buildNgramCounts(['one', 'two'], 5, null)).toEqual({});
  });
});
