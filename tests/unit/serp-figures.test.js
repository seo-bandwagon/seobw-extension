// The figures under each Google result (1.11.0, src/lib/serp-figures.js):
// what is asked for, what a bar says, and the words for the plan, the
// allowance, the limit, the monthly pause and every error. The answers are
// the saved ones in tests/fixtures/serp-metrics, in the route's shape.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const F = require('../../extension/src/lib/serp-figures.js');
const Settings = require('../../extension/src/lib/serp-settings.js');

const answer = (name) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/serp-metrics', name + '.json'), 'utf8'));
const ALL = Object.fromEntries(Settings.FIGURES.map((f) => [f.key, true]));

function row(over) {
  const r = Object.assign({ position: 1, url: 'https://alpha.example/page-0', domain: 'alpha.example', title: 'A' }, over);
  Object.defineProperty(r, '_key', { value: r.url || 'k' + r.position, enumerable: false });
  return r;
}

describe('what is asked for', () => {
  it('asks for each result by its address and site, without the fragment Google links snippets with', () => {
    expect(F.requestItem(row({ url: 'https://www.alpha.example/a#:~:text=x', domain: 'alpha.example' })))
      .toEqual({ key: 'https://www.alpha.example/a#:~:text=x', url: 'https://www.alpha.example/a', domain: 'alpha.example' });
  });

  it('asks for a result Google hid from a signed-out user by its site only, and never resolves it', () => {
    expect(F.requestItem(row({ url: 'https://beta.example/', domain: 'beta.example', urlResolved: false })))
      .toMatchObject({ url: null, domain: 'beta.example' });
  });

  it('asks nothing for an unknown site, and once for a result seen twice', () => {
    const unknown = row({ url: '', domain: '', siteUnknown: true, position: 2 });
    const a = row({});
    expect(F.requestItems([a, unknown, a])).toHaveLength(1);
  });

  it('sends an address only when it is on the result\'s site', () => {
    expect(F.requestItem(row({ url: 'https://elsewhere.example/', domain: 'alpha.example' })).url).toBeNull();
    expect(F.requestItem(row({ url: 'https://blog.alpha.example/x', domain: 'alpha.example' })).url).toBe('https://blog.alpha.example/x');
  });

  it('never sends the search: Google\'s own results lose their query, other sites any parameter holding it', () => {
    const q = 'emergency plumber austin';
    expect(F.requestItem(row({ url: 'https://books.google.com/books?id=abc&dq=emergency+plumber+austin', domain: 'books.google.com' }), q).url)
      .toBe('https://books.google.com/books');
    expect(F.requestItem(row({ url: 'https://scholar.google.com/scholar?q=x', domain: 'scholar.google.com' }), q).url)
      .toBe('https://scholar.google.com/scholar');
    expect(F.requestItem(row({ url: 'https://alpha.example/search?s=Emergency+Plumber+Austin&page=2', domain: 'alpha.example' }), q).url)
      .toBe('https://alpha.example/search?page=2');
    expect(F.requestItem(row({ url: 'https://alpha.example/p?id=7', domain: 'alpha.example' }), q).url).toBe('https://alpha.example/p?id=7');
    const all = F.requestItems([row({ url: 'https://www.google.com/books/edition/X/abc?gbpv=1&dq=emergency+plumber+austin', domain: 'google.com' })], q);
    // What the worker posts is { url, domain }; the key stays in the browser.
    expect(JSON.stringify(all.map(({ url, domain }) => ({ url, domain })))).not.toMatch(/plumber/);
  });

  it('asks 10 results a call, the route\'s limit', () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ key: String(i) }));
    expect(F.batches(items, F.MAX_PER_CALL).map((b) => b.length)).toEqual([10, 10, 3]);
  });
});

describe('what a bar says', () => {
  const done = answer('done');

  it('labels the link and traffic figures DataForSEO\'s, with its 0 to 100 rank', () => {
    const items = F.barItems(F.resultFigures(done.results[0]), ALL, row({}));
    expect(items.page.map((i) => i.text)).toEqual(['412 ref. domains', '9.1K backlinks', 'rank 38', '2.3K visits/mo', '840 keywords']);
    expect(items.site.map((i) => i.text)).toEqual(['rank 61', '15.2K ref. domains', '482K visits/mo', '91K keywords']);
    [...items.page, ...items.site].forEach((i) => expect(i.title).toMatch(/^DataForSEO: /));
    expect(items.page.find((i) => i.key === 'pageRank').title).toMatch(/0 to 100 scale/);
    expect(items.page[0].title).toMatch(/As of 2026-11-01/);
  });

  it('shows domain age, with registrar, created and expiry on hover, from RDAP', () => {
    const { age } = F.barItems(F.resultFigures(done.results[0]), ALL, row({}));
    expect(age.text).toBe('age 28y 1m');
    expect(age.title).toBe('alpha.example: Registered 1998-09-15, registrar Example Registrar, Inc., expires 2028-09-14. From RDAP, the domain registries’ own record.');
  });

  it('calls the score the person\'s own on-page checklist, never a ranking factor', () => {
    const { checklist } = F.barItems(F.resultFigures(done.results[0]), ALL, row({}));
    expect(checklist.text).toBe('your checklist 92/100');
    expect(checklist.title).toMatch(/not a ranking factor/);
    expect(checklist.title).toMatch(/2026-10-28/);
    expect(JSON.stringify(F.barItems(F.resultFigures(done.results[0]), ALL, row({})))).not.toMatch(/authority|predicts? (where|your) rank/i);
  });

  it('signed out of Google: the site\'s figures, and "sign in to Google to see page figures"', () => {
    const hidden = row({ url: 'https://beta.example/', domain: 'beta.example', urlResolved: false });
    const items = F.barItems(F.resultFigures(done.results[1]), ALL, hidden);
    expect(items.page).toEqual([]);
    expect(items.site.map((i) => i.key)).toEqual(['siteRank', 'siteReferringDomains', 'siteTraffic', 'siteKeywords']);
    expect(items.notes).toEqual(['sign in to Google to see page figures']);
  });

  it('shows only the figures chosen in settings, and blank is never shown as zero', () => {
    const items = F.barItems(F.resultFigures(done.results[0]), Settings.defaults().figures, row({}));
    expect(items.page.map((i) => i.key)).toEqual(['pageReferringDomains', 'pageBacklinks', 'pageRank', 'pageTraffic']);
    expect(items.site.map((i) => i.key)).toEqual(['siteRank', 'siteReferringDomains']);
    const none = F.barItems(F.resultFigures({ page: { referringDomains: null }, domain: null }), ALL, row({}));
    expect(F.isEmpty(none)).toBe(true);
  });

  it('keeps nothing from an answer that is not the route\'s shape', () => {
    expect(F.resultFigures({ page: { rank: '99', backlinks: 5 }, whois: 'x', checklist: { score: 'high' } }))
      .toEqual({ page: { referringDomains: null, backlinks: 5, rank: null, etv: null, keywords: null, fetchedAt: null }, domain: null, whois: null, checklist: null });
  });

  it('writes counts short', () => {
    expect([0, 412, 999, 1000, 9134, 15200, 482000, 1203000, 3.4e9].map(F.compact))
      .toEqual(['0', '412', '999', '1K', '9.1K', '15.2K', '482K', '1.2M', '3.4B']);
    expect(F.compact(null)).toBe('');
  });
});

describe('the plan, the allowance, the limit and the monthly pause', () => {
  it('says the plan and what is left of today\'s allowance', () => {
    expect(F.allowanceLine(F.standing(answer('done')))).toBe('Free plan: 17 of 20 searches with new figures left today (UTC).');
  });

  it('says "this month (UTC)" when the site counts figures by the calendar month (Free: 20 a month, website change 337eaf4d)', () => {
    const s = F.standing(Object.assign(answer('done'), { allowance: { limit: 20, used: 4, remaining: 16, period: 'month' } }));
    expect(s.allowance).toEqual({ limit: 20, used: 4, remaining: 16, period: 'month' });
    expect(F.allowanceLine(s)).toBe('Free plan: 16 of 20 searches with new figures left this month (UTC).');
    const limit = F.standing(Object.assign(answer('limit-reached'), { allowance: { limit: 20, used: 20, remaining: 0, period: 'month' } }));
    expect(F.lookupNotice(limit)).toEqual({
      kind: 'limit_reached',
      text: 'This month’s 20 searches with new figures are used. Figures already looked up still show, and everything else works.',
      upgrade: true
    });
  });

  it('reads the day when the answer says "day", says no period (as before 2026-11-05) or one it does not know', () => {
    const pro = F.standing({ plan: 'pro', allowance: { limit: 250, used: 7, remaining: 243, period: 'day' }, lookups: 'done' });
    expect(pro.allowance).toEqual({ limit: 250, used: 7, remaining: 243, period: 'day' });
    expect(F.allowanceLine(pro)).toBe('Pro plan: 243 of 250 searches with new figures left today (UTC).');
    expect(F.standing(answer('done')).allowance).toEqual({ limit: 20, used: 3, remaining: 17, period: 'day' });
    expect(F.lookupNotice(F.standing(answer('limit-reached'))).text)
      .toBe('Today’s 20 searches with new figures are used. Figures already looked up still show, and everything else works.');
    ['year', 7, null].forEach((period) => {
      const s = F.standing({ plan: 'free', allowance: { limit: 20, used: 5, remaining: 15, period }, lookups: 'done' });
      expect(s.allowance.period).toBe('day');
      expect(F.allowanceLine(s)).toBe('Free plan: 15 of 20 searches with new figures left today (UTC).');
    });
  });

  it('at the limit: says so, keeps the cached figures, and links to upgrading', () => {
    const notice = F.lookupNotice(F.standing(answer('limit-reached')));
    expect(notice).toMatchObject({ kind: 'limit_reached', upgrade: true });
    expect(notice.text).toMatch(/20 searches with new figures are used/);
    expect(notice.text).toMatch(/everything else works/);
  });

  it('Pro at the limit is not offered an upgrade', () => {
    expect(F.lookupNotice({ plan: 'pro', lookups: 'limit_reached', allowance: { limit: 250 } }).upgrade).toBe(false);
  });

  it('paused at the monthly ceiling: says so for everyone, without an upgrade', () => {
    expect(F.lookupNotice(F.standing(answer('paused')))).toMatchObject({ kind: 'paused', upgrade: false });
  });

  it('keeps figures for the session only when the route got every figure it would', () => {
    expect(['done', 'not_needed'].every(F.keepable)).toBe(true);
    expect(['failed', 'limit_reached', 'paused', 'unavailable'].some(F.keepable)).toBe(false);
  });
});

describe('the words for every answer that is not figures', () => {
  it('a 403 (a key without the serp scope) says Reconnect, a 429 its own words', () => {
    expect(F.errorWords('forbidden')).toMatchObject({ action: 'connect' });
    expect(F.errorWords('forbidden').text).toMatch(/^Reconnect/);
    expect(F.errorWords('rate_limited').text).toMatch(/Too many figure requests/);
  });

  it('signed out of SEO Bandwagon: "Connect free to see figures"', () => {
    expect(F.errorWords('no_key')).toEqual({ text: 'Connect free to see figures', action: 'connect' });
  });

  it('never says "Could not reach SEO Bandwagon" for an answer it got', () => {
    ['forbidden', 'rate_limited', 'unauthorized', 'unavailable', 'network', 'error', 'no_key', 'needs_consent']
      .forEach((code) => expect(F.errorWords(code).text).not.toMatch(/could not reach/i));
    expect(F.errorWords('network').text).toMatch(/^Offline/);
  });
});

describe('1.12.0: addresses that aren\'t results', () => {
  it('an AI Overview source or a pinned page goes without the search or its fragment', () => {
    expect(F.cleanAddress('https://books.google.com/books?id=1&dq=emergency+plumber+austin#x', 'books.google.com', 'emergency plumber austin')).toBe('https://books.google.com/books');
    expect(F.cleanAddress('https://mine.example/page?s=emergency+plumber+austin', 'mine.example', 'emergency plumber austin')).toBe('https://mine.example/page');
    expect(F.cleanAddress('https://elsewhere.example/', 'mine.example', '')).toBeNull();
  });
});
