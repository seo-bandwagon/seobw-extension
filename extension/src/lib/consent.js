// SEO Bandwagon — consent for every send (1.11.0)
//
// One table of what the extension sends to SEO Bandwagon (FLOWS), and one
// check every send makes first: the flow's data category is granted, and
// the flow itself was accepted. Designed once for all three browsers (vault
// Extension_Roadmap_To_2_0_Design, decision 5):
//
//   - Firefox: each flow names the data categories Firefox asks about
//     (`data_collection_permissions` in the Firefox manifest, 1.13.2's build
//     target). A category is granted only when Firefox says so, and data
//     collection starts off there.
//   - Chrome and Edge have no such prompt, so a category reads the switch
//     people already have for that flow: "Send analyses to SEO Bandwagon"
//     (`dataCollection`, on unless turned off) for saved analyses, and the
//     figures setting on the Google results page for figures.
//
// A flow is accepted either by the step that always started it (saved
// analyses go only with a key the person connected) or by a specific action:
// the figures' "Send result addresses" button in Options (stored here with
// the version of the words accepted). Accept buttons live in Options, since
// Firefox's permission prompt closes the popup.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWConsent` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWConsent = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // chrome.storage.local: { [flow]: { acceptedAt, version } }
  const STORAGE_KEY = 'sbwConsent';

  const FLOWS = {
    // Saving an analysis with an account connected (since 1.4.0).
    captureSync: {
      title: 'Analyses you save',
      sends: 'The page address and the analysis of each page you analyze, the extension version and your browser’s user-agent string.',
      why: 'So your captures show in your SEO Bandwagon account.',
      firefox: ['browsingActivity', 'websiteContent', 'technicalAndInteraction'],
      // Chrome and Edge: the "Send analyses to SEO Bandwagon" switch.
      chromeSwitch: { area: 'local', key: 'dataCollection', on: (v) => v !== false },
      acceptedBy: 'connect'
    },
    // The figures under each Google result (1.11.0): full result addresses,
    // where nothing on a results page was sent before.
    serpFigures: {
      title: 'Figures under Google results',
      sends: 'The address of each result on a Google results page you open, up to 10 at a time, with its site. Never your search terms, and never a request to Google.',
      why: 'So SEO Bandwagon can answer with each result’s link, traffic and domain-age figures and your own on-page checklist for it.',
      firefox: ['websiteContent', 'searchTerms'],
      chromeSwitch: { area: 'local', key: 'serpSettings', on: (v) => !(v && (v.overlay === false || v.figuresOn === false)) },
      acceptedBy: 'action',
      // Raise this when the words in `sends` change what is sent: everyone is
      // asked again.
      version: 1
    }
  };

  const FIREFOX_CATEGORIES = Object.freeze(['browsingActivity', 'websiteContent', 'searchTerms', 'technicalAndInteraction']);

  function flowOf(name) {
    return Object.prototype.hasOwnProperty.call(FLOWS, name) ? FLOWS[name] : null;
  }

  // Firefox exposes data-collection consent through permissions.contains;
  // Chrome and Edge reject the key, so it is asked only where it exists.
  function isFirefox() {
    return typeof globalThis.browser !== 'undefined' && !!(globalThis.browser.runtime && globalThis.browser.runtime.getBrowserInfo);
  }

  /**
   * The decision, from what was read. Pure; exported for tests.
   *   { ok: true } or { ok: false, reason: 'unknown_flow' | 'category_off' | 'not_accepted' }
   */
  function decide(flow, { granted, accepted }) {
    if (!flow) return { ok: false, reason: 'unknown_flow' };
    if (!granted) return { ok: false, reason: 'category_off' };
    if (!accepted) return { ok: false, reason: 'not_accepted' };
    return { ok: true };
  }

  /** Whether `record` (what storage holds for a flow) accepts its current words. */
  function isAccepted(flow, record, hasKey) {
    if (!flow) return false;
    if (flow.acceptedBy === 'connect') return hasKey !== false;
    return !!(record && record.acceptedAt && Number(record.version) >= Number(flow.version || 1));
  }

  async function readStorage(area, key) {
    try {
      const got = await chrome.storage[area].get(key);
      return got ? got[key] : undefined;
    } catch (e) {
      return undefined;
    }
  }

  async function categoriesGranted(flow) {
    if (isFirefox()) {
      try {
        return await globalThis.browser.permissions.contains({ data_collection: flow.firefox });
      } catch (e) {
        return false;
      }
    }
    const sw = flow.chromeSwitch;
    return sw ? sw.on(await readStorage(sw.area, sw.key)) : true;
  }

  /**
   * Every send asks this first. `opts.hasKey` lets a caller that already
   * read the key say so (a 'connect' flow is accepted with a key).
   */
  async function check(name, opts) {
    const flow = flowOf(name);
    if (!flow) return decide(null, {});
    const granted = await categoriesGranted(flow);
    const records = (await readStorage('local', STORAGE_KEY)) || {};
    const hasKey = opts && typeof opts.hasKey === 'boolean' ? opts.hasKey : true;
    return decide(flow, { granted, accepted: isAccepted(flow, records[name], hasKey) });
  }

  /** The flow's acceptance record, or null. */
  async function acceptance(name) {
    const records = (await readStorage('local', STORAGE_KEY)) || {};
    const flow = flowOf(name);
    return flow && isAccepted(flow, records[name]) ? records[name] || { acceptedBy: flow.acceptedBy } : null;
  }

  /**
   * Records the person's specific action. On Firefox it also asks for the
   * flow's categories, which must run inside that click.
   */
  async function accept(name, now) {
    const flow = flowOf(name);
    if (!flow || flow.acceptedBy !== 'action') return false;
    if (isFirefox()) {
      try {
        const ok = await globalThis.browser.permissions.request({ data_collection: flow.firefox });
        if (!ok) return false;
      } catch (e) {
        return false;
      }
    }
    const records = (await readStorage('local', STORAGE_KEY)) || {};
    records[name] = { acceptedAt: new Date(now || Date.now()).toISOString(), version: flow.version || 1 };
    await chrome.storage.local.set({ [STORAGE_KEY]: records });
    return true;
  }

  async function withdraw(name) {
    const records = (await readStorage('local', STORAGE_KEY)) || {};
    if (!(name in records)) return;
    delete records[name];
    await chrome.storage.local.set({ [STORAGE_KEY]: records });
  }

  return {
    STORAGE_KEY,
    FLOWS,
    FIREFOX_CATEGORIES,
    decide,
    isAccepted,
    check,
    acceptance,
    accept,
    withdraw
  };
});
