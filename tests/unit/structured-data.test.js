// Unit tests for the pure structured-data validation logic
// (src/lib/structured-data.js).
//
// Covers all three extraction syntaxes (JSON-LD incl. @graph + parse
// errors, WHATWG microdata incl. nested itemscopes, basic RDFa Lite),
// required/recommended property validation against the schema.org /
// Google Search Central tables, the specific `problems` checks the brief
// calls out, and validateAll()'s counts/eligible rollup.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWSchema` rather than an ESM default export.
await import('../../src/lib/structured-data.js');
const SBWSchema = globalThis.SBWSchema;

function parseFragment(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return dom.window.document;
}

describe('SBWSchema namespace', () => {
  it('attaches to globalThis.SBWSchema', () => {
    expect(SBWSchema).toBeTruthy();
    ['extractJsonLd', 'extractMicrodata', 'extractRdfa', 'validateItem', 'validateAll']
      .forEach(fn => expect(typeof SBWSchema[fn]).toBe('function'));
    expect(SBWSchema.REQUIRED).toBeTruthy();
    expect(SBWSchema.RECOMMENDED).toBeTruthy();
  });
});

/* ---------- extractJsonLd ---------- */

describe('extractJsonLd', () => {
  it('extracts a single top-level object', () => {
    const items = SBWSchema.extractJsonLd([
      JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Hi' })
    ]);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('Article');
    expect(items[0].source).toBe('json-ld');
    expect(items[0].properties.headline).toBe('Hi');
  });

  it('flattens an @graph array', () => {
    const items = SBWSchema.extractJsonLd([
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Article', headline: 'A' },
          { '@type': 'Person', name: 'B' }
        ]
      })
    ]);
    expect(items.length).toBe(2);
    expect(items.map(i => i.type).sort()).toEqual(['Article', 'Person']);
  });

  it('flattens a bare top-level array', () => {
    const items = SBWSchema.extractJsonLd([
      JSON.stringify([{ '@type': 'Person', name: 'A' }, { '@type': 'Person', name: 'B' }])
    ]);
    expect(items.length).toBe(2);
  });

  it('takes the first @type when it is an array', () => {
    const items = SBWSchema.extractJsonLd([
      JSON.stringify({ '@type': ['NewsArticle', 'Article'], headline: 'Hi' })
    ]);
    expect(items[0].type).toBe('NewsArticle');
  });

  it('captures a parse error as {error, snippet} instead of throwing', () => {
    const items = SBWSchema.extractJsonLd(['{ this is not json ]']);
    expect(items.length).toBe(1);
    expect(items[0].error).toBeTruthy();
    expect(items[0].source).toBe('json-ld');
    expect(typeof items[0].snippet).toBe('string');
  });

  it('a parse error next to a valid graph member does not lose the valid one', () => {
    const items = SBWSchema.extractJsonLd([
      '{ broken',
      JSON.stringify({ '@graph': [{ '@type': 'Article', headline: 'Fine' }] })
    ]);
    expect(items.some(i => i.error)).toBe(true);
    expect(items.some(i => i.type === 'Article')).toBe(true);
  });

  it('ignores blank/empty script bodies', () => {
    const items = SBWSchema.extractJsonLd(['', '   ']);
    expect(items.length).toBe(0);
  });
});

/* ---------- extractMicrodata ---------- */

describe('extractMicrodata', () => {
  it('extracts a Product with a nested Offer itemscope', () => {
    const doc = parseFragment(`
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Widget</span>
        <img itemprop="image" src="https://example.com/w.jpg">
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <span itemprop="price">19.99</span>
          <span itemprop="priceCurrency">USD</span>
        </div>
      </div>
    `);
    const items = SBWSchema.extractMicrodata(doc);
    expect(items.length).toBe(1);
    const product = items[0];
    expect(product.type).toBe('Product');
    expect(product.source).toBe('microdata');
    expect(product.properties.name).toBe('Widget');
    expect(product.properties.image).toBe('https://example.com/w.jpg');
    expect(product.properties.offers.type).toBe('Offer');
    expect(product.properties.offers.properties.price).toBe('19.99');
    expect(product.properties.offers.properties.priceCurrency).toBe('USD');
  });

  it('does not double-count a nested itemscope as its own top-level item', () => {
    const doc = parseFragment(`
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Widget</span>
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <span itemprop="price">10</span>
        </div>
      </div>
    `);
    expect(SBWSchema.extractMicrodata(doc).length).toBe(1);
  });

  it('reads meta/link/time attribute value rules', () => {
    const doc = parseFragment(`
      <div itemscope itemtype="https://schema.org/Event">
        <meta itemprop="name" content="Launch Party">
        <time itemprop="startDate" datetime="2026-10-01T18:00:00Z">Oct 1</time>
        <a itemprop="url" href="https://example.com/event">Details</a>
      </div>
    `);
    const item = SBWSchema.extractMicrodata(doc)[0];
    expect(item.properties.name).toBe('Launch Party');
    expect(item.properties.startDate).toBe('2026-10-01T18:00:00Z');
    expect(item.properties.url).toBe('https://example.com/event');
  });

  it('collects repeated itemprop names into an array', () => {
    const doc = parseFragment(`
      <div itemscope itemtype="https://schema.org/Recipe">
        <span itemprop="recipeIngredient">Flour</span>
        <span itemprop="recipeIngredient">Sugar</span>
        <span itemprop="recipeIngredient">Eggs</span>
      </div>
    `);
    const item = SBWSchema.extractMicrodata(doc)[0];
    expect(item.properties.recipeIngredient).toEqual(['Flour', 'Sugar', 'Eggs']);
  });

  it('returns an empty array when there is no [itemscope] at all', () => {
    const doc = parseFragment('<p>nothing here</p>');
    expect(SBWSchema.extractMicrodata(doc)).toEqual([]);
  });
});

/* ---------- extractRdfa ---------- */

describe('extractRdfa', () => {
  it('extracts a Person with property/content/href', () => {
    const doc = parseFragment(`
      <div vocab="https://schema.org/" typeof="Person">
        <span property="name">Jamie Rivera</span>
        <a property="url" href="https://example.com/jamie">Profile</a>
        <meta property="jobTitle" content="Editor">
      </div>
    `);
    const items = SBWSchema.extractRdfa(doc);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('Person');
    expect(items[0].source).toBe('rdfa');
    expect(items[0].properties.name).toBe('Jamie Rivera');
    expect(items[0].properties.url).toBe('https://example.com/jamie');
    expect(items[0].properties.jobTitle).toBe('Editor');
  });

  it('does not descend past a nested typeof for the parent\'s own properties', () => {
    const doc = parseFragment(`
      <div vocab="https://schema.org/" typeof="Product">
        <span property="name">Widget</span>
        <div property="offers" typeof="Offer">
          <span property="price">19.99</span>
        </div>
      </div>
    `);
    const items = SBWSchema.extractRdfa(doc);
    expect(items.length).toBe(1);
    expect(items[0].properties.offers.type).toBe('Offer');
    expect(items[0].properties.offers.properties.price).toBe('19.99');
  });

  it('returns an empty array with no [typeof] present', () => {
    const doc = parseFragment('<p>nothing here</p>');
    expect(SBWSchema.extractRdfa(doc)).toEqual([]);
  });
});

/* ---------- validateItem ---------- */

describe('validateItem', () => {
  it('reports no missing required fields for a complete Article', () => {
    const v = SBWSchema.validateItem({
      type: 'Article', source: 'json-ld',
      properties: { headline: 'H', image: 'https://x.com/i.jpg', datePublished: '2026-01-01', author: { name: 'A' } }
    });
    expect(v.type).toBe('Article');
    expect(v.source).toBe('json-ld');
    expect(v.required.missing).toEqual([]);
    expect(v.required.present.sort()).toEqual(['author', 'datePublished', 'headline', 'image'].sort());
    expect(v.problems).toEqual([]);
  });

  it('lists missing required fields', () => {
    const v = SBWSchema.validateItem({ type: 'Article', source: 'json-ld', properties: { headline: 'H' } });
    expect(v.required.missing.sort()).toEqual(['author', 'datePublished', 'image'].sort());
  });

  it('lists missing recommended fields separately from required', () => {
    const v = SBWSchema.validateItem({
      type: 'Article', source: 'json-ld',
      properties: { headline: 'H', image: 'https://x.com/i.jpg', datePublished: '2026-01-01', author: { name: 'A' } }
    });
    expect(v.recommended.missing).toContain('dateModified');
  });

  it('flags an unknown @type', () => {
    const v = SBWSchema.validateItem({ type: 'TotallyMadeUpType', source: 'json-ld', properties: {} });
    expect(v.problems).toContain('Unknown type: TotallyMadeUpType');
  });

  it('flags offers missing price/priceCurrency', () => {
    const v = SBWSchema.validateItem({
      type: 'Product', source: 'json-ld',
      properties: { name: 'Widget', image: 'https://x.com/w.jpg', offers: { '@type': 'Offer' } }
    });
    expect(v.problems.join(' ')).toMatch(/price/);
    expect(v.problems.join(' ')).toMatch(/priceCurrency/);
  });

  it('does not flag offers when price and priceCurrency are both present', () => {
    const v = SBWSchema.validateItem({
      type: 'Product', source: 'json-ld',
      properties: { name: 'Widget', image: 'https://x.com/w.jpg', offers: { price: '9.99', priceCurrency: 'USD' } }
    });
    expect(v.problems.filter(p => /price/i.test(p))).toEqual([]);
  });

  it('flags a non-ISO-8601 datePublished', () => {
    const v = SBWSchema.validateItem({
      type: 'Article', source: 'json-ld',
      properties: { headline: 'H', image: 'https://x.com/i.jpg', author: 'A', datePublished: 'January 1st 2026' }
    });
    expect(v.problems).toContain('datePublished not an ISO 8601 date');
  });

  it('accepts a full ISO 8601 datetime for datePublished', () => {
    const v = SBWSchema.validateItem({
      type: 'Article', source: 'json-ld',
      properties: { headline: 'H', image: 'https://x.com/i.jpg', author: 'A', datePublished: '2026-01-01T09:00:00Z' }
    });
    expect(v.problems).not.toContain('datePublished not an ISO 8601 date');
  });

  it('flags an image that is not a URL or ImageObject', () => {
    const v = SBWSchema.validateItem({
      type: 'Article', source: 'json-ld',
      properties: { headline: 'H', author: 'A', datePublished: '2026-01-01', image: 'not a url' }
    });
    expect(v.problems).toContain('image not a URL or ImageObject');
  });

  it('accepts an ImageObject for image', () => {
    const v = SBWSchema.validateItem({
      type: 'Article', source: 'json-ld',
      properties: { headline: 'H', author: 'A', datePublished: '2026-01-01', image: { '@type': 'ImageObject', url: 'https://x.com/i.jpg' } }
    });
    expect(v.problems).not.toContain('image not a URL or ImageObject');
  });

  it('flags a BreadcrumbList item missing position', () => {
    const v = SBWSchema.validateItem({
      type: 'BreadcrumbList', source: 'json-ld',
      properties: { itemListElement: [{ name: 'Home' }, { name: 'Shop', position: 2 }] }
    });
    expect(v.problems).toContain('BreadcrumbList item missing position');
  });

  it('does not flag BreadcrumbList when every item has a position', () => {
    const v = SBWSchema.validateItem({
      type: 'BreadcrumbList', source: 'json-ld',
      properties: { itemListElement: [{ name: 'Home', position: 1 }, { name: 'Shop', position: 2 }] }
    });
    expect(v.problems).not.toContain('BreadcrumbList item missing position');
  });

  it('flags a FAQPage mainEntity missing acceptedAnswer', () => {
    const v = SBWSchema.validateItem({
      type: 'FAQPage', source: 'json-ld',
      properties: { mainEntity: [{ name: 'Q1', acceptedAnswer: { text: 'A1' } }, { name: 'Q2' }] }
    });
    expect(v.problems).toContain('FAQPage mainEntity missing acceptedAnswer');
  });

  it('resolves NewsArticle/BlogPosting to the Article required set', () => {
    const v1 = SBWSchema.validateItem({ type: 'NewsArticle', source: 'json-ld', properties: {} });
    const v2 = SBWSchema.validateItem({ type: 'BlogPosting', source: 'json-ld', properties: {} });
    expect(v1.required.missing.sort()).toEqual(SBWSchema.REQUIRED.Article.slice().sort());
    expect(v2.required.missing.sort()).toEqual(SBWSchema.REQUIRED.Article.slice().sort());
  });

  it('resolves a LocalBusiness subtype (Dentist) to the LocalBusiness required set', () => {
    const v = SBWSchema.validateItem({ type: 'Dentist', source: 'microdata', properties: {} });
    expect(v.required.missing.sort()).toEqual(SBWSchema.REQUIRED.LocalBusiness.slice().sort());
  });

  it('a nested-item wrapper (microdata/RDFa shape) is understood the same as a raw JSON-LD nested object', () => {
    const vMicro = SBWSchema.validateItem({
      type: 'Product', source: 'microdata',
      properties: { name: 'Widget', image: 'https://x.com/w.jpg', offers: { type: 'Offer', source: 'microdata', properties: { price: '9.99', priceCurrency: 'USD' } } }
    });
    expect(vMicro.problems.filter(p => /price/i.test(p))).toEqual([]);
  });
});

/* ---------- validateAll ---------- */

describe('validateAll', () => {
  const completeArticle = { type: 'Article', source: 'json-ld', properties: { headline: 'H', image: 'https://x.com/i.jpg', datePublished: '2026-01-01', author: 'A' } };
  const incompleteProduct = { type: 'Product', source: 'json-ld', properties: { name: 'Widget' } };
  const microdataLocalBusiness = { type: 'LocalBusiness', source: 'microdata', properties: { name: 'Shop', address: '1 Main St', telephone: '555-1000' } };
  const rdfaPerson = { type: 'Person', source: 'rdfa', properties: { name: 'Jamie' } };
  const parseError = { source: 'json-ld', error: 'Unexpected token', snippet: '{ bad' };

  it('rolls up byType, bySource and withErrors', () => {
    const result = SBWSchema.validateAll([completeArticle, incompleteProduct, microdataLocalBusiness, rdfaPerson, parseError]);
    expect(result.items.length).toBe(5);
    expect(result.counts.byType.Article).toBe(1);
    expect(result.counts.byType.Product).toBe(1);
    expect(result.counts.bySource['json-ld']).toBe(3);
    expect(result.counts.bySource.microdata).toBe(1);
    expect(result.counts.bySource.rdfa).toBe(1);
    // incompleteProduct (missing required) + parseError both count as errors;
    // the complete Article/LocalBusiness/Person do not.
    expect(result.counts.withErrors).toBe(2);
  });

  it('passes parse-error entries through untouched (no required/recommended/problems computed)', () => {
    const result = SBWSchema.validateAll([parseError]);
    expect(result.items[0].error).toBe('Unexpected token');
    expect(result.items[0].source).toBe('json-ld');
    expect(result.items[0].required).toBeUndefined();
  });

  it('lists a feature in eligible only when its required set is fully satisfied', () => {
    const result = SBWSchema.validateAll([completeArticle, incompleteProduct]);
    expect(result.eligible).toContain('Article');
    expect(result.eligible).not.toContain('Product');
  });

  // Fix round 1, CRITICAL 2b: FAQ and How-to rich results are discontinued
  // (verified live 2026-09-06) — a complete FAQPage/HowTo item is still
  // validated as markup (no problems, required set satisfied) but no
  // longer appears in `eligible`. VideoObject/BreadcrumbList are unaffected.
  it('maps VideoObject/BreadcrumbList to the Video/Breadcrumb feature names, but never lists FAQ (retired rich result)', () => {
    const faq = { type: 'FAQPage', source: 'json-ld', properties: { mainEntity: [{ name: 'Q', acceptedAnswer: { text: 'A' } }] } };
    const video = { type: 'VideoObject', source: 'json-ld', properties: { name: 'V', description: 'D', thumbnailUrl: 'https://x.com/t.jpg', uploadDate: '2026-01-01' } };
    const crumb = { type: 'BreadcrumbList', source: 'json-ld', properties: { itemListElement: [{ position: 1 }] } };
    const result = SBWSchema.validateAll([faq, video, crumb]);
    expect(result.eligible.sort()).toEqual(['Breadcrumb', 'Video'].sort());
    expect(result.eligible).not.toContain('FAQ');
    const faqItem = result.items.find(i => i.type === 'FAQPage');
    expect(faqItem.required.missing).toEqual([]);
  });

  // Fix round 1, CRITICAL 2b: a complete HowTo item is likewise never
  // eligible (How-to rich results are also discontinued).
  it('never lists HowTo in eligible even when its required set is complete', () => {
    const howTo = { type: 'HowTo', source: 'json-ld', properties: { name: 'Fix a leak', step: ['Turn off water', 'Replace washer'] } };
    const result = SBWSchema.validateAll([howTo]);
    expect(result.eligible).toEqual([]);
    expect(result.items[0].required.missing).toEqual([]);
  });

  it('returns empty counts/eligible for an empty item list', () => {
    const result = SBWSchema.validateAll([]);
    expect(result.items).toEqual([]);
    expect(result.eligible).toEqual([]);
    expect(result.counts.withErrors).toBe(0);
  });

  it('validates a full mixed batch end to end (json-ld + microdata + rdfa + a parse error)', () => {
    const result = SBWSchema.validateAll([completeArticle, incompleteProduct, microdataLocalBusiness, rdfaPerson, parseError]);
    expect(result.items.length).toBe(5);
    const article = result.items.find(i => i.type === 'Article');
    expect(article.required.missing).toEqual([]);
  });
});

/* ---------- REQUIRED/RECOMMENDED/SOURCE_URLS table shape ---------- */

describe('type tables', () => {
  const TYPES = [
    'Article', 'Product', 'LocalBusiness', 'Organization', 'Person', 'BreadcrumbList',
    'FAQPage', 'HowTo', 'Recipe', 'Event', 'VideoObject', 'Review', 'AggregateRating',
    'WebSite', 'WebPage', 'JobPosting'
  ];

  it('every documented type has a non-empty required-or-recommended entry and a sourceUrl', () => {
    TYPES.forEach(type => {
      expect(Array.isArray(SBWSchema.REQUIRED[type])).toBe(true);
      expect(Array.isArray(SBWSchema.RECOMMENDED[type])).toBe(true);
      expect(typeof SBWSchema.SOURCE_URLS[type]).toBe('string');
      expect(SBWSchema.SOURCE_URLS[type].length).toBeGreaterThan(0);
    });
  });

  // Fix round 1, CRITICAL 2d: every SOURCE_URLS value must be one of the
  // reviewer's live-verified (2026-09-06) URLs — a new URL has to be added
  // to this allow-list deliberately, not slip in as a typo or a stale page.
  it('every SOURCE_URLS value is in the verified allow-list', () => {
    const GOOGLE_BASE = 'https://developers.google.com/search/docs/appearance/structured-data/';
    const ALLOWED = new Set([
      GOOGLE_BASE + 'article',
      GOOGLE_BASE + 'product',
      GOOGLE_BASE + 'local-business',
      GOOGLE_BASE + 'breadcrumb',
      GOOGLE_BASE + 'recipe',
      GOOGLE_BASE + 'event',
      GOOGLE_BASE + 'video',
      GOOGLE_BASE + 'review-snippet',
      GOOGLE_BASE + 'job-posting',
      GOOGLE_BASE + 'organization',
      'https://schema.org/Person',
      'https://schema.org/WebPage',
      'https://schema.org/WebSite',
      'https://schema.org/FAQPage',
      'https://schema.org/HowTo',
      'https://schema.org/docs/terms.html'
    ]);
    Object.values(SBWSchema.SOURCE_URLS).forEach(url => {
      expect(ALLOWED.has(url)).toBe(true);
    });
  });

  it('Organization resolves to the Google Search Central organization page (the old /logo page redirects there)', () => {
    expect(SBWSchema.SOURCE_URLS.Organization).toBe('https://developers.google.com/search/docs/appearance/structured-data/organization');
  });

  it('WebSite resolves to schema.org and drops potentialAction (sitelinks search box discontinued)', () => {
    expect(SBWSchema.SOURCE_URLS.WebSite).toBe('https://schema.org/WebSite');
    expect(SBWSchema.RECOMMENDED.WebSite).not.toContain('potentialAction');
  });

  it('FAQPage/HowTo keep a schema.org sourceUrl (retired rich result, still valid markup)', () => {
    expect(SBWSchema.SOURCE_URLS.FAQPage).toBe('https://schema.org/FAQPage');
    expect(SBWSchema.SOURCE_URLS.HowTo).toBe('https://schema.org/HowTo');
  });
});

/* ---------- Fix round 1 (task-5-fix-1-brief.md) ---------- */

describe('CRITICAL 1: schema.org type oracle vs "no required-property spec"', () => {
  it('a LocalBusiness subtype outside the old hardcoded list (Plumber) gets no problems, the LocalBusiness required set, and is eligible', () => {
    const v = SBWSchema.validateItem({
      type: 'Plumber', source: 'json-ld',
      properties: { name: 'Ace Plumbing', address: '1 Main St', telephone: '555-1000' }
    });
    expect(v.problems).toEqual([]);
    expect(v.required.missing).toEqual([]);
    expect(SBWSchema.REQUIRED.Plumber).toEqual(SBWSchema.REQUIRED.LocalBusiness);

    const result = SBWSchema.validateAll([{ type: 'Plumber', source: 'json-ld', properties: { name: 'Ace Plumbing', address: '1 Main St', telephone: '555-1000' } }]);
    expect(result.eligible).toContain('LocalBusiness');
  });

  it('a real schema.org type with no required-property list (Service) gets a note, no problems, and does not count as an error', () => {
    const v = SBWSchema.validateItem({ type: 'Service', source: 'json-ld', properties: { name: 'Consulting' } });
    expect(v.problems).toEqual([]);
    expect(v.note).toBeTruthy();

    const result = SBWSchema.validateAll([{ type: 'Service', source: 'json-ld', properties: { name: 'Consulting' } }]);
    expect(result.counts.withErrors).toBe(0);
  });

  it('flags a genuinely unknown type', () => {
    const v = SBWSchema.validateItem({ type: 'Foo', source: 'json-ld', properties: {} });
    expect(v.problems).toContain('Unknown type: Foo');
  });

  it('resolves a "schema:" prefix and a full schema.org URL to the bare type name', () => {
    const v1 = SBWSchema.validateItem({ type: 'schema:Person', source: 'json-ld', properties: { name: 'A' } });
    const v2 = SBWSchema.validateItem({ type: 'https://schema.org/Person', source: 'json-ld', properties: { name: 'A' } });
    expect(v1.type).toBe('Person');
    expect(v1.problems).not.toContain('Unknown type: schema:Person');
    expect(v2.type).toBe('Person');
    expect(v2.problems).not.toContain('Unknown type: https://schema.org/Person');
  });
});

describe('IMPORTANT 3: extractJsonLd recurses through nested/array @graph', () => {
  it('a @graph member that is itself an array is flattened (Person found)', () => {
    const items = SBWSchema.extractJsonLd([
      JSON.stringify({ '@graph': [[{ '@type': 'Person', name: 'Array Nested' }]] })
    ]);
    expect(items.some(i => i.type === 'Person' && i.properties.name === 'Array Nested')).toBe(true);
    expect(items.some(i => i.type === undefined)).toBe(false);
  });

  it('a @graph member that itself carries @graph is flattened (Person found)', () => {
    const items = SBWSchema.extractJsonLd([
      JSON.stringify({ '@graph': [{ '@graph': [{ '@type': 'Person', name: 'Graph Nested' }] }] })
    ]);
    expect(items.some(i => i.type === 'Person' && i.properties.name === 'Graph Nested')).toBe(true);
    expect(items.some(i => i.type === undefined)).toBe(false);
  });
});

describe('IMPORTANT 4: checkOffers — all offers, AggregateOffer, priceSpecification', () => {
  it('a valid AggregateOffer (lowPrice + priceCurrency) is not flagged', () => {
    const v = SBWSchema.validateItem({
      type: 'Product', source: 'json-ld',
      properties: { name: 'Widget', image: 'https://x.com/w.jpg', offers: { '@type': 'AggregateOffer', lowPrice: '9.99', highPrice: '19.99', priceCurrency: 'USD' } }
    });
    expect(v.problems.filter(p => /offers/.test(p))).toEqual([]);
  });

  it('an AggregateOffer missing lowPrice is flagged for lowPrice, not price', () => {
    const v = SBWSchema.validateItem({
      type: 'Product', source: 'json-ld',
      properties: { name: 'Widget', image: 'https://x.com/w.jpg', offers: { '@type': 'AggregateOffer', priceCurrency: 'USD' } }
    });
    expect(v.problems).toContain('offers[0] missing lowPrice');
    expect(v.problems).not.toContain('offers[0] missing price');
  });

  it('a plain Offer with priceSpecification (no price) counts as priced', () => {
    const v = SBWSchema.validateItem({
      type: 'Product', source: 'json-ld',
      properties: { name: 'Widget', image: 'https://x.com/w.jpg', offers: { priceSpecification: { price: '9.99', priceCurrency: 'USD' }, priceCurrency: 'USD' } }
    });
    expect(v.problems.filter(p => /missing price\b/.test(p))).toEqual([]);
  });

  it('iterates every offer in an array, emitting exactly one indexed message for the offending one', () => {
    const v = SBWSchema.validateItem({
      type: 'Product', source: 'json-ld',
      properties: { name: 'Widget', image: 'https://x.com/w.jpg', offers: [{ price: '9.99', priceCurrency: 'USD' }, { priceCurrency: 'USD' }] }
    });
    expect(v.problems).toEqual(['offers[1] missing price']);
  });
});

describe('IMPORTANT 5: stripForStorage', () => {
  it('removes properties from every item but leaves counts/eligible untouched', () => {
    const result = SBWSchema.validateAll([
      { type: 'Article', source: 'json-ld', properties: { headline: 'H', image: 'https://x.com/i.jpg', datePublished: '2026-01-01', author: 'A' } },
      { source: 'json-ld', error: 'bad', snippet: '{ bad' }
    ]);
    const stripped = SBWSchema.stripForStorage(result);
    stripped.items.forEach(item => {
      expect(item).not.toHaveProperty('properties');
    });
    expect(stripped.counts).toEqual(result.counts);
    expect(stripped.eligible).toEqual(result.eligible);
    // original is untouched (popup keeps the in-memory copy for Copy JSON-LD)
    expect(result.items[0].properties).toBeTruthy();
  });
});

describe('IMPORTANT 6: microdata itemref', () => {
  it('resolves a property referenced by itemref elsewhere in the document', () => {
    const doc = parseFragment(`
      <div itemscope itemtype="https://schema.org/Product" itemref="sku-el">
        <span itemprop="name">Widget</span>
      </div>
      <span id="sku-el" itemprop="sku">ABC123</span>
    `);
    const items = SBWSchema.extractMicrodata(doc);
    expect(items.length).toBe(1);
    expect(items[0].properties.sku).toBe('ABC123');
  });

  it('does not loop forever on a cyclic itemref', () => {
    const doc = parseFragment(`
      <div id="a" itemscope itemtype="https://schema.org/Product" itemref="b">
        <span itemprop="name">Widget</span>
      </div>
      <div id="b" itemprop="offers" itemscope itemtype="https://schema.org/Offer" itemref="a">
        <span itemprop="price">9.99</span>
      </div>
    `);
    expect(() => SBWSchema.extractMicrodata(doc)).not.toThrow();
  });
});

describe('IMPORTANT 7: microdata URL values resolve against the document', () => {
  it('resolves a relative href to an absolute URL', () => {
    const dom = new JSDOM(
      '<!doctype html><body><div itemscope itemtype="https://schema.org/Person"><a itemprop="url" href="/relative">Profile</a></div></body>',
      { url: 'https://example.com/page' }
    );
    const items = SBWSchema.extractMicrodata(dom.window.document);
    expect(items[0].properties.url).toBe('https://example.com/relative');
  });
});

describe('MINOR 10: ISO_8601_RE accepts year/year-month, sanity-checks full dates', () => {
  it('accepts a bare year and a year-month', () => {
    const v1 = SBWSchema.validateItem({ type: 'Article', source: 'json-ld', properties: { headline: 'H', image: 'https://x.com/i.jpg', author: 'A', datePublished: '2026' } });
    const v2 = SBWSchema.validateItem({ type: 'Article', source: 'json-ld', properties: { headline: 'H', image: 'https://x.com/i.jpg', author: 'A', datePublished: '2026-06' } });
    expect(v1.problems).not.toContain('datePublished not an ISO 8601 date');
    expect(v2.problems).not.toContain('datePublished not an ISO 8601 date');
  });

  it('rejects a calendar-invalid full date (Feb 30) even though it matches the ISO shape', () => {
    const v = SBWSchema.validateItem({ type: 'Article', source: 'json-ld', properties: { headline: 'H', image: 'https://x.com/i.jpg', author: 'A', datePublished: '2026-02-30' } });
    expect(v.problems).toContain('datePublished not an ISO 8601 date');
  });
});

describe('MINOR 11: extractJsonLd strips a wrapping HTML comment or CDATA section', () => {
  it('strips a wrapping HTML comment before parsing', () => {
    const items = SBWSchema.extractJsonLd(['<!-- ' + JSON.stringify({ '@type': 'Article', headline: 'Commented' }) + ' -->']);
    expect(items.length).toBe(1);
    expect(items[0].error).toBeFalsy();
    expect(items[0].properties.headline).toBe('Commented');
  });

  it('strips a wrapping CDATA section before parsing', () => {
    const items = SBWSchema.extractJsonLd(['//<![CDATA[\n' + JSON.stringify({ '@type': 'Article', headline: 'CDATA' }) + '\n//]]>']);
    expect(items.length).toBe(1);
    expect(items[0].error).toBeFalsy();
    expect(items[0].properties.headline).toBe('CDATA');
  });
});

describe('MINOR 13: AggregateRating.required drops itemReviewed only when nested', () => {
  it('requires itemReviewed for a top-level AggregateRating item', () => {
    const v = SBWSchema.validateItem({ type: 'AggregateRating', source: 'json-ld', properties: { ratingValue: '4.5' } });
    expect(v.required.missing).toContain('itemReviewed');
  });

  it('does not require itemReviewed when validated as a nested value', () => {
    const v = SBWSchema.validateItem({ type: 'AggregateRating', source: 'json-ld', properties: { ratingValue: '4.5' } }, { nested: true });
    expect(v.required.missing).not.toContain('itemReviewed');
  });
});

describe('re-review 2026-09-06: LocalBusiness subtypes missing vs the live vocabulary', () => {
  const S = globalThis.SBWSchema;
  it.each(['Notary', 'PhysiciansOffice', 'StadiumOrArena', 'VacationRental', 'AutomatedTeller', 'Bakery', 'BarOrPub', 'IndividualPhysician', 'HousePainter'])(
    '%s gets the LocalBusiness required set and no "Unknown type"', (type) => {
      const props = { name: 'X', address: 'A', telephone: 'T' };
      const r = S.validateItem({ type, source: 'json-ld', properties: props });
      expect(r.problems).toEqual([]);
      expect(r.required.missing).toEqual([]);
      expect(S.validateAll([{ type, source: 'json-ld', properties: props }]).eligible).toContain('LocalBusiness');
    },
  );
  it('names that are not schema.org classes are unknown', () => {
    for (const t of ['Painter', 'Podcast', 'Sheet', 'BookAction']) {
      expect(S.validateItem({ type: t, source: 'json-ld', properties: {} }).problems).toContain('Unknown type: ' + t);
    }
  });
});
