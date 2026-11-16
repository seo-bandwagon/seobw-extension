// Unit tests for the pure hreflang validation logic (src/lib/hreflang.js).
// No chrome/fetch dependency here — the worker (service-worker.js) owns the
// actual alternate-page fetches; this module only parses tags, validates a
// declared hreflang set, extracts <link> tags from raw HTML, and interprets
// a batch of fetched alternates for reciprocity.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWHreflang` rather than an ESM default export.
await import('../../extension/src/lib/hreflang.js');
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

  // 1.13.8: Google reads ISO 3166-1 alpha-2 regions only ("codes ... such
  // as es-419, aren't supported").
  it('a UN M49 region (es-419) is not a region Google reads', () => {
    const r = SBWHreflang.parseLangTag('es-419');
    expect(r.valid).toBe(false);
    expect(r.language).toBe('es');
    expect(r.region).toBe('419');
    expect(r.reason).toMatch(/UN M49.*ISO 3166-1/);
  });

  // 1.13.8: "The hreflang value is case-insensitive" (Google). Casing is
  // information, not an error: valid, with the usual form to show.
  it('a tag in unusual casing is valid, with its usual form as a note', () => {
    const r = SBWHreflang.parseLangTag('EN-us');
    expect(r.valid).toBe(true);
    expect(r.casing).toBe(true);
    expect(r.suggestion).toBe('en-US');
    expect(r.language).toBe('en');
    expect(r.region).toBe('US');
    expect(SBWHreflang.parseLangTag('en-gb')).toMatchObject({ valid: true, casing: true, suggestion: 'en-GB' });
    expect(SBWHreflang.parseLangTag('zh-hant-tw')).toMatchObject({ valid: true, suggestion: 'zh-Hant-TW' });
    expect(SBWHreflang.parseLangTag('X-Default')).toMatchObject({ valid: true, xDefault: true, casing: true });
    expect(SBWHreflang.parseLangTag('en-GB').casing).toBeUndefined();
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

  // 1.13.8: "Only language codes listed in ISO 639-1 ... are supported."
  it('a three-letter language code is not one Google reads', () => {
    const r = SBWHreflang.parseLangTag('fil'); // Filipino, ISO 639-2
    expect(r.valid).toBe(false);
    expect(r.language).toBe('fil');
    expect(r.reason).toMatch(/two-letter ISO 639-1/);
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

  it('gives distinct set-level chip text for a casing defect vs a structurally invalid tag', () => {
    const casingResult = SBWHreflang.validateSet(
      [{ lang: 'EN-us', href: 'https://example.com/en' }], pageUrl
    );
    // 1.13.8: casing is a note, not an issue.
    expect(casingResult.issues.some(i => /EN-us/.test(i))).toBe(false);
    expect(casingResult.notes).toEqual(['Written "EN-us": Google reads it in any case; usually written en-US']);
    expect(casingResult.entries[0].valid).toBe(true);

    const invalidResult = SBWHreflang.validateSet(
      [{ lang: 'en_US', href: 'https://example.com/en' }], pageUrl
    );
    expect(invalidResult.issues).toContain('Invalid hreflang tag: en_US (use a hyphen, not an underscore)');
  });

  it('excludes an x-default sharing a URL with a language variant from the same-URL info issue', () => {
    const entries = [
      { lang: 'en', href: 'https://example.com/en/page' },
      { lang: 'x-default', href: 'https://example.com/en/page' }
    ];
    const result = SBWHreflang.validateSet(entries, pageUrl);
    expect(result.issues.some(i => /same url/i.test(i))).toBe(false);
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

  it('matches attribute names case-insensitively, including uppercase HREFLANG=', () => {
    const html = `<html><head>
      <link REL="alternate" HREFLANG="en" HREF="https://example.com/en/page">
    </head></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries).toHaveLength(1);
    expect(entries[0].lang).toBe('en');
  });

  it('extracts a self-closing <link ... /> tag', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="en" href="https://example.com/en/page" />
    </head></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries).toHaveLength(1);
    expect(entries[0].lang).toBe('en');
  });

  it('ignores a hreflang link inside an HTML comment', () => {
    const html = `<html><head>
      <!-- <link rel="alternate" hreflang="es" href="https://example.com/es/page"> -->
      <link rel="alternate" hreflang="en" href="https://example.com/en/page">
    </head></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries).toHaveLength(1);
    expect(entries[0].lang).toBe('en');
  });

  it('falls back to the slice up to <body> when the head has no closing </head> tag', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="en" href="https://example.com/en/page">
      <link rel="alternate" hreflang="fr" href="https://example.com/fr/page">
    <body><p>malformed markup, head never closed</p></body></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries.map(e => e.lang).sort()).toEqual(['en', 'fr']);
  });

  it('falls back to the whole clipped string when the HTML is truncated mid-head (no </head>, no <body>)', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="en" href="https://example.com/en/page">
      <link rel="alternate" hreflang="de" href="https://example.com/de/pa`; // cut off mid-tag
    const entries = SBWHreflang.extractHreflangFromHtml(html, baseUrl);
    expect(entries.map(e => e.lang)).toContain('en');
  });

  it('resolves a relative href against baseUrl and returns an absolute url alongside the raw href', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="fr" href="/fr/page">
    </head></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, 'https://example.com/en/page');
    expect(entries[0].href).toBe('/fr/page');
    expect(entries[0].url).toBe('https://example.com/fr/page');
  });

  it('honors a <base href> in the head, resolved against baseUrl', () => {
    const html = `<html><head>
      <base href="/intl/">
      <link rel="alternate" hreflang="fr" href="fr/page">
    </head></html>`;
    const entries = SBWHreflang.extractHreflangFromHtml(html, 'https://example.com/en/page');
    expect(entries[0].url).toBe('https://example.com/intl/fr/page');
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

    expect(result.summary).toEqual({ checked: 3, ok: 1, missing: 1, unreachable: 1, self: 0, redirected: 0, notIndexable: 0 });
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

  it("resolves a relative return link against the alternate's finalUrl (post-redirect), not its pre-redirect declared URL", () => {
    // pageUrl2 is what the return link ACTUALLY resolves to once resolved
    // against the alternate's real landing spot (finalUrl); resolving the
    // same relative href against the pre-redirect key instead (the bug this
    // fixes) lands on plain 'https://example.com/en/page', which must NOT
    // count as a match here.
    const pageUrl2 = 'https://example.com/regional/en/page';
    const preRedirectAlternateUrl = 'https://example.com/fr/page';
    const entries = [{ lang: 'fr', url: preRedirectAlternateUrl }];
    const fetched = new Map([
      [preRedirectAlternateUrl, {
        status: 200,
        finalUrl: 'https://example.com/regional/fr/page',
        entries: [{ lang: 'en', href: '../en/page' }],
        linkHeaderEntries: []
      }]
    ]);
    const result = SBWHreflang.reciprocity(pageUrl2, entries, fetched);
    expect(result.entries[0].returnTag).toBe('yes');
  });
});

describe('the page itself and tracking parameters (#91, #92)', () => {
  const pair = [
    { lang: 'en', url: 'https://example.com/en' },
    { lang: 'es', url: 'https://example.com/es' },
    { lang: 'x-default', url: 'https://example.com/en' }
  ];
  const fetched = new Map([['https://example.com/es', { status: 200, finalUrl: 'https://example.com/es', entries: [{ lang: 'en', href: 'https://example.com/en', url: 'https://example.com/en' }] }]]);

  it('marks the page\'s own entries SELF, not unreachable (#91)', () => {
    const r = SBWHreflang.reciprocity('https://example.com/en', pair, fetched);
    expect(r.entries.map(e => e.returnTag)).toEqual(['self', 'yes', 'self']);
    expect(r.summary).toEqual({ checked: 1, ok: 1, missing: 0, unreachable: 0, self: 2, redirected: 0, notIndexable: 0 });
  });

  it('opened from a tracking link, the page still finds itself and its return tags (#92)', () => {
    const page = 'https://example.com/en?utm_source=newsletter&utm_medium=email&gclid=abc';
    const r = SBWHreflang.reciprocity(page, pair, fetched);
    expect(r.entries.map(e => e.returnTag)).toEqual(['self', 'yes', 'self']);
    const v = SBWHreflang.validateSet(pair.map(e => ({ lang: e.lang, href: e.url })), page);
    expect(v.issues).not.toContain('Missing self-referencing hreflang');
  });

  it('a real query string is still a different page', () => {
    expect(SBWHreflang.comparableUrl('https://example.com/en?page=2')).not.toBe(SBWHreflang.comparableUrl('https://example.com/en'));
    expect(SBWHreflang.comparableUrl('https://example.com/en?page=2&utm_source=x')).toBe('https://example.com/en?page=2');
  });

  it('decodes &amp; in raw-HTML hrefs', () => {
    const html = '<head><link rel="alternate" hreflang="de" href="https://example.com/p?lang=de&amp;region=at"></head>';
    expect(SBWHreflang.extractHreflangFromHtml(html, 'https://example.com/')[0].url).toBe('https://example.com/p?lang=de&region=at');
  });
});

// 1.13.8: the codes Google reads, and the audit's two verified cases: valid
// lowercase en-gb read as a red error, and invalid en-UK passed.
describe('ISO 639-1 and ISO 3166-1 (1.13.8)', () => {
  it('holds the current tables: 183 languages, 249 regions', () => {
    expect(SBWHreflang.ISO_639_1.size).toBe(183);
    expect(SBWHreflang.ISO_3166_1.size).toBe(249);
    ['en', 'fr', 'de', 'zh', 'he', 'nb', 'tl'].forEach(c => expect(SBWHreflang.ISO_639_1.has(c)).toBe(true));
    ['GB', 'US', 'DE', 'TW', 'HK', 'XK'].forEach(c => expect(SBWHreflang.ISO_3166_1.has(c)).toBe(c !== 'XK'));
  });

  it('en-UK is invalid, with en-GB as the fix', () => {
    expect(SBWHreflang.parseLangTag('en-UK')).toMatchObject({ valid: false, reason: 'UK is not a country code (use GB)', suggestion: 'en-GB' });
    expect(SBWHreflang.parseLangTag('en-uk')).toMatchObject({ valid: false, suggestion: 'en-GB' });
  });

  it('en-gb is valid', () => {
    expect(SBWHreflang.parseLangTag('en-gb').valid).toBe(true);
  });

  it('a code in no table, a reserved region, and a language people mistake', () => {
    expect(SBWHreflang.parseLangTag('xx').reason).toBe('xx is not an ISO 639-1 language code');
    expect(SBWHreflang.parseLangTag('en-XX').reason).toBe('XX is not an ISO 3166-1 country code');
    expect(SBWHreflang.parseLangTag('en-EU').reason).toBe('EU is reserved and has no effect in Google Search');
    expect(SBWHreflang.parseLangTag('jp')).toMatchObject({ valid: false, suggestion: 'ja' });
    expect(SBWHreflang.parseLangTag('iw-IL')).toMatchObject({ valid: false, suggestion: 'he-IL' });
    // A region alone is not a tag ("You can't specify the country code by itself").
    expect(SBWHreflang.parseLangTag('US')).toMatchObject({ valid: false, reason: 'US is a country code: a tag starts with a language, as in en-US' });
  });

  it('a script is kept (ISO 15924), in any case', () => {
    expect(SBWHreflang.parseLangTag('zh-Hans')).toMatchObject({ valid: true, script: 'Hans' });
    expect(SBWHreflang.parseLangTag('sr-latn-rs')).toMatchObject({ valid: true, script: 'Latn', region: 'RS', suggestion: 'sr-Latn-RS' });
  });

  it('the same tag in two casings is a duplicate', () => {
    const out = SBWHreflang.validateSet([
      { lang: 'en-GB', href: 'https://example.com/uk/' },
      { lang: 'en-gb', href: 'https://example.com/gb/' },
      { lang: 'x-default', href: 'https://example.com/' }
    ], 'https://example.com/');
    expect(out.issues).toContain('Duplicate hreflang tag: en-GB, en-gb');
  });

  it('an invalid tag says why in the set issues', () => {
    const out = SBWHreflang.validateSet([{ lang: 'en-UK', href: 'https://example.com/' }, { lang: 'x-default', href: 'https://example.com/' }], 'https://example.com/');
    expect(out.issues).toContain('Invalid hreflang tag: en-UK (UK is not a country code (use GB))');
    expect(out.entries[0].issues[0]).toBe('Invalid hreflang tag "en-UK": UK is not a country code (use GB)');
  });
});

// 1.13.8: alternates that redirect or can't be indexed are flagged.
describe('alternates that redirect or are not indexable (1.13.8)', () => {
  const page = 'https://example.com/en/';
  const entries = [
    { lang: 'en', url: 'https://example.com/en/' },
    { lang: 'fr', url: 'https://example.com/fr' },
    { lang: 'de', url: 'https://example.com/de/' },
    { lang: 'es', url: 'https://example.com/es/' },
    { lang: 'it', url: 'https://example.com/it/' }
  ];
  const back = [{ lang: 'en', href: page, url: page }];
  const fetched = new Map([
    ['https://example.com/fr', { url: 'https://example.com/fr', finalUrl: 'https://example.com/fr/', status: 200, entries: back }],
    ['https://example.com/de/', { url: 'https://example.com/de/', finalUrl: 'https://example.com/de/', status: 200, entries: back, noindex: true, noindexSource: 'robots' }],
    ['https://example.com/es/', { url: 'https://example.com/es/', finalUrl: 'https://example.com/es/', status: 200, entries: back, canonical: 'https://example.com/' }],
    ['https://example.com/it/', { url: 'https://example.com/it/', finalUrl: 'https://example.com/it/?utm_source=x', status: 200, entries: back, noindex: true, noindexSource: 'x-robots-tag' }]
  ]);

  it('flags each, and leaves a clean one alone', () => {
    const r = SBWHreflang.reciprocity(page, entries, fetched);
    const by = Object.fromEntries(r.entries.map(e => [e.lang, e]));
    expect(by.fr.redirectsTo).toBe('https://example.com/fr/');
    expect(by.fr.notIndexable).toBeUndefined();
    expect(by.de.notIndexable).toBe('noindex (meta robots)');
    expect(by.es.notIndexable).toBe('canonical points to https://example.com/');
    expect(by.it.notIndexable).toBe('noindex (X-Robots-Tag)');
    expect(by.it.redirectsTo).toBeUndefined(); // only a tracking parameter differs
    expect(r.summary).toMatchObject({ redirected: 1, notIndexable: 3, ok: 4 });
  });

  it('reads the signals from an alternate\'s head', () => {
    const html = `<html><head><!-- <meta name="robots" content="noindex"> -->
      <meta name="googlebot" content="NONE"><link rel="canonical" href="/fr/?a=1&amp;b=2"></head><body><meta name="robots" content="noindex"></body></html>`;
    expect(SBWHreflang.extractIndexSignalsFromHtml(html, 'https://example.com/fr/x')).toEqual({ noindex: true, noindexSource: 'googlebot', canonical: 'https://example.com/fr/?a=1&b=2' });
    expect(SBWHreflang.extractIndexSignalsFromHtml('<head><meta name="robots" content="index"></head>', 'https://example.com/')).toEqual({ noindex: false, noindexSource: null, canonical: null });
  });
});
