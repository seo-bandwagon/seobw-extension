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

  it('listingUrl() is null while THEME_IDS are placeholders, and a real id builds the store URL', async () => {
    const S = await load(chromeStub());
    expect(S.listingUrl('dark')).toBeNull();
    expect(S.listingUrl('light')).toBeNull();
    S.THEME_IDS.dark = 'abcdefghijklmnopabcdefghijklmnop';
    expect(S.listingUrl('dark')).toBe('https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop');
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
