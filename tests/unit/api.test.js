// Unit tests for the unified SEO Bandwagon API client (src/lib/api.js).
// Covers: apiUrl normalization, auth headers, sbwFetch status→code mapping,
// timeout/network handling, and the SBW.* wrapper surface (captures, domain,
// link-building, citations).

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

function mockChrome({ apiKey = '', apiUrl = 'https://seobandwagon.com/api' } = {}) {
  return {
    storage: {
      sync: {
        get: vi.fn((defaults, cb) => cb({ apiKey, apiUrl })),
        set: vi.fn((items, cb) => cb && cb())
      },
      local: {
        get: vi.fn((keys, cb) => {
          const result = {};
          if (cb) { cb(result); return undefined; }
          return Promise.resolve(result);
        }),
        set: vi.fn((items, cb) => { if (cb) cb(); return Promise.resolve(); }),
        remove: vi.fn((keys, cb) => { if (cb) cb(); return Promise.resolve(); })
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
});
