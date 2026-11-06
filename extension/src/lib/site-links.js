// SEO Bandwagon — links the extension opens on seobandwagon.com
//
// Every page of ours the extension opens carries the same three UTM tags,
// utm_source=chrome_extension (edge_extension in the Edge build: the
// browser's own, from src/lib/browser.js), utm_medium=extension and the
// surface it was opened from as utm_campaign, so a visit (and a sign-in that
// follows it) is attributable in GA4. The site's own first-touch cookie reads
// the same tags. Static hrefs in the HTML pages carry them by hand, written
// for Chrome; scripts/build-zip.mjs writes another target's utm_source into
// them. tests/unit/site-links.test.js fails on one that does not, and on a
// script that opens a dashboard path without going through siteUrl().
//
// Also builds the two onboarding URLs the service worker uses: the welcome
// page opened on a first install, and the one-question survey Chrome opens
// after an uninstall. Both always point at production, since a fresh install
// has no settings yet. A build whose browser those two pages don't name
// (SBWBrowser.sitePages false: the Edge build, 1.13.6) opens neither.
//
// And says whether a message comes from the Connect bridge
// (src/content/site-bridge.js): isBridgeSender().
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSiteLinks` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSiteLinks = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const SITE_ORIGIN = 'https://seobandwagon.com';

  // utm_campaign values, one per place a link is opened from.
  const SURFACES = Object.freeze([
    'popup',          // the toolbar popup's own links
    'options',        // the options page
    'citations_tab',  // the popup's Citations tab
    'side_panel',     // the Citations / Link Building side panel
    'serp_overlay',   // "Connect your account" under a Google result
    'new_tab',        // the new tab page's account cards
    'install',        // the welcome tab on a first install
    'uninstall'       // the survey the browser opens after an uninstall
  ]);

  // `origin` is the site root (SBWOptions.dashboardOrigin() of the stored API
  // URL, so staging and localhost keep working); `path` starts with '/' and
  // may carry a query of its own, which is kept. Throws on a surface not in
  // SURFACES, so a typo cannot ship as its own GA4 campaign.
  function siteUrl(origin, path, surface) {
    if (!SURFACES.includes(surface)) {
      throw new Error('Unknown surface for utm_campaign: ' + surface);
    }
    const url = new URL(path, origin);
    url.searchParams.set('utm_source', globalThis.SBWBrowser.utmSource);
    url.searchParams.set('utm_medium', 'extension');
    url.searchParams.set('utm_campaign', surface);
    return url.href;
  }

  function welcomeUrl() {
    return siteUrl(SITE_ORIGIN, '/seo-chrome-extension/welcome?ref=install', 'install');
  }

  // Carries the version only: no install id, no settings, no usage.
  function uninstallUrl(version) {
    const query = version ? '?ref=uninstall&v=' + encodeURIComponent(version) : '?ref=uninstall';
    return siteUrl(SITE_ORIGIN, '/seo-chrome-extension/uninstalled' + query, 'uninstall');
  }

  // What runtime.onInstalled should do for a given details.reason: a welcome
  // tab on a first install only, never on an update, and the survey URL every
  // time, so people who update from a version without it get it too. Neither
  // where the site's pages would name another browser (SBWBrowser.sitePages).
  function installActions(reason, version) {
    if (!globalThis.SBWBrowser.sitePages) return { welcomeUrl: null, uninstallUrl: null };
    return {
      welcomeUrl: reason === 'install' ? welcomeUrl() : null,
      uninstallUrl: uninstallUrl(version)
    };
  }

  // A runtime.onMessage sender the Connect bridge's messages are taken from:
  // this extension's own content script (`extensionId`), in the top frame
  // (frame 0) of a page whose origin is the site's.
  function isBridgeSender(sender, extensionId) {
    if (!sender || !extensionId || sender.id !== extensionId || sender.frameId !== 0) return false;
    try {
      return new URL(sender.url).origin === SITE_ORIGIN;
    } catch (_) {
      return false;
    }
  }

  return {
    SITE_ORIGIN,
    SURFACES,
    siteUrl,
    welcomeUrl,
    uninstallUrl,
    installActions,
    isBridgeSender
  };
});
