// Unit tests for the pure capture stripper (src/lib/capture-strip.js,
// fix round 1, item 3) — the function popup.js's stripForStorage() (née
// stripSchemaPropertiesForStorage) delegates to before handing a copy of
// the analysis result to autoSaveCapture/syncCapture.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWCaptureStrip` rather than an ESM default export.
await import('../../src/lib/capture-strip.js');
const SBWCaptureStrip = globalThis.SBWCaptureStrip;

function fixture() {
  return {
    url: 'https://example.com/page',
    headings: {
      h1: ['Title'],
      h2: [],
      outline: [{ level: 1, text: 'Title', order: 1 }]
    },
    links: {
      internal: { count: 3 },
      external: { count: 1 },
      nofollow: 1,
      ugc: 0,
      sponsored: 0,
      list: [{ url: 'https://example.com/a', anchor: 'a', rel: null, type: 'internal' }],
      nofollowAnchors: [{ url: 'https://example.com/b', text: 'b', rel: 'nofollow' }]
    },
    images: {
      total: 2,
      missingAlt: { count: 0 },
      list: [{ src: '/a.jpg', alt: 'a', hasAlt: true, lazy: false, width: null, height: null }]
    }
  };
}

describe('SBWCaptureStrip namespace', () => {
  it('attaches to globalThis.SBWCaptureStrip', () => {
    expect(SBWCaptureStrip).toBeTruthy();
    expect(typeof SBWCaptureStrip.strip).toBe('function');
  });
});

describe('strip', () => {
  it('drops headings.outline but keeps the rest of headings intact', () => {
    const out = SBWCaptureStrip.strip(fixture());
    expect(out.headings.outline).toBeUndefined();
    expect(out.headings.h1).toEqual(['Title']);
  });

  it('drops links.list and links.nofollowAnchors but keeps counts intact', () => {
    const out = SBWCaptureStrip.strip(fixture());
    expect(out.links.list).toBeUndefined();
    expect(out.links.nofollowAnchors).toBeUndefined();
    expect(out.links.internal.count).toBe(3);
    expect(out.links.external.count).toBe(1);
    expect(out.links.nofollow).toBe(1);
  });

  it('drops images.list but keeps images.total/missingAlt intact', () => {
    const out = SBWCaptureStrip.strip(fixture());
    expect(out.images.list).toBeUndefined();
    expect(out.images.total).toBe(2);
    expect(out.images.missingAlt.count).toBe(0);
  });

  it('does not mutate the input object', () => {
    const data = fixture();
    SBWCaptureStrip.strip(data);
    expect(data.headings.outline).toBeDefined();
    expect(data.links.list).toBeDefined();
    expect(data.images.list).toBeDefined();
  });

  it('passes through data with none of the four fields unchanged', () => {
    const data = { url: 'https://example.com/', headings: { h1: ['x'] }, links: { internal: { count: 1 } }, images: { total: 0 } };
    const out = SBWCaptureStrip.strip(data);
    expect(out).toEqual(data);
  });

  it('handles null/undefined data without throwing', () => {
    expect(SBWCaptureStrip.strip(null)).toBeNull();
    expect(SBWCaptureStrip.strip(undefined)).toBeUndefined();
  });

  describe('schemaValidation (existing Task 5 behavior, composed here)', () => {
    it('fails closed and drops schemaValidation entirely when SBWSchema.stripForStorage is not loaded', () => {
      const data = Object.assign(fixture(), { schemaValidation: { items: [{ type: 'Article', properties: { headline: 'hi' } }] } });
      const out = SBWCaptureStrip.strip(data);
      expect(out.schemaValidation).toBeUndefined();
    });

    it('delegates to SBWSchema.stripForStorage when present', () => {
      const originalSchema = globalThis.SBWSchema;
      globalThis.SBWSchema = {
        stripForStorage(result) {
          return Object.assign({}, result, { stripped: true });
        }
      };
      try {
        const data = Object.assign(fixture(), { schemaValidation: { items: [] } });
        const out = SBWCaptureStrip.strip(data);
        expect(out.schemaValidation).toEqual({ items: [], stripped: true });
      } finally {
        globalThis.SBWSchema = originalSchema;
      }
    });
  });

  // fix round 2, item 1 — `meta.schema` (lib/dom-extraction.js's extractMeta())
  // is the RAW parsed JSON-LD blocks, values included, kept for the score
  // calculator's own "has schema" check. Task 5's stripForStorage only ever
  // touched `schemaValidation` (SBWSchema's own parsed/validated items); this
  // block was never reduced and its property values — a plumber's phone
  // number, a business's address, a review's text — synced verbatim.
  describe('meta.schema (fix round 2, item 1)', () => {
    it('reduces a schema block to its @type and sorted top-level property names, dropping every value', () => {
      const data = {
        url: 'https://example.com/',
        meta: {
          schema: [
            {
              '@context': 'https://schema.org',
              '@type': 'Plumber',
              name: 'Acme Plumbing',
              telephone: '206-555-0100',
              address: { '@type': 'PostalAddress', streetAddress: '1 Main St' },
              aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '12' }
            }
          ]
        }
      };

      const out = SBWCaptureStrip.strip(data);

      expect(out.meta.schema).toEqual([
        { '@type': 'Plumber', keys: ['@context', '@type', 'address', 'aggregateRating', 'name', 'telephone'] }
      ]);
      expect(JSON.stringify(out.meta.schema)).not.toContain('206-555');
    });

    it('flattens @graph members to { @type, keys } under a graph array, one level deep', () => {
      const data = {
        meta: {
          schema: [
            {
              '@context': 'https://schema.org',
              '@graph': [
                { '@type': 'Organization', name: 'Acme', telephone: '206-555-0100' },
                { '@type': 'WebSite', url: 'https://example.com/' }
              ]
            }
          ]
        }
      };

      const out = SBWCaptureStrip.strip(data);

      expect(out.meta.schema[0]['@type']).toBeUndefined();
      expect(out.meta.schema[0].keys).toEqual(['@context', '@graph']);
      expect(out.meta.schema[0].graph).toEqual([
        { '@type': 'Organization', keys: ['@type', 'name', 'telephone'] },
        { '@type': 'WebSite', keys: ['@type', 'url'] }
      ]);
      expect(JSON.stringify(out.meta.schema)).not.toContain('206-555');
    });

    it('preserves an array-valued @type as-is (a type name, not page-authored content)', () => {
      const data = { meta: { schema: [{ '@type': ['LocalBusiness', 'Plumber'], name: 'Acme' }] } };
      const out = SBWCaptureStrip.strip(data);
      expect(out.meta.schema).toEqual([{ '@type': ['LocalBusiness', 'Plumber'], keys: ['@type', 'name'] }]);
    });

    it('leaves other meta fields untouched', () => {
      const data = { meta: { title: { text: 'Hi', length: 2 }, schema: [{ '@type': 'Article', headline: 'h' }] } };
      const out = SBWCaptureStrip.strip(data);
      expect(out.meta.title).toEqual({ text: 'Hi', length: 2 });
    });

    it('passes through unchanged when meta.schema is absent or empty', () => {
      const withoutSchema = { meta: { title: { text: 'x', length: 1 } } };
      expect(SBWCaptureStrip.strip(withoutSchema)).toEqual(withoutSchema);

      const emptySchema = { meta: { schema: [] } };
      expect(SBWCaptureStrip.strip(emptySchema)).toEqual(emptySchema);
    });

    it('does not mutate the input', () => {
      const data = { meta: { schema: [{ '@type': 'Article', headline: 'h' }] } };
      SBWCaptureStrip.strip(data);
      expect(data.meta.schema[0].headline).toBe('h');
    });
  });
});
