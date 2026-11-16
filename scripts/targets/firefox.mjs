// The Firefox package (1.13.10): the shared manifest with this overlay, and
// these browser values written into src/lib/browser.js. Built for
// `web-ext lint` in CI and for 2.0.0's Firefox launch; nothing is submitted
// to addons.mozilla.org (AMO) before then. 2.0.0 adds the sidebar
// (`sidebar_action`) and the consent prompts.
//
// Mozilla's rules this follows, read 2026-11-16:
//   - MDN, "background": Firefox doesn't run `background.service_worker`
//     (bug 1573659) and loads `background.scripts` as one background page,
//     "in the order they appear", sharing one `window`. Chrome, from 121,
//     ignores `scripts` in a Manifest V3 manifest.
//   - MDN, "browser_specific_settings": `gecko.id` is required to sign a
//     Manifest V3 extension ("AMO does not assign an ID"), and new AMO
//     submissions since 2025-11-03 must declare `data_collection_permissions`.
//   - Extension Workshop, "Firefox built-in consent for data collection":
//     an extension that collects only optional data declares
//     `required: ["none"]`; Firefox shows the consent from desktop 140.
//   - AMO counts a build that strips comments as machine-generated code and
//     then asks for the source, so this package keeps every comment.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import GOOGLE_DOMAINS from './google-domains.mjs';

const require = createRequire(import.meta.url);
const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
const WORKER = 'src/background/service-worker.js';
const { FIREFOX_CATEGORIES } = require(path.join(EXTENSION, 'src', 'lib', 'consent.js'));

// The files the worker loads with importScripts(), as extension paths, in
// the order it loads them, then the worker itself. A background page has no
// importScripts (it is a worker API), so on Firefox the manifest loads them
// and the worker's calls are skipped (`typeof importScripts`). Read from the
// worker's own calls, so a library added there reaches Firefox too.
export function workerScripts(source, worker = WORKER) {
  const dir = path.posix.dirname(worker);
  const files = [];
  for (const call of source.matchAll(/\bimportScripts\(([^)]*)\)/g)) {
    for (const lit of call[1].matchAll(/'([^']+)'/g)) {
      const file = path.posix.normalize(path.posix.join(dir, lit[1]));
      if (!files.includes(file)) files.push(file);
    }
  }
  if (!files.length) throw new Error(`${worker}: no importScripts() calls to read`);
  return [...files, worker];
}

const workerSource = fs.readFileSync(path.join(EXTENSION, WORKER), 'utf8');

export default {
  target: 'firefox',
  zip: 'seo-bw-extension-firefox-{version}.zip',
  // KEEP_COMMENTS=1 for this target always: AMO reviewers read the source as
  // it is in the repo, so no source upload is needed.
  keepComments: true,
  // A JSON merge patch (RFC 7396) on manifest.json: an object merges into the
  // one beside it, null removes the key, anything else replaces it.
  manifest: {
    // The new tab dashboard exists to go with the Neon Night and Neon Day
    // themes, which are Chrome Web Store items (vault design decision 3).
    chrome_url_overrides: null,
    background: {
      // `web-ext lint` (addons-linter, web-ext 10.8.0) warns that Firefox
      // ignores `service_worker` (BACKGROUND_SERVICE_WORKER_IGNORED), so the
      // Firefox manifest names only the page.
      service_worker: null,
      scripts: workerScripts(workerSource)
    },
    browser_specific_settings: {
      gecko: {
        // Ours, fixed at the first AMO signing (not done yet).
        id: 'seo-bandwagon@seobandwagon.com',
        // 140: Firefox's own data-collection consent (desktop 140), which
        // src/lib/consent.js reads through permissions.contains().
        strict_min_version: '140.0',
        data_collection_permissions: {
          // Nothing is sent without the person's yes.
          required: ['none'],
          // What each flow in src/lib/consent.js asks Firefox for, inside
          // the click that accepts it (permissions.request()).
          optional: [...FIREFOX_CATEGORIES]
        }
      }
    },
    // Ctrl+Shift+S, and Command+Shift+S on a Mac, is Firefox's Screenshot
    // (`key_screenshot`, modifiers "accel,shift", key S, in Firefox's
    // browser/base/content/browser-sets.inc.xhtml at 828de2c6, 2026-11-05).
    // Neither Alt+Shift+S nor Control+Shift+S on a Mac is in that keyset or
    // in DevTools' (devtools/startup/DevToolsStartup.sys.mjs); the Edge
    // package uses the same pair.
    commands: {
      'analyze-current': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' }
      }
    }
  },
  // Every Google search domain, granted at install (Firefox from 127 shows
  // `host_permissions` in the install prompt), because Firefox grants no
  // host an update adds (google-domains.mjs says why). The results overlay
  // still runs only on the thirty its content script matches.
  addHostPermissions: GOOGLE_DOMAINS.map((host) => `https://${host}/*`),
  // `management` only reads which Neon theme is on, for the new tab
  // (decision 3). The optional `topSites` and `search` are asked for only by
  // the new tab's search box and most visited sites. Firefox has neither
  // `sidePanel` nor `offscreen` (`web-ext lint`: "Invalid permissions"):
  // the code checks for chrome.sidePanel, and on Firefox reads Analyze's
  // pages in the background page, which has a DOMParser, instead of an
  // offscreen document. Firefox's sidebar (`sidebar_action`) comes with
  // 2.0.0.
  dropPermissions: ['management', 'topSites', 'search', 'sidePanel', 'offscreen'],
  // Files no Firefox manifest entry or page reaches.
  leaveOut: ['src/newtab/'],
  browser: {
    target: 'firefox',
    name: 'Firefox',
    storeName: 'Firefox Browser Add-ons',
    // There is no AMO listing until 2.0.0, so no listing to link or review:
    // the review prompt and the "Rate us" links stay off.
    storeUrl: null,
    reviewUrl: null,
    // Neon Night and Neon Day are Chrome Web Store items: no theme links.
    themeStoreUrl: null,
    // about:addons, an extension's Details: "Run in Private Windows", Allow
    // (Firefox's toolkit/locales/en-US/toolkit/about/aboutAddons.ftl).
    privateWindow: 'Private Windows',
    privateSwitches: '"Run in Private Windows"',
    // Pages no extension may read: Firefox's
    // extensions.webextensions.restrictedDomains (modules/libpref/init/all.js).
    storeHosts: [
      'accounts-static.cdn.mozilla.net',
      'accounts.firefox.com',
      'addons.cdn.mozilla.net',
      'addons.mozilla.org',
      'api.accounts.firefox.com',
      'content.cdn.mozilla.net',
      'discovery.addons.mozilla.org',
      'oauth.accounts.firefox.com',
      'profile.accounts.firefox.com',
      'support.mozilla.org',
      'sync.services.mozilla.com'
    ].map((host) => ({ host, path: '/' })),
    shortcut: { default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' },
    // Firefox's shortcuts page is in about:addons, which tabs.create may not
    // open (MDN, tabs.create: privileged about: URLs fail). Without an
    // address, SBWShortcut.openSettings() calls commands.openShortcutSettings()
    // (Firefox 137).
    shortcutsUrl: null,
    utmSource: 'firefox_extension',
    // seobandwagon.com's API keys page names its button for Chrome; as on
    // Edge, Settings names it without the browser.
    connectButton: 'Connect extension',
    newTab: false,
    // seobandwagon.com's welcome page and uninstall survey both say "Chrome
    // extension", so the Firefox build opens neither (as on Edge).
    sitePages: false
  }
};
