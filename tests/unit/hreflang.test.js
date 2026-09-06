// Unit tests for the pure hreflang validation logic (src/lib/hreflang.js).
// No chrome/fetch dependency here — the worker (service-worker.js) owns the
// actual alternate-page fetches; this module only parses tags, validates a
// declared hreflang set, extracts <link> tags from raw HTML, and interprets
// a batch of fetched alternates for reciprocity.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWHreflang` rather than an ESM default export.
await import('../../src/lib/hreflang.js');
const SBWHreflang = globalThis.SBWHreflang;

describe('SBWHreflang namespace', () => {
  it('attaches to globalThis.SBWHreflang', () => {
    expect(SBWHreflang).toBeTruthy();
    ['parseLangTag', 'normalizeUrl', 'validateSet', 'extractHreflangFromHtml', 'reciprocity']
      .forEach(fn => expect(typeof SBWHreflang[fn]).toBe('function'));
  });
});

describe('parseLangTag — tag grammar table', () => {
  it('accepts a bare two-letter language', () => {
    const r = SBWHreflang.parseLangTag('en');
    expect(r.valid).toBe(true);
    expect(r.language).toBe('en');
    expect(r.script).toBeUndefined();
    expect(r.region).toBeUndefined();
    expect(r.xDefault).toBe(false);
  });

  it('accepts language-REGION', () => {
    const r = SBWHreflang.parseLangTag('en-US');
    expect(r.valid).toBe(true);
    expect(r.language).toBe('en');
    expect(r.region).toBe('US');
  });

  it('accepts language-Script-REGION (zh-Hant-TW)', () => {
    const r = SBWHreflang.parseLangTag('zh-Hant-TW');
    expect(r.valid).toBe(true);
    expect(r.language).toBe('zh');
    expect(r.script).toBe('Hant');
    expect(r.region).toBe('TW');
  });

  it('accepts the x-default sentinel', () => {
    const r = SBWHreflang.parseLangTag('x-default');
    expect(r.valid).toBe(true);
    expect(r.xDefault).toBe(true);
  });

  it('accepts a numeric UN M49 region (es-419)', () => {
    const r = SBWHreflang.parseLangTag('es-419');
    expect(r.valid).toBe(true);
    expect(r.language).toBe('es');
    expect(r.region).toBe('419');
  });

  it('flags wrong casing as a soft "casing" issue, not a hard invalid', () => {
    const r = SBWHreflang.parseLangTag('EN-us');
    expect(r.valid).toBe(false);
    expect(r.casing).toBe(true);
    // still recovers the intended language/region so the UI can suggest a fix
    expect(r.language).toBe('en');
    expect(r.region).toBe('US');
  });

  it('rejects an underscore separator outright (no casing rescue)', () => {
    const r = SBWHreflang.parseLangTag('en_US');
    expect(r.valid).toBe(false);
    expect(r.casing).toBeFalsy();
  });

  it('rejects empty/garbage input', () => {
    expect(SBWHreflang.parseLangTag('').valid).toBe(false);
    expect(SBWHreflang.parseLangTag(null).valid).toBe(false);
    expect(SBWHreflang.parseLangTag('!!!').valid).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('resolves a relative href against the page URL and strips the fragment', () => {
    expect(SBWHreflang.normalizeUrl('/fr/page#section', 'https://example.com/en/page'))
      .toBe('https://example.com/fr/page');
  });

  it('passes through an absolute URL, stripping only its fragment', () => {
    expect(SBWHreflang.normalizeUrl('https://example.com/de/page#x', 'https://example.com/en/page'))
      .toBe('https://example.com/de/page');
  });

  it('returns null for an unparsable href', () => {
    expect(SBWHreflang.normalizeUrl('not a url', undefined)).toBeNull();
    expect(SBWHreflang.normalizeUrl(null, 'https://example.com/')).toBeNull();
  });
});

describe('validateSet', () => {
  const pageUrl = 'https://example.com/en/page';

  it('flags a fully correct set (self-ref + x-default) with no set-level issues', () => {
    const entries = [
      { lang: 'en', href: 'https://example.com/en/page' },
      { lang: 'fr', href: 'https://example.com/fr/page' },
      { lang: 'x-default', href: 'https://example.com/en/page' }
    ];
    const result = SBWHreflang.validateSet(entries, pageUrl);
    expect(result.issues).toEqual([]);
    expect(result.entries).toHaveLength(3);
    result.entries.forEach(e => expect(e.valid).toBe(true));
  });

  it('flags missing x-default and missing self-reference', () => {
    const entries = [
      { lang: 'en', href: 'https://example.com/en/other-page' },
      { lang: 'fr', href: 'https://example.com/fr/page' }
    ];
    const result = SBWHreflang.validateSet(entries, pageUrl);
    expect(result.issues).toContain('Missing x-default hreflang');
    expect(result.issues).toContain('Missing self-referencing hreflang');
  });

  it('flags a duplicate language tag', () => {
    const entries = [
      { lang: 'en', href: 'https://example.com/en/page' },
      { lang: 'en', href: 'https://example.com/en/page-2' }
    ];
    const result = SBWHreflang.validateSet(entries, pageUrl);
    expect(result.issues.some(i => /duplicate/i.test(i) && /en/.test(i))).toBe(true);
  });

  it('flags the same URL declared under multiple tags (info)', () => {
    const entries = [
      { lang: 'en', href: 'https://example.com/shared' },
      { lang: 'fr', href: 'https://example.com/shared' }
    ];
    const result = SBWHreflang.validateSet(entries, pageUrl);
    expect(result.issues.some(i => /same url/i.test(i))).toBe(true);
  });

  it('warns on a relative href and on a protocol that differs from the page', () => {
    const entries = [
      { lang: 'en', href: '/en/relative' },
      { lang: 'fr', href: 'http://example.com/fr/page' } // page is https
    ];
    const result = SBWHreflang.validateSet(entries, pageUrl);
    expect(result.issues.some(i => /relative/i.test(i))).toBe(true);
    expect(result.issues.some(i => /protocol/i.test(i))).toBe(true);
  });

  it('marks an invalid tag both per-entry and at the set level', () => {
    const entries = [
      { lang: 'not_a_tag', href: 'https://example.com/x' }
    ];
    const result = SBWHreflang.validateSet(entries, pageUrl);
    expect(result.entries[0].valid).toBe(false);
    expect(result.entries[0].issues.length).toBeGreaterThan(0);
    expect(result.issues.some(i => /invalid/i.test(i))).toBe(true);
  });
});

describe('extractHreflangFromHtml', () => {
  const baseUrl = 'https://example.com/en/page';

  it('extracts alternate/hreflang links from the head regardless of attribute order/quoting', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="en" href="https://example.com/en/page">
      <link href='https://example.com/fr/page' hreflang='fr' rel='alternate'>
      <link hreflang=de rel=alternate href=https://example.com/de/page>
    </head><body></body></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.lang).sort()).toEqual(['de', 'en', 'fr']);
    entries.forEach(e => expect(e.href).toMatch(/^https:\/\/example\.com\//));
  });

  it('ignores a hreflang link placed in the body', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="en" href="https://example.com/en/page">
    </head><body>
      <link rel="alternate" hreflang="es" href="https://example.com/es/page">
    </body></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries).toHaveLength(1);
    expect(entries[0].lang).toBe('en');
  });

  it('ignores non-alternate or hreflang-less link tags', () => {
    const html = `<html><head>
      <link rel="canonical" href="https://example.com/en/page">
      <link rel="alternate" href="https://example.com/feed.xml" type="application/rss+xml">
      <link rel="alternate" hreflang="en" href="https://example.com/en/page">
    </head></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries).toHaveLength(1);
    expect(entries[0].lang).toBe('en');
  });

  it('returns an empty array when there is no head or no hreflang tags', () => {
    expect(SBWHreflang.extractHreflangFromHtml('<html><body>hi</body></html>', baseUrl)).toEqual([]);
    expect(SBWHreflang.extractHreflangFromHtml('', baseUrl)).toEqual([]);
    expect(SBWHreflang.extractHreflangFromHtml(null, baseUrl)).toEqual([]);
  });
});

describe('reciprocity', () => {
  const pageUrl = 'https://example.com/en/page';
  const pageEntries = [
    { lang: 'fr', url: 'https://example.com/fr/page' },
    { lang: 'es', url: 'https://example.com/es/page' },
    { lang: 'de', url: 'https://example.com/de/page' }
  ];

  it('reports yes/no/unreachable across a reciprocal alternate, one missing the return tag, and one 404', () => {
    const fetched = new Map([
      ['https://example.com/fr/page', {
        status: 200,
        entries: [
          { lang: 'fr', href: 'https://example.com/fr/page' },
          { lang: 'en', href: 'https://example.com/en/page' } // links back to the page
        ],
        linkHeaderEntries: []
      }],
      ['https://example.com/es/page', {
        status: 200,
        entries: [{ lang: 'es', href: 'https://example.com/es/page' }], // no back-link
        linkHeaderEntries: []
      }],
      ['https://example.com/de/page', { status: 404, entries: [], linkHeaderEntries: [] }]
    ]);

    const result = SBWHreflang.reciprocity(pageUrl, pageEntries, fetched);
    const byLang = Object.fromEntries(result.entries.map(e => [e.lang, e]));

    expect(byLang.fr.returnTag).toBe('yes');
    expect(byLang.fr.selfRefOnAlternate).toBe(true);
    expect(byLang.es.returnTag).toBe('no');
    expect(byLang.de.returnTag).toBe('unreachable');

    expect(result.summary).toEqual({ checked: 3, ok: 1, missing: 1, unreachable: 1 });
  });

  it('treats a Link-header alternate entry as satisfying the return tag too', () => {
    const fetched = new Map([
      ['https://example.com/fr/page', {
        status: 200,
        entries: [],
        linkHeaderEntries: [{ url: 'https://example.com/en/page', rel: 'alternate', hreflang: 'en' }]
      }]
    ]);
    const result = SBWHreflang.reciprocity(pageUrl, [pageEntries[0]], fetched);
    expect(result.entries[0].returnTag).toBe('yes');
  });

  it('treats a URL never fetched (skipped by the cap) as unreachable', () => {
    const fetched = new Map();
    const result = SBWHreflang.reciprocity(pageUrl, [pageEntries[0]], fetched);
    expect(result.entries[0].returnTag).toBe('unreachable');
    expect(result.entries[0].status).toBeNull();
  });
});
