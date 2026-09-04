// Unit tests for the unified SEO Bandwagon API client (src/lib/api.js).
// Covers: apiUrl normalization, auth headers, sbwFetch status→code mapping,
// timeout/network handling, the SBW.* wrapper surface (captures, domain,
// link-building, citations), and the capture-sync additions (Task 2).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// sync-state.js must load before api.js, same as service-worker.js's
// importScripts order and history.html/popup.html's <script> order — api.js
// reads SBWSync off the global scope.
await import('../../src/lib/sync-state.js');
// The module attaches itself to `globalThis.SBW` (classic-script / dual-export
// pattern — see lib/content-analysis.js) rather than relying on the ESM
// default export, so tests read it off globalThis after importing.
await import('../../src/lib/api.js');
const SBW = globalThis.SBW;

function mockResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name) => (name in headers ? headers[name] : null) }
  };
}

// `localStore` gives the local.get/set/remove stub real persistence across
// calls within a test — needed for the capture-sync tests, which read back
// what an earlier call wrote. Existing callers that don't pass it keep
// seeing an always-empty store, matching the old stub's behavior.
function mockChrome({ apiKey = '', apiUrl = 'https://seobandwagon.com/api', localStore = {} } = {}) {
  const store = localStore;
  return {
    storage: {
      sync: {
        get: vi.fn((defaults, cb) => cb({ apiKey, apiUrl })),
        set: vi.fn((items, cb) => cb && cb())
      },
      local: {
        get: vi.fn((keys, cb) => {
          let result = {};
          if (keys === null || keys === undefined) {
            result = Object.assign({}, store);
          } else if (typeof keys === 'string') {
            result[keys] = store[keys];
          } else if (Array.isArray(keys)) {
            keys.forEach(k => { result[k] = store[k]; });
          } else {
            Object.keys(keys).forEach(k => { result[k] = k in store ? store[k] : keys[k]; });
          }
          if (cb) { cb(result); return undefined; }
          return Promise.resolve(result);
        }),
        set: vi.fn((items, cb) => {
          Object.assign(store, items);
          if (cb) cb();
          return Promise.resolve();
        }),
        remove: vi.fn((keys, cb) => {
          (Array.isArray(keys) ? keys : [keys]).forEach(k => { delete store[k]; });
          if (cb) cb();
          return Promise.resolve();
        })
      }
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: '1.5.0' }))
    }
  };
}

beforeEach(() => {
  globalThis.chrome = mockChrome();
  globalThis.fetch = vi.fn();
});

describe('SBW namespace', () => {
  it('attaches to globalThis.SBW', () => {
    expect(SBW).toBeTruthy();
    expect(typeof SBW.sbwFetch).toBe('function');
  });

  it('keeps getApiSettings and autoSaveLocal as thin globals for legacy callers', () => {
    expect(typeof globalThis.getApiSettings).toBe('function');
    expect(typeof globalThis.autoSaveLocal).toBe('function');
  });
});

describe('getApiSettings — apiUrl normalization', () => {
  it('appends /api when missing', async () => {
    globalThis.chrome = mockChrome({ apiUrl: 'https://x.com' });
    const settings = await SBW.getApiSettings();
    expect(settings.apiUrl).toBe('https://x.com/api');
  });

  it('strips a trailing slash after /api', async () => {
    globalThis.chrome = mockChrome({ apiUrl: 'https://x.com/api/' });
    const settings = await SBW.getApiSettings();
    expect(settings.apiUrl).toBe('https://x.com/api');
  });

  it('leaves an already-correct apiUrl untouched', async () => {
    globalThis.chrome = mockChrome({ apiUrl: 'https://x.com/api' });
    const settings = await SBW.getApiSettings();
    expect(settings.apiUrl).toBe('https://x.com/api');
  });
});

describe('sbwFetch — headers', () => {
  it('omits Authorization when no apiKey is set', async () => {
    globalThis.chrome = mockChrome({ apiKey: '' });
    globalThis.fetch.mockResolvedValue(mockResponse(200, { ok: true }));
    await SBW.sbwFetch('/v1/me');
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sends Bearer <apiKey> when set', async () => {
    globalThis.chrome = mockChrome({ apiKey: 'sbw_test123' });
    globalThis.fetch.mockResolvedValue(mockResponse(200, { ok: true }));
    await SBW.sbwFetch('/v1/me');
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sbw_test123');
  });

  it('sets Content-Type json only when a body is present', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, {}));
    await SBW.sbwFetch('/v1/me');
    expect(globalThis.fetch.mock.calls[0][1].headers['Content-Type']).toBeUndefined();

    globalThis.fetch.mockClear();
    globalThis.fetch.mockResolvedValue(mockResponse(200, {}));
    await SBW.sbwFetch('/v1/captures', { method: 'POST', body: { a: 1 } });
    expect(globalThis.fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('builds the URL from apiUrl + path, appending a query object', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, {}));
    await SBW.sbwFetch('/v1/captures', { query: { url: 'https://example.com' } });
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://seobandwagon.com/api/v1/captures?url=https%3A%2F%2Fexample.com');
  });
});

describe('sbwFetch — status → code mapping', () => {
  it('2xx → ok:true, code "ok"', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, { hello: 'world' }));
    const res = await SBW.sbwFetch('/v1/me');
    expect(res).toEqual({ ok: true, status: 200, data: { hello: 'world' }, retryAfter: null, code: 'ok' });
  });

  it('401 → code "unauthorized" and sets sbwKeyStatus to invalid', async () => {
    globalThis.chrome = mockChrome({ apiKey: 'bad-key' });
    globalThis.fetch.mockResolvedValue(mockResponse(401, { error: 'bad key' }));
    const res = await SBW.sbwFetch('/v1/me');
    expect(res.code).toBe('unauthorized');
    expect(res.ok).toBe(false);
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ sbwKeyStatus: 'invalid' })
    );
  });

  it('403 → code "forbidden", data carries { error, required }', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(403, { error: 'nope', required: 'pro' }));
    const res = await SBW.sbwFetch('/v1/me');
    expect(res.code).toBe('forbidden');
    expect(res.data).toEqual({ error: 'nope', required: 'pro' });
  });

  it('409 → code "conflict", data kept', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(409, { error: 'exists', id: 5 }));
    const res = await SBW.sbwFetch('/v1/captures', { method: 'POST', body: {} });
    expect(res.code).toBe('conflict');
    expect(res.data).toEqual({ error: 'exists', id: 5 });
  });

  it('429 → code "rate_limited", retryAfter parsed from header', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(429, { error: 'slow down' }, { 'Retry-After': '30' }));
    const res = await SBW.sbwFetch('/v1/me');
    expect(res.code).toBe('rate_limited');
    expect(res.retryAfter).toBe(30);
  });

  it('429 → retryAfter defaults to 60 when Retry-After header is absent', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(429, { error: 'slow down' }));
    const res = await SBW.sbwFetch('/v1/me');
    expect(res.retryAfter).toBe(60);
  });

  it('503 → code "unavailable"', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(503, { error: 'down' }));
    const res = await SBW.sbwFetch('/v1/me');
    expect(res.code).toBe('unavailable');
  });

  it('other non-ok statuses → code "error"', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(500, { error: 'boom' }));
    const res = await SBW.sbwFetch('/v1/me');
    expect(res.code).toBe('error');
  });

  it('network failure / timeout → code "network", never throws', async () => {
    globalThis.fetch.mockImplementation((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const res = await SBW.sbwFetch('/v1/me', { timeoutMs: 10 });
    expect(res).toEqual({ ok: false, status: 0, data: null, retryAfter: null, code: 'network' });
  });

  it('sets sbwKeyStatus to valid on a successful authenticated call', async () => {
    globalThis.chrome = mockChrome({ apiKey: 'sbw_good' });
    globalThis.fetch.mockResolvedValue(mockResponse(200, { ok: true }));
    await SBW.sbwFetch('/v1/me');
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ sbwKeyStatus: 'valid' })
    );
  });
});

describe('wrappers', () => {
  it('verifyKey() calls GET /v1/me', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, { userId: '1' }));
    await SBW.verifyKey();
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://seobandwagon.com/api/v1/me');
    expect(init.method).toBe('GET');
  });

  it('postCapture(payload) adds extensionVersion and userAgent', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(201, { id: 1 }));
    await SBW.postCapture({ url: 'https://example.com', score: 90 });
    const [, init] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.extensionVersion).toBe('1.5.0');
    expect(body.userAgent).toBe(navigator.userAgent);
    expect(body.url).toBe('https://example.com');
  });

  it('quickBatch(domains) posts { domains }', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, { results: [], invalid: [] }));
    await SBW.quickBatch(['a.com', 'b.com']);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://seobandwagon.com/api/domain/quick-batch');
    expect(JSON.parse(init.body)).toEqual({ domains: ['a.com', 'b.com'] });
  });

  it('lb.markSent(id) sends { id, action: "mark_sent" }', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, { ok: true }));
    await SBW.lb.markSent('pitch-1');
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://seobandwagon.com/api/link-building/pitches/dispatch');
    expect(JSON.parse(init.body)).toEqual({ id: 'pitch-1', action: 'mark_sent' });
  });

  it('ct.businesses() unwraps { data } into data', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, { data: [{ id: 1 }, { id: 2 }] }));
    const businesses = await SBW.ct.businesses();
    expect(businesses).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('ct.business(id) calls GET /citations/businesses/<id> and unwraps', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(200, { data: { id: 'b1', name: 'Acme' } }));
    const biz = await SBW.ct.business('b1');
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://seobandwagon.com/api/citations/businesses/b1');
    expect(biz).toEqual({ id: 'b1', name: 'Acme' });
  });

  it('ct.businesses() throws a CtError carrying .code on a 401', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(401, { error: 'API key required' }));
    await expect(SBW.ct.businesses()).rejects.toMatchObject({
      name: 'CtError',
      code: 'unauthorized',
      status: 401,
      message: 'API key required'
    });
  });

  it('ct.businesses() throws a CtError with .code "forbidden" on a 403', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(403, { error: 'insufficient_scope' }));
    await expect(SBW.ct.businesses()).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('ct.triggerCampaign() throws a CtError with .code "network" on a timeout/network failure', async () => {
    globalThis.fetch.mockRejectedValue(new Error('network down'));
    await expect(SBW.ct.triggerCampaign('b1')).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('ct.createCitation() still merges created:true onto the unwrapped row on success', async () => {
    globalThis.fetch.mockResolvedValue(mockResponse(201, { data: { id: 'c1' }, created: true }));
    const row = await SBW.ct.createCitation('b1', { directory_name: 'Yelp' });
    expect(row).toEqual({ id: 'c1', created: true });
  });
});

describe('autoSaveLocal — storage shape + return value', () => {
  it('stamps a new capture with sync: SBWSync.initialSync() and returns its key', async () => {
    const store = {};
    globalThis.chrome = mockChrome({ localStore: store });
    const key = await SBW.autoSaveLocal({ url: 'https://example.com/a', capturedAt: '2026-01-01T00:00:00Z' });
    expect(key).toMatch(/^capture_\d+$/);
    expect(store[key].sync).toEqual({ status: 'pending', attempts: 0, nextAt: 0 });
    expect(store[key].url).toBe('https://example.com/a');
  });

  it('returns the existing key instead of creating a duplicate within 60s of the same URL', async () => {
    const now = Date.now();
    const existingKey = `capture_${now - 1000}`;
    const store = { [existingKey]: { url: 'https://example.com/a', sync: { status: 'synced', remoteId: '1', syncedAt: now } } };
    globalThis.chrome = mockChrome({ localStore: store });

    const key = await SBW.autoSaveLocal({ url: 'https://example.com/a' });

    expect(key).toBe(existingKey);
    expect(Object.keys(store)).toEqual([existingKey]); // no new entry written
  });
});

describe('SBW.syncCapture', () => {
  it('skips without calling the network when data collection is off', async () => {
    globalThis.chrome = mockChrome({ apiKey: 'sbw_test', localStore: {} });
    globalThis.chrome.storage.local.get = vi.fn((keys, cb) => {
      const result = keys === 'dataCollection' ? { dataCollection: false } : {};
      if (cb) { cb(result); return undefined; }
      return Promise.resolve(result);
    });
    const result = await SBW.syncCapture('capture_1');
    expect(result).toEqual({ status: 'skipped', error: 'collection_off', code: 'collection_off' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('skips without calling the network when no apiKey is configured', async () => {
    globalThis.chrome = mockChrome({ apiKey: '', localStore: {} });
    const result = await SBW.syncCapture('capture_1');
    expect(result).toEqual({ status: 'skipped', error: 'no_key', code: 'no_key' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('posts the capture without the sync field, then writes back a synced state', async () => {
    const store = {
      capture_1: { url: 'https://example.com', capturedAt: 'x', sync: { status: 'pending', attempts: 0, nextAt: 0 } }
    };
    globalThis.chrome = mockChrome({ apiKey: 'sbw_test', localStore: store });
    globalThis.fetch.mockResolvedValue(mockResponse(201, { id: 'remote-1' }));

    const result = await SBW.syncCapture('capture_1');

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(init.body).sync).toBeUndefined();
    expect(result.status).toBe('synced');
    expect(result.remoteId).toBe('remote-1');
    expect(store.capture_1.sync).toEqual({ status: 'synced', remoteId: 'remote-1', syncedAt: expect.any(Number) });
  });

  it('backs off on a 503 without losing the previous attempt count', async () => {
    const store = {
      capture_1: { url: 'https://example.com', sync: { status: 'pending', attempts: 2, nextAt: 0 } }
    };
    globalThis.chrome = mockChrome({ apiKey: 'sbw_test', localStore: store });
    globalThis.fetch.mockResolvedValue(mockResponse(503, { error: 'down' }));

    const result = await SBW.syncCapture('capture_1');

    expect(result.status).toBe('pending');
    expect(result.attempts).toBe(3);
    expect(store.capture_1.sync.attempts).toBe(3);
  });
});

describe('SBW.drainPendingCaptures', () => {
  it('syncs due captures oldest-first and tallies synced/duplicate counts', async () => {
    const pending = { status: 'pending', attempts: 0, nextAt: 0 };
    const store = {
      capture_200: { url: 'https://example.com/b', sync: pending },
      capture_100: { url: 'https://example.com/a', sync: pending }
    };
    globalThis.chrome = mockChrome({ apiKey: 'sbw_test', localStore: store });
    globalThis.fetch
      .mockResolvedValueOnce(mockResponse(201, { id: 'r1' }))
      .mockResolvedValueOnce(mockResponse(409, { error: 'exists' }));

    const result = await SBW.drainPendingCaptures({ max: 20 });

    // capture_100 (older) syncs first, then capture_200 is a duplicate.
    expect(globalThis.fetch.mock.calls[0][0]).toContain('/v1/captures');
    expect(result).toEqual({ sent: 2, synced: 1, duplicates: 1, stoppedOn: null, nextAt: null });
    expect(store.capture_100.sync.status).toBe('synced');
    expect(store.capture_200.sync.status).toBe('duplicate');
  });

  it('stops early on the first rate-limited response and reports stoppedOn + nextAt', async () => {
    const pending = { status: 'pending', attempts: 0, nextAt: 0 };
    const store = {
      capture_100: { url: 'https://example.com/a', sync: pending },
      capture_200: { url: 'https://example.com/b', sync: pending }
    };
    globalThis.chrome = mockChrome({ apiKey: 'sbw_test', localStore: store });
    globalThis.fetch.mockResolvedValue(mockResponse(429, { error: 'slow down' }, { 'Retry-After': '30' }));

    const result = await SBW.drainPendingCaptures({ max: 20 });

    expect(result.sent).toBe(1); // stopped after the first rate-limited item
    expect(result.stoppedOn).toBe('rate_limited');
    expect(result.nextAt).toEqual(expect.any(Number));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('caps the batch at max', async () => {
    const pending = { status: 'pending', attempts: 0, nextAt: 0 };
    const store = {};
    for (let i = 0; i < 5; i++) store[`capture_${100 + i}`] = { url: `https://example.com/${i}`, sync: pending };
    globalThis.chrome = mockChrome({ apiKey: 'sbw_test', localStore: store });
    globalThis.fetch.mockResolvedValue(mockResponse(201, { id: 'r' }));

    const result = await SBW.drainPendingCaptures({ max: 2 });

    expect(result.sent).toBe(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('SBW.markLegacyPending', () => {
  it('stamps captures missing a sync field and leaves existing ones alone', async () => {
    const store = {
      capture_1: { url: 'https://example.com/a' }, // legacy, no sync
      capture_2: { url: 'https://example.com/b', sync: { status: 'synced', remoteId: '1', syncedAt: 1 } }
    };
    globalThis.chrome = mockChrome({ localStore: store });

    const stamped = await SBW.markLegacyPending();

    expect(stamped).toBe(1);
    expect(store.capture_1.sync).toEqual({ status: 'pending', attempts: 0, nextAt: 0 });
    expect(store.capture_2.sync).toEqual({ status: 'synced', remoteId: '1', syncedAt: 1 });
  });

  it('is a no-op when every capture already has a sync field', async () => {
    const store = { capture_1: { url: 'https://example.com/a', sync: { status: 'pending', attempts: 0, nextAt: 0 } } };
    globalThis.chrome = mockChrome({ localStore: store });

    const stamped = await SBW.markLegacyPending();

    expect(stamped).toBe(0);
  });
});
