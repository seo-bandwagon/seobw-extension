// Unit tests for "open a link and analyze it" (src/lib/analyze-link.js), the
// flow behind the results overlay's Analyze button and the context menu's
// "Analyze linked page": open the link in a new tab, and once the page it
// lands on has loaded, open the popup, which analyzes it (or, without access
// to that tab, offers "Allow access to analyze other tabs", S29). A person's
// click starts each one; nothing here reads a page on its own.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../../extension/src/lib/analyze-link.js');
const SBWAnalyzeLink = globalThis.SBWAnalyzeLink;

let listeners, created, updated, openPopup, open;

function fakeChrome() {
  listeners = new Set();
  created = [];
  updated = [];
  openPopup = vi.fn(() => Promise.resolve());
  return {
    tabs: {
      create: vi.fn(async ({ url }) => { const tab = { id: 100 + created.length, url }; created.push(tab); return tab; }),
      update: vi.fn(async (id, { url }) => { updated.push({ id, url }); return { id, url }; }),
      onUpdated: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn)
      }
    },
    action: { openPopup }
  };
}

// What chrome.tabs.onUpdated reports as a tab loads.
function loaded(tabId, url) {
  for (const fn of [...listeners]) fn(tabId, { status: 'complete' }, { id: tabId, url });
}

beforeEach(() => {
  vi.useFakeTimers();
  open = SBWAnalyzeLink.createAnalyzeLink(fakeChrome()).open;
});
afterEach(() => vi.useRealTimers());

describe('open(url)', () => {
  it('opens the link in a new tab and the popup once the page has loaded', async () => {
    const res = await open('https://example.com/page');
    expect(res).toEqual({ ok: true, tabId: 100 });
    expect(created).toEqual([{ id: 100, url: 'https://example.com/page' }]);
    expect(openPopup).not.toHaveBeenCalled();
    loaded(100, 'https://example.com/page');
    await vi.advanceTimersByTimeAsync(SBWAnalyzeLink.POPUP_DELAY_MS);
    expect(openPopup).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('waits past Google\'s redirect page for the page the link lands on', async () => {
    await open('https://www.google.com/goto?url=CAESopaque');
    loaded(100, 'https://www.google.com/goto?url=CAESopaque');
    loaded(100, 'https://www.google.co.uk/url?q=https://example.com/');
    await vi.advanceTimersByTimeAsync(5000);
    expect(openPopup).not.toHaveBeenCalled();
    loaded(100, 'https://example.com/');
    await vi.advanceTimersByTimeAsync(SBWAnalyzeLink.POPUP_DELAY_MS);
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('analyzes a result that is itself a Google page (not a redirect)', async () => {
    await open('https://support.google.com/webmasters/answer/1');
    loaded(100, 'https://support.google.com/webmasters/answer/1');
    await vi.advanceTimersByTimeAsync(SBWAnalyzeLink.POPUP_DELAY_MS);
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('ignores other tabs loading, and opens the popup only once', async () => {
    await open('https://example.com/');
    loaded(7, 'https://other.example/');
    await vi.advanceTimersByTimeAsync(5000);
    expect(openPopup).not.toHaveBeenCalled();
    loaded(100, 'https://example.com/');
    loaded(100, 'https://example.com/');
    await vi.advanceTimersByTimeAsync(SBWAnalyzeLink.POPUP_DELAY_MS);
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('stops waiting after GIVE_UP_MS if the page never finishes loading', async () => {
    await open('https://slow.example/');
    await vi.advanceTimersByTimeAsync(SBWAnalyzeLink.GIVE_UP_MS);
    expect(listeners.size).toBe(0);
    loaded(100, 'https://slow.example/');
    await vi.advanceTimersByTimeAsync(5000);
    expect(openPopup).not.toHaveBeenCalled();
  });

  it('swallows a refused openPopup (no focused window): the tab is open, the icon still works', async () => {
    openPopup.mockImplementation(() => Promise.reject(new Error('no focused window')));
    await open('https://example.com/');
    loaded(100, 'https://example.com/');
    await expect(vi.advanceTimersByTimeAsync(SBWAnalyzeLink.POPUP_DELAY_MS)).resolves.not.toThrow();
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('opens nothing for a link that is not http(s)', async () => {
    for (const bad of ['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', '', undefined, 'not a url']) {
      expect(await open(bad)).toEqual({ ok: false, error: 'invalid_url' });
    }
    expect(created).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});

describe('open(url, { tabId })', () => {
  it('opens the site in the tab it was asked from (the new tab page) and analyzes it there', async () => {
    const res = await open('https://example.com/', { tabId: 42 });
    expect(res).toEqual({ ok: true, tabId: 42 });
    expect(created).toEqual([]);
    expect(updated).toEqual([{ id: 42, url: 'https://example.com/' }]);
    loaded(42, 'https://example.com/');
    await vi.advanceTimersByTimeAsync(SBWAnalyzeLink.POPUP_DELAY_MS);
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('still refuses anything that is not http(s), in the same tab too', async () => {
    expect(await open('chrome://settings', { tabId: 42 })).toEqual({ ok: false, error: 'invalid_url' });
    expect(updated).toEqual([]);
  });
});
