// Unit tests for the optional <all_urls> permission helper (src/lib/perms.js).
// Covers: hasAllUrls()/requestAllUrls() delegate to chrome.permissions with
// the right origins shape and propagate the boolean result, and the reason
// copy used verbatim by the UI card.

import { describe, it, expect, beforeEach } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — the module attaches
// itself to `globalThis.SBWPerms` rather than an ESM default export.
await import('../../src/lib/perms.js');
const SBWPerms = globalThis.SBWPerms;

describe('SBWPerms namespace', () => {
  it('attaches to globalThis.SBWPerms', () => {
    expect(SBWPerms).toBeTruthy();
    expect(typeof SBWPerms.hasAllUrls).toBe('function');
    expect(typeof SBWPerms.requestAllUrls).toBe('function');
  });

  it('exposes a plain-language ALL_URLS_REASON', () => {
    expect(typeof SBWPerms.ALL_URLS_REASON).toBe('string');
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/fetch pages on other sites/i);
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/no cookies/i);
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/not.*sent to SEO Bandwagon|nothing it fetches is sent to SEO Bandwagon/i);
    expect(SBWPerms.ALL_URLS_REASON).toMatch(/chrome:\/\/extensions/);
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
