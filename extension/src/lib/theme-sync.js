/* SEO Bandwagon — ES-module view of the appearance system.
 *
 * The themed surfaces are ES modules; the appearance system that ships is
 * src/lib/theme-mode.js, a classic script that attaches `globalThis.SBWTheme`.
 * This is the seam between the two. It owns no state and no storage key: every
 * function here forwards to SBWTheme, so the popup, side panel, options page
 * and any themed surface all read and write the one `bwThemeMode` key.
 *
 * Load order matters. A page must load theme-mode.js as a plain <script>
 * before the module that imports this file, which is also what gives the page
 * its synchronous first paint from the localStorage mirror.
 *
 * Named theme-sync.js to match the import path in the Chrome-theme design
 * package, so its surfaces drop in unchanged.
 */

const T = () => globalThis.SBWTheme;

function required() {
  const t = T();
  if (!t) throw new Error('theme-mode.js must load before theme-sync.js');
  return t;
}

export const MODES = ['dark', 'light'];

/** The published theme item ids, from the one place that holds them. */
export const THEME_IDS = new Proxy({}, {
  get: (_, k) => { const t = T(); return t ? t.THEME_IDS[k] : undefined; },
  ownKeys: () => ['dark', 'light'],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

export const storedMode = () => required().storedMode();
export const resolveMode = () => required().resolveMode();
export const applyTheme = () => required().applyTheme();
export const setMode = (mode) => required().setMode(mode);
export const clearMode = () => required().clearMode();
export const watchThemeChanges = (onChange) => required().watch(onChange);
export const controlState = () => required().controlState();
export const bindControl = (el, onChange) => required().bindControl(el, onChange);
export const listingUrl = (mode) => required().listingUrl(mode);
export const osMode = () => required().osMode();

/**
 * Which Bandwagon Chrome theme is enabled right now.
 *
 * Always null. Answering it needs `chrome.management.getAll()`, and the
 * `management` permission was declined for this extension (owner ruling,
 * 2026-09-07) because it raises the "Manage your apps, extensions and themes"
 * install warning for a cosmetic gain. Appearance therefore follows the user's
 * own Night/Day/Auto choice and then the OS setting, which is what
 * SBWTheme.resolveMode() already does.
 *
 * Kept as an exported no-op so the design's surfaces import cleanly and so a
 * future decision to take the permission has one obvious place to land.
 */
export async function installedThemeMode() {
  return null;
}
