// Unit tests for the pure page-history summarizer (src/lib/domain-history.js).
// Covers: cacheKey shape, isFresh TTL logic, and summarize()'s line
// formatting including the overallScore -> seoScore.score fallback and the
// positive/negative/zero delta cases. 1.10.3: only the page's own captures
// count (the route falls back to the domain's other pages), and the pooled
// "Domain avg" line is gone.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/api.js, src/lib/sync-state.js) — the module
// attaches itself to `globalThis.SBWDomainHistory` rather than relying on an
// ESM default export, so tests read it off globalThis after importing.
await import('../../extension/src/lib/domain-history.js');
const SBWDomainHistory = globalThis.SBWDomainHistory;

const NOW = 1_700_000_000_000;
const PAGE = 'https://example.com/services/';

// A capture of PAGE (the route answers with each capture's own url).
const at = (fields) => Object.assign({ url: PAGE }, fields);

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

describe('samePage — the route\'s own URL variants are one page', () => {
  it('ignores the scheme, www. and a trailing slash', () => {
    expect(SBWDomainHistory.samePage('http://www.example.com/services', PAGE)).toBe(true);
    expect(SBWDomainHistory.samePage('https://example.com/services/', PAGE)).toBe(true);
    expect(SBWDomainHistory.samePage('https://EXAMPLE.com/services#top', PAGE)).toBe(true);
  });

  it('keeps the path and the query', () => {
    expect(SBWDomainHistory.samePage('https://example.com/', PAGE)).toBe(false);
    expect(SBWDomainHistory.samePage('https://example.com/services/plumbing', PAGE)).toBe(false);
    expect(SBWDomainHistory.samePage('https://example.com/services?page=2', PAGE)).toBe(false);
    expect(SBWDomainHistory.samePage('https://other.com/services', PAGE)).toBe(false);
  });

  it('matches nothing for a missing or unparseable URL', () => {
    expect(SBWDomainHistory.samePage(undefined, undefined)).toBe(false);
    expect(SBWDomainHistory.samePage('http://', PAGE)).toBe(false);
  });
});

describe('summarize — no earlier capture of this page', () => {
  it('returns hasHistory:false and a null line when there are no captures', () => {
    const captures = { url: PAGE, domain: 'example.com', totalCaptures: 0, captures: [] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 80 });
    expect(result).toEqual({ urlLine: null, delta: null, hasHistory: false });
  });

  it('treats a missing answer the same as none', () => {
    const result = SBWDomainHistory.summarize({ captures: null, pageUrl: PAGE, currentScore: 80 });
    expect(result).toEqual({ urlLine: null, delta: null, hasHistory: false });
  });

  it('never shows the domain\'s other pages as this page\'s history (the route\'s fallback)', () => {
    // GET /api/v1/captures?url= answers with the account's captures of other
    // pages on the domain when the page itself has none. Until 1.10.3 the
    // strip read these as "3 prior captures · last 91".
    const captures = {
      url: PAGE, domain: 'example.com', totalCaptures: 3,
      captures: [
        { url: 'https://example.com/', createdAt: '2026-08-01T00:00:00Z', overallScore: 91 },
        { url: 'https://example.com/about', createdAt: '2026-07-01T00:00:00Z', overallScore: 60 },
        { url: 'https://example.com/services/plumbing', createdAt: '2026-06-01T00:00:00Z', overallScore: 50 }
      ]
    };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 80 });
    expect(result).toEqual({ urlLine: null, delta: null, hasHistory: false });
  });

  it('has no domain line any more: the pooled domain average is not shown', () => {
    const result = SBWDomainHistory.summarize({
      quick: { domain: 'example.com', avgScore: 77, sampleSize: 31 },
      captures: { totalCaptures: 0, captures: [] },
      pageUrl: PAGE
    });
    expect(result).not.toHaveProperty('domainLine');
    expect(result.hasHistory).toBe(false);
  });
});

describe('summarize — this page captured before', () => {
  it('counts only this page\'s captures and labels the line as this page\'s', () => {
    const captures = {
      totalCaptures: 3,
      captures: [
        at({ id: 3, url: 'http://www.example.com/services', createdAt: '2026-08-01T00:00:00Z', overallScore: 74 }),
        { id: 2, url: 'https://example.com/', createdAt: '2026-09-01T00:00:00Z', overallScore: 99 },
        at({ id: 1, createdAt: '2026-06-01T00:00:00Z', overallScore: 50 })
      ]
    };

    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 77 });

    expect(result.urlLine).toBe('This page: 2 earlier captures · last 74 (+3)');
    expect(result.delta).toBe(3);
    expect(result.hasHistory).toBe(true);
  });

  it('shows a negative delta when the current score is worse than the last capture', () => {
    const captures = { totalCaptures: 1, captures: [at({ id: 1, createdAt: '2026-08-01T00:00:00Z', overallScore: 90 })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 82 });
    expect(result.urlLine).toBe('This page: 1 earlier capture · last 90 (-8)');
    expect(result.delta).toBe(-8);
  });

  it('shows a zero delta with an explicit sign when scores are unchanged', () => {
    const captures = {
      totalCaptures: 2,
      captures: [at({ id: 2, createdAt: '2026-08-01T00:00:00Z', overallScore: 74 }), at({ id: 1, createdAt: '2026-07-01T00:00:00Z', overallScore: 60 })]
    };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 74 });
    expect(result.urlLine).toBe('This page: 2 earlier captures · last 74 (+0)');
    expect(result.delta).toBe(0);
  });

  it('picks the newest earlier capture by createdAt, regardless of array order', () => {
    const captures = {
      totalCaptures: 2,
      captures: [
        at({ id: 1, createdAt: '2026-06-01T00:00:00Z', overallScore: 40 }),
        at({ id: 2, createdAt: '2026-08-01T00:00:00Z', overallScore: 65 })
      ]
    };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 65 });
    expect(result.urlLine).toBe('This page: 2 earlier captures · last 65 (+0)');
  });

  it('falls back to seoScore.score when overallScore is absent', () => {
    const captures = { totalCaptures: 1, captures: [at({ id: 1, createdAt: '2026-08-01T00:00:00Z', seoScore: { score: 55, grade: 'D' } })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 60 });
    expect(result.urlLine).toBe('This page: 1 earlier capture · last 55 (+5)');
    expect(result.delta).toBe(5);
  });

  it('prefers overallScore over seoScore.score when both are present', () => {
    const captures = { totalCaptures: 1, captures: [at({ id: 1, createdAt: '2026-08-01T00:00:00Z', overallScore: 88, seoScore: { score: 10 } })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 88 });
    expect(result.urlLine).toBe('This page: 1 earlier capture · last 88 (+0)');
  });

  it('omits the delta when no currentScore is available, but still reports the line', () => {
    const captures = { totalCaptures: 1, captures: [at({ id: 1, createdAt: '2026-08-01T00:00:00Z', overallScore: 88 })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: null });
    expect(result.urlLine).toBe('This page: 1 earlier capture · last 88');
    expect(result.delta).toBeNull();
  });

  it('omits the last-score/delta portion when neither score field is present', () => {
    const captures = { totalCaptures: 2, captures: [at({ id: 1, createdAt: '2026-08-01T00:00:00Z' }), at({ id: 2, createdAt: '2026-07-01T00:00:00Z' })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 80 });
    expect(result.urlLine).toBe('This page: 2 earlier captures');
    expect(result.delta).toBeNull();
  });
});

describe('summarize — excludeSince (race with the capture the popup just posted)', () => {
  it('ignores a capture created at/after excludeSince minus the 5s skew allowance', () => {
    // The popup's own autoSaveCapture()/syncCapture() landed a fraction of a
    // second before capturesForUrl() was read back — this capture is the one
    // the popup itself just posted for the current analysis, not real prior
    // history, even though it is technically "before" excludeSince.
    const captures = { totalCaptures: 1, captures: [at({ id: 'just-posted', createdAt: new Date(NOW - 1000).toISOString(), overallScore: 80 })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 80, excludeSince: NOW });
    expect(result.urlLine).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.hasHistory).toBe(false);
  });

  it('still counts a genuinely older capture (well outside the skew window)', () => {
    const captures = { totalCaptures: 1, captures: [at({ id: 'old', createdAt: new Date(NOW - 10_000).toISOString(), overallScore: 70 })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 80, excludeSince: NOW });
    expect(result.urlLine).toBe('This page: 1 earlier capture · last 70 (+10)');
    expect(result.delta).toBe(10);
    expect(result.hasHistory).toBe(true);
  });

  it('reduces the count and re-derives "last" from the remaining older captures', () => {
    const captures = {
      totalCaptures: 2,
      captures: [
        at({ id: 'just-posted', createdAt: new Date(NOW - 500).toISOString(), overallScore: 80 }),
        at({ id: 'old', createdAt: new Date(NOW - 20_000).toISOString(), overallScore: 65 })
      ]
    };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 80, excludeSince: NOW });
    expect(result.urlLine).toBe('This page: 1 earlier capture · last 65 (+15)');
    expect(result.delta).toBe(15);
  });

  it('does not filter anything when excludeSince is omitted (back-compat)', () => {
    const captures = { totalCaptures: 1, captures: [at({ id: 'x', createdAt: new Date(NOW).toISOString(), overallScore: 80 })] };
    const result = SBWDomainHistory.summarize({ captures, pageUrl: PAGE, currentScore: 80 });
    expect(result.urlLine).toBe('This page: 1 earlier capture · last 80 (+0)');
  });
});
