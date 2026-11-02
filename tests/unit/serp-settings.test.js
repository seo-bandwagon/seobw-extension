// The Google results settings (1.11.0, src/lib/serp-settings.js): their
// defaults, what a stored record can hold, your own sites, and saving.

import { describe, it, expect, vi } from 'vitest';

const S = require('../../extension/src/lib/serp-settings.js');

describe('defaults', () => {
  it('overlay on, figures on and loaded with the page, the panel below the results, Match Google', () => {
    expect(S.defaults()).toMatchObject({ overlay: true, figuresOn: true, load: 'auto', placement: 'bottom', look: 'google', collapsed: false, ownSites: [] });
  });

  it('shows the figures the study supports and fits one line: keywords and site traffic start off', () => {
    const on = Object.entries(S.defaults().figures).filter(([, v]) => v).map(([k]) => k);
    expect(on).toEqual(['pageReferringDomains', 'pageBacklinks', 'pageRank', 'pageTraffic', 'siteRank', 'siteReferringDomains', 'domainAge', 'checklist']);
  });
});

describe('what storage can hold', () => {
  it('keeps known values and drops the rest', () => {
    const s = S.normalize({ overlay: 'yes', placement: 'left', look: 'dark', load: 'click', figures: { pageRank: false, bogus: true }, ownSites: 'x' });
    expect(s).toMatchObject({ overlay: true, placement: 'bottom', look: 'dark', load: 'click', ownSites: [] });
    expect(s.figures.pageRank).toBe(false);
    expect('bogus' in s.figures).toBe(false);
  });
});

describe('your own sites', () => {
  it('reads one site a line, as typed, into bare hosts', () => {
    expect(S.parseSiteList('https://www.Example.com/blog\nshop.example.org, not a site\n\nexample.com')).toEqual(['example.com', 'shop.example.org']);
  });

  it('marks a result on the site or under it, never one that only ends the same', () => {
    const sites = ['example.com'];
    expect(S.isOwnSite('example.com', sites)).toBe(true);
    expect(S.isOwnSite('blog.example.com', sites)).toBe(true);
    expect(S.isOwnSite('www.example.com', sites)).toBe(true);
    expect(S.isOwnSite('myexample.com', sites)).toBe(false);
    expect(S.isOwnSite('', sites)).toBe(false);
  });

  it('keeps at most 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => `site${i}.example`);
    expect(S.parseSiteList(many.join('\n'))).toHaveLength(S.MAX_OWN_SITES);
  });
});

describe('saving', () => {
  it('merges a change into what is stored, figure by figure', async () => {
    const data = {};
    const area = { get: vi.fn(async (k) => ({ [k]: data[k] })), set: vi.fn(async (o) => Object.assign(data, o)) };
    await S.save({ placement: 'top', figures: { pageKeywords: true } }, area);
    const next = await S.save({ figures: { pageRank: false } }, area);
    expect(next).toMatchObject({ placement: 'top' });
    expect(next.figures).toMatchObject({ pageKeywords: true, pageRank: false, pageReferringDomains: true });
  });
});
