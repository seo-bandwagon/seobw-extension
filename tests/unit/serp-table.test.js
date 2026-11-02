// The results table (1.12.0, src/lib/serp-table.js): the search's words,
// the median and the marks, the pinned page, sorting and the CSV.

import { describe, it, expect } from 'vitest';

const F = require('../../extension/src/lib/serp-figures.js');
globalThis.SBWSerpFigures = F;
const T = require('../../extension/src/lib/serp-table.js');

function row(position, domain, title, snippet, over) {
  const r = Object.assign({ position, url: `https://${domain}/${title.toLowerCase().replace(/\s+/g, '-')}`, domain, title, snippet }, over);
  Object.defineProperty(r, '_key', { value: r.url, enumerable: false });
  return r;
}

const rows = [
  row(1, 'a.example', 'Emergency Plumber Austin', 'A 24 hour emergency plumber in Austin.'),
  row(2, 'b.example', 'Plumbing services', 'Plumbers for Austin homes.'),
  row(3, 'c.example', 'Water heaters', 'Repairs and installs.')
];
const figs = {
  [rows[0].url]: { page: { referringDomains: 400, rank: 40 }, domain: { rank: 60 }, whois: { age: '20y 6m' }, checklist: null },
  [rows[1].url]: { page: { referringDomains: 100, rank: 20 }, domain: { rank: 50 }, whois: { age: '5y' }, checklist: null },
  [rows[2].url]: { page: { referringDomains: 50, rank: 10 }, domain: null, whois: null, checklist: null }
};

describe('the results table', () => {
  const recs = T.records(rows, 'emergency plumber austin', (k) => figs[k], () => null);
  const col = (k) => T.COLUMNS.find((c) => c.key === k);

  it('counts the search\'s words in the title, the address and the description', () => {
    expect(T.queryTerms('best emergency plumber near austin')).toEqual(['emergency', 'plumber', 'austin']);
    expect(recs.map((r) => T.cellText(col('inTitle'), r))).toEqual(['3/3', '0/3', '0/3']);
    expect(recs.map((r) => T.cellText(col('inUrl'), r))).toEqual(['3/3', '0/3', '0/3']);
    expect(recs.map((r) => T.cellText(col('inDesc'), r))).toEqual(['3/3', '1/3', '0/3']);
  });

  it('marks each cell above or below the median of the results', () => {
    const base = T.baselines(recs, null);
    expect(base.pageRD).toBe(100);
    expect(recs.map((r) => T.mark(col('pageRD').value(r), base.pageRD))).toEqual(['above', 'same', 'below']);
    expect(T.mark(null, 100)).toBeNull();
  });

  it('or against the pinned page', () => {
    const pinRow = row(0, 'mine.example', 'My page', '');
    const pin = T.records([pinRow], 'x', () => ({ page: { referringDomains: 200 } }), () => null)[0];
    const base = T.baselines(recs, pin);
    expect(base.pageRD).toBe(200);
    expect(T.mark(col('pageRD').value(recs[0]), base.pageRD)).toBe('above');
  });

  it('reads domain age in years', () => {
    expect(T.ageYears('20y 6m')).toBe(20.5);
    expect(T.ageYears('5y')).toBe(5);
    expect(T.ageYears(null)).toBeNull();
  });

  it('sorts by a column, unknown values last either way', () => {
    expect(T.sortRecords(recs, 'siteRank', 'desc').map((r) => r.row.domain)).toEqual(['a.example', 'b.example', 'c.example']);
    expect(T.sortRecords(recs, 'siteRank', 'asc').map((r) => r.row.domain)).toEqual(['b.example', 'a.example', 'c.example']);
  });

  it('exports the chosen columns, named for their source, with the title and URL apart', () => {
    const csv = T.toCsv(recs, { type: false, date: false }, { query: '=cmd' });
    const [head, first] = csv.replace(/^﻿/, '').split('\r\n');
    expect(head.split(',').slice(0, 4)).toEqual(['Query', '#', 'On page', 'Title']);
    expect(head).toContain('Page ref. domains (DataForSEO)');
    expect(head).toContain('Domain age (RDAP)');
    expect(head).not.toContain('Type');
    expect(first.startsWith("'=cmd,")).toBe(true);
    expect(first).toContain('https://a.example/emergency-plumber-austin');
  });

  it('every figure column names DataForSEO or RDAP, and the checklist is never a ranking factor', () => {
    T.COLUMNS.filter((c) => /^(page|site)/.test(c.key)).forEach((c) => expect(c.source).toBe('DataForSEO'));
    expect(col('checklist').title).toMatch(/Not a ranking factor/);
  });
});
