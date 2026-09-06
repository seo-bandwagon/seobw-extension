// Unit tests for the pure "domain history" summarizer (src/lib/domain-history.js).
// Covers: cacheKey shape, isFresh TTL logic, and summarize()'s domain/url line
// formatting including the overallScore -> seoScore.score fallback and the
// positive/negative/zero delta cases.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/api.js, src/lib/sync-state.js) — the module
// attaches itself to `globalThis.SBWDomainHistory` rather than relying on an
// ESM default export, so tests read it off globalThis after importing.
await import('../../extension/src/lib/domain-history.js');
const SBWDomainHistory = globalThis.SBWDomainHistory;

const NOW = 1_700_000_000_000;

describe('SBWDomainHistory namespace', () => {
  it('attaches to globalThis.SBWDomainHistory', () => {
    expect(SBWDomainHistory).toBeTruthy();
    expect(typeof SBWDomainHistory.summarize).toBe('function');
  });

  it('exposes CACHE_TTL_MS = 10 minutes', () => {
    expect(SBWDomainHistory.CACHE_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe('cacheKey', () => {
  it('builds a quick-domain key', () => {
    expect(SBWDomainHistory.cacheKey('quick', 'example.com')).toBe('dh:quick:example.com');
  });

  it('builds a url key', () => {
    expect(SBWDomainHistory.cacheKey('url', 'https://example.com/a')).toBe('dh:url:https://example.com/a');
  });
});

describe('isFresh', () => {
  it('is false when there is no entry', () => {
    expect(SBWDomainHistory.isFresh(null, NOW)).toBe(false);
    expect(SBWDomainHistory.isFresh(undefined, NOW)).toBe(false);
  });

  it('is true when within CACHE_TTL_MS of now', () => {
    const entry = { at: NOW - 1000, value: { ok: true } };
    expect(SBWDomainHistory.isFresh(entry, NOW)).toBe(true);
  });

  it('is false once CACHE_TTL_MS has elapsed', () => {
    const entry = { at: NOW - SBWDomainHistory.CACHE_TTL_MS, value: { ok: true } };
    expect(SBWDomainHistory.isFresh(entry, NOW)).toBe(false);
  });

  it('is false well past the ttl', () => {
    const entry = { at: NOW - SBWDomainHistory.CACHE_TTL_MS - 1, value: { ok: true } };
    expect(SBWDomainHistory.isFresh(entry, NOW)).toBe(false);
  });
});

describe('summarize — unseen domain', () => {
  it('returns hasHistory:false and null lines when sampleSize is 0 and no captures', () => {
    const quick = { domain: 'never-seen.com', avgWordCount: null, schemaPercentage: null, avgScore: null, age: null, sampleSize: 0 };
    const captures = { url: 'https://never-seen.com/', domain: 'never-seen.com', totalCaptures: 0, captures: [] };

    const result = SBWDomainHistory.summarize({ quick, captures, currentScore: 80 });

    expect(result).toEqual({ domainLine: null, urlLine: null, delta: null, hasHistory: false });
  });

  it('treats missing quick/captures the same as unseen', () => {
    const result = SBWDomainHistory.summarize({ quick: null, captures: null, currentScore: 80 });
    expect(result).toEqual({ domainLine: null, urlLine: null, delta: null, hasHistory: false });
  });
});

describe('summarize — domain seen, url never captured', () => {
  it('produces a domainLine and no urlLine', () => {
    const quick = { domain: 'example.com', avgWordCount: 900, schemaPercentage: 62, avgScore: 77, age: '2 years', sampleSize: 31 };
    const captures = { url: 'https://example.com/new-page', domain: 'example.com', totalCaptures: 0, captures: [] };

    const result = SBWDomainHistory.summarize({ quick, captures, currentScore: 80 });

    expect(result.domainLine).toBe('Domain avg 77 · 31 captures');
    expect(result.urlLine).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.hasHistory).toBe(true);
  });

  it('singularizes "capture" when sampleSize is 1', () => {
    const quick = { domain: 'example.com', avgScore: 50, sampleSize: 1 };
    const captures = { url: 'https://example.com/', totalCaptures: 0, captures: [] };

    const result = SBWDomainHistory.summarize({ quick, captures, currentScore: 50 });

    expect(result.domainLine).toBe('Domain avg 50 · 1 capture');
  });

  it('rounds a fractional avgScore', () => {
    const quick = { domain: 'example.com', avgScore: 76.6, sampleSize: 4 };
    const captures = { totalCaptures: 0, captures: [] };

    const result = SBWDomainHistory.summarize({ quick, captures, currentScore: 80 });

    expect(result.domainLine).toBe('Domain avg 77 · 4 captures');
  });
});

describe('summarize — url with prior captures', () => {
  it('shows a positive delta when the current score beats the last capture', () => {
    const quick = { domain: 'example.com', avgScore: 70, sampleSize: 10 };
    const captures = {
      totalCaptures: 3,
      captures: [
        { id: 3, createdAt: '2026-08-01T00:00:00Z', overallScore: 74 },
        { id: 2, createdAt: '2026-07-01T00:00:00Z', overallScore: 60 },
        { id: 1, createdAt: '2026-06-01T00:00:00Z', overallScore: 50 }
      ]
    };

    const result = SBWDomainHistory.summarize({ quick, captures, currentScore: 77 });

    expect(result.urlLine).toBe('3 prior captures · last 74 (+3)');
    expect(result.delta).toBe(3);
    expect(result.hasHistory).toBe(true);
  });

  it('shows a negative delta when the current score is worse than the last capture', () => {
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 1, createdAt: '2026-08-01T00:00:00Z', overallScore: 90 }]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: 82 });

    expect(result.urlLine).toBe('1 prior capture · last 90 (-8)');
    expect(result.delta).toBe(-8);
  });

  it('shows a zero delta with an explicit sign when scores are unchanged', () => {
    const captures = {
      totalCaptures: 2,
      captures: [{ id: 2, createdAt: '2026-08-01T00:00:00Z', overallScore: 74 }]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: 74 });

    expect(result.urlLine).toBe('2 prior captures · last 74 (+0)');
    expect(result.delta).toBe(0);
  });

  it('picks the newest prior capture by createdAt, regardless of array order', () => {
    const captures = {
      totalCaptures: 2,
      captures: [
        { id: 1, createdAt: '2026-06-01T00:00:00Z', overallScore: 40 },
        { id: 2, createdAt: '2026-08-01T00:00:00Z', overallScore: 65 }
      ]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: 65 });

    expect(result.urlLine).toBe('2 prior captures · last 65 (+0)');
  });

  it('falls back to seoScore.score when overallScore is absent', () => {
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 1, createdAt: '2026-08-01T00:00:00Z', seoScore: { score: 55, grade: 'D' } }]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: 60 });

    expect(result.urlLine).toBe('1 prior capture · last 55 (+5)');
    expect(result.delta).toBe(5);
  });

  it('prefers overallScore over seoScore.score when both are present', () => {
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 1, createdAt: '2026-08-01T00:00:00Z', overallScore: 88, seoScore: { score: 10 } }]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: 88 });

    expect(result.urlLine).toBe('1 prior capture · last 88 (+0)');
  });

  it('omits the delta when no currentScore is available, but still reports the line', () => {
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 1, createdAt: '2026-08-01T00:00:00Z', overallScore: 88 }]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: null });

    expect(result.urlLine).toBe('1 prior capture · last 88');
    expect(result.delta).toBeNull();
  });

  it('omits the last-score/delta portion when neither score field is present', () => {
    const captures = {
      totalCaptures: 2,
      captures: [{ id: 1, createdAt: '2026-08-01T00:00:00Z' }]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: 80 });

    expect(result.urlLine).toBe('2 prior captures');
    expect(result.delta).toBeNull();
  });
});

describe('summarize — excludeSince (race with the capture the popup just posted)', () => {
  const NOW = 1_700_000_000_000;

  it('ignores a capture created at/after excludeSince minus the 5s skew allowance', () => {
    // The popup's own autoSaveCapture()/syncCapture() landed a fraction of a
    // second before capturesForUrl() was read back — this capture is the one
    // the popup itself just posted for the current analysis, not real prior
    // history, even though it is technically "before" excludeSince.
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 'just-posted', createdAt: new Date(NOW - 1000).toISOString(), overallScore: 80 }]
    };

    const result = SBWDomainHistory.summarize({
      quick: null, captures, currentScore: 80, excludeSince: NOW
    });

    expect(result.urlLine).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.hasHistory).toBe(false);
  });

  it('still counts a genuinely older capture (well outside the skew window)', () => {
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 'old', createdAt: new Date(NOW - 10_000).toISOString(), overallScore: 70 }]
    };

    const result = SBWDomainHistory.summarize({
      quick: null, captures, currentScore: 80, excludeSince: NOW
    });

    expect(result.urlLine).toBe('1 prior capture · last 70 (+10)');
    expect(result.delta).toBe(10);
    expect(result.hasHistory).toBe(true);
  });

  it('reduces totalCaptures and re-derives "last" from the remaining older captures', () => {
    const captures = {
      totalCaptures: 2,
      captures: [
        { id: 'just-posted', createdAt: new Date(NOW - 500).toISOString(), overallScore: 80 },
        { id: 'old', createdAt: new Date(NOW - 20_000).toISOString(), overallScore: 65 }
      ]
    };

    const result = SBWDomainHistory.summarize({
      quick: null, captures, currentScore: 80, excludeSince: NOW
    });

    expect(result.urlLine).toBe('1 prior capture · last 65 (+15)');
    expect(result.delta).toBe(15);
  });

  it('keeps the domainLine even when excludeSince empties the url history', () => {
    const quick = { domain: 'example.com', avgScore: 70, sampleSize: 12 };
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 'just-posted', createdAt: new Date(NOW).toISOString(), overallScore: 80 }]
    };

    const result = SBWDomainHistory.summarize({
      quick, captures, currentScore: 80, excludeSince: NOW
    });

    expect(result.domainLine).toBe('Domain avg 70 · 12 captures');
    expect(result.urlLine).toBeNull();
    expect(result.hasHistory).toBe(true);
  });

  it('does not filter anything when excludeSince is omitted (back-compat)', () => {
    const captures = {
      totalCaptures: 1,
      captures: [{ id: 'x', createdAt: new Date(NOW).toISOString(), overallScore: 80 }]
    };

    const result = SBWDomainHistory.summarize({ quick: null, captures, currentScore: 80 });

    expect(result.urlLine).toBe('1 prior capture · last 80 (+0)');
  });
});

describe('summarize — both domain and url history present', () => {
  it('returns both lines together', () => {
    const quick = { domain: 'example.com', avgScore: 70, sampleSize: 12 };
    const captures = {
      totalCaptures: 2,
      captures: [{ id: 1, createdAt: '2026-08-01T00:00:00Z', overallScore: 68 }]
    };

    const result = SBWDomainHistory.summarize({ quick, captures, currentScore: 75 });

    expect(result.domainLine).toBe('Domain avg 70 · 12 captures');
    expect(result.urlLine).toBe('2 prior captures · last 68 (+7)');
    expect(result.hasHistory).toBe(true);
  });
});
