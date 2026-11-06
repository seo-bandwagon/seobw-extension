// The Microsoft Edge Add-ons package (1.13.6): the shared manifest with this
// overlay, and these browser values written into src/lib/browser.js.
//
// Microsoft Edge Add-ons developer policy 1.1.2: the extension "must not
// reference other browsers", so every user-facing string reads its browser
// and store from browser.js, and tests/unit/build-targets.test.js scans the
// built package for "Chrome".
export default {
  target: 'edge',
  zip: 'seo-bw-extension-edge-{version}.zip',
  // A JSON merge patch (RFC 7396) on manifest.json: an object merges into the
  // one beside it, null removes the key, anything else replaces it.
  manifest: {
    // The new tab dashboard exists to go with the Neon Night and Neon Day
    // themes, which are Chrome Web Store items (vault design decision 3).
    chrome_url_overrides: null,
    // Ctrl+Shift+S is Edge's Web capture. Alt+Shift+S and, on a Mac,
    // Control+Shift+S are on neither of Microsoft's lists ("Keyboard shortcuts
    // in Microsoft Edge", read 2026-11-05), which use Alt+Shift only for B, I
    // and T, and Control only for Ctrl+M and Command+Ctrl+F on a Mac.
    commands: {
      'analyze-current': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' }
      }
    }
  },
  // `management` only reads which Neon theme is on, for the new tab; never
  // in the Edge build (vault design, Constraints). The optional `topSites`
  // and `search` are asked for only by the new tab's "search box and your
  // most visited sites": Edge policy 1.6 allows no permission a build doesn't
  // use.
  dropPermissions: ['management', 'topSites', 'search'],
  // Files no Edge manifest entry or page reaches.
  leaveOut: ['src/newtab/'],
  browser: {
    target: 'edge',
    name: 'Microsoft Edge',
    storeName: 'Microsoft Edge Add-ons',
    // Microsoft assigns the item's ID, and with it the listing's address, at
    // the first upload in Partner Center. Until the owner creates the product
    // there is no listing to link or review, so the review prompt and the
    // "Rate us" links stay off.
    storeUrl: null,
    reviewUrl: null,
    // Neon Night and Neon Day are Chrome Web Store items: no theme links.
    themeStoreUrl: null,
    privateWindow: 'InPrivate',
    privateSwitches: '"Allow in InPrivate"',
    storeHosts: [{ host: 'microsoftedge.microsoft.com', path: '/' }],
    shortcut: { default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' },
    utmSource: 'edge_extension',
    // The options page's "click Connect … there": the API keys page's button
    // says "Connect Chrome extension" today, so the Edge build gives it a
    // name without the browser, for the site to match.
    connectButton: 'Connect extension',
    newTab: false,
    // seobandwagon.com's welcome page (opened on a first install) and its
    // uninstall survey both say "Chrome extension", so the Edge build opens
    // neither until they name no browser.
    sitePages: false
  }
};
