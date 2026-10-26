// SEO Bandwagon — whether a new tab shows the dashboard (1.9.5)
//
// The new tab dashboard is for people who installed one of the two Chrome
// themes, Neon Night or Neon Day (owner ruling, 2026-10-26; the original
// design). Without one, the extension hands the tab straight to Chrome's own
// new tab, so nobody who kept their own theme gets their new tab replaced.
// Detecting the theme needs the `management` permission (chrome.management
// .getAll lists themes); nothing it reads leaves the browser.
//
// A setting overrides the default: "theme" (the dashboard with a Neon theme,
// Chrome's new tab without one), "always", or "off".
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWNewTabGate = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const SETTING_KEY = 'bwNewTab';
  const SETTINGS = ['theme', 'always', 'off'];
  const DEFAULT_SETTING = 'theme';
  // Dismissing the "add a theme" prompt in the popup.
  const PROMPT_DISMISSED_KEY = 'bwThemePromptDismissed';
  // Chrome's own new tab, the handoff target when the dashboard is not shown.
  const CHROME_NEW_TAB_URL = 'chrome://new-tab-page/';
  // The themes' manifest names: an unpacked copy (development, or a person who
  // loaded the zip) gets an id of its own, so the name finds it too.
  const THEME_NAMES = { dark: 'SEO Bandwagon — Neon Night', light: 'SEO Bandwagon — Neon Day' };

  // chrome.management.getAll() → 'dark' (Neon Night), 'light' (Neon Day) or null.
  function themeModeFrom(infos, themeIds) {
    for (const info of infos || []) {
      if (!info || info.type !== 'theme' || !info.enabled) continue;
      for (const mode of ['dark', 'light']) {
        if (info.id === (themeIds || {})[mode] || info.name === THEME_NAMES[mode]) return mode;
      }
    }
    return null;
  }

  function settingOf(value) {
    return SETTINGS.includes(value) ? value : DEFAULT_SETTING;
  }

  // 'dashboard' or 'chrome', from the setting and the installed theme.
  function decide(setting, themeMode) {
    const s = settingOf(setting);
    if (s === 'always') return 'dashboard';
    if (s === 'off') return 'chrome';
    return themeMode ? 'dashboard' : 'chrome';
  }

  // The popup's "add Neon Night or Neon Day" strip: only under the default
  // setting, only while no Neon theme is on, until dismissed.
  function shouldPrompt({ setting, themeMode, dismissed }) {
    return settingOf(setting) === 'theme' && !themeMode && !dismissed;
  }

  // The live answer, for extension pages. Without the API (a test page, or a
  // build without the permission) it reports no theme.
  async function installedThemeMode(themeIds) {
    try {
      if (typeof chrome === 'undefined' || !chrome.management || !chrome.management.getAll) return null;
      return themeModeFrom(await chrome.management.getAll(), themeIds);
    } catch (_) {
      return null;
    }
  }

  return {
    SETTING_KEY, SETTINGS, DEFAULT_SETTING, PROMPT_DISMISSED_KEY, CHROME_NEW_TAB_URL, THEME_NAMES,
    themeModeFrom, settingOf, decide, shouldPrompt, installedThemeMode
  };
});
