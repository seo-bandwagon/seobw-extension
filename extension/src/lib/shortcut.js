// SEO Bandwagon — the keyboard shortcut (1.13.8)
//
// "Analyze current page" (manifest `commands.analyze-current`) opens the
// popup. Until 1.13.8 the worker called chrome.action.openPopup() with no
// error handling, so a press with no focused browser window (or one the
// browser refused) did nothing and threw an uncaught rejection, and the
// shortcut was shown nowhere. Options and the popup's About now show it,
// "Not set" when the person cleared it, with a button to the browser's
// shortcuts page (SBWBrowser.shortcutsUrl).
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') globalThis.SBWShortcut = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(function () {
  'use strict';

  const NAME = 'analyze-current';

  // The shortcut as the browser reports it ("Ctrl+Shift+S", "⇧⌘S"), '' when
  // the person cleared it, null when it can't be read.
  async function current(chromeApi) {
    const c = chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    if (!c || !c.commands || typeof c.commands.getAll !== 'function') return null;
    try {
      const cmd = (await c.commands.getAll()).find((x) => x.name === NAME);
      return cmd ? (cmd.shortcut || '') : null;
    } catch (e) {
      return null;
    }
  }

  function label(shortcut) {
    if (shortcut === null || shortcut === undefined) return 'Unknown';
    return shortcut || 'Not set';
  }

  // The popup, in the window the press came from; the last focused normal
  // window when the browser refuses the first try. True when it opened.
  async function openPopup(chromeApi) {
    const c = chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    if (!c || !c.action || typeof c.action.openPopup !== 'function') return false;
    try {
      await c.action.openPopup();
      return true;
    } catch (e) {
      try {
        const win = await c.windows.getLastFocused({ windowTypes: ['normal'] });
        if (win && typeof win.id === 'number') {
          if (!win.focused) await c.windows.update(win.id, { focused: true });
          await c.action.openPopup({ windowId: win.id });
          return true;
        }
      } catch (e2) { /* no window to open it in */ }
      return false;
    }
  }

  return { NAME, current, label, openPopup };
});
