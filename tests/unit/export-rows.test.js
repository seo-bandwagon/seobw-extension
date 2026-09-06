// Unit tests for the pure export-row selection helper
// (src/lib/export-rows.js, fix round 1, item 8) — decides whether the
// popup's headings/images/links export buttons have real data to work
// from, or should be disabled because a cached pre-Task-7 analysis is
// missing the field entirely.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWExportRows` rather than an ESM default export.
await import('../../src/lib/export-rows.js');
const SBWExportRows = globalThis.SBWExportRows;

describe('SBWExportRows namespace', () => {
  it('attaches to globalThis.SBWExportRows', () => {
    expect(SBWExportRows).toBeTruthy();
    ['headingsRows', 'imagesRows', 'linksRows'].forEach(fn => expect(typeof SBWExportRows[fn]).toBe('function'));
  });
});

describe('headingsRows', () => {
  it('returns the outline array directly when present', () => {
    const data = { headings: { outline: [{ level: 1, text: 'Title', order: 1 }] } };
    expect(SBWExportRows.headingsRows(data)).toEqual([{ level: 1, text: 'Title', order: 1 }]);
  });

  it('falls back to flattening h1-h6 in level order when outline is missing (pre-1.6.0 cached analysis)', () => {
    const data = { headings: { h1: ['Main'], h2: ['Sub A', 'Sub B'], h3: [], h4: [], h5: [], h6: [] } };
    const rows = SBWExportRows.headingsRows(data);
    expect(rows).toEqual([
      { level: 1, text: 'Main', order: 1 },
      { level: 2, text: 'Sub A', order: 2 },
      { level: 2, text: 'Sub B', order: 3 }
    ]);
  });

  it('returns null when data.headings itself is missing entirely', () => {
    expect(SBWExportRows.headingsRows({})).toBeNull();
    expect(SBWExportRows.headingsRows(null)).toBeNull();
  });

  it('returns null when headings has no outline and none of h1-h6 are arrays', () => {
    expect(SBWExportRows.headingsRows({ headings: {} })).toBeNull();
  });

  it('returns an empty array (not null) when there really are zero headings on the page', () => {
    const data = { headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] } };
    expect(SBWExportRows.headingsRows(data)).toEqual([]);
  });
});

describe('imagesRows', () => {
  it('returns images.list when it is an array', () => {
    const data = { images: { list: [{ src: '/a.jpg' }] } };
    expect(SBWExportRows.imagesRows(data)).toEqual([{ src: '/a.jpg' }]);
  });

  it('returns an empty array (not null) when the page really has zero images', () => {
    expect(SBWExportRows.imagesRows({ images: { list: [] } })).toEqual([]);
  });

  it('returns null when images.list is missing (pre-1.6.0 cached analysis)', () => {
    expect(SBWExportRows.imagesRows({ images: { total: 3 } })).toBeNull();
    expect(SBWExportRows.imagesRows({})).toBeNull();
    expect(SBWExportRows.imagesRows(null)).toBeNull();
  });
});

describe('linksRows', () => {
  it('returns links.list when it is an array', () => {
    const data = { links: { list: [{ url: 'https://a.example/' }] } };
    expect(SBWExportRows.linksRows(data)).toEqual([{ url: 'https://a.example/' }]);
  });

  it('returns an empty array (not null) when the page really has zero qualifying links', () => {
    expect(SBWExportRows.linksRows({ links: { list: [] } })).toEqual([]);
  });

  it('returns null when links.list is missing (pre-1.6.0 cached analysis)', () => {
    expect(SBWExportRows.linksRows({ links: { internal: { count: 3 } } })).toBeNull();
    expect(SBWExportRows.linksRows({})).toBeNull();
    expect(SBWExportRows.linksRows(null)).toBeNull();
  });
});
