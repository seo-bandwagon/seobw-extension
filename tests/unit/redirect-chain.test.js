// Unit tests for the pure redirect-chain / HTTP-header / indexability logic
// (src/lib/redirect-chain.js). No chrome/webRequest dependency — the worker
// (service-worker.js) owns capturing the raw events; this module only
// shapes and interprets them.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWRedirects` rather than an ESM default export.
await import('../../src/lib/redirect-chain.js');
const SBWRedirects = globalThis.SBWRedirects;

describe('SBWRedirects namespace', () => {
  it('attaches to globalThis.SBWRedirects', () => {
    expect(SBWRedirects).toBeTruthy();
    ['pickHeaders', 'parseXRobotsTag', 'parseLinkHeader', 'chainSummary', 'indexability']
      .forEach(fn => expect(typeof SBWRedirects[fn]).toBe('function'));
  });
});

describe('pickHeaders', () => {
  it('plucks the tracked headers case-insensitively', () => {
    const headers = [
      { name: 'X-Robots-Tag', value: 'noindex' },
      { name: 'Cache-Control', value: 'no-store' },
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'LOCATION', value: 'https://example.com/next' },
      { name: 'Server', value: 'nginx' } // untracked, must not appear
    ];
    const out = SBWRedirects.pickHeaders(headers);
    expect(out['x-robots-tag']).toBe('noindex');
    expect(out['cache-control']).toBe('no-store');
    expect(out['content-type']).toBe('text/html; charset=utf-8');
    expect(out['location']).toBe('https://example.com/next');
    expect(out.server).toBeUndefined();
  });

  it('joins repeated headers with ", "', () => {
    const headers = [
      { name: 'Link', value: '<https://example.com/en>; rel="alternate"; hreflang="en"' },
      { name: 'link', value: '<https://example.com/de>; rel="alternate"; hreflang="de"' }
    ];
    const out = SBWRedirects.pickHeaders(headers);
    expect(out.link).toBe(
      '<https://example.com/en>; rel="alternate"; hreflang="en", <https://example.com/de>; rel="alternate"; hreflang="de"'
    );
  });

  it('reports content-security-policy and strict-transport-security as present/absent booleans', () => {
    const present = SBWRedirects.pickHeaders([
      { name: 'Content-Security-Policy', value: "default-src 'self'" },
      { name: 'Strict-Transport-Security', value: 'max-age=63072000' }
    ]);
    expect(present['content-security-policy']).toBe(true);
    expect(present['strict-transport-security']).toBe(true);

    const absent = SBWRedirects.pickHeaders([{ name: 'Content-Type', value: 'text/html' }]);
    expect(absent['content-security-policy']).toBe(false);
    expect(absent['strict-transport-security']).toBe(false);
  });

  it('handles an empty/missing header list', () => {
    expect(SBWRedirects.pickHeaders([])).toEqual({
      'content-security-policy': false,
      'strict-transport-security': false
    });
    expect(SBWRedirects.pickHeaders(undefined)).toEqual({
      'content-security-policy': false,
      'strict-transport-security': false
    });
  });
});

describe('parseXRobotsTag', () => {
  it('parses a plain noindex directive', () => {
    const out = SBWRedirects.parseXRobotsTag('noindex');
    expect(out.directives).toEqual(['noindex']);
    expect(out.noindex).toBe(true);
    expect(out.nofollow).toBe(false);
    expect(out.agents).toEqual([]);
  });

  it('parses comma-separated directives', () => {
    const out = SBWRedirects.parseXRobotsTag('noindex, nofollow');
    expect(out.noindex).toBe(true);
    expect(out.nofollow).toBe(true);
    expect(out.directives.sort()).toEqual(['nofollow', 'noindex']);
  });

  it('parses space-separated directives in one segment', () => {
    const out = SBWRedirects.parseXRobotsTag('noarchive nosnippet');
    expect(out.directives.sort()).toEqual(['noarchive', 'nosnippet']);
  });

  it('handles a UA-prefixed directive ("googlebot: noindex")', () => {
    const out = SBWRedirects.parseXRobotsTag('googlebot: noindex');
    expect(out.noindex).toBe(true);
    expect(out.agents).toEqual(['googlebot']);
  });

  it('handles a mix of UA-prefixed and bare directives', () => {
    const out = SBWRedirects.parseXRobotsTag('noindex, googlebot: nofollow');
    expect(out.noindex).toBe(true);
    expect(out.nofollow).toBe(true);
    expect(out.agents).toEqual(['googlebot']);
  });

  it('returns an empty-but-shaped result for no value', () => {
    expect(SBWRedirects.parseXRobotsTag('')).toEqual({ directives: [], noindex: false, nofollow: false, agents: [] });
    expect(SBWRedirects.parseXRobotsTag(undefined)).toEqual({ directives: [], noindex: false, nofollow: false, agents: [] });
  });
});

describe('parseLinkHeader', () => {
  it('parses a single canonical link', () => {
    const out = SBWRedirects.parseLinkHeader('<https://example.com/page>; rel="canonical"');
    expect(out).toEqual([{ url: 'https://example.com/page', rel: 'canonical' }]);
  });

  it('parses two hreflang alternates from one header value', () => {
    const value = '<https://example.com/en>; rel="alternate"; hreflang="en", <https://example.com/de>; rel="alternate"; hreflang="de"';
    const out = SBWRedirects.parseLinkHeader(value);
    expect(out).toEqual([
      { url: 'https://example.com/en', rel: 'alternate', hreflang: 'en' },
      { url: 'https://example.com/de', rel: 'alternate', hreflang: 'de' }
    ]);
  });

  it('parses two canonicals in one header (duplicate-canonical case)', () => {
    const value = '<https://example.com/a>; rel="canonical", <https://example.com/b>; rel="canonical"';
    const out = SBWRedirects.parseLinkHeader(value);
    expect(out.length).toBe(2);
    expect(out.every(l => l.rel === 'canonical')).toBe(true);
  });

  it('returns [] for no value', () => {
    expect(SBWRedirects.parseLinkHeader('')).toEqual([]);
    expect(SBWRedirects.parseLinkHeader(undefined)).toEqual([]);
  });
});

describe('chainSummary', () => {
  it('summarizes a multi-hop chain ending in a 200', () => {
    const events = [
      { kind: 'redirect', url: 'https://a.example/', statusCode: 301, location: 'https://b.example/', headers: {} },
      { kind: 'redirect', url: 'https://b.example/', statusCode: 302, location: 'https://c.example/', headers: {} },
      { kind: 'response', url: 'https://c.example/', statusCode: 200, headers: {} }
    ];
    const out = SBWRedirects.chainSummary(events);
    expect(out.hops).toEqual([
      { from: 'https://a.example/', to: 'https://b.example/', status: 301 },
      { from: 'https://b.example/', to: 'https://c.example/', status: 302 }
    ]);
    expect(out.finalUrl).toBe('https://c.example/');
    expect(out.finalStatus).toBe(200);
    expect(out.hopCount).toBe(2);
    expect(out.hasClientRedirect).toBe(false);
    expect(out.loops).toBe(false);
  });

  it('flags a client-side redirect', () => {
    const events = [
      { kind: 'response', url: 'https://a.example/', statusCode: 200, headers: {} },
      { kind: 'client_redirect', url: 'https://a.example/next' }
    ];
    const out = SBWRedirects.chainSummary(events);
    expect(out.hasClientRedirect).toBe(true);
  });

  it('detects a loop when a URL repeats', () => {
    const events = [
      { kind: 'redirect', url: 'https://a.example/', statusCode: 301, location: 'https://b.example/', headers: {} },
      { kind: 'redirect', url: 'https://b.example/', statusCode: 301, location: 'https://a.example/', headers: {} },
      { kind: 'redirect', url: 'https://a.example/', statusCode: 301, location: 'https://b.example/', headers: {} }
    ];
    const out = SBWRedirects.chainSummary(events);
    expect(out.loops).toBe(true);
  });

  it('handles an empty event list', () => {
    const out = SBWRedirects.chainSummary([]);
    expect(out).toEqual({ hops: [], finalUrl: null, finalStatus: null, hopCount: 0, hasClientRedirect: false, loops: false });
  });
});

describe('indexability', () => {
  it('is indexable with no negative signals', () => {
    const out = SBWRedirects.indexability({
      metaRobots: 'index, follow',
      xRobotsTag: null,
      finalStatus: 200,
      canonicalDom: 'https://example.com/page',
      canonicalHeader: null,
      pageUrl: 'https://example.com/page'
    });
    expect(out.indexable).toBe(true);
    expect(out.reasons).toEqual([]);
    expect(out.canonicalMatches).toBe(true);
  });

  it('is not indexable on meta robots noindex', () => {
    const out = SBWRedirects.indexability({ metaRobots: 'noindex', finalStatus: 200, pageUrl: 'https://example.com/' });
    expect(out.indexable).toBe(false);
    expect(out.reasons.join(' ')).toMatch(/noindex/);
  });

  it('is not indexable on X-Robots-Tag noindex', () => {
    const out = SBWRedirects.indexability({ metaRobots: '', xRobotsTag: 'googlebot: noindex', finalStatus: 200, pageUrl: 'https://example.com/' });
    expect(out.indexable).toBe(false);
    expect(out.signals.headerNoindex).toBe(true);
  });

  it('is not indexable on a 4xx/5xx final status', () => {
    const out = SBWRedirects.indexability({ finalStatus: 404, pageUrl: 'https://example.com/' });
    expect(out.indexable).toBe(false);
    expect(out.reasons.join(' ')).toMatch(/404/);
  });

  it('flags a canonical that points to another URL, ignoring protocol/www/trailing slash', () => {
    const same = SBWRedirects.indexability({
      finalStatus: 200,
      canonicalDom: 'http://www.example.com/page/',
      pageUrl: 'https://example.com/page'
    });
    expect(same.canonicalMatches).toBe(true);
    expect(same.indexable).toBe(true);

    const different = SBWRedirects.indexability({
      finalStatus: 200,
      canonicalDom: 'https://example.com/other-page',
      pageUrl: 'https://example.com/page'
    });
    expect(different.canonicalMatches).toBe(false);
    expect(different.indexable).toBe(false);
    expect(different.reasons.join(' ')).toMatch(/canonical/);
  });

  it('null canonicalMatches when no canonical is known', () => {
    const out = SBWRedirects.indexability({ finalStatus: 200, pageUrl: 'https://example.com/' });
    expect(out.canonicalMatches).toBeNull();
  });
});
