// Unit tests for pure logic in lib/content-analysis.js.
// Covers: scoring, readability math, word/phrase extraction, n-grams.

import { describe, it, expect } from 'vitest';
import analysis from '../../extension/lib/content-analysis.js';

const {
  calculateSEOScore,
  getGrade,
  cleanText,
  getWords,
  countSentences,
  countSyllables,
  calculateReadability,
  getTopWords,
  getTopPhrases,
  buildNgramCounts,
  getTopN,
  DEFAULT_STOP_WORDS
} = analysis;

// Fixture: a well-formed capture payload. Start from this and mutate to
// stress specific scoring branches.
function goodCaptureInputs(overrides = {}) {
  return {
    content: {
      wordCount: 1200,
      readability: { fleschKincaid: 9.2, fleschEase: 60, level: 'High School' },
      ...overrides.content
    },
    meta: {
      title: { text: 'Local SEO: A 2026 Guide', length: 24 },
      description: {
        text: 'Everything you need to know about ranking in local search.',
        length: 58
      },
      canonical: 'https://seobandwagon.com/local-seo',
      schema: [{ '@type': 'Article' }],
      openGraph: { title: 'Local SEO' },
      ...overrides.meta
    },
    headings: {
      h1: ['Local SEO'],
      multipleH1: false,
      ...overrides.headings
    },
    links: {
      internal: { count: 12 },
      ...overrides.links
    },
    images: {
      total: 4,
      missingAlt: { count: 0 },
      ...overrides.images
    },
    technical: {
      domElements: 800,
      ...overrides.technical
    }
  };
}

describe('getGrade', () => {
  it.each([
    [100, 'A'],
    [95, 'A'],
    [90, 'A'],
    [89, 'B'],
    [80, 'B'],
    [79, 'C'],
    [70, 'C'],
    [69, 'D'],
    [60, 'D'],
    [59, 'F'],
    [0, 'F']
  ])('returns %s -> %s', (score, expected) => {
    expect(getGrade(score)).toBe(expected);
  });
});

describe('calculateSEOScore', () => {
  it('awards perfect-but-not-100 for a well-formed page (deducts the title-too-short if applicable)', () => {
    const inputs = goodCaptureInputs();
    // Title has length 24 (< 30) -> -6. Description length 58 (< 120) -> -4.
    // Everything else clean; what the inputs don't carry (url, lang,
    // viewport, charset) doesn't apply.
    const result = calculateSEOScore(
      inputs.content,
      inputs.meta,
      inputs.headings,
      inputs.links,
      inputs.images,
      inputs.technical
    );
    expect(result.score).toBe(90);
    expect(result.grade).toBe('A');
    expect(result.issues).toContain('Title too short');
    expect(result.issues).toContain('Description too short');
  });

  it('deducts 12 for a missing title and 8 for a missing description', () => {
    const inputs = goodCaptureInputs({
      meta: {
        ...goodCaptureInputs().meta,
        title: { text: '', length: 0 },
        description: { text: '', length: 0 }
      }
    });
    const result = calculateSEOScore(
      inputs.content,
      inputs.meta,
      inputs.headings,
      inputs.links,
      inputs.images,
      inputs.technical
    );
    expect(result.score).toBe(80); // 100 - 12 - 8
    expect(result.issues).toContain('Missing title');
    expect(result.issues).toContain('Missing meta description');
  });

  it('deducts 10 for missing H1 and flags the issue', () => {
    const inputs = goodCaptureInputs({
      headings: { h1: [], multipleH1: false }
    });
    const result = calculateSEOScore(
      inputs.content,
      inputs.meta,
      inputs.headings,
      inputs.links,
      inputs.images,
      inputs.technical
    );
    expect(result.issues).toContain('Missing H1');
  });

  it('deducts 5 for multiple H1s', () => {
    const inputs = goodCaptureInputs({
      headings: { h1: ['H1 A', 'H1 B'], multipleH1: true }
    });
    const result = calculateSEOScore(
      inputs.content,
      inputs.meta,
      inputs.headings,
      inputs.links,
      inputs.images,
      inputs.technical
    );
    expect(result.issues).toContain('Multiple H1 tags');
  });

  it('deducts more for high missing-alt ratio', () => {
    const manyMissing = goodCaptureInputs({
      images: { total: 10, missingAlt: { count: 8 } }
    });
    const fewMissing = goodCaptureInputs({
      images: { total: 10, missingAlt: { count: 1 } }
    });
    const none = goodCaptureInputs({
      images: { total: 10, missingAlt: { count: 0 } }
    });

    const manyResult = calculateSEOScore(
      manyMissing.content, manyMissing.meta, manyMissing.headings,
      manyMissing.links, manyMissing.images, manyMissing.technical
    );
    const fewResult = calculateSEOScore(
      fewMissing.content, fewMissing.meta, fewMissing.headings,
      fewMissing.links, fewMissing.images, fewMissing.technical
    );
    const noneResult = calculateSEOScore(
      none.content, none.meta, none.headings,
      none.links, none.images, none.technical
    );

    expect(manyResult.issues).toContain('Many images missing alt');
    expect(fewResult.issues).toContain('Some images missing alt');
    expect(noneResult.issues).not.toContain('Many images missing alt');
    expect(noneResult.issues).not.toContain('Some images missing alt');
  });

  it('deducts 10 for thin content (<300 words)', () => {
    const inputs = goodCaptureInputs({
      content: { wordCount: 150, readability: { fleschKincaid: 5 } }
    });
    const result = calculateSEOScore(
      inputs.content, inputs.meta, inputs.headings,
      inputs.links, inputs.images, inputs.technical
    );
    expect(result.issues).toContain('Thin content');
  });

  it('deducts 5 for light content (300-599 words)', () => {
    const inputs = goodCaptureInputs({
      content: { wordCount: 450, readability: { fleschKincaid: 5 } }
    });
    const result = calculateSEOScore(
      inputs.content, inputs.meta, inputs.headings,
      inputs.links, inputs.images, inputs.technical
    );
    expect(result.issues).toContain('Light content');
  });

  it('produces a failing grade when every signal is missing', () => {
    // Since 1.10.4 the checks' points add up to 100. An http page has no
    // mixed-content check, so this one bottoms out at 3.
    const inputs = goodCaptureInputs({
      meta: {
        title: { text: '', length: 0, count: 2 },
        description: { text: '', length: 0, count: 0 },
        canonical: null,
        schema: [],
        openGraph: { title: null },
        robots: 'noindex',
        lang: null,
        viewport: null,
        charset: { document: 'windows-1252', declared: null }
      },
      headings: { h1: [], multipleH1: false },
      links: { internal: { count: 0 } },
      images: { total: 10, missingAlt: { count: 10 } },
      technical: { domElements: 5000 },
      content: { wordCount: 50, readability: { fleschKincaid: 18 } }
    });
    const result = calculateSEOScore(
      inputs.content, inputs.meta, inputs.headings,
      inputs.links, inputs.images, inputs.technical,
      { url: 'http://example.com/', mixedContent: { isHttps: false, mixedCount: 0 } }
    );
    expect(result.score).toBe(3);
    expect(result.grade).toBe('F');
    expect(result.issues.length).toBeGreaterThan(7);
  });
});

describe('cleanText', () => {
  it('collapses whitespace', () => {
    expect(cleanText('hello   world\n\n\tfoo')).toBe('hello world foo');
  });

  it('strips non-allowed punctuation while keeping common marks', () => {
    expect(cleanText('Hello, world! Visit "example.com" (the site)')).toBe(
      'Hello, world! Visit "example.com" (the site)'
    );
  });

  it('handles empty string', () => {
    expect(cleanText('')).toBe('');
  });

  it('handles whitespace-only', () => {
    expect(cleanText('   \n\t  ')).toBe('');
  });
});

describe('getWords', () => {
  it('lowercases and splits on whitespace', () => {
    expect(getWords('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips punctuation', () => {
    expect(getWords('Hello, world! "Quoted" (paren)')).toEqual([
      'hello', 'world', 'quoted', 'paren'
    ]);
  });

  it('handles empty input', () => {
    expect(getWords('')).toEqual([]);
  });

  it('filters out empty tokens after splitting', () => {
    expect(getWords('a  b   c')).toEqual(['a', 'b', 'c']);
  });
});

describe('countSentences', () => {
  it('splits on terminal punctuation', () => {
    expect(countSentences('First. Second! Third?')).toBe(3);
  });

  it('returns at least 1 for non-empty text without terminals', () => {
    expect(countSentences('no punctuation here')).toBe(1);
  });

  it('handles empty', () => {
    // Implementation returns 1 when the split result is empty — guards against
    // divide-by-zero in calculateReadability.
    expect(countSentences('')).toBe(1);
  });
});

describe('countSyllables', () => {
  it.each([
    ['cat', 1],
    ['hello', 2],
    // Note: the regex-based heuristic overcounts "beautiful" (actual: "beau-ti-ful")
    // as 4 syllables because it matches the 'eau', 'ti', 'u' patterns separately.
    // This is the characterized behavior — accuracy of the heuristic is out of scope.
    ['beautiful', 4]
  ])('%s -> %d', (word, expected) => {
    expect(countSyllables(word)).toBe(expected);
  });

  it('returns 1 for very short words', () => {
    expect(countSyllables('a')).toBe(1);
    expect(countSyllables('go')).toBe(1);
  });
});

describe('calculateReadability', () => {
  it('returns zeros for empty word array', () => {
    const result = calculateReadability('', []);
    expect(result.fleschKincaid).toBe(0);
    expect(result.fleschEase).toBe(0);
  });

  it('returns a valid grade level for a simple sentence', () => {
    const words = getWords('The cat sat on the mat.');
    const result = calculateReadability('The cat sat on the mat.', words);
    expect(result.level).toBeDefined();
    expect(['Elementary', 'Middle School', 'High School', 'College']).toContain(result.level);
    expect(result.fleschEase).toBeGreaterThanOrEqual(0);
    expect(result.fleschEase).toBeLessThanOrEqual(100);
  });

  it('clamps fleschEase between 0 and 100', () => {
    // Pathological input: very long words, very long sentence
    const text = 'antidisestablishmentarianism pneumonoultramicroscopicsilicovolcanoconiosis';
    const words = getWords(text);
    const result = calculateReadability(text, words);
    expect(result.fleschEase).toBeGreaterThanOrEqual(0);
    expect(result.fleschEase).toBeLessThanOrEqual(100);
  });

  it('never returns negative fleschKincaid', () => {
    const result = calculateReadability('a. b. c.', getWords('a. b. c.'));
    expect(result.fleschKincaid).toBeGreaterThanOrEqual(0);
  });
});

describe('getTopWords', () => {
  it('counts non-stop-words and sorts by frequency', () => {
    const words = 'local seo local seo local ranking'.split(' ');
    const top = getTopWords(words);
    expect(top[0]).toEqual({ word: 'local', count: 3 });
    expect(top[1]).toEqual({ word: 'seo', count: 2 });
    expect(top.find(t => t.word === 'ranking')).toEqual({ word: 'ranking', count: 1 });
  });

  it('filters words of length <= 2', () => {
    const words = 'a an on local seo'.split(' ');
    const top = getTopWords(words);
    expect(top.every(t => t.word.length > 2)).toBe(true);
  });

  it('filters stop words', () => {
    const words = ['the', 'and', 'but', 'ranking'];
    const top = getTopWords(words);
    expect(top.map(t => t.word)).toEqual(['ranking']);
  });

  it('caps at 30 entries', () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
    const top = getTopWords(words);
    expect(top.length).toBe(30);
  });

  it('returns empty array for empty input', () => {
    expect(getTopWords([])).toEqual([]);
  });
});

describe('getTopPhrases', () => {
  it('finds bigrams that appear more than once', () => {
    const words = 'local seo ranking local seo strategy local seo tips'.split(' ');
    const top = getTopPhrases(words);
    const localSeo = top.find(p => p.phrase === 'local seo');
    expect(localSeo).toBeDefined();
    expect(localSeo.count).toBe(3);
  });

  it('filters out single-occurrence phrases', () => {
    const words = 'alpha beta gamma delta epsilon'.split(' ');
    const top = getTopPhrases(words);
    // All phrases appear exactly once, so result is empty
    expect(top).toEqual([]);
  });

  it('returns empty for short input (< 2 words)', () => {
    expect(getTopPhrases([])).toEqual([]);
    expect(getTopPhrases(['single'])).toEqual([]);
  });
});

describe('buildNgramCounts', () => {
  it('counts overlapping n-grams', () => {
    const words = ['a', 'b', 'c', 'a', 'b'];
    const counts = buildNgramCounts(words, 2, null);
    expect(counts['a b']).toBe(2);
    expect(counts['b c']).toBe(1);
    expect(counts['c a']).toBe(1);
  });

  it('skips n-grams composed entirely of stop words (when n > 1)', () => {
    const words = ['the', 'and', 'local', 'seo'];
    const stopWords = new Set(['the', 'and']);
    const counts = buildNgramCounts(words, 2, stopWords);
    // 'the and' is ALL stop words -> skipped
    expect(counts['the and']).toBeUndefined();
    // 'and local' has one non-stop -> kept
    expect(counts['and local']).toBe(1);
  });

  it('returns empty when words.length < n', () => {
    expect(buildNgramCounts(['a'], 3, null)).toEqual({});
  });

  it('handles unigrams (n=1)', () => {
    const counts = buildNgramCounts(['a', 'a', 'b'], 1, null);
    expect(counts['a']).toBe(2);
    expect(counts['b']).toBe(1);
  });
});

describe('getTopN', () => {
  it('filters out entries with count < 2 and sorts descending', () => {
    const counts = { rare: 1, common: 5, moderate: 2 };
    const top = getTopN(counts, 10);
    expect(top).toEqual([
      { phrase: 'common', count: 5 },
      { phrase: 'moderate', count: 2 }
    ]);
  });

  it('caps at n results', () => {
    const counts = { a: 10, b: 9, c: 8, d: 7, e: 6 };
    const top = getTopN(counts, 3);
    expect(top.length).toBe(3);
    expect(top[0].count).toBe(10);
  });

  it('returns empty for empty input', () => {
    expect(getTopN({}, 5)).toEqual([]);
  });
});

describe('DEFAULT_STOP_WORDS', () => {
  it('is a Set containing common English stop words', () => {
    expect(DEFAULT_STOP_WORDS.has('the')).toBe(true);
    expect(DEFAULT_STOP_WORDS.has('and')).toBe(true);
    expect(DEFAULT_STOP_WORDS.has('local')).toBe(false);
  });
});

// ------------------------------------------------------------------ 1.10.4

const {
  evaluateChecks, groupChecks, fixFor, CHECKS, ISSUES, POINTS,
  detectLanguage, displayLength, lcpFrom, clsFrom, inpFrom, firstHiddenFrom
} = analysis;

describe('words in every language (1.10.4)', () => {
  it('counts Cyrillic, Greek and accented Latin words, which cleanText used to drop', () => {
    expect(getWords(cleanText('Небольшой огород у дома — это просто.'))).toEqual(['небольшой', 'огород', 'у', 'дома', 'это', 'просто']);
    expect(getWords('Καλημέρα κόσμε')).toEqual(['καλημέρα', 'κόσμε']);
    expect(getWords('Crème brûlée à la française')).toHaveLength(5);
  });

  it('splits Japanese, Chinese and Thai, which have no spaces, into words', () => {
    const ja = getWords('小さな家庭菜園の始め方。');
    expect(ja.length).toBeGreaterThan(3);
    expect(ja.join('')).toBe('小さな家庭菜園の始め方');
    expect(getWords('SEO対策').slice(0, 1)).toEqual(['seo']);
    expect(getWords('ภาษาไทยง่ายนิดเดียว').length).toBeGreaterThan(1);
  });

  it('keeps an English page\'s words as they were: apostrophes, hyphens, dots and digit commas join', () => {
    expect(getWords("Don't e-mail the U.S. team about example.com")).toEqual(["don't", 'e-mail', 'the', 'u.s', 'team', 'about', 'example.com']);
    expect(getWords('It costs 5.99, or 1,000 for a crate, e.g. now.')).toEqual(['it', 'costs', '5.99', 'or', '1,000', 'for', 'a', 'crate', 'e.g', 'now']);
  });

  it('drops emoji and symbols but keeps every script\'s letters', () => {
    expect(cleanText('Привет 👋 мир ©')).toBe('Привет мир');
  });

  it('counts sentences ending in CJK full stops', () => {
    expect(countSentences('一つ目。二つ目！三つ目？')).toBe(3);
  });
});

describe('detectLanguage', () => {
  it('reads the lang attribute: English only for en', () => {
    expect(detectLanguage('en-US', 'Hello there', ['hello', 'there'])).toEqual({ code: 'en', source: 'lang', english: true });
    expect(detectLanguage('ru', 'Привет', ['привет'])).toMatchObject({ code: 'ru', english: false });
  });

  it('is not English when the text is mostly another script, whatever lang says', () => {
    expect(detectLanguage('en', 'これは日本語の文章です', ['これ', 'は'])).toMatchObject({ code: 'en', english: false });
  });

  it('without lang, recognises English text by its commonest words', () => {
    const en = 'The garden is easy to start and the soil is the most important part of it for you to get right this year'.toLowerCase().split(' ');
    expect(detectLanguage(null, en.join(' '), en)).toMatchObject({ code: 'en', source: 'text', english: true });
    const de = 'Der Garten ist leicht anzulegen und der Boden ist der wichtigste Teil davon für dich in diesem Jahr ganz sicher'.toLowerCase().split(' ');
    expect(detectLanguage(null, de.join(' '), de)).toMatchObject({ code: null, english: false });
  });
});

describe('displayLength', () => {
  it('counts CJK and full-width characters twice', () => {
    expect(displayLength('abc')).toBe(3);
    expect(displayLength('家庭菜園')).toBe(8);
    expect(displayLength('ＡＢ')).toBe(4);
    expect(displayLength('Огород')).toBe(6);
  });
});

describe('the one check list', () => {
  it('has 18 checks whose points add up to 100, each outcome no more than its check', () => {
    expect(CHECKS).toHaveLength(18);
    expect(CHECKS.reduce((n, c) => n + c.points, 0)).toBe(100);
    for (const c of CHECKS) {
      for (const [label, pts] of Object.entries(c.outcomes)) {
        expect(pts, label).toBeLessThanOrEqual(c.points);
        expect(POINTS[label]).toBe(pts);
      }
    }
  });

  it('has fix text for every issue a check can raise, and nothing else', () => {
    expect(Object.keys(ISSUES).sort()).toEqual(Object.keys(POINTS).sort());
  });

  it('marks each check pass, warn, fail or na, and the score is 100 minus the points lost', () => {
    const r = evaluateChecks({
      url: 'https://example.com/',
      meta: { title: { text: 'x'.repeat(20), length: 20 }, description: { text: '', length: 0 }, canonical: null, openGraph: {}, schema: [] },
      content: { wordCount: 700, readability: null },
      headings: { h1: ['A'] },
      links: { internal: { count: 5 } },
      images: { total: 0 },
      technical: { domElements: 10 }
    });
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(by).toMatchObject({ title: 'warn', description: 'fail', canonical: 'fail', h1: 'pass', readability: 'na', imageAlt: 'na', viewport: 'na' });
    const lost = r.checks.reduce((n, c) => n + c.lost, 0);
    expect(r.score).toBe(100 - lost);
    expect(r.issues).toEqual(r.checks.filter((c) => c.issue).map((c) => c.issue));
  });

  it('reads noindex from the robots or googlebot meta, and none as noindex', () => {
    const page = (meta) => evaluateChecks({ meta: { title: { text: '' }, ...meta } }).issues;
    expect(page({ noindex: true, noindexSource: 'googlebot' })).toContain('Set to noindex');
    expect(page({ robots: 'none' })).toContain('Set to noindex');
    expect(page({ robots: 'index, follow' })).not.toContain('Set to noindex');
  });

  it('counts JSON-LD, Microdata and RDFa as structured data', () => {
    const has = (sd) => evaluateChecks({ meta: { structuredData: sd, schema: [] } }).issues.includes('No structured data');
    expect(has({ jsonLd: 0, microdata: 1, rdfa: 0 })).toBe(false);
    expect(has({ jsonLd: 0, microdata: 0, rdfa: 2 })).toBe(false);
    expect(has({ jsonLd: 0, microdata: 0, rdfa: 0 })).toBe(true);
  });

  it('groups the checks into the four sub-scores by points kept', () => {
    const groups = groupChecks(evaluateChecks({ url: 'http://example.com/' }).checks);
    expect(groups.find((g) => g.k === 'Tech')).toMatchObject({ of: 1, points: 5, kept: 0, v: 0 });
  });

  it('fixFor gives each issue its fix and points, from the page\'s own numbers', () => {
    expect(fixFor('Title too short', { meta: { title: { text: 'Short', length: 5 } } }))
      .toEqual({ title: 'Title too short', body: '5 characters. Aim for 30 to 60.', tool: 'gsc', points: 6 });
    expect(fixFor('Title too short', { meta: { title: { text: '家庭菜園', length: 4, displayLength: 8 } } }).body)
      .toBe('4 characters (8 counting each wide character as two). Aim for 30 to 60.');
    expect(fixFor('Duplicate tags', { meta: { title: { count: 2 }, description: { count: 1 }, canonicalCount: 2 } }).body)
      .toBe('2 title tags, 2 canonical tags. Keep one of each: Google picks one, and it may not be yours.');
    expect(fixFor('Some images missing alt', { images: { total: 6, missingAlt: { count: 1 }, decorative: 3 } }).body)
      .toBe('1 of 6 images have no alt attribute. 3 more have alt="" and count as decorative.');
    expect(fixFor('Something new', {})).toBeNull();
  });
});

describe('Core Web Vitals arithmetic', () => {
  it('LCP is the last entry before the page was first hidden, from activation', () => {
    const e = [{ startTime: 800 }, { startTime: 1900 }, { startTime: 5200 }];
    expect(lcpFrom(e, Infinity, 0)).toBe(5200);
    expect(lcpFrom(e, 3000, 0)).toBe(1900);
    expect(lcpFrom(e, Infinity, 500)).toBe(4700);
    expect(lcpFrom([], Infinity, 0)).toBeNull();
    expect(lcpFrom(e, 0, 0)).toBeNull();
  });

  it('CLS is the largest session window, not the sum of every shift', () => {
    // Two windows: 0.05 + 0.05 (shifts 400 ms apart), then 0.08 three seconds later.
    const shifts = [
      { startTime: 100, value: 0.05 }, { startTime: 500, value: 0.05 },
      { startTime: 3500, value: 0.08 }, { startTime: 3600, value: 0.5, hadRecentInput: true }
    ];
    expect(clsFrom(shifts)).toBe(0.1);
    // A window closes after 5 seconds even without a 1-second gap.
    const steady = Array.from({ length: 12 }, (_, i) => ({ startTime: i * 900, value: 0.01 }));
    expect(clsFrom(steady)).toBe(0.06);
    expect(clsFrom([])).toBe(0);
  });

  it('INP is the worst interaction, ignoring one in every 50, and null with none', () => {
    const events = [
      { interactionId: 1, duration: 40 }, { interactionId: 1, duration: 120 },
      { interactionId: 2, duration: 300 }, { interactionId: 0, duration: 900 }
    ];
    expect(inpFrom(events)).toEqual({ inp: 300, interactions: 2 });
    const many = Array.from({ length: 60 }, (_, i) => ({ interactionId: i + 1, duration: i === 0 ? 1000 : 50 + i }));
    expect(inpFrom(many)).toEqual({ inp: 109, interactions: 60 });
    expect(inpFrom([{ interactionId: 0, duration: 400 }])).toEqual({ inp: null, interactions: 0 });
  });

  it('firstHiddenFrom: a background tab that never painted was hidden from the start', () => {
    expect(firstHiddenFrom([{ name: 'hidden', startTime: 0 }], true, false)).toBe(0);
    expect(firstHiddenFrom([{ name: 'visible', startTime: 0 }, { name: 'hidden', startTime: 4000 }], true, true)).toBe(4000);
    expect(firstHiddenFrom([{ name: 'visible', startTime: 0 }], false, true)).toBe(Infinity);
    expect(firstHiddenFrom(null, true, false)).toBe(0);
    expect(firstHiddenFrom(null, false, true)).toBe(Infinity);
  });

  it('firstHiddenFrom: a prerendered page, hidden until activated, was not hidden', () => {
    const prerendered = [{ name: 'hidden', startTime: 0 }, { name: 'visible', startTime: 800 }];
    expect(firstHiddenFrom(prerendered, false, true, 800)).toBe(Infinity);
    expect(firstHiddenFrom([...prerendered, { name: 'hidden', startTime: 5000 }], true, true, 800)).toBe(5000);
    // Not prerendered (activationStart 0): hidden at 0 is a background load.
    expect(firstHiddenFrom([{ name: 'hidden', startTime: 0 }], true, true, 0)).toBe(0);
  });
});
