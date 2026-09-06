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
});
