// src/lib/theme-mode.js — Night/Day precedence, storage key, control state.
import { describe, it, expect, beforeEach, vi } from 'vitest';

function chromeStub(initial = {}) {
  let store = { ...initial };
  const listeners = [];
  return {
    store: () => store,
    api: {
      storage: {
        local: {
          get: vi.fn(async (k) => (typeof k === 'string' ? { [k]: store[k] } : { ...store })),
          set: vi.fn(async (obj) => { store = { ...store, ...obj }; }),
          remove: vi.fn(async (k) => { const n = { ...store }; delete n[k]; store = n; }),
        },
        onChanged: { addListener: vi.fn((fn) => listeners.push(fn)) },
      },
    },
    fire: (changes) => listeners.forEach((fn) => fn(changes, 'local')),
  };
}

async function load(stub, dark = true) {
  globalThis.chrome = stub.api;
  globalThis.matchMedia = vi.fn(() => ({ matches: dark, addEventListener: vi.fn() }));
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  await import('../../extension/src/lib/theme-mode.js?t=' + Math.random());
  return globalThis.SBWTheme;
}

describe('SBWTheme', () => {
  beforeEach(() => { delete globalThis.SBWTheme; });

  it('resolve(): stored choice beats the OS, OS beats nothing, garbage falls to dark', () => {
    const T = { resolve: null };
    return load(chromeStub()).then((S) => {
      expect(S.resolve('light', 'dark')).toBe('light');
      expect(S.resolve(null, 'light')).toBe('light');
      expect(S.resolve('auto', 'dark')).toBe('dark');
      expect(S.resolve(undefined, 'nonsense')).toBe('dark');
      T.resolve = S.resolve;
    });
  });

  it('paints the OS mode on load when nothing is stored, and Auto is the control state', async () => {
    const S = await load(chromeStub(), false);
    await S.applyTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(await S.controlState()).toBe('auto');
    expect(await S.storedMode()).toBeNull();
  });

  // 1.9.5: the new tab follows the installed Neon theme. Its pin must win over
  // the load-time repaint, and must not touch the saved choice or the mirror
  // the other surfaces paint from first.
  it('pin() holds a mode for this page through later repaints, and saves nothing', async () => {
    const stub = chromeStub({ bwThemeMode: 'light' });
    const S = await load(stub, false);
    const pending = S.applyTheme(); // the repaint theme-mode.js starts on load
    S.pin('dark');
    await pending;
    await S.applyTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(stub.store()[S.STORAGE_KEY]).toBe('light');
    expect(localStorage.getItem(S.MIRROR_KEY)).not.toBe('dark');
    expect(() => S.pin('auto')).toThrow();
  });

  it('setMode() writes bwThemeMode and paints; clearMode() REMOVES the key (never writes "auto")', async () => {
    const stub = chromeStub();
    const S = await load(stub, true);
    await S.setMode('light');
    expect(stub.store()[S.STORAGE_KEY]).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(await S.controlState()).toBe('light');
    await S.clearMode();
    expect(S.STORAGE_KEY in stub.store()).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark'); // OS dark
    await expect(S.setMode('auto')).rejects.toThrow();
  });

  it('mirrors the last mode in localStorage for a synchronous first paint', async () => {
    const stub = chromeStub({ bwThemeMode: 'light' });
    const S = await load(stub, true);
    await S.applyTheme();
    expect(localStorage.getItem(S.MIRROR_KEY)).toBe('light');
    document.documentElement.setAttribute('data-theme', 'dark');
    S.paintFromMirror();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('watch() re-paints when another surface changes the key', async () => {
    const stub = chromeStub();
    const S = await load(stub, true);
    const seen = [];
    S.watch((m) => seen.push(m));
    stub.store().bwThemeMode = 'light';
    stub.fire({ bwThemeMode: { newValue: 'light' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['light']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('listingUrl() builds a store URL from each shipped id, and is null for a non-id', async () => {
    const S = await load(chromeStub());
    // The two published theme items. A typo here would point the options page
    // at someone else's listing, so assert the exact ids, not just the shape.
    expect(S.THEME_IDS.dark).toBe('bomhiblgnbmpgbddhocomnbijdkmpbhl');
    expect(S.THEME_IDS.light).toBe('ldifldabjbffldoekbebpickddaiiggm');
    expect(S.listingUrl('dark')).toBe(
      'https://chromewebstore.google.com/detail/bomhiblgnbmpgbddhocomnbijdkmpbhl'
    );
    expect(S.listingUrl('light')).toBe(
      'https://chromewebstore.google.com/detail/ldifldabjbffldoekbebpickddaiiggm'
    );
    // Anything that is not a 32-char a–p id hides the link rather than
    // producing a broken URL — the pre-upload behaviour, still reachable.
    S.THEME_IDS.dark = 'REPLACE_WITH_NEON_NIGHT_ITEM_ID';
    expect(S.listingUrl('dark')).toBeNull();
    S.THEME_IDS.light = '';
    expect(S.listingUrl('light')).toBeNull();
  });

  it('bindControl(): buttons reflect the STORED choice and clicking writes/removes the key', async () => {
    const stub = chromeStub();
    const S = await load(stub, true);
    document.body.innerHTML = '<div id="g"><button data-mode="auto"></button><button data-mode="dark"></button><button data-mode="light"></button></div>';
    S.bindControl(document.getElementById('g'));
    await new Promise((r) => setTimeout(r, 0));
    const pressed = () => [...document.querySelectorAll('#g button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.mode);
    expect(pressed()).toEqual(['auto']);
    document.querySelector('[data-mode="light"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(stub.store().bwThemeMode).toBe('light');
    expect(pressed()).toEqual(['light']);
    document.querySelector('[data-mode="auto"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect('bwThemeMode' in stub.store()).toBe(false);
    expect(pressed()).toEqual(['auto']);
  });
});
