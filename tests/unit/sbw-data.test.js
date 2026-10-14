// src/lib/sbw-data.js — the only route from a themed surface to the product.
//
// The rules being tested are the ones that keep a surface honest: no request
// when there is no key, no second request while a verified key is still fresh,
// no number that did not come from the shipped scorer, and a complete render
// when the API is unreachable.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as D from '../../extension/src/lib/sbw-data.js';
import SubScores from '../../extension/src/lib/sub-scores.js';

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
