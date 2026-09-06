// Unit tests for the optional <all_urls> permission helper (src/lib/perms.js).
// Covers: hasAllUrls()/requestAllUrls() delegate to chrome.permissions with
// the right origins shape and propagate the boolean result, and the reason
// copy used verbatim by the UI card.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — the module attaches
// itself to `globalThis.SBWPerms` rather than an ESM default export.
await import('../../src/lib/perms.js');
const SBWPerms = globalThis.SBWPerms;

describe('SBWPerms namespace', () => {
  it('attaches to globalThis.SBWPerms', () => {
    expect(SBWPerms).toBeTruthy();
    expect(typeof SBWPerms.hasAllUrls).toBe('function');
    expect(typeof SBWPerms.requestAllUrls).toBe('function');
    expect(typeof SBWPerms.onAllUrlsGranted).toBe('function');
  });

  it('exposes a plain-language ALL_URLS_REASON covering both fetch and trace-in-a-tab', () => {
    expect(typeof SBWPerms.ALL_URLS_REASON).toBe('string');
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/look at pages on other sites/i);
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/without cookies/i);
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/opens that url in a background tab/i);
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/nothing it sees on those sites is sent to SEO Bandwagon/i);
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/revoke this at any time from the extensions page/i);
  });
});

describe('hasAllUrls', () => {
  let containsCalls;

  beforeEach(() => {
    containsCalls = [];
    globalThis.chrome = {
      permissions: {
        contains: (opts) => { containsCalls.push(opts); return Promise.resolve(true); },
        request: () => Promise.resolve(false)
      }
    };
  });

  it('calls chrome.permissions.contains with origins: [<all_urls>]', async () => {
    const result = await SBWPerms.hasAllUrls();
    expect(containsCalls).toEqual([{ origins: ['<all_urls>'] }]);
    expect(result).toBe(true);
  });

  it('propagates false when the permission is absent', async () => {
    globalThis.chrome.permissions.contains = () => Promise.resolve(false);
    expect(await SBWPerms.hasAllUrls()).toBe(false);
  });
});

describe('requestAllUrls', () => {
  let requestCalls;

  beforeEach(() => {
    requestCalls = [];
    globalThis.chrome = {
      permissions: {
        contains: () => Promise.resolve(false),
        request: (opts) => { requestCalls.push(opts); return Promise.resolve(true); }
      }
    };
  });

  it('calls chrome.permissions.request with origins: [<all_urls>]', async () => {
    const result = await SBWPerms.requestAllUrls();
    expect(requestCalls).toEqual([{ origins: ['<all_urls>'] }]);
    expect(result).toBe(true);
  });

  it('propagates false when the user declines', async () => {
    globalThis.chrome.permissions.request = () => Promise.resolve(false);
    expect(await SBWPerms.requestAllUrls()).toBe(false);
  });
});

describe('onAllUrlsGranted', () => {
  let listeners;
  let has;

  beforeEach(() => {
    listeners = [];
    has = false;
    globalThis.chrome = {
      permissions: {
        contains: () => Promise.resolve(has),
        request: () => Promise.resolve(false),
        onAdded: {
          addListener: (fn) => listeners.push(fn),
          removeListener: (fn) => {
            const i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
          }
        }
      }
    };
  });

  it('registers a chrome.permissions.onAdded listener and calls cb once hasAllUrls() reports true', async () => {
    const cb = vi.fn();
    SBWPerms.onAllUrlsGranted(cb);
    expect(listeners).toHaveLength(1);

    has = true;
    listeners[0]({ origins: ['<all_urls>'] });
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not call cb when the event fires but hasAllUrls() still reports false', async () => {
    const cb = vi.fn();
    SBWPerms.onAllUrlsGranted(cb);
    listeners[0]({ origins: ['https://example.com/*'] });
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const unsub = SBWPerms.onAllUrlsGranted(() => {});
    expect(listeners).toHaveLength(1);
    unsub();
    expect(listeners).toHaveLength(0);
  });

  it('returns a safe no-op unsubscribe when chrome.permissions.onAdded is unavailable', () => {
    globalThis.chrome = { permissions: { contains: () => Promise.resolve(false), request: () => Promise.resolve(false) } };
    const cb = vi.fn();
    const unsub = SBWPerms.onAllUrlsGranted(cb);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});
