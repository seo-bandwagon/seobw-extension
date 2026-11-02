// The API client's 1.11.0 parts (src/lib/api.js): the figures call, and the
// capture send asking the consent module first (src/lib/consent.js), loaded
// before api.js as every page and the worker load them.

import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../extension/src/lib/sync-state.js');
await import('../../extension/src/lib/consent.js');
await import('../../extension/src/lib/api.js');
const SBW = globalThis.SBW;

function chromeWith({ apiKey = 'sbw_test', local = {} } = {}) {
  globalThis.chrome = {
    storage: {
      sync: { get: vi.fn((defaults, cb) => cb({ apiKey, apiUrl: 'https://seobandwagon.com/api' })) },
      local: {
        get: vi.fn(async (k) => (typeof k === 'string' ? { [k]: local[k] } : Object.assign({}, local))),
        set: vi.fn(async (o) => { Object.assign(local, o); }),
        remove: vi.fn(async () => {})
      }
    },
    runtime: { getManifest: () => ({ version: '1.11.0' }) }
  };
  return local;
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ok({}));
});

describe('SBW.serpMetrics', () => {
  it('posts up to 10 results to /v1/serp/metrics with the key', async () => {
    chromeWith({ local: { sbwKeyStatus: 'valid' } });
    const results = [{ url: 'https://a.example/', domain: 'a.example' }, { url: null, domain: 'b.example' }];
    await SBW.serpMetrics(results);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://seobandwagon.com/api/v1/serp/metrics');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sbw_test');
    expect(JSON.parse(init.body)).toEqual({ results });
  });

  it('sends nothing without a key', async () => {
    chromeWith({ apiKey: '' });
    expect(await SBW.serpMetrics([{ url: null, domain: 'a.example' }])).toMatchObject({ code: 'no_key' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a key without the serp scope answers 403: "forbidden"', async () => {
    chromeWith();
    globalThis.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'insufficient_scope', required: 'serp' }), headers: { get: () => null } });
    expect(await SBW.serpMetrics([{ url: null, domain: 'a.example' }])).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('every send asks the consent module', () => {
  it('a saved analysis goes through captureSync: the switch off sends nothing', async () => {
    chromeWith({ local: { dataCollection: false, capture_1: { url: 'https://a.example/' } } });
    const spy = vi.spyOn(globalThis.SBWConsent, 'check');
    expect(await SBW.syncCapture('capture_1')).toMatchObject({ code: 'collection_off' });
    expect(spy).toHaveBeenCalledWith('captureSync', { hasKey: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('with the switch on and a key, the analysis is sent as before', async () => {
    chromeWith({ local: { capture_1: { url: 'https://a.example/' } } });
    globalThis.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'r1' }), headers: { get: () => null } });
    expect(await SBW.syncCapture('capture_1')).toMatchObject({ status: 'synced' });
  });

  it('a new account clears the figures kept this session with the other account caches', async () => {
    chromeWith();
    const session = { serpFiguresStatus: {}, 'serpFig:page:https://a.example/': {}, 'dh:x': {}, other: 1 };
    globalThis.chrome.storage.session = {
      get: vi.fn(async () => Object.assign({}, session)),
      remove: vi.fn(async (keys) => keys.forEach((k) => delete session[k]))
    };
    await SBW.clearAccountCaches();
    expect(Object.keys(session)).toEqual(['other']);
  });
});
