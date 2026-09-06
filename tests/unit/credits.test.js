// Unit tests for the pure credits/attribution data (src/lib/credits.js).
// Covers: license entries present with the exact license names the
// ledger's attribution rule requires, every type row resolves a real
// sourceUrl off SBWSchema (no drift between the two modules), and the
// dual-export shape.

import { describe, it, expect } from 'vitest';

// SBWSchema must be loaded first — src/lib/credits.js reads
// globalThis.SBWSchema.SOURCE_URLS at load time (see popup.html's script
// order: structured-data.js then credits.js).
await import('../../extension/src/lib/structured-data.js');
await import('../../extension/src/lib/credits.js');
const SBWCredits = globalThis.SBWCredits;
const SBWSchema = globalThis.SBWSchema;

describe('SBWCredits namespace', () => {
  it('attaches to globalThis.SBWCredits with an entries array', () => {
    expect(SBWCredits).toBeTruthy();
    expect(Array.isArray(SBWCredits.entries)).toBe(true);
    expect(SBWCredits.entries.length).toBeGreaterThan(0);
  });
});

describe('license entries', () => {
  it('credits schema.org under CC BY-SA 3.0', () => {
    const e = SBWCredits.entries.find(x => /schema\.org/i.test(x.title) && x.section === 'license');
    expect(e).toBeTruthy();
    expect(e.note).toBe('CC BY-SA 3.0');
    expect(e.url).toMatch(/^https:\/\//);
  });

  it('credits Google Search Central under CC BY 4.0', () => {
    const e = SBWCredits.entries.find(x => /Google Search Central/i.test(x.title) && x.section === 'license');
    expect(e).toBeTruthy();
    expect(e.note).toBe('CC BY 4.0');
    expect(e.url).toMatch(/^https:\/\//);
  });
});

describe('type rows', () => {
  it('every type row has a non-empty url that matches SBWSchema.SOURCE_URLS', () => {
    const rows = SBWCredits.entries.filter(x => x.section === 'type');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(row => {
      expect(typeof row.url).toBe('string');
      expect(row.url.length).toBeGreaterThan(0);
      expect(Object.values(SBWSchema.SOURCE_URLS)).toContain(row.url);
    });
  });

  it('covers every type category the brief lists', () => {
    const titles = SBWCredits.entries.filter(x => x.section === 'type').map(x => x.title).join(' | ');
    ['Article', 'Product', 'LocalBusiness', 'Organization', 'Person', 'BreadcrumbList',
      'FAQPage', 'HowTo', 'Recipe', 'Event', 'VideoObject', 'Review', 'WebSite', 'WebPage', 'JobPosting']
      .forEach(name => expect(titles).toMatch(new RegExp(name)));
  });
});

// Task 7, item F: the tool links opened by the context menu / popup TOOLS
// row (src/lib/tool-links.js) get their own credit rows.
describe('tool rows (Task 7, item F)', () => {
  it('credits Google Search Console, PageSpeed Insights, Rich Results Test, and Wayback Machine', () => {
    const rows = SBWCredits.entries.filter(x => x.section === 'tool');
    const titles = rows.map(r => r.title);
    expect(titles).toEqual(expect.arrayContaining([
      'Google Search Console', 'PageSpeed Insights', 'Rich Results Test', 'Wayback Machine'
    ]));
  });

  it('every tool row has a real https URL and the "not affiliated" note', () => {
    const rows = SBWCredits.entries.filter(x => x.section === 'tool');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(row => {
      expect(row.url).toMatch(/^https:\/\//);
      expect(row.note).toMatch(/not affiliated/i);
    });
  });
});
