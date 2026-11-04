// SEO Bandwagon — consent for every send (1.11.0)
//
// One table of what the extension sends to SEO Bandwagon (FLOWS), and one
// check every send makes first: the flow's data category is granted, and
// the flow itself was accepted. Designed once for all three browsers (vault
// Extension_Roadmap_To_2_0_Design, decision 5):
//
//   - Firefox: each flow names the data categories Firefox asks about
//     (`data_collection_permissions` in the Firefox manifest, 1.13.6's build
//     target). A category is granted only when Firefox says so, and data
//     collection starts off there.
//   - Chrome and Edge have no such prompt, so a category reads the switch
//     people already have for that flow: "Send analyses to SEO Bandwagon"
//     (`dataCollection`, on unless turned off) for saved analyses, and the
//     figures setting on the Google results page for figures, and (1.13.0)
//     its keyword data setting for keyword data.
//
// A flow is accepted either by the step that always started it (saved
// analyses go only with a key the person connected) or by a specific action:
// the figures' "Send result addresses" button in Options, or keyword data's
// yes (stored here with the version of the words accepted). Accept buttons
// live in Options, since Firefox's permission prompt closes the popup.
// 1.13.0: keyword data's first-use disclosure on Google takes its yes there
// too, through the worker; where the browser must ask itself (Firefox's
// prompt needs the click of an extension page), that yes is refused and the
// disclosure sends the person to Options.
// 1.13.3: the AI Overview study has its own yes, in its own Options card; no
// switch beside it, so on Chrome and Edge the yes alone decides.
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
      sends: 'The address of each result on a Google results page you open, up to 10 at a time, with its site, and of a page you pin to compare with them or of the pages an AI Overview cites, when you ask for their figures. Never your search terms with them, and never a request to Google.',
      why: 'So SEO Bandwagon can answer with each result’s link, traffic and domain-age figures and your own on-page checklist for it.',
      firefox: ['websiteContent', 'searchTerms'],
      chromeSwitch: { area: 'local', key: 'serpSettings', on: (v) => !(v && (v.overlay === false || v.figuresOn === false)) },
      acceptedBy: 'action',
      // Raise this when the words in `sends` change what is sent: everyone is
      // asked again. 2 (1.12.0): a pinned page and the AI Overview's sources.
      // 1.13.3 reworded the last sentence to the Options card's own words; what
      // is sent did not change, so the version stays 2.
      version: 2
    },
    // Keyword data on Google (1.13.0): the search itself, which nothing sent
    // before. Accepted with the yes of its first-use disclosure on Google or
    // the button in Options.
    keywordData: {
      title: 'Keyword data for your searches',
      sends: 'The words of a Google search you open, with its related searches and People also ask questions, up to 50 at a time, and that Google’s country and language, when you ask for keyword data or, if you choose it in settings, with each search; and a search you add to your rank tracker. Never a result’s address with them, and never a request to Google.',
      why: 'So SEO Bandwagon can answer with each one’s monthly searches, difficulty, cost per click, competition and 12-month trend from DataForSEO, and your own rank tracker’s history for the search.',
      firefox: ['searchTerms'],
      chromeSwitch: { area: 'local', key: 'serpSettings', on: (v) => !(v && (v.overlay === false || v.keywordsOn === false)) },
      acceptedBy: 'action',
      version: 1
    },
    // The AI Overview study (1.13.3): a results page the study itself opened,
    // sent as its CSV export only when the person clicks Send to study. For
    // invited testers; its own yes, in its own Options card. No chromeSwitch:
    // on Chrome and Edge nothing else turns it on or off, so the yes alone
    // decides (a flow with no switch counts its categories as granted).
    aioStudy: {
      title: 'AI Overview study',
      sends: 'For people invited to SEO Bandwagon’s AI Overview study, and only when you click Send to study on a search the study opened for you: that results page as its CSV export, which is the search term, each result’s position, address, site, title, snippet, breadcrumb, date and rating, the page’s search features, related searches and People also ask questions, the result count, the AI Overview’s text and the pages it cites, Google’s country and language settings, the capture time and the extension version; and, when you click Google stopped me, that Google stopped you that day. Never any other search or page, never figures or keyword data, and the extension never sends a request to Google itself. It goes to the study, not into your account’s captures, history or keyword data.',
      why: 'So the study can measure which pages Google’s AI Overviews cite, from searches people make by hand.',
      firefox: ['searchTerms', 'browsingActivity', 'websiteContent'],
      acceptedBy: 'action',
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
