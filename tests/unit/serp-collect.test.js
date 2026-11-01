// Collecting Google result pages a person added, one click per page (#45).
import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/serp-collect.js');
const C = globalThis.SBWSerpCollect;

const row = (n, host = `r${n}.example`) => ({ position: n, url: `https://${host}/`, domain: host, title: `Result ${host}` });
const page = (start, hosts, context = {}) => ({ start, rows: hosts.map((h, i) => row(i + 1, h)), context });
const add = (c, p, now = 1) => C.addPage(c, p, now).collection;

describe('collectionKey', () => {
  it('is the same search for the same query, market and filter, whatever page', () => {
    expect(C.collectionKey('?q=Best+CRM&gl=us&hl=en&start=20')).toBe(C.collectionKey('?q=best%20crm&gl=US&hl=en'));
  });

  it('keeps Web-results-only pages and a different market apart', () => {
    const base = C.collectionKey('?q=crm&gl=us');
    expect(C.collectionKey('?q=crm&gl=us&udm=web')).not.toBe(base);
    expect(C.collectionKey('?q=crm&gl=gb')).not.toBe(base);
  });

  it('has no key without a query', () => {
    expect(C.collectionKey('?gl=us')).toBeNull();
  });
});

describe('combining pages', () => {
  it('gives exact absolute positions across pages, in page order whatever order they were added', () => {
    let c = C.emptyCollection('k');
    c = add(c, page(10, ['d', 'e', 'f']));
    c = add(c, page(0, ['a', 'b', 'c']));
    const { rows, summary } = C.combine(c);
    expect(rows.map(r => [r.domain, r.page, r.position, r.absoluteExact])).toEqual([
      ['a', 1, 1, 1], ['b', 1, 2, 2], ['c', 1, 3, 3],
      ['d', 2, 1, 4], ['e', 2, 2, 5], ['f', 2, 3, 6]
    ]);
    expect(summary.missing).toEqual([]);
    expect(summary.exact).toBe(6);
  });

  it('leaves out a URL repeated from an earlier page and counts it on its page', () => {
    let c = C.emptyCollection('k');
    c = add(c, page(0, ['a', 'b', 'c']));
    c = add(c, page(10, ['b', 'd', 'e']));
    const { rows, summary } = C.combine(c);
    expect(rows.map(r => r.domain)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(rows.find(r => r.domain === 'd').absoluteExact).toBe(4);
    expect(summary.repeats).toBe(1);
    expect(summary.pages.find(p => p.page === 2).repeats).toBe(1);
  });

  it('after a page that was not added, the exact position is blank and says why', () => {
    let c = C.emptyCollection('k');
    c = add(c, page(0, ['a', 'b']));
    c = add(c, page(20, ['x', 'y']));
    const { rows, summary } = C.combine(c);
    expect(summary.missing).toEqual([2]);
    expect(rows.find(r => r.domain === 'b').absoluteExact).toBe(2);
    expect(rows.find(r => r.domain === 'x').absoluteExact).toBe('');
    expect(rows.find(r => r.domain === 'x').notes).toMatch(/not added/);
    expect(C.describe(summary)).toMatch(/page 2 not added/);
  });

  it('a later page on its own has no exact positions', () => {
    const { rows } = C.combine(add(C.emptyCollection('k'), page(30, ['m'])));
    expect(rows[0].absoluteExact).toBe('');
  });

  it('each row carries its own page\'s context', () => {
    let c = add(C.emptyCollection('k'), page(0, ['a'], { capturedAt: 'T1', resultStats: 'About 1,000 results' }));
    c = add(c, page(10, ['b'], { capturedAt: 'T2' }));
    const { rows } = C.combine(c);
    expect(rows.map(r => r.capturedAt)).toEqual(['T1', 'T2']);
    expect(rows[0].resultStats).toBe('About 1,000 results');
  });

  it('does not change the stored collection', () => {
    const c = add(add(C.emptyCollection('k'), page(0, ['a', 'b'])), page(10, ['b', 'c']));
    const before = JSON.stringify(c);
    C.combine(c);
    expect(JSON.stringify(c)).toBe(before);
  });
});

describe('adding a page again (a second pass)', () => {
  it('replaces it and notes which results moved, from where', () => {
    let c = add(C.emptyCollection('k'), page(0, ['a', 'b', 'c']));
    const r = C.addPage(c, page(0, ['b', 'a', 'z']), 2);
    expect(r.added).toBe('replaced');
    expect(r.moved).toBe(3);
    const { rows, summary } = C.combine(r.collection);
    expect(rows.map(x => x.domain)).toEqual(['b', 'a', 'z']);
    expect(rows[0].notes).toBe('Was position 2 on this page before it was added again');
    expect(rows[2].notes).toBe('New on this page since it was last added');
    expect(summary.pages[0].times).toBe(2);
  });

  it('notes nothing for results that kept their place', () => {
    const c = add(C.emptyCollection('k'), page(0, ['a', 'b']));
    const r = C.addPage(c, page(0, ['a', 'b']));
    expect(r.moved).toBe(0);
    expect(C.combine(r.collection).rows.every(x => x.notes === '')).toBe(true);
  });
});

describe('limits', () => {
  it(`takes at most ${C.MAX_PAGES} pages, and a page already there can still be added again`, () => {
    let c = C.emptyCollection('k');
    for (let i = 0; i < C.MAX_PAGES; i++) c = add(c, page(i * 10, [`p${i}`]));
    expect(C.addPage(c, page(100, ['late'])).error).toBe('full');
    expect(C.addPage(c, page(0, ['p0'])).error).toBeUndefined();
  });

  it('refuses an empty page', () => {
    expect(C.addPage(C.emptyCollection('k'), page(0, [])).error).toBe('empty');
  });
});

describe('1.10.2: repeats matched on the result link, and absolute counts from earlier pages', () => {
  const siteOnly = (link, position) => ({ position, url: 'https://same-site.example/', domain: 'same-site.example', urlResolved: false, link });

  it('keeps two results from one site that are known only by their home address', () => {
    const { collection } = C.addPage(C.emptyCollection('k'), { start: 0, rows: [siteOnly('/goto?url=CAESone', 1), siteOnly('/goto?url=CAEStwo', 2)] });
    expect(C.combine(collection).rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it('still drops a known URL that repeats on a later page', () => {
    let c = C.addPage(C.emptyCollection('k'), { start: 0, rows: [{ position: 1, url: 'https://a.example/x', domain: 'a.example', link: 'https://a.example/x' }] }).collection;
    c = C.addPage(c, { start: 10, rows: [{ position: 1, url: 'https://a.example/x', domain: 'a.example', link: 'https://a.example/x' }] }).collection;
    expect(C.combine(c).summary.repeats).toBe(1);
  });

  it('keeps an unknown site, matched on its link', () => {
    const unknown = { position: 1, url: '', domain: '', siteUnknown: true, link: '/goto?url=CAESabc' };
    const { collection, error } = C.addPage(C.emptyCollection('k'), { start: 0, rows: [unknown] });
    expect(error).toBeUndefined();
    expect(C.combine(collection).rows).toHaveLength(1);
  });

  it('counts the organic results of the earlier pages, and 10 for a page not added', () => {
    const page = (start, n) => ({ start, rows: Array.from({ length: n }, (_, i) => ({ position: i + 1, url: `https://s${start}-${i}.example/`, domain: 'x' })) });
    let c = C.addPage(C.emptyCollection('k'), page(0, 7)).collection;
    c = C.addPage(c, page(10, 9)).collection;
    c = C.addPage(c, page(30, 8)).collection; // page 3 skipped
    const rows = C.combine(c).rows;
    const first = (pg) => rows.find((r) => r.page === pg);
    expect([first(1).absoluteApprox, first(2).absoluteApprox, first(4).absoluteApprox]).toEqual([1, 8, 7 + 9 + 10 + 1]);
    expect(C.earlierOrganic(c, 10)).toBe(7);
    expect(C.earlierOrganic(c, 20)).toBe(16);
    expect(C.earlierOrganic(C.emptyCollection('k'), 20)).toBe(20);
  });
});

describe('1.10.2: Google\'s Web filter is one filter, written udm=14 or udm=web', () => {
  it('puts pages of either into one collection, apart from all results', () => {
    expect(C.collectionKey('?q=crm&udm=14')).toBe(C.collectionKey('?q=crm&udm=web'));
    expect(C.collectionKey('?q=crm&udm=14')).not.toBe(C.collectionKey('?q=crm'));
  });
});
