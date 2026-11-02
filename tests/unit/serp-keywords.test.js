// Keyword data on Google (1.13.0, src/lib/serp-keywords.js): what is asked
// (the search first, its related searches and People also ask questions,
// 50 at most, as the routes take them), the market, the answer read back,
// "Add to my keywords"'s four answers, the words, the rank history and the
// exports.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const K = require('../../extension/src/lib/serp-keywords.js');
require('../../extension/src/lib/serp-figures.js');
require('../../extension/src/lib/serp.js');

const answer = (name) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/keyword-metrics', name + '.json'), 'utf8'));

describe('keywordOf: a shown search as it is sent', () => {
  it('lowercases and collapses spaces, and keeps its punctuation: the site reads it in its own lookup form and tracks it as sent', () => {
    expect(K.keywordOf('What is the best free CRM for nonprofits?')).toBe('what is the best free crm for nonprofits?');
    expect(K.keywordOf('What is the 33% rule for nonprofits?')).toBe('what is the 33% rule for nonprofits?');
    expect(K.keywordOf('  C#   Jobs ')).toBe('c# jobs');
    expect(K.keywordOf("Joe's B&B near St. Paul")).toBe("joe's b&b near st. paul");
    expect(K.keywordOf('Kaffee München')).toBe('kaffee münchen');
    expect(K.keywordOf('東京 ホテル')).toBe('東京 ホテル');
  });

  it('is empty for a search with an operator, an empty one, and one Google Ads refuses (80 characters, 10 words in lookup form)', () => {
    expect(K.keywordOf('site:example.com plumbing')).toBe('');
    expect(K.keywordOf('plumbing inurl:blog')).toBe('');
    expect(K.keywordOf('  ?? ')).toBe('');
    expect(K.keywordOf('one two three four five six seven eight nine ten?')).not.toBe('');
    expect(K.keywordOf('one two three four five six seven eight nine ten eleven')).toBe('');
    expect(K.keywordOf('a'.repeat(81))).toBe('');
  });
});

describe('lookupOf: the site\'s lookup form (website lookupForm)', () => {
  it('drops apostrophes, reads a question mark and other punctuation as a space, drops a full stop that ends a word', () => {
    expect(K.lookupOf('What’s the 33% rule for nonprofits?')).toBe('whats the 33 rule for nonprofits');
    expect(K.lookupOf("Joe's B&B near St. Paul")).toBe('joes b&b near st paul');
    expect(K.lookupOf('node.js hosting')).toBe('node.js hosting');
  });
});

describe('request: one request a results page', () => {
  it('puts the search first, then related searches, then People also ask, each once', () => {
    const r = K.request('Best CRM for nonprofits', ['Best crm for nonprofits reddit', 'best CRM for nonprofits'], ['What is the best free CRM for nonprofits?', 'Best crm for nonprofits reddit?']);
    // The question with a "?" and the related search without are one keyword.
    expect(r.keywords).toEqual(['best crm for nonprofits', 'best crm for nonprofits reddit', 'what is the best free crm for nonprofits?']);
    expect(r.items.map((i) => i.source)).toEqual(['search', 'related', 'paa']);
    expect(r.items[2].text).toBe('What is the best free CRM for nonprofits?');
    expect(r.search).toMatchObject({ text: 'Best CRM for nonprofits', keyword: 'best crm for nonprofits' });
  });

  it('asks for 50 keywords at most, the search among them', () => {
    const related = Array.from({ length: 60 }, (_, i) => `crm idea ${i}`);
    const r = K.request('crm', related, []);
    expect(r.keywords).toHaveLength(50);
    expect(r.keywords[0]).toBe('crm');
  });

  it('notes what is left out, and asks nothing for a search with an operator', () => {
    const r = K.request('crm', ['one two three four five six seven eight nine ten eleven'], []);
    expect(r.skipped).toEqual([{ text: 'one two three four five six seven eight nine ten eleven', source: 'related' }]);
    expect(K.request('site:example.com', ['x y'], []).search).toBeNull();
    expect(K.request('site:example.com', ['x y'], []).keywords).toEqual([]);
  });
});

describe('the market', () => {
  const loc = (search, hostname) => ({ search, hostname });
  const doc = (lang) => ({ documentElement: { getAttribute: () => lang } });

  it('reads gl= and hl= first, and keeps the language\'s region: the rank tracker files pt-BR and pt-PT apart', () => {
    expect(K.marketOf(loc('?q=x&gl=DE&hl=de-AT', 'www.google.com'), doc('en'))).toEqual({ gl: 'de', hl: 'de-AT' });
    expect(K.marketOf(loc('?q=x&hl=pt_br', 'www.google.com.br'), doc('pt'))).toEqual({ gl: 'br', hl: 'pt-BR' });
    expect(K.languageOf('es-419')).toBe('es-419');
    expect(K.languageOf('zh-tw')).toBe('zh-TW');
    expect(K.languageOf('not a language')).toBe('');
  });

  it('falls back to the Google\'s own country and the page\'s language; google.com names no country', () => {
    expect(K.marketOf(loc('?q=x', 'www.google.co.uk'), doc('en-GB'))).toEqual({ gl: 'gb', hl: 'en-GB' });
    expect(K.marketOf(loc('?q=x', 'www.google.com.au'), doc(''))).toEqual({ gl: 'au' });
    expect(K.marketOf(loc('?q=x', 'www.google.com'), doc('en'))).toEqual({ hl: 'en' });
    expect(K.countryOfHost('www.google.co.jp')).toBe('jp');
    expect(K.countryOfHost('www.google.de')).toBe('de');
  });

  it('keys the session cache by market', () => {
    expect(K.marketKey({ gl: 'gb', hl: 'en' })).toBe('gb|en');
    expect(K.marketKey({})).toBe('|');
  });
});

describe('the answer', () => {
  it('reads every keyword by the same normalization, figures checked; blank stays null', () => {
    const res = K.resultsByKeyword(answer('done'));
    expect(res['best crm for nonprofits']).toMatchObject({ volume: 2900, cpc: 18.42, competition: 0.82, difficulty: 47, fetchedAt: '2026-11-02T13:34:00.000Z' });
    expect(res['best crm for nonprofits'].trend).toHaveLength(12);
    expect(res['what is the 33% rule for nonprofits?'].volume).toBe(1000);
    expect(res['best crm for nonprofits in usa']).toEqual({ volume: null, cpc: null, competition: null, difficulty: null, trend: [], fetchedAt: null });
    expect(K.resultsByKeyword({ results: [{ keyword: 'What is SEO?', volume: '12' }] })['what is seo?'].volume).toBeNull();
  });

  it('takes competition as Google Ads\' level or a number', () => {
    expect(K.keywordFigures({ competition: 'medium' }).competition).toBe('MEDIUM');
    expect(K.keywordFigures({ competition: 0.4 }).competition).toBe(0.4);
    expect(K.keywordFigures({ competition: 'huge' }).competition).toBeNull();
  });

  it('reads the tracked search: its site bare, its history by date', () => {
    const t = K.trackedOf({ keyword: 'crm', trackerId: 't1', domain: 'WWW.Example.org', history: [{ date: '2026-11-01', position: 4 }, { date: '2026-10-05T00:00:00Z', position: 9 }, { date: 'soon', position: 1 }, { date: '2026-10-12', position: null }] });
    expect(t.domain).toBe('example.org');
    expect(t.history).toEqual([{ date: '2026-10-05', position: 9 }, { date: '2026-10-12', position: null }, { date: '2026-11-01', position: 4 }]);
    expect(K.trackedOf(null)).toBeNull();
    expect(K.isTrackedSite('blog.example.org', t)).toBe(true);
    expect(K.isTrackedSite('example.org.evil.example', t)).toBe(false);
  });

  it('reads the market DataForSEO answered for', () => {
    expect(K.marketAnswered(answer('done'))).toEqual({ locationCode: 2840, languageCode: 'en' });
    expect(K.marketAnswered({})).toBeNull();
  });

  it('reads the plan, the allowance and `lookups`, keyword data\'s unsupported_market among them', () => {
    expect(K.standing(answer('done'))).toEqual({ plan: 'free', allowance: { limit: 10, used: 4, remaining: 6 }, lookups: 'done' });
    expect(K.standing(answer('unsupported-market')).lookups).toBe('unsupported_market');
    expect(K.lookupNotice(K.standing(answer('unsupported-market')))).toMatchObject({ kind: 'unsupported_market', upgrade: false });
    expect(K.standing({ lookups: 'bogus' }).lookups).toBeNull();
  });

  it('says "this week" if the site counts keyword data by the week (allowance.period, still the owner\'s choice)', () => {
    const s = K.standing({ plan: 'free', allowance: { limit: 50, used: 50, remaining: 0, period: 'week' }, lookups: 'limit_reached' });
    expect(K.allowanceLine(s)).toBe('Free plan: 0 of 50 searches with new keyword data left this week (UTC).');
    expect(K.lookupNotice(s).text).toMatch(/^This week’s 50 searches with new keyword data are used/);
    expect(K.standing({ allowance: { limit: 10, used: 1, remaining: 9, period: 'day' } }).allowance).toEqual({ limit: 10, used: 1, remaining: 9 });
  });
});

describe('"Add to my keywords": the route\'s four answers', () => {
  it('201 added, 200 already tracked', () => {
    expect(K.addResult({ ok: true, status: 201, data: { trackerId: 't1', keyword: 'crm' }, code: 'ok' })).toEqual({ state: 'added', trackerId: 't1' });
    expect(K.addResult({ ok: true, status: 200, data: { alreadyTracked: true, trackerId: 't1' }, code: 'ok' })).toEqual({ state: 'already', trackerId: 't1' });
  });

  it('409 no_tracker, and 409 choose_tracker with the trackers to choose from', () => {
    expect(K.addResult({ ok: false, status: 409, code: 'conflict', data: { error: 'no_tracker' } })).toEqual({ state: 'no_tracker' });
    expect(K.addResult({ ok: false, status: 409, code: 'conflict', data: { error: 'choose_tracker', trackers: [{ id: 'a', domain: 'www.example.org', label: 'Main site' }, { id: 7, domain: 'shop.example.org' }, { id: null, domain: 'x.example' }] } }))
      .toEqual({ state: 'choose_tracker', trackers: [{ id: 'a', domain: 'example.org', label: 'Main site' }, { id: 7, domain: 'shop.example.org', label: null }] });
  });

  it('403 limit_reached is the plan\'s keyword limit, not the key\'s scope; 404 tracker_not_found is a tracker gone', () => {
    expect(K.addResult({ ok: false, status: 403, code: 'forbidden', data: { error: 'limit_reached', limit: 50, message: 'x' } })).toEqual({ state: 'tracker_full', limit: 50 });
    expect(K.addResult({ ok: false, status: 404, code: 'error', data: { error: 'tracker_not_found' } })).toEqual({ state: 'tracker_gone' });
  });

  it('anything else is an error with its code (403 Reconnect, offline)', () => {
    expect(K.addResult({ ok: false, status: 403, code: 'forbidden', data: null })).toEqual({ state: 'error', code: 'forbidden' });
    expect(K.addResult({ ok: false, status: 0, code: 'network', data: null })).toEqual({ state: 'error', code: 'network' });
    expect(K.addResult({ ok: false, status: 409, code: 'conflict', data: { error: 'choose_tracker', trackers: [] } })).toEqual({ state: 'error', code: 'conflict' });
  });
});

describe('words', () => {
  it('says each figure short, and "—" for none, never 0', () => {
    expect(K.volumeText(2900)).toBe('2.9K/mo');
    expect(K.volumeText(null)).toBe('—');
    expect(K.cpcText(18.42)).toBe('$18.42');
    expect(K.cpcText(0)).toBe('$0.00');
    expect(K.cpcText(null)).toBe('—');
    expect(K.competitionText('HIGH')).toBe('High');
    expect(K.competitionText(0.2)).toBe('Low (0.20)');
    expect(K.competitionText(82)).toBe('High (82)');
    expect(K.difficultyText(46.6)).toBe('47/100');
  });

  it('says the year\'s trend and every month in its title', () => {
    const tw = K.trendWords(K.resultsByKeyword(answer('done'))['best crm for nonprofits'].trend);
    expect(tw.text).toBe('▲ 30% over 12 months');
    expect(tw.title).toMatch(/^DataForSEO: searches a month, 2025-11 2,400, .*2026-10 3,120\.$/);
    expect(K.trendWords([]).text).toBe('');
  });

  it('draws a rank line with the best position at the top', () => {
    const d = K.sparkPath([9, 4], 60, 16, true);
    expect(d).toBe('M0.0,15.0L60.0,1.0');
    expect(K.sparkPath([5], 60, 16)).toBe('');
  });

  it('sums up the rank history, and names whose it is', () => {
    const s = K.historySummary(K.trackedOf(answer('tracked').tracked));
    expect(s.text).toBe('your tracker #4');
    expect(s.change).toBe('▲ 5 since 2026-10-05');
    expect(s.title).toMatch(/^Your rank tracker, example\.org: 2026-10-05 #9,.*From your own SEO Bandwagon account, not DataForSEO\.$/);
    expect(K.historySummary(K.trackedOf({ domain: 'a.example', history: [{ date: '2026-11-01', position: null }] })).text).toBe('your tracker not in the top 100');
  });

  it('the plan and the day\'s allowance; the limit offers the upgrade on Free only, paused never', () => {
    expect(K.allowanceLine({ plan: 'free', allowance: { limit: 20, used: 4, remaining: 16 } })).toBe('Free plan: 16 of 20 searches with new keyword data left today (UTC).');
    expect(K.lookupNotice({ plan: 'free', lookups: 'limit_reached', allowance: { limit: 20 } })).toMatchObject({ kind: 'limit_reached', upgrade: true });
    expect(K.lookupNotice({ plan: 'pro', lookups: 'limit_reached' })).toMatchObject({ upgrade: false });
    expect(K.lookupNotice({ plan: 'free', lookups: 'paused' })).toMatchObject({ kind: 'paused', upgrade: false });
    expect(K.lookupNotice({ lookups: 'done' })).toBeNull();
  });

  it('a 403 says Reconnect, offline says so, and nothing reads "Could not reach SEO Bandwagon"', () => {
    expect(K.errorWords('forbidden')).toMatchObject({ action: 'connect' });
    expect(K.errorWords('forbidden').text).toMatch(/^Reconnect/);
    expect(K.errorWords('network').text).toMatch(/^Offline/);
    expect(K.errorWords('no_key').text).toBe('Connect free to see keyword data');
    Object.values(K.ERROR_WORDS).forEach((w) => expect(w.text).not.toMatch(/Could not reach/));
  });
});

describe('exports', () => {
  const asked = K.request('best crm for nonprofits', ['Best crm for nonprofits reddit', 'Best crm for nonprofits in usa'], ['What is the best free CRM for nonprofits?']);
  const res = K.resultsByKeyword(answer('done'));
  const figuresOf = (k) => res[k] || null;

  it('a keywords CSV: one row a keyword, figures named for DataForSEO, blank where none', () => {
    const csv = K.keywordsToCsv(asked.items, figuresOf, { query: 'best crm for nonprofits', country: 'us', language: 'en', capturedAt: '2026-11-02T10:00:00Z' });
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Query,Keyword,Shown on Google as,Source,Search volume a month (DataForSEO),CPC USD (DataForSEO),Competition (DataForSEO),Keyword difficulty 0-100 (DataForSEO),Trend 12 months (DataForSEO),Country,Language,Captured');
    expect(lines[1]).toMatch(/^best crm for nonprofits,best crm for nonprofits,best crm for nonprofits,Search,2900,18\.42,0\.82,47,2025-11: 2400 \|/);
    expect(lines[3]).toBe('best crm for nonprofits,best crm for nonprofits in usa,Best crm for nonprofits in usa,Related search,,,,,,us,en,2026-11-02T10:00:00Z');
    expect(lines[4]).toMatch(/^best crm for nonprofits,what is the best free crm for nonprofits\?,What is the best free CRM for nonprofits\?,People also ask,90,11,0\.6,22,/);
  });

  it('guards a cell a spreadsheet would run as a formula', () => {
    const csv = K.keywordsToCsv([{ text: '=HYPERLINK("x")', keyword: 'hyperlink x', source: 'related' }], () => null, {});
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('the results exports\' page-level keyword columns', () => {
    const ctx = K.exportContext(asked.items, figuresOf);
    expect(ctx).toMatchObject({ keywordVolume: 2900, keywordCpc: 18.42, keywordCompetition: 0.82, keywordDifficulty: 47 });
    expect(ctx.relatedVolumes).toBe('Best crm for nonprofits reddit (170)');
    expect(ctx.paaVolumes).toBe('What is the best free CRM for nonprofits? (90)');
    expect(K.exportContext(asked.items, () => null)).toMatchObject({ keywordVolume: '', relatedVolumes: '' });
  });

  it('the results CSV carries those columns on every row, after every older column', () => {
    const S = globalThis.SBWSerp;
    const names = S.RESULT_CSV_COLUMNS.map((c) => c[0]);
    expect(names.slice(-8)).toEqual(['Search volume a month (DataForSEO)', 'CPC USD (DataForSEO)', 'Competition (DataForSEO)', 'Keyword difficulty 0-100 (DataForSEO)', 'Search trend 12 months (DataForSEO)', 'Related searches with volume (DataForSEO)', 'People also ask with volume (DataForSEO)', 'Your rank tracker position']);
    const csv = S.resultsToCsv([{ position: 1, url: 'https://example.org/', domain: 'example.org', trackedPosition: 4 }, { position: 2, url: 'https://b.example/', domain: 'b.example', trackedPosition: null }], Object.assign({ query: 'crm' }, K.exportContext(asked.items, figuresOf)));
    const rows = csv.replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(','));
    const at = (name) => names.indexOf(name);
    expect(rows[1][at('Search volume a month (DataForSEO)')]).toBe('2900');
    expect(rows[2][at('Search volume a month (DataForSEO)')]).toBe('2900');
    expect(rows[1][at('Your rank tracker position')]).toBe('4');
    expect(rows[2][at('Your rank tracker position')]).toBe('');
  });
});
