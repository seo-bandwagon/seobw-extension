// The Chrome Web Store package: the shared manifest as it is (less "key",
// which every target drops) and the browser values extension/src/lib/browser.js
// already holds. tests/unit/browser.test.js fails when the two differ.
export default {
  target: 'chrome',
  // store-submit.yml downloads the Chrome zip by this name from the release.
  zip: 'seo-bw-extension-{version}.zip',
  manifest: {},
  dropPermissions: [],
  leaveOut: [],
  browser: {
    target: 'chrome',
    name: 'Chrome',
    storeName: 'Chrome Web Store',
    storeUrl: 'https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj',
    reviewUrl: 'https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj/reviews',
    themeStoreUrl: 'https://chromewebstore.google.com/detail/',
    privateWindow: 'Incognito',
    privateSwitches: '"Allow in Private" (Brave) or "Allow in Incognito" (Chrome)',
    storeHosts: [
      { host: 'chromewebstore.google.com', path: '/' },
      { host: 'chrome.google.com', path: '/webstore' }
    ],
    shortcut: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
    utmSource: 'chrome_extension',
    connectButton: 'Connect Chrome extension',
    newTab: true,
    sitePages: true
  }
};
