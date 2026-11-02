// The worker's side of the figures (1.11.0, src/lib/serp-figures-service.js),
// with the route stubbed: figures, a cache miss, a 403, the allowance
// reached, paused at the ceiling and offline. What matters most: nothing
// is sent without a key and the figures accepted, and the session keeps
// what it was given so a second look sends nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const F = require('../../extension/src/lib/serp-figures.js');
const { createSerpFiguresService, HOLD_KEY, STATUS_KEY } = require('../../extension/src/lib/serp-figures-service.js');

const answer = (name) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/serp-metrics', name + '.json'), 'utf8'));

const ITEMS = [
  { key: 'a', url: 'https://alpha.example/page-0', domain: 'alpha.example' },
  { key: 'b', url: null, domain: 'beta.example' }
];

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

let storage, post, hasKey, consent, now, svc;

beforeEach(() => {
  storage = sessionStorage();
  post = vi.fn(async () => ({ ok: true, status: 200, data: answer('done'), code: 'ok' }));
  hasKey = vi.fn(async () => true);
  consent = vi.fn(async () => ({ ok: true }));
  now = 1_700_000_000_000;
  svc = createSerpFiguresService({ figures: F, hasKey, consent, post, storage, now: () => now });
});

describe('nothing is sent without a key and the figures accepted', () => {
  it('without a key: "no_key", and no request', async () => {
    hasKey.mockResolvedValue(false);
    expect(await svc.lookup(ITEMS)).toEqual({ state: 'no_key' });
    expect(post).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
  });

  it('with a key but the figures not accepted: "needs_consent", and no request', async () => {
    consent.mockResolvedValue({ ok: false, reason: 'not_accepted' });
    expect(await svc.lookup(ITEMS)).toEqual({ state: 'needs_consent', reason: 'not_accepted' });
    expect(consent).toHaveBeenCalledWith('serpFigures', { hasKey: true });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('figures', () => {
  it('a cache miss: one call with each result\'s address and site, nothing else', async () => {
    const res = await svc.lookup(ITEMS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith([{ url: 'https://alpha.example/page-0', domain: 'alpha.example' }, { url: null, domain: 'beta.example' }]);
    expect(res).toMatchObject({ state: 'ok', plan: 'free', allowance: { limit: 20, used: 3, remaining: 17 }, lookups: 'done', notice: null });
    expect(res.results.a.page.referringDomains).toBe(412);
    expect(res.results.b.page).toBeNull();
    expect(res.results.b.domain.rank).toBe(44);
    expect(storage.data[STATUS_KEY]).toMatchObject({ plan: 'free', lookups: 'done' });
  });

  it('the same results again this session: answered from the session, no request', async () => {
    await svc.lookup(ITEMS);
    const again = await svc.lookup(ITEMS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(again.state).toBe('ok');
    expect(again.results.a.page.rank).toBe(38);
    expect(again.allowance).toEqual({ limit: 20, used: 3, remaining: 17 });
  });

  it('asks 10 results a call', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, url: null, domain: `s${i}.example` }));
    post.mockImplementation(async (batch) => ({ ok: true, data: Object.assign(answer('done'), { results: batch.map(() => ({})) }) }));
    await svc.lookup(many);
    expect(post.mock.calls.map((c) => c[0].length)).toEqual([10, 2]);
  });

  it('the allowance reached: cached figures and the notice, and nothing kept for the session', async () => {
    post.mockResolvedValue({ ok: true, data: answer('limit-reached') });
    const res = await svc.lookup(ITEMS);
    expect(res).toMatchObject({ state: 'ok', lookups: 'limit_reached', notice: { kind: 'limit_reached', upgrade: true } });
    expect(res.results.b.domain.rank).toBe(44);
    await svc.lookup(ITEMS);
    expect(post).toHaveBeenCalledTimes(2); // asked again: the limit may have reset
  });

  it('paused at the monthly ceiling: the notice, without an upgrade', async () => {
    post.mockResolvedValue({ ok: true, data: answer('paused') });
    expect(await svc.lookup(ITEMS)).toMatchObject({ lookups: 'paused', notice: { kind: 'paused', upgrade: false } });
  });
});

describe('answers that are not figures', () => {
  it('a 403 (a key without the serp scope) is "forbidden"', async () => {
    post.mockResolvedValue({ ok: false, status: 403, code: 'forbidden', data: { error: 'insufficient_scope', required: 'serp' } });
    expect(await svc.lookup(ITEMS)).toMatchObject({ state: 'error', code: 'forbidden' });
  });

  it('offline is "network"', async () => {
    post.mockResolvedValue({ ok: false, status: 0, code: 'network', data: null });
    expect(await svc.lookup(ITEMS)).toMatchObject({ state: 'error', code: 'network' });
  });

  it('a 429 holds every request until Retry-After has passed', async () => {
    post.mockResolvedValueOnce({ ok: false, status: 429, code: 'rate_limited', retryAfter: 30 });
    expect(await svc.lookup(ITEMS)).toMatchObject({ state: 'error', code: 'rate_limited' });
    expect(storage.data[HOLD_KEY]).toBe(now + 30_000);
    now += 10_000;
    expect(await svc.lookup(ITEMS)).toMatchObject({ state: 'error', code: 'rate_limited', retryAfter: 20 });
    expect(post).toHaveBeenCalledTimes(1);
    now += 21_000;
    expect((await svc.lookup(ITEMS)).state).toBe('ok');
    expect(post).toHaveBeenCalledTimes(2);
  });
});
