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
export const pinMode = (mode) => required().pin(mode);

/**
 * Which Bandwagon Chrome theme is enabled right now: 'dark' (Neon Night),
 * 'light' (Neon Day) or null.
 *
 * Since 1.9.5 the extension holds `management` (owner ruling 2026-10-26,
 * reversing 2026-09-07): the new tab shows the dashboard only with a Neon
 * theme on. The answer comes from src/lib/newtab-gate.js, which a page loads
 * as a classic script; without it, or without the API, this is null.
 */
export async function installedThemeMode() {
  const gate = globalThis.SBWNewTabGate;
  return gate ? gate.installedThemeMode(required().THEME_IDS) : null;
}
