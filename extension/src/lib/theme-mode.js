// SEO Bandwagon — appearance (Night / Day) for the extension's own pages.
//
// Precedence: explicit user choice (chrome.storage.local `bwThemeMode`) > the
// OS setting (prefers-color-scheme). "Auto" is the ABSENCE of a stored choice —
// clearMode() removes the key rather than writing 'auto', so following the OS
// stays reachable after someone has picked a side.
//
// The two Chrome themes (Neon Night / Neon Day) are separate Web Store items; a
// theme has no code, so nothing here can detect which one is installed (that
// would need the `management` permission, which this extension does not ask
// for). The popup, side panel and options page all load this file in <head> and
// read `<html data-theme>`; popup.css carries the two token blocks.
//
// First paint: chrome.storage is async, so the last resolved mode is mirrored
// into localStorage (extension pages have their own origin) and applied
// synchronously on load. The async read then confirms or corrects it.
(function (root) {
  'use strict';

  const STORAGE_KEY = 'bwThemeMode';
  const MIRROR_KEY = 'bwThemeMode:last';
  const MODES = ['dark', 'light'];

  // The two published Chrome theme items (filled 2026-09-08). A non-id here —
  // a placeholder, or a cleared string — makes listingUrl() return null and
  // every link to a theme hide itself, which is the behaviour before upload.
  const THEME_IDS = {
    dark: 'bomhiblgnbmpgbddhocomnbijdkmpbhl',
    light: 'ldifldabjbffldoekbebpickddaiiggm',
  };
  const ID_RE = /^[a-p]{32}$/; // Chrome extension/theme ids are 32 chars of a–p

  const hasChrome = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const doc = () => (typeof document !== 'undefined' ? document : null);

  function osMode() {
    try {
      return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'dark'; }
  }

  function isMode(v) { return MODES.indexOf(v) !== -1; }

  /** The explicit choice, or null when on Auto. */
  async function storedMode() {
    if (!hasChrome()) return null;
    try {
      const got = await chrome.storage.local.get(STORAGE_KEY);
      const v = got && got[STORAGE_KEY];
      return isMode(v) ? v : null;
    } catch (e) { return null; }
  }

  /** stored choice → OS setting. Pure given its inputs; exported for tests. */
  function resolve(stored, os) {
    return isMode(stored) ? stored : (isMode(os) ? os : 'dark');
  }

  async function resolveMode() {
    return resolve(await storedMode(), osMode());
  }

  function paint(mode) {
    const d = doc();
    if (d && d.documentElement) d.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem(MIRROR_KEY, mode); } catch (e) { /* private mode etc. */ }
    return mode;
  }

  /** Synchronous first paint from the mirror (or the OS), before storage answers. */
  function paintFromMirror() {
    let last = null;
    try { last = localStorage.getItem(MIRROR_KEY); } catch (e) { /* ignore */ }
    return paint(isMode(last) ? last : osMode());
  }

  /** Resolve and paint. Returns the mode used. */
  async function applyTheme() {
    return paint(await resolveMode());
  }

  /** Explicit choice; sticks until clearMode(). */
  async function setMode(mode) {
    if (!isMode(mode)) throw new Error('mode must be dark or light');
    if (hasChrome()) await chrome.storage.local.set({ [STORAGE_KEY]: mode });
    return paint(mode);
  }

  /** Back to Auto: remove the key (never write 'auto'), then follow the OS. */
  async function clearMode() {
    if (hasChrome()) await chrome.storage.local.remove(STORAGE_KEY);
    return applyTheme();
  }

  /** Re-paint when the choice changes in another surface or the OS flips. */
  function watch(onChange) {
    const rerun = async () => { const m = await applyTheme(); if (onChange) onChange(m); };
    if (hasChrome() && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes && Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) rerun();
      });
    }
    try {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      if (mq && mq.addEventListener) mq.addEventListener('change', rerun);
    } catch (e) { /* no matchMedia */ }
    return rerun;
  }

  /** 'auto' | 'dark' | 'light' for a tri-state control (reflects the STORED choice). */
  async function controlState() {
    return (await storedMode()) || 'auto';
  }

  function listingUrl(mode) {
    const id = THEME_IDS[mode === 'light' ? 'light' : 'dark'];
    return ID_RE.test(id) ? 'https://chromewebstore.google.com/detail/' + id : null;
  }

  // Wire a group of buttons with data-mode="auto|dark|light" and aria-pressed.
  function bindControl(container, onChange) {
    if (!container) return;
    const buttons = Array.prototype.slice.call(container.querySelectorAll('[data-mode]'));
    const paintButtons = async () => {
      const state = await controlState();
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === state)));
    };
    buttons.forEach((b) => {
      b.addEventListener('click', async () => {
        const pick = b.getAttribute('data-mode');
        const mode = pick === 'auto' ? await clearMode() : await setMode(pick);
        await paintButtons();
        if (onChange) onChange(mode);
      });
    });
    paintButtons();
    watch(paintButtons);
  }

  // Paint immediately on load in a page context, then once more when the
  // document is ready (storage may not have been available at parse time —
  // in the preview harness the chrome stub installs after this script runs).
  if (doc()) {
    paintFromMirror();
    applyTheme();
    if (doc().readyState === 'loading') doc().addEventListener('DOMContentLoaded', () => { applyTheme(); });
  }

  const api = {
    STORAGE_KEY, MIRROR_KEY, THEME_IDS, MODES,
    resolve, osMode, storedMode, resolveMode, applyTheme, setMode, clearMode,
    watch, controlState, listingUrl, bindControl, paintFromMirror,
  };
  root.SBWTheme = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
