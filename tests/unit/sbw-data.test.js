// src/lib/sbw-data.js — the only route from a themed surface to the product.
//
// The rules being tested are the ones that keep a surface honest: no request
// when there is no key, no second request while a verified key is still fresh,
// no number that did not come from the shipped scorer, and a complete render
// when the API is unreachable.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as D from '../../extension/src/lib/sbw-data.js';
import SubScores from '../../extension/src/lib/sub-scores.js';

// The shipped API module, for the second-device tests: the stub below has a
// `hasApiKey` that api.js did not export until 1.10.3, which is how the gap
// got past these tests.
await import('../../extension/src/lib/sync-state.js');
await import('../../extension/src/lib/api.js');
const REAL_SBW = globalThis.SBW;

function chromeStub(local = {}) {
  const store = { ...local };
  const messages = [];
  const sidePanel = { setOptions: vi.fn(async () => {}), open: vi.fn(async () => {}) };
  return {
    store: () => store,
    messages,
    sidePanel,
    api: {
      storage: {
        local: {
          get: vi.fn(async (k) => {
            if (typeof k === 'string') return { [k]: store[k] };
            if (Array.isArray(k)) return Object.fromEntries(k.map((n) => [n, store[n]]));
            return { ...store };
          }),
          set: vi.fn(async (obj) => Object.assign(store, obj)),
        },
        onChanged: { addListener: vi.fn() },
      },
      runtime: { sendMessage: vi.fn(async (m) => { messages.push(m); return undefined; }) },
      tabs: { sendMessage: vi.fn(async () => ({})), query: vi.fn(async () => []) },
      scripting: { executeScript: vi.fn(async () => {}) },
      sidePanel,
      commands: { getAll: vi.fn(async () => [{ name: 'analyze-current', shortcut: 'Ctrl+Shift+S' }]) },
    },
  };
}

/** A minimal SBW with only what the call under test needs. */
function sbwStub(over = {}) {
  return {
    hasApiKey: vi.fn(async () => true),
    isDataCollectionEnabled: vi.fn(async () => true),
    verifyKey: vi.fn(async () => ({ ok: true, code: 'ok', data: { email: 'k@example.com' } })),
    drainPendingCaptures: vi.fn(async () => ({ sent: 2, synced: 2, duplicates: 0, stoppedOn: null, nextAt: null })),
    autoSaveLocal: vi.fn(async () => 'capture_1'),
    syncCapture: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  const stub = chromeStub();
  globalThis.chrome = stub.api;
  globalThis.SBW = sbwStub();
  globalThis.SBWSubScores = SubScores;
  delete globalThis.SBWToolLinks;
  delete globalThis.SBWCaptureStrip;
});

describe('url helpers', () => {
  it('hostOf and domainOf strip www, and survive junk', () => {
    expect(D.hostOf('https://www.example.com/a')).toBe('www.example.com');
    expect(D.domainOf('https://www.example.com/a')).toBe('example.com');
    expect(D.hostOf('not a url')).toBe('');
    expect(D.domainOf(undefined)).toBe('');
  });

  it('a Google results page is not analyzable; its other pages are', () => {
    expect(D.isGoogleSerpUrl('https://www.google.com/search?q=x')).toBe(true);
    expect(D.isGoogleSerpUrl('https://www.google.de/search?q=x')).toBe(true);
    expect(D.isGoogleSerpUrl('https://www.google.com/maps')).toBe(false);
    expect(D.isAnalyzable('https://www.google.com/search?q=x')).toBe(false);
    expect(D.isAnalyzable('https://example.com')).toBe(true);
    expect(D.isAnalyzable('chrome://extensions')).toBe(false);
    expect(D.isAnalyzable(undefined)).toBe(false);
  });
});

describe('checks come from the shipped scorer', () => {
  const page = {
    url: 'https://example.com/',
    meta: { title: { text: 'x', length: 45 }, description: { text: 'y', length: 140 }, canonical: 'c', openGraph: { title: 'o' }, schema: [{}] },
    content: { wordCount: 900, readability: { fleschKincaid: 9, level: 'Fairly easy' } },
    headings: { h1: ['one'] },
    links: { internal: { count: 9 }, external: { count: 2 } },
    images: { total: 2, missingAlt: { count: 0 } },
    technical: { domElements: 500 },
    mixedContent: { mixedCount: 0 },
    webVitals: { lcp: 1800 },
  };

  it('checkTotals delegates rather than re-deriving', () => {
    expect(D.checkTotals(page)).toEqual(SubScores.checkTotals(page));
    expect(D.subScores(page)).toEqual(SubScores.computeSubScores(page));
  });

  it('returns zeroes rather than throwing when the scorer is absent', () => {
    delete globalThis.SBWSubScores;
    expect(D.checkTotals(page)).toEqual({ passed: 0, of: 0 });
    expect(D.subScores(page)).toEqual([]);
  });

  it('pageChecks marks pass, warn and fail, and omits rows the analyzer did not produce', () => {
    const rows = D.pageChecks(page);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.Title.status).toBe('pass');
    expect(by.LCP).toMatchObject({ note: '1800 ms', status: 'pass' });
    expect(by['Reading level'].note).toBe('Fairly easy');

    const bare = D.pageChecks({ meta: {}, content: {}, headings: {}, links: {}, images: {}, technical: {} });
    expect(bare.find((r) => r.name === 'LCP')).toBeUndefined();
    expect(bare.find((r) => r.name === 'Reading level')).toBeUndefined();
    expect(bare.find((r) => r.name === 'Canonical').status).toBe('fail');

    const warn = D.pageChecks({ ...page, meta: { ...page.meta, title: { text: 'x', length: 12 } } });
    expect(warn.find((r) => r.name === 'Title').status).toBe('warn');
  });
});

describe('accountState', () => {
  it('is no_key when nothing is stored and there is no key', async () => {
    globalThis.SBW = sbwStub({ hasApiKey: vi.fn(async () => false) });
    expect(await D.accountState()).toMatchObject({ state: 'no_key', connected: false });
  });

  it('is connected when the key last verified, and carries the cached email', async () => {
    const stub = chromeStub({ sbwKeyStatus: 'valid', sbwUser: { data: { email: 'k@example.com' }, at: Date.now() } });
    globalThis.chrome = stub.api;
    expect(await D.accountState()).toMatchObject({ state: 'connected', email: 'k@example.com' });
  });

  it('is invalid when api.js recorded a 401, even though a key is present', async () => {
    const stub = chromeStub({ sbwKeyStatus: 'invalid' });
    globalThis.chrome = stub.api;
    expect(await D.accountState()).toMatchObject({ state: 'invalid' });
  });

  it('is collection_off when syncing is turned off, and outranks connected', async () => {
    const stub = chromeStub({ sbwKeyStatus: 'valid' });
    globalThis.chrome = stub.api;
    globalThis.SBW = sbwStub({ isDataCollectionEnabled: vi.fn(async () => false) });
    expect(await D.accountState()).toMatchObject({ state: 'collection_off', collecting: false });
  });

  it('is unverified, not connected and not signed out, for a key with no status yet (1.10.3)', async () => {
    expect(await D.accountState()).toMatchObject({ state: 'unverified', connected: false, email: null });
  });

  it('a status left by a key that is gone is not connected (Disconnect on another device)', async () => {
    const stub = chromeStub({ sbwKeyStatus: 'valid', sbwUser: { data: { email: 'old@example.com' }, at: Date.now() } });
    globalThis.chrome = stub.api;
    globalThis.SBW = sbwStub({ hasApiKey: vi.fn(async () => false) });
    expect(await D.accountState()).toMatchObject({ state: 'no_key', connected: false, email: null });
  });
});

/* -------------------- a second device (1.10.3), real api.js ------------------- */

describe('a second device: the key came through Chrome sync, this profile has nothing else', () => {
  const SUMMARY = { generatedAt: 'x', windowDays: 7, rankTracking: { trackers: [{ id: 't1' }], movers: [] }, clientAudits: [], tasks: [{ id: 'k1' }] };

  // A fresh profile: chrome.storage.sync holds the key (synced from the
  // first device), chrome.storage.local and .session are empty. fetch
  // answers as seobandwagon.com does.
  function freshProfile(answers) {
    const local = {};
    const session = {};
    globalThis.chrome = {
      storage: {
        sync: { get: vi.fn((defaults, cb) => cb({ ...defaults, apiKey: 'sbw_' + 'a'.repeat(48) })) },
        local: {
          get: vi.fn(async (k) => {
            if (k === null || k === undefined) return { ...local };
            if (typeof k === 'string') return { [k]: local[k] };
            if (Array.isArray(k)) return Object.fromEntries(k.map((n) => [n, local[n]]));
            return { ...k, ...local };
          }),
          set: vi.fn(async (obj) => { Object.assign(local, obj); }),
          remove: vi.fn(async (keys) => { [].concat(keys).forEach((n) => { delete local[n]; }); }),
        },
        session: {
          get: vi.fn(async (k) => (typeof k === 'string' ? { [k]: session[k] } : { ...session })),
          set: vi.fn(async (obj) => { Object.assign(session, obj); }),
          remove: vi.fn(async (keys) => { [].concat(keys).forEach((n) => { delete session[n]; }); }),
        },
        onChanged: { addListener: vi.fn() },
      },
      runtime: { getManifest: () => ({ version: '1.10.3' }) },
    };
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(path);
      const [status, body] = answers[path] || [404, { error: 'Not found' }];
      return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } };
    });
    globalThis.SBW = REAL_SBW;
    return { local, session, calls };
  }

  it('1.10.2 read it as signed out: the real api.js had no hasApiKey', async () => {
    freshProfile({});
    globalThis.SBW = Object.assign({}, REAL_SBW, { hasApiKey: undefined });
    expect(await D.accountState()).toMatchObject({ state: 'no_key' });
    expect(await D.accountProgress()).toEqual({ state: 'signed_out' });
  });

  it('reads unverified, checks the key once, then loads the account cards', async () => {
    const { local, session, calls } = freshProfile({
      '/api/v1/me': [200, { email: 'k@example.com', scopes: ['captures', 'progress'] }],
      '/api/extension/progress': [200, SUMMARY],
    });

    expect(await D.accountState()).toMatchObject({ state: 'unverified' });
    const progress = await D.accountProgress({ now: 1000 });

    expect(progress).toEqual({ state: 'ok', data: SUMMARY, origin: 'https://seobandwagon.com' });
    expect(calls).toEqual(['/api/v1/me', '/api/extension/progress']);
    expect(local.sbwKeyStatus).toBe('valid');
    expect(local.sbwUser.data.email).toBe('k@example.com');
    expect(session.sbwProgress.result.state).toBe('ok');
    expect(await D.accountState()).toMatchObject({ state: 'connected', email: 'k@example.com' });

    // The next new tab sends nothing: verified, and the cards are cached.
    await D.accountProgress({ now: 2000 });
    expect(calls).toHaveLength(2);
  });

  it('overlapping paints share one /v1/me', async () => {
    const { calls } = freshProfile({
      '/api/v1/me': [200, { email: 'k@example.com' }],
      '/api/extension/progress': [200, SUMMARY],
    });
    await Promise.all([D.accountProgress({ now: 1 }), D.accountProgress({ now: 1 })]);
    expect(calls.filter((p) => p === '/api/v1/me')).toHaveLength(1);
  });

  it('a 429 or no connection on the check is not signed out: still unverified, asked again later', async () => {
    const { local, calls } = freshProfile({ '/api/v1/me': [429, { error: 'Too many requests' }] });
    expect(await D.accountProgress()).toEqual({ state: 'signed_out' });
    expect(calls).toEqual(['/api/v1/me']);
    expect(local.sbwKeyStatus).toBeUndefined();
    expect(await D.accountState()).toMatchObject({ state: 'unverified' });

    freshProfile({});
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await D.verifyAccount()).toMatchObject({ code: 'network', state: 'unverified' });
  });

  it('a refused key reads invalid, so the surfaces say to reconnect', async () => {
    const { local } = freshProfile({ '/api/v1/me': [401, { error: 'Invalid API key' }] });
    expect(await D.accountProgress()).toEqual({ state: 'signed_out' });
    expect(local.sbwKeyStatus).toBe('invalid');
    expect(await D.accountState()).toMatchObject({ state: 'invalid' });
  });
});

describe('verifyAccount', () => {
  it('sends no request at all when there is no key', async () => {
    const SBW = sbwStub({ hasApiKey: vi.fn(async () => false) });
    globalThis.SBW = SBW;
    const res = await D.verifyAccount();
    expect(SBW.verifyKey).not.toHaveBeenCalled();
    expect(res).toMatchObject({ checked: false, code: 'no_key' });
  });

  it('sends no request while a verified key is still inside the TTL', async () => {
    const now = Date.now();
    const stub = chromeStub({ sbwKeyStatus: 'valid', sbwUser: { data: { email: 'k@example.com' }, at: now - 1000 } });
    globalThis.chrome = stub.api;
    const SBW = sbwStub();
    globalThis.SBW = SBW;
    const res = await D.verifyAccount({ now });
    expect(SBW.verifyKey).not.toHaveBeenCalled();
    expect(res).toMatchObject({ checked: false, cached: true, state: 'connected' });
  });

  it('re-checks once the TTL has passed, and refreshes the cache', async () => {
    const now = Date.now();
    const stub = chromeStub({ sbwKeyStatus: 'valid', sbwUser: { data: { email: 'old@example.com' }, at: now - D.VERIFY_TTL_MS - 1 } });
    globalThis.chrome = stub.api;
    const SBW = sbwStub();
    globalThis.SBW = SBW;
    const res = await D.verifyAccount({ now });
    expect(SBW.verifyKey).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ checked: true, code: 'ok', email: 'k@example.com' });
    expect(stub.store().sbwUser.at).toBe(now);
  });

  it('force ignores a fresh cache', async () => {
    const now = Date.now();
    const stub = chromeStub({ sbwKeyStatus: 'valid', sbwUser: { data: {}, at: now } });
    globalThis.chrome = stub.api;
    const SBW = sbwStub();
    globalThis.SBW = SBW;
    await D.verifyAccount({ now, force: true });
    expect(SBW.verifyKey).toHaveBeenCalledTimes(1);
  });

  it('a revoked key surfaces as invalid, reading the status api.js just wrote', async () => {
    const now = Date.now();
    const store = { sbwKeyStatus: 'valid', sbwUser: { data: {}, at: now - D.VERIFY_TTL_MS - 1 } };
    const stub = chromeStub(store);
    globalThis.chrome = stub.api;
    globalThis.SBW = sbwStub({
      verifyKey: vi.fn(async () => {
        stub.store().sbwKeyStatus = 'invalid'; // what sbwFetch does on a 401
        return { ok: false, code: 'unauthorized', retryAfter: null };
      }),
    });
    expect(await D.verifyAccount({ now })).toMatchObject({ checked: true, code: 'unauthorized', state: 'invalid' });
  });

  it('passes Retry-After through on a 429 without changing the stored state', async () => {
    const now = Date.now();
    const stub = chromeStub({ sbwKeyStatus: 'valid', sbwUser: { data: {}, at: now - D.VERIFY_TTL_MS - 1 } });
    globalThis.chrome = stub.api;
    globalThis.SBW = sbwStub({
      verifyKey: vi.fn(async () => ({ ok: false, code: 'rate_limited', retryAfter: 120 })),
    });
    expect(await D.verifyAccount({ now })).toMatchObject({ code: 'rate_limited', retryAfter: 120, state: 'connected' });
  });
});

describe('drainPending / drainLine', () => {
  it('passes the drainer result straight through', async () => {
    expect(await D.drainPending()).toEqual({ sent: 2, synced: 2, duplicates: 0, stoppedOn: null, nextAt: null });
  });

  it('reports network rather than throwing when api.js is missing', async () => {
    delete globalThis.SBW;
    expect(await D.drainPending()).toMatchObject({ synced: 0, stoppedOn: 'network' });
    globalThis.SBW = sbwStub({ drainPendingCaptures: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await D.drainPending()).toMatchObject({ synced: 0, stoppedOn: 'network' });
  });

  it('says nothing when nothing synced, and counts when something did', () => {
    expect(D.drainLine(null)).toBeNull();
    expect(D.drainLine({ synced: 0, stoppedOn: null })).toBeNull();
    expect(D.drainLine({ synced: 1 })).toBe('1 capture synced');
    expect(D.drainLine({ synced: 4 })).toBe('4 captures synced');
  });

  it('turns a rate-limited stop into a wait the user can read', () => {
    const line = D.drainLine({ synced: 0, stoppedOn: 'rate_limited', nextAt: Date.now() + 5 * 60000 });
    expect(line).toBe('Sync paused, retrying in 5 minutes');
    expect(D.drainLine({ synced: 0, stoppedOn: 'rate_limited', nextAt: Date.now() + 20000 }))
      .toBe('Sync paused, retrying in 1 minute');
    // Stopped for a reason the user cannot act on here: stay quiet.
    expect(D.drainLine({ synced: 0, stoppedOn: 'unavailable', nextAt: null })).toBeNull();
  });
});

describe('analyzeTab', () => {
  it('uses the tab cache and injects nothing when it hits', async () => {
    const stub = chromeStub();
    stub.api.runtime.sendMessage = vi.fn(async (m) =>
      m.action === 'getCachedAnalysis' ? { hit: true, data: { seoScore: { score: 88 } } } : undefined);
    globalThis.chrome = stub.api;
    const res = await D.analyzeTab({ id: 7, url: 'https://example.com' });
    expect(res).toMatchObject({ cached: true });
    expect(stub.api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('on a miss it injects, stores, badges and saves the stripped capture', async () => {
    const stub = chromeStub();
    stub.api.tabs.sendMessage = vi.fn(async () => ({ url: 'https://example.com', seoScore: { score: 71, grade: 'C' } }));
    globalThis.chrome = stub.api;
    const SBW = sbwStub();
    globalThis.SBW = SBW;
    globalThis.SBWCaptureStrip = { strip: vi.fn((d) => ({ ...d, stripped: true })) };

    const res = await D.analyzeTab({ id: 7, url: 'https://example.com' });
    expect(res.cached).toBe(false);
    expect(stub.api.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: D.ANALYZER_FILES });
    expect(stub.messages.map((m) => m.action)).toContain('storeAnalysis');
    expect(stub.messages.find((m) => m.action === 'updateBadge')).toMatchObject({ score: 71, grade: 'C' });
    expect(globalThis.SBWCaptureStrip.strip).toHaveBeenCalled();
    expect(SBW.autoSaveLocal).toHaveBeenCalledWith(expect.objectContaining({ stripped: true }));
    expect(SBW.syncCapture).toHaveBeenCalledWith('capture_1');
  });

  it('strips fail-closed when the strip lib is missing', async () => {
    const stub = chromeStub();
    stub.api.tabs.sendMessage = vi.fn(async () => ({
      url: 'https://example.com',
      schemaValidation: [{ secret: true }],
      links: { list: ['a'], internal: { count: 1 } },
      meta: { schema: [{}] },
    }));
    globalThis.chrome = stub.api;
    const SBW = sbwStub();
    globalThis.SBW = SBW;
    await D.analyzeTab({ id: 7, url: 'https://example.com' });
    const saved = SBW.autoSaveLocal.mock.calls[0][0];
    expect(saved.schemaValidation).toBeUndefined();
    expect(saved.links.list).toBeUndefined();
    expect(saved.meta.schema).toBeUndefined();
    expect(saved.links.internal).toEqual({ count: 1 });
  });

  it('save:false analyses without writing a capture', async () => {
    const stub = chromeStub();
    stub.api.tabs.sendMessage = vi.fn(async () => ({ url: 'https://example.com' }));
    globalThis.chrome = stub.api;
    const SBW = sbwStub();
    globalThis.SBW = SBW;
    await D.analyzeTab({ id: 7, url: 'https://example.com' }, { save: false });
    expect(SBW.autoSaveLocal).not.toHaveBeenCalled();
  });

  it('throws when the analyzer returns nothing, so the surface can say so', async () => {
    const stub = chromeStub();
    stub.api.tabs.sendMessage = vi.fn(async () => null);
    globalThis.chrome = stub.api;
    await expect(D.analyzeTab({ id: 7, url: 'https://example.com' })).rejects.toThrow('No analysis returned');
  });
});

describe('tools, directory and panel', () => {
  it('toolRow drops any tool the link builder cannot make a url for', () => {
    globalThis.SBWToolLinks = { toolUrl: (kind) => (kind === 'gsc' ? 'https://gsc.example' : null) };
    expect(D.toolRow('https://example.com')).toEqual([
      { kind: 'gsc', label: 'Search Console', url: 'https://gsc.example' },
    ]);
    delete globalThis.SBWToolLinks;
    expect(D.toolRow('https://example.com')).toEqual([]);
  });

  it('directoryMatch returns null rather than throwing when the worker is asleep', async () => {
    const stub = chromeStub();
    stub.api.runtime.sendMessage = vi.fn(async () => { throw new Error('no receiver'); });
    globalThis.chrome = stub.api;
    expect(await D.directoryMatch('https://example.com')).toBeNull();
  });

  it('shortcutFor reads the real command binding', async () => {
    expect(await D.shortcutFor()).toBe('Ctrl+Shift+S');
    globalThis.chrome.commands.getAll = vi.fn(async () => []);
    expect(await D.shortcutFor()).toBeNull();
  });

  it('openPanel swaps this tab only, and never touches the manifest default', async () => {
    const stub = chromeStub();
    globalThis.chrome = stub.api;
    expect(await D.openPanel('citations', 12)).toBe(true);
    expect(stub.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 12, path: 'src/sidepanel/sidepanel.html', enabled: true,
    });
    await D.openPanel('checks', 12);
    expect(stub.sidePanel.setOptions).toHaveBeenLastCalledWith({
      tabId: 12, path: 'src/panel/panel.html', enabled: true,
    });
  });

  it('openPanel reports a refused open, with no worker fallback (S34: it could not work)', async () => {
    const stub = chromeStub();
    stub.sidePanel.setOptions = vi.fn(async () => { throw new Error('no gesture'); });
    globalThis.chrome = stub.api;
    expect(await D.openPanel('checks', 12)).toBe(false);
    expect(stub.messages).not.toContainEqual({ action: 'openSidePanel' });
  });
});

/* ------------------------------ the new tab ------------------------------- */

// A stored capture as SBW.autoSaveLocal writes it: the analyzer's response,
// stripped, under `capture_<ms>`.
function capture(ms, url, score, extra = {}) {
  return [`capture_${ms}`, {
    url,
    capturedAt: new Date(ms).toISOString(),
    seoScore: { score, grade: score >= 90 ? 'A' : 'C', issues: [] },
    ...extra,
  }];
}

describe('recentAudits', () => {
  it('lists the newest capture per URL, newest first, with the change since that URL\'s previous capture', async () => {
    const stub = chromeStub(Object.fromEntries([
      capture(1000, 'https://a.example/', 60),
      capture(2000, 'https://b.example/', 70),
      capture(3000, 'https://a.example/', 72),
      capture(4000, 'https://c.example/', 55),
      ['bwThemeMode', 'dark'], // not a capture: ignored
    ]));
    globalThis.chrome = stub.api;
    const rows = await D.recentAudits(5);
    expect(rows.map((r) => [r.host, r.score, r.delta, r.captures])).toEqual([
      ['c.example', 55, null, 1],
      ['a.example', 72, 12, 2],
      ['b.example', 70, null, 1],
    ]);
    expect(rows[1].at).toBe(3000);
  });

  it('reads overallScore before seoScore, the rule src/lib/domain-history.js uses', () => {
    expect(D.captureScore({ overallScore: 81, seoScore: { score: 40 } })).toBe(81);
    expect(D.captureScore({ seoScore: { score: 40 } })).toBe(40);
    expect(D.captureScore({})).toBeNull();
    expect(D.captureScore(null)).toBeNull();
  });

  it('leaves out a capture with no score rather than showing zero', async () => {
    const stub = chromeStub(Object.fromEntries([
      capture(1000, 'https://a.example/', 60),
      ['capture_2000', { url: 'https://b.example/', capturedAt: new Date(2000).toISOString() }],
    ]));
    globalThis.chrome = stub.api;
    expect((await D.recentAudits(5)).map((r) => r.host)).toEqual(['a.example']);
  });

  it('reads only the newest RECENT_WINDOW captures when the browser can list keys', async () => {
    const entries = [];
    for (let i = 1; i <= D.RECENT_WINDOW + 10; i++) entries.push(capture(i * 1000, `https://s${i}.example/`, 50));
    const stub = chromeStub(Object.fromEntries(entries));
    stub.api.storage.local.getKeys = vi.fn(async () => Object.keys(stub.store()));
    globalThis.chrome = stub.api;
    const rows = await D.recentAudits(3);
    expect(rows.map((r) => r.host)).toEqual(['s60.example', 's59.example', 's58.example']);
    const read = stub.api.storage.local.get.mock.calls.at(-1)[0];
    expect(read).toHaveLength(D.RECENT_WINDOW);
    expect(read).not.toContain('capture_1000');
  });

  it('is empty, not an error, before anything was captured', async () => {
    globalThis.chrome = chromeStub({}).api;
    expect(await D.recentAudits()).toEqual([]);
  });
});

describe('topFix', () => {
  const page = {
    url: 'https://example.com/pricing',
    meta: { description: { length: 41 } },
    images: { total: 9, missingAlt: { count: 4 } },
    seoScore: { score: 64, issues: ['Description too short', 'Some images missing alt'] },
  };

  it('is the analyzer\'s first issue, with a body built from the page\'s own numbers', () => {
    const fix = D.topFix(page);
    expect(fix).toMatchObject({
      issue: 'Description too short',
      title: 'Description too short',
      body: '41 characters. Aim for 120 to 160.',
      host: 'example.com',
      of: 2,
    });
  });

  it('has fix text for every issue string the analyzer can produce', () => {
    // 1.10.4: the fix text lives with the checks, so it is read from there.
    const issues = SubScores.analysis.CHECKS.flatMap((c) => Object.keys(c.outcomes));
    expect(issues.length).toBeGreaterThan(20);
    for (const issue of issues) expect(D.fixIssues(), issue).toContain(issue);
  });

  it('says what each fix costs on the checklist', () => {
    expect(D.topFix(page).points).toBe(4);
  });

  it('is null for a clean page, and skips an issue it has no words for', () => {
    expect(D.topFix({ url: 'https://example.com/', seoScore: { issues: [] } })).toBeNull();
    expect(D.topFix(null)).toBeNull();
    const fix = D.topFix({ url: 'https://example.com/', seoScore: { issues: ['Something new', 'Missing H1'] } });
    expect(fix.issue).toBe('Missing H1');
  });

  it('links to a tool only when the link builder can make the URL', () => {
    globalThis.SBWToolLinks = { toolUrl: (kind, { pageUrl }) => `https://tool.example/${kind}?u=${encodeURIComponent(pageUrl)}` };
    const fix = D.topFix({ url: 'https://example.com/', seoScore: { issues: ['No structured data'] } });
    expect(fix.url).toBe('https://tool.example/rich-results?u=https%3A%2F%2Fexample.com%2F');
    expect(fix.label).toBe('Rich Results Test');
    delete globalThis.SBWToolLinks;
    expect(D.topFix({ url: 'https://example.com/', seoScore: { issues: ['No structured data'] } }).url).toBeNull();
  });
});

describe('localHistoryLine', () => {
  it('says what the stored captures alone can say', () => {
    expect(D.localHistoryLine(null)).toBeNull();
    expect(D.localHistoryLine({ captures: 1, delta: null })).toBe('First capture of this page');
    expect(D.localHistoryLine({ captures: 2, delta: 12 })).toBe('1 earlier capture · +12 since');
    expect(D.localHistoryLine({ captures: 4, delta: -3 })).toBe('3 earlier captures · −3 since');
    expect(D.localHistoryLine({ captures: 3, delta: 0 })).toBe('2 earlier captures · no change');
  });
});

describe('scanSite', () => {
  it('takes a bare domain or a full URL, and never treats words as a search', () => {
    expect(D.normalizeUrl('example.com')).toBe('https://example.com/');
    expect(D.normalizeUrl('  http://example.com/a?b=1 ')).toBe('http://example.com/a?b=1');
    expect(D.normalizeUrl('plumber seattle')).toBeNull();
    expect(D.normalizeUrl('localhost')).toBeNull();
    expect(D.normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(D.normalizeUrl('')).toBeNull();
  });

  it('asks the worker to open the site in this tab and analyze it, the overlay\'s Analyze flow', async () => {
    const stub = chromeStub();
    stub.api.runtime.sendMessage = vi.fn(async () => ({ ok: true, tabId: 7 }));
    globalThis.chrome = stub.api;
    expect(await D.scanSite('example.com')).toEqual({ ok: true, tabId: 7 });
    expect(stub.api.runtime.sendMessage).toHaveBeenCalledWith({ action: 'analyzeResult', url: 'https://example.com/', sameTab: true });
  });

  it('sends nothing for input that is not a site, or for a Google results page', async () => {
    const stub = chromeStub();
    globalThis.chrome = stub.api;
    expect(await D.scanSite('best plumber near me')).toEqual({ ok: false, error: 'invalid_url' });
    expect(await D.scanSite('https://www.google.com/search?q=x')).toEqual({ ok: false, error: 'not_analyzable' });
    expect(stub.messages).toEqual([]);
  });

  it('reports a sleeping worker instead of throwing', async () => {
    const stub = chromeStub();
    stub.api.runtime.sendMessage = vi.fn(async () => { throw new Error('Receiving end does not exist.'); });
    globalThis.chrome = stub.api;
    expect(await D.scanSite('example.com')).toEqual({ ok: false, error: 'tab_open_failed' });
  });
});

/* --------------------------- account progress ---------------------------- */

describe('accountProgress', () => {
  const SUMMARY = { generatedAt: 'x', windowDays: 7, rankTracking: { trackers: [], movers: [] }, clientAudits: [], tasks: [] };

  function connected(progress) {
    const stub = chromeStub({ sbwKeyStatus: 'valid' });
    const session = {};
    stub.api.storage.session = {
      get: vi.fn(async (k) => ({ [k]: session[k] })),
      set: vi.fn(async (obj) => Object.assign(session, obj)),
    };
    globalThis.chrome = stub.api;
    globalThis.SBW = sbwStub({
      progress: vi.fn(progress),
      getApiSettings: vi.fn(async () => ({ apiKey: 'sbw_x', apiUrl: 'https://seobandwagon.com/api' })),
    });
    return { stub, session };
  }

  it('sends nothing when the account is not connected', async () => {
    globalThis.SBW = sbwStub({ hasApiKey: vi.fn(async () => false), progress: vi.fn() });
    expect(await D.accountProgress()).toEqual({ state: 'signed_out' });
    expect(globalThis.SBW.progress).not.toHaveBeenCalled();
  });

  it('answers the summary with the site origin, and reuses it for ten minutes', async () => {
    connected(async () => ({ ok: true, status: 200, code: 'ok', data: SUMMARY }));
    const first = await D.accountProgress({ now: 1000 });
    expect(first).toEqual({ state: 'ok', data: SUMMARY, origin: 'https://seobandwagon.com' });
    await D.accountProgress({ now: 1000 + D.PROGRESS_TTL_MS - 1 });
    expect(globalThis.SBW.progress).toHaveBeenCalledTimes(1);
    await D.accountProgress({ now: 1000 + D.PROGRESS_TTL_MS });
    expect(globalThis.SBW.progress).toHaveBeenCalledTimes(2);
    await D.accountProgress({ now: 1000 + D.PROGRESS_TTL_MS, force: true });
    expect(globalThis.SBW.progress).toHaveBeenCalledTimes(3);
  });

  it('a 403 is a key from before the scope: reconnect', async () => {
    connected(async () => ({ ok: false, status: 403, code: 'forbidden', data: { error: 'insufficient_scope' } }));
    expect(await D.accountProgress()).toMatchObject({ state: 'reconnect', origin: 'https://seobandwagon.com' });
  });

  it('a 404 or a network failure means the route is not there yet: local cards only, and not asked again on the next tab', async () => {
    connected(async () => ({ ok: false, status: 404, code: 'error', data: null }));
    expect(await D.accountProgress({ now: 5 })).toEqual({ state: 'unavailable', code: 'error', status: 404 });
    expect(await D.accountProgress({ now: 6 })).toMatchObject({ state: 'unavailable' });
    expect(globalThis.SBW.progress).toHaveBeenCalledTimes(1);
    connected(async () => { throw new Error('offline'); });
    expect(await D.accountProgress({ now: 100 })).toEqual({ state: 'unavailable', code: 'network', status: 0 });
  });

  it('retries a network failure after a minute, not ten: a request cut off by navigation must not hide the cards', async () => {
    connected(async () => ({ ok: false, status: 0, code: 'network', data: null }));
    await D.accountProgress({ now: 0 });
    await D.accountProgress({ now: D.PROGRESS_RETRY_MS - 1 });
    expect(globalThis.SBW.progress).toHaveBeenCalledTimes(1);
    await D.accountProgress({ now: D.PROGRESS_RETRY_MS });
    expect(globalThis.SBW.progress).toHaveBeenCalledTimes(2);
  });

  it('an answer without the summary\'s shape is not trusted', () => {
    expect(D.progressResult({ ok: true, data: { rankTracking: {} } }, 'o').state).toBe('unavailable');
  });

  it('progressLink tags a dashboard path for the new tab, and refuses anything else', () => {
    globalThis.SBWSiteLinks = { siteUrl: (origin, path, surface) => `${origin}${path}#${surface}` };
    expect(D.progressLink('https://seobandwagon.com', '/dashboard/rank-tracker/')).toBe('https://seobandwagon.com/dashboard/rank-tracker/#new_tab');
    expect(D.progressLink('https://seobandwagon.com', 'https://evil.example/')).toBeNull();
    delete globalThis.SBWSiteLinks;
  });
});

/* ----------------------------- rank changes ------------------------------ */

describe('rank changes (1.10.0)', () => {
  // Rows from the live feed of 2026-10-27, seobandwagon.com's own tracker.
  const T1 = 'bc6f1b67-b060-4207-a292-de04bab296a1';
  const T2 = 'fb3fb28b-fe0f-4df0-a2d7-5bb26f66388b';
  const drop = (over) => ({
    trackerId: T1, keyword: 'k', domain: 'seobandwagon.com', from: 6, to: 26,
    lostUrl: null, nowUrl: null, swapped: false, tookSpot: null, since: '2026-10-17', fix: null,
    analyzePath: '/dashboard/rank-tracker/drop?tracker=' + T1 + '&keyword=k', ...over,
  });
  const SITE = 'https://seobandwagon.com';
  const links = { siteUrl: (origin, path, surface) => `${origin}${path}#${surface}` };

  it('dropView shows from → to as the feed gives it, the page that lost it, and the page Google swapped in', () => {
    globalThis.SBWSiteLinks = links;
    const v = D.dropView(drop({
      keyword: 'swamp seo', lostUrl: 'https://seobandwagon.com/contact', nowUrl: 'https://seobandwagon.com/',
      swapped: true, tookSpot: 'www.youtube.com',
      analyzePath: '/dashboard/rank-tracker/drop?tracker=' + T1 + '&keyword=swamp%20seo',
    }), SITE);
    expect(v).toMatchObject({
      keyword: 'swamp seo', from: 6, to: 26, out: false, fell: 20,
      lostUrl: 'https://seobandwagon.com/contact', nowUrl: 'https://seobandwagon.com/',
      tookSpot: 'www.youtube.com', fix: null, since: '2026-10-17',
      analyzeUrl: SITE + '/dashboard/rank-tracker/drop?tracker=' + T1 + '&keyword=swamp%20seo#new_tab',
    });
    delete globalThis.SBWSiteLinks;
  });

  it('dropView: `to` null is out of the checked results, and an unswapped page is not repeated', () => {
    const v = D.dropView(drop({
      keyword: 'how much does law firm seo cost', from: 8, to: null,
      lostUrl: 'https://seobandwagon.com/law-firm-seo', nowUrl: 'https://seobandwagon.com/law-firm-seo', tookSpot: '6smarketers.com',
    }), SITE);
    expect(v).toMatchObject({ from: 8, to: null, out: true, fell: null, nowUrl: null });
  });

  it('dropView names the fix with the extension\'s own title, and links only http(s) pages', () => {
    expect(D.dropView(drop({ fix: 'Description too long' }), SITE).fix).toBe('Description too long');
    expect(D.dropView(drop({ fix: 'Missing title' }), SITE).fix).toBe('No title tag');
    expect(D.dropView(drop({ fix: 'An issue the extension has no text for' }), SITE).fix).toBe('An issue the extension has no text for');
    expect(D.dropView(drop({ lostUrl: 'javascript:alert(1)' }), SITE).lostUrl).toBeNull();
    expect(D.dropView(drop({ lostUrl: 'not a url' }), SITE).lostUrl).toBeNull();
    expect(D.dropView(drop({ swapped: true, nowUrl: 'data:text/html,x' }), SITE).nowUrl).toBeNull();
  });

  it('trackerOrder: most drops first, ties to the best lost position, then the feed\'s order', () => {
    const trackers = [{ id: T2, domain: 'mastercontrolpress.com' }, { id: T1, domain: 'seobandwagon.com' }, { id: 'none', domain: 'quiet.example' }];
    const drops = [
      drop({ trackerId: T2, from: 4 }), drop({ trackerId: T2, from: 4 }), drop({ trackerId: T2, from: 24 }),
      drop({ trackerId: T1, from: 6 }), drop({ trackerId: T1, from: 8 }), drop({ trackerId: T1, from: 10 }),
      drop({ trackerId: T1, from: 11 }), drop({ trackerId: T1, from: 13 }),
    ];
    const order = D.trackerOrder(trackers, drops);
    expect(order.map((o) => [o.tracker.domain, o.drops.length])).toEqual([
      ['seobandwagon.com', 5], ['mastercontrolpress.com', 3], ['quiet.example', 0],
    ]);
    // Five each (the feed's cap): the better lost position leads.
    const capped = [...[9, 10, 11, 12, 13].map((from) => drop({ trackerId: T2, from })), ...[2, 30, 31, 32, 33].map((from) => drop({ trackerId: T1, from }))];
    expect(D.trackerOrder(trackers, capped)[0].tracker.id).toBe(T1);
    // Within a tracker the drops keep the feed's order (search volume since
    // website #519), never re-sorted by position lost.
    const byVolume = [drop({ keyword: 'law firm seo cost', from: 10 }), drop({ trackerId: T2, keyword: 'acf mcp', from: 4 }),
      drop({ keyword: 'swamp seo', from: 6 }), drop({ keyword: 'banstead seo', from: 11 })];
    expect(D.trackerOrder(trackers, byVolume)[0].drops.map((d) => d.keyword)).toEqual(['law firm seo cost', 'swamp seo', 'banstead seo']);
    // No drops anywhere: the feed's order stands.
    expect(D.trackerOrder(trackers, []).map((o) => o.tracker.id)).toEqual([T2, T1, 'none']);
    expect(D.trackerOrder(trackers, undefined)).toHaveLength(3);
  });

  it('trackerGains keeps the keywords on that tracker that went up', () => {
    const movers = [
      { trackerId: T1, keyword: 'ahrefs seo toolbar', from: 77, to: 32, change: 45 },
      { trackerId: T1, keyword: 'wordpress band theme', from: 20, to: 63, change: -43 },
      { trackerId: T2, keyword: 'acf mcp', from: 9, to: 3, change: 6 },
    ];
    expect(D.trackerGains(movers, T1).map((m) => m.keyword)).toEqual(['ahrefs seo toolbar']);
    expect(D.trackerGains(undefined, T1)).toEqual([]);
  });

  it('auditDetail: the first two issues, comma-separated, and the date', () => {
    const now = Date.parse('2026-10-27T18:00:00Z');
    const row = (issues, at) => ({ at, capture: { seoScore: { issues } } });
    expect(D.auditDetail(row(['Title too long', 'No structured data', 'Thin content'], Date.parse('2026-10-26T15:00:00Z')), now))
      .toBe('Title too long, No structured data · Oct 26');
    expect(D.auditDetail(row([], Date.parse('2025-12-30T15:00:00Z')), now)).toBe('No issues found · Dec 30, 2025');
    expect(D.auditDetail(row(['Missing H1'], 0), now)).toBe('Missing H1');
  });
});
