// The worker's side of keyword data (1.13.0, src/lib/serp-keywords-service.js),
// with both routes stubbed: keyword data, the session cache (paid or not),
// a 403, the allowance reached, paused, a 429, offline, the tracked
// search's history, and each answer of "Add to my keywords". What matters
// most: the search leaves the browser only with a key and the person's yes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const K = require('../../extension/src/lib/serp-keywords.js');
const F = require('../../extension/src/lib/serp-figures.js');
const { createSerpKeywordsService, HOLD_KEY, STATUS_KEY } = require('../../extension/src/lib/serp-keywords-service.js');

const answer = (name) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/keyword-metrics', name + '.json'), 'utf8'));
const okRes = (data, status = 200) => ({ ok: true, status, data, retryAfter: null, code: 'ok' });

const REQ = {
  query: 'best crm for nonprofits',
  related: ['Best crm for nonprofits reddit', 'Best CRM for small nonprofits'],
  paa: ['What is the best free CRM for nonprofits?'],
  gl: 'us',
  hl: 'en'
};

function sessionStorage() {
  const data = {};
  return {
    data,
    get: vi.fn(async (keys) => {
      if (keys === null) return Object.assign({}, data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    }),
    set: vi.fn(async (obj) => { Object.assign(data, obj); }),
    remove: vi.fn(async (keys) => { [].concat(keys).forEach((k) => delete data[k]); })
  };
}

let storage, post, add, hasKey, consent, now, svc;

beforeEach(() => {
  storage = sessionStorage();
  post = vi.fn(async () => okRes(answer('done')));
  add = vi.fn(async () => okRes({ trackerId: 't1', keyword: 'best crm for nonprofits' }, 201));
  hasKey = vi.fn(async () => true);
  consent = vi.fn(async () => ({ ok: true }));
  now = 1_700_000_000_000;
  svc = createSerpKeywordsService({ keywords: K, figures: F, hasKey, consent, post, add, storage, now: () => now });
});

describe('the search leaves the browser only with a key and the person\'s yes', () => {
  it('without a key: "no_key", and no request', async () => {
    hasKey.mockResolvedValue(false);
    expect(await svc.lookup(REQ)).toEqual({ state: 'no_key' });
    expect(await svc.add({ keyword: 'crm' })).toEqual({ state: 'no_key' });
    expect(post).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('without the yes: "needs_consent", asked of the keywordData flow, and no request', async () => {
    consent.mockResolvedValue({ ok: false, reason: 'not_accepted' });
    expect(await svc.lookup(REQ)).toEqual({ state: 'needs_consent', reason: 'not_accepted' });
    expect(await svc.add({ keyword: 'crm' })).toEqual({ state: 'needs_consent', reason: 'not_accepted' });
    expect(consent).toHaveBeenCalledWith('keywordData', { hasKey: true });
    expect(post).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('a search with an operator asks nothing, not even the consent', async () => {
    expect(await svc.lookup(Object.assign({}, REQ, { query: 'site:example.com crm' }))).toEqual({ state: 'not_a_keyword' });
    expect(consent).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('says whether it could ask, without asking', async () => {
    consent.mockResolvedValue({ ok: false, reason: 'not_accepted' });
    expect(await svc.ready()).toEqual({ hasKey: true, accepted: false, reason: 'not_accepted' });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('one request a search', () => {
  it('sends the search first, then its related searches and questions, normalized, with the market', async () => {
    const out = await svc.lookup(REQ);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual({
      keywords: ['best crm for nonprofits', 'best crm for nonprofits reddit', 'best crm for small nonprofits', 'what is the best free crm for nonprofits'],
      gl: 'us',
      hl: 'en'
    });
    expect(out.state).toBe('ok');
    expect(out.results['best crm for nonprofits']).toMatchObject({ volume: 2900, difficulty: 47 });
    expect(out.results['what is the best free crm for nonprofits'].volume).toBe(90);
    expect(out).toMatchObject({ plan: 'free', allowance: { limit: 20, used: 4, remaining: 16 }, lookups: 'done', notice: null, tracked: null });
    expect(out.market).toEqual({ locationCode: 2840, languageCode: 'en' });
    expect(storage.data[STATUS_KEY]).toMatchObject({ plan: 'free', lookups: 'done' });
  });

  it('drops a market that isn\'t two letters', async () => {
    await svc.lookup(Object.assign({}, REQ, { gl: 'USA', hl: '<b>' }));
    expect(post.mock.calls[0][0]).not.toHaveProperty('gl');
    expect(post.mock.calls[0][0]).not.toHaveProperty('hl');
  });

  it('the same search again this session sends nothing', async () => {
    await svc.lookup(REQ);
    const again = await svc.lookup(REQ);
    expect(post).toHaveBeenCalledTimes(1);
    expect(again.state).toBe('ok');
    expect(again.results['best crm for nonprofits reddit'].volume).toBe(170);
    expect(again.allowance).toEqual({ limit: 20, used: 4, remaining: 16 });
  });

  it('a new question asks for it alone, with the search first as the route reads it', async () => {
    await svc.lookup(REQ);
    await svc.lookup(Object.assign({}, REQ, { paa: REQ.paa.concat('Is Salesforce free for nonprofits?') }));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].keywords).toEqual(['best crm for nonprofits', 'is salesforce free for nonprofits']);
  });

  it('a market keeps its own figures: the same search on google.co.uk is asked again', async () => {
    await svc.lookup(REQ);
    await svc.lookup(Object.assign({}, REQ, { gl: 'gb' }));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('figures from the site\'s cache are kept too ("not_needed")', async () => {
    post.mockResolvedValue(okRes(answer('cached')));
    await svc.lookup(REQ);
    await svc.lookup(REQ);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('the allowance, the ceiling and the refusals', () => {
  it('the allowance reached: says so, offers the upgrade, keeps nothing so the next search asks again', async () => {
    post.mockResolvedValue(okRes(answer('limit-reached')));
    const out = await svc.lookup(REQ);
    expect(out.lookups).toBe('limit_reached');
    expect(out.notice).toMatchObject({ kind: 'limit_reached', upgrade: true });
    expect(out.results['best crm for nonprofits'].volume).toBe(2900);
    await svc.lookup(REQ);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('paused at the monthly ceiling: says so, no upgrade', async () => {
    post.mockResolvedValue(okRes(answer('paused')));
    const out = await svc.lookup(REQ);
    expect(out.notice).toMatchObject({ kind: 'paused', upgrade: false });
    expect(out.results).toEqual({});
  });

  it('a key without the keywords scope (403): "forbidden", for Reconnect', async () => {
    post.mockResolvedValue({ ok: false, status: 403, data: { error: 'insufficient_scope', required: 'keywords' }, code: 'forbidden' });
    expect(await svc.lookup(REQ)).toMatchObject({ state: 'error', code: 'forbidden', results: {} });
  });

  it('a 429 holds every request until its Retry-After', async () => {
    post.mockResolvedValue({ ok: false, status: 429, data: null, retryAfter: 40, code: 'rate_limited' });
    expect(await svc.lookup(REQ)).toMatchObject({ state: 'error', code: 'rate_limited', retryAfter: 40 });
    expect(storage.data[HOLD_KEY]).toBe(now + 40_000);
    now += 10_000;
    expect(await svc.lookup(REQ)).toMatchObject({ state: 'error', code: 'rate_limited', retryAfter: 30 });
    expect(post).toHaveBeenCalledTimes(1);
    now += 31_000;
    post.mockResolvedValue(okRes(answer('done')));
    expect((await svc.lookup(REQ)).state).toBe('ok');
  });

  it('offline: "network", with what the session already had', async () => {
    await svc.lookup(REQ);
    post.mockResolvedValue({ ok: false, status: 0, data: null, code: 'network' });
    const out = await svc.lookup(Object.assign({}, REQ, { related: ['zoho crm for nonprofits'] }));
    expect(out).toMatchObject({ state: 'error', code: 'network' });
    expect(out.results['best crm for nonprofits'].volume).toBe(2900);
  });
});

describe('the tracked search', () => {
  it('comes with the answer, and is kept for the session', async () => {
    post.mockResolvedValue(okRes(answer('tracked')));
    const out = await svc.lookup(REQ);
    expect(out.tracked).toMatchObject({ domain: 'example.org', trackerId: 'trk_example_1' });
    expect(out.tracked.history.map((h) => h.position)).toEqual([9, 8, 6, 5, 4]);
    const again = await svc.lookup(REQ);
    expect(post).toHaveBeenCalledTimes(1);
    expect(again.tracked.domain).toBe('example.org');
  });
});

describe('"Add to my keywords"', () => {
  it('sends the keyword normalized, with the market', async () => {
    expect(await svc.add({ keyword: 'What is the best free CRM for nonprofits?', gl: 'us', hl: 'en' })).toEqual({ state: 'added', trackerId: 't1' });
    expect(add).toHaveBeenCalledWith({ keyword: 'what is the best free crm for nonprofits', gl: 'us', hl: 'en' });
  });

  it('with a chosen tracker, sends its id', async () => {
    await svc.add({ keyword: 'crm', trackerId: 'trk_2' });
    expect(add).toHaveBeenCalledWith({ keyword: 'crm', trackerId: 'trk_2' });
  });

  it('already tracked, no tracker, which tracker', async () => {
    add.mockResolvedValueOnce(okRes({ alreadyTracked: true, trackerId: 't1' }));
    expect(await svc.add({ keyword: 'crm' })).toEqual({ state: 'already', trackerId: 't1' });
    add.mockResolvedValueOnce({ ok: false, status: 409, code: 'conflict', data: { error: 'no_tracker' } });
    expect(await svc.add({ keyword: 'crm' })).toEqual({ state: 'no_tracker' });
    add.mockResolvedValueOnce({ ok: false, status: 409, code: 'conflict', data: { error: 'choose_tracker', trackers: [{ id: 'a', domain: 'example.org' }, { id: 'b', domain: 'example.net' }] } });
    expect(await svc.add({ keyword: 'crm' })).toEqual({ state: 'choose_tracker', trackers: [{ id: 'a', domain: 'example.org' }, { id: 'b', domain: 'example.net' }] });
  });

  it('a 403 is "forbidden" (Reconnect); a too-long keyword is never sent', async () => {
    add.mockResolvedValueOnce({ ok: false, status: 403, code: 'forbidden', data: null });
    expect(await svc.add({ keyword: 'crm' })).toEqual({ state: 'error', code: 'forbidden' });
    expect(await svc.add({ keyword: 'a b c d e f g h i j k' })).toEqual({ state: 'not_a_keyword' });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('once added, the search\'s rank history is asked again, not read from the session', async () => {
    await svc.lookup(REQ);
    await svc.add({ keyword: 'best crm for nonprofits', gl: 'us', hl: 'en' });
    await svc.lookup(REQ);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].keywords).toEqual(['best crm for nonprofits']);
  });
});
