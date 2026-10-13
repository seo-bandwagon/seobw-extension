// Unit tests for the SERP overlay's worker-side domain stats (#50):
// src/lib/serp-stats.js. Storage and quick-batch are fakes, except the last
// block, which runs the real SBW.quickBatch to prove a signed-out user's
// domains never leave the browser.

import { describe, it, expect, vi, beforeEach } from 'vitest';

await import('../../extension/src/lib/sync-state.js');
await import('../../extension/src/lib/api.js');
await import('../../extension/src/lib/serp-stats.js');
const { createSerpStats, statKey, CACHE_TTL_MS, MAX_DOMAINS } = globalThis.SBWSerpStats;

function fakeStorage() {
  const map = new Map();
  return {
    map,
    get: vi.fn(async (keys) => Object.fromEntries(keys.filter((k) => map.has(k)).map((k) => [k, map.get(k)]))),
    set: vi.fn(async (obj) => { Object.entries(obj).forEach(([k, v]) => map.set(k, v)); })
  };
}

const okBatch = (stat) => vi.fn(async (domains) => ({
  ok: true, status: 200, code: 'ok',
  data: { results: Object.fromEntries(domains.filter((d) => d !== 'nodata.example').map((d) => [d, stat])), invalid: [] }
}));

describe('serp stats lookup (#50)', () => {
  let t;
  const now = () => t;
  beforeEach(() => { t = 1_000_000; });

  it('fetches what it has not seen and caches each domain, null included', async () => {
    const storage = fakeStorage();
    const quickBatch = okBatch({ avgScore: 70 });
    const stats = createSerpStats({ quickBatch, storage, now });
    const res = await stats.lookup(['a.example', 'nodata.example']);
    expect(res).toMatchObject({ ok: true, data: { results: { 'a.example': { avgScore: 70 }, 'nodata.example': null } } });
    expect(quickBatch).toHaveBeenCalledWith(['a.example', 'nodata.example']);
    expect(storage.map.get(statKey('a.example'))).toEqual({ at: t, stat: { avgScore: 70 } });
    expect(storage.map.get(statKey('nodata.example'))).toEqual({ at: t, stat: null });
  });

  it('answers from the cache for 10 minutes, then asks again', async () => {
    const storage = fakeStorage();
    const quickBatch = okBatch({ avgScore: 70 });
    const stats = createSerpStats({ quickBatch, storage, now });
    await stats.lookup(['a.example']);
    t += CACHE_TTL_MS - 1;
    expect((await stats.lookup(['a.example'])).data.results['a.example']).toEqual({ avgScore: 70 });
    expect(quickBatch).toHaveBeenCalledTimes(1);
    t += 2;
    await stats.lookup(['a.example']);
    expect(quickBatch).toHaveBeenCalledTimes(2);
  });

  it('asks only for the domains missing from the cache', async () => {
    const storage = fakeStorage();
    const quickBatch = okBatch({ avgScore: 50 });
    const stats = createSerpStats({ quickBatch, storage, now });
    await stats.lookup(['a.example']);
    const res = await stats.lookup(['a.example', 'b.example']);
    expect(quickBatch).toHaveBeenLastCalledWith(['b.example']);
    expect(Object.keys(res.data.results).sort()).toEqual(['a.example', 'b.example']);
  });

  it('passes a failed reply through and caches nothing', async () => {
    const storage = fakeStorage();
    const quickBatch = vi.fn(async () => ({ ok: false, status: 0, data: null, code: 'no_key' }));
    const stats = createSerpStats({ quickBatch, storage, now });
    expect(await stats.lookup(['a.example'])).toMatchObject({ ok: false, code: 'no_key' });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('only ever sends bare hostnames, deduped and capped', async () => {
    const quickBatch = okBatch({});
    const stats = createSerpStats({ quickBatch, storage: fakeStorage(), now });
    const many = Array.from({ length: MAX_DOMAINS + 5 }, (_, i) => `d${i}.example`);
    await stats.lookup([
      'A.Example', 'a.example', 'https://evil.example/path', 'plumbers near austin', '', null, ...many
    ]);
    const sent = quickBatch.mock.calls[0][0];
    expect(sent[0]).toBe('a.example');
    expect(sent).toHaveLength(MAX_DOMAINS);
    sent.forEach((d) => expect(d).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/));
  });

  it('still answers when session storage fails', async () => {
    const storage = { get: vi.fn(async () => { throw new Error('quota'); }), set: vi.fn(async () => { throw new Error('quota'); }) };
    const stats = createSerpStats({ quickBatch: okBatch({ avgScore: 1 }), storage, now });
    expect((await stats.lookup(['a.example'])).ok).toBe(true);
  });
});

describe('a signed-out user sends nothing (#50, docs/CWS-LISTING.md §5)', () => {
  function chromeWithKey(apiKey) {
    return {
      storage: {
        sync: { get: vi.fn((defaults, cb) => cb({ apiKey, apiUrl: 'https://seobandwagon.com/api' })) },
        // sbwFetch records the key's status here after a successful call
        local: { set: vi.fn((items, cb) => { if (cb) cb(); return Promise.resolve(); }) }
      },
      runtime: { getManifest: () => ({ version: '1.7.7' }) }
    };
  }

  it('with no API key, no request goes out and the overlay gets no_key', async () => {
    globalThis.chrome = chromeWithKey('');
    globalThis.fetch = vi.fn();
    const stats = createSerpStats({ quickBatch: (d) => globalThis.SBW.quickBatch(d), storage: fakeStorage() });
    expect(await stats.lookup(['a.example', 'b.example'])).toMatchObject({ ok: false, code: 'no_key' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('with a key, the bare domains go to /domain/quick-batch', async () => {
    globalThis.chrome = chromeWithKey('sbw_test');
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: { 'a.example': { avgScore: 9 } }, invalid: [] }), headers: { get: () => null } }));
    const stats = createSerpStats({ quickBatch: (d) => globalThis.SBW.quickBatch(d), storage: fakeStorage() });
    const res = await stats.lookup(['a.example']);
    expect(res.data.results['a.example']).toEqual({ avgScore: 9 });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/domain\/quick-batch$/);
    expect(JSON.parse(init.body)).toEqual({ domains: ['a.example'] });
  });
});
