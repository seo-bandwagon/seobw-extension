// SEO Bandwagon — the Google results page settings (1.11.0)
//
// One record in chrome.storage.local (`serpSettings`), read by the overlay
// on google.com (a content script may use storage.local, not .session), and
// written by the "Google results" section of Options and of the popup. The
// overlay follows changes as they are saved (storage.onChanged), so a
// setting changed in the popup shows on the open results page at once.
//
//   overlay     the bars and the panel on Google's results pages
//   figuresOn   figures on the bars (needs the figures accepted in Options)
//   load        'auto': figures load with the page (the default, as
//               SEOquake does); 'click': only after "Load figures"
//   placement   the panel 'bottom' (below the results, as before) or 'top'
//               (above them, pushing them down); never over Google's content
//   look        'google' (follows Google's own light or dark page), 'dark'
//               (Night) or 'light' (Day)
//   collapsed   the panel folded to its one header line
//   figures     which figures each bar shows (FIGURES)
//   ownSites    the person's own sites, highlighted on the bars; a local
//               list until 1.14.0 fills it from the account
//   tableColumns  (1.12.0) the results table's columns; a column is shown
//               unless set false (src/lib/serp-table.js COLUMNS)
//   compareTo   (1.12.0) the table marks each cell against the search's
//               'median', or against the person's 'pinned' page
//   keywordsOn  (1.13.0) keyword data under the search box (needs its own
//               yes: it sends the search)
//   keywordsLoad (1.13.0) 'click': only after "Show keyword data" (the
//               default: each search with new data counts against the day's
//               allowance); 'auto': with the page
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpSettings` when loaded as a classic <script>, content
// script or via importScripts, and exports via CommonJS when loaded by
// Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpSettings = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const STORAGE_KEY = 'serpSettings';

  // Every figure a bar can show, in the order it shows them. `group` is what
  // it describes; `on` is the default. Keywords and site traffic start off so
  // the default line fits one line under a result; each is a click away.
  const FIGURES = [
    { key: 'pageReferringDomains', group: 'page', label: 'Referring domains to the page', on: true },
    { key: 'pageBacklinks', group: 'page', label: 'Backlinks to the page', on: true },
    { key: 'pageRank', group: 'page', label: 'Page rank (0 to 100)', on: true },
    { key: 'pageTraffic', group: 'page', label: 'Estimated traffic to the page', on: true },
    { key: 'pageKeywords', group: 'page', label: 'Keywords the page ranks for', on: false },
    { key: 'siteRank', group: 'site', label: 'Site rank (0 to 100)', on: true },
    { key: 'siteReferringDomains', group: 'site', label: 'Referring domains to the site', on: true },
    { key: 'siteTraffic', group: 'site', label: 'Estimated traffic to the site', on: false },
    { key: 'siteKeywords', group: 'site', label: 'Keywords the site ranks for', on: false },
    { key: 'domainAge', group: 'age', label: 'Domain age, with registrar and dates', on: true },
    { key: 'checklist', group: 'checklist', label: 'Your on-page checklist, where you captured the page', on: true }
  ];

  const PLACEMENTS = ['bottom', 'top'];
  const LOOKS = ['google', 'dark', 'light'];
  const LOADS = ['auto', 'click'];
  const COMPARES = ['median', 'pinned'];
  const MAX_OWN_SITES = 50;

  function defaults() {
    const figures = {};
    FIGURES.forEach((f) => { figures[f.key] = f.on; });
    return {
      overlay: true,
      figuresOn: true,
      load: 'auto',
      placement: 'bottom',
      look: 'google',
      collapsed: false,
      figures,
      ownSites: [],
      tableColumns: {},
      compareTo: 'median',
      keywordsOn: true,
      keywordsLoad: 'click'
    };
  }

  function pick(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  /** Whatever storage holds, as a complete record with only known values. */
  function normalize(raw) {
    const d = defaults();
    const r = raw && typeof raw === 'object' ? raw : {};
    const figures = Object.assign({}, d.figures);
    if (r.figures && typeof r.figures === 'object') {
      FIGURES.forEach((f) => { if (typeof r.figures[f.key] === 'boolean') figures[f.key] = r.figures[f.key]; });
    }
    return {
      overlay: typeof r.overlay === 'boolean' ? r.overlay : d.overlay,
      figuresOn: typeof r.figuresOn === 'boolean' ? r.figuresOn : d.figuresOn,
      load: pick(r.load, LOADS, d.load),
      placement: pick(r.placement, PLACEMENTS, d.placement),
      look: pick(r.look, LOOKS, d.look),
      collapsed: r.collapsed === true,
      figures,
      ownSites: Array.isArray(r.ownSites) ? normalizeSites(r.ownSites) : [],
      tableColumns: columnChoice(r.tableColumns),
      compareTo: pick(r.compareTo, COMPARES, d.compareTo),
      keywordsOn: typeof r.keywordsOn === 'boolean' ? r.keywordsOn : d.keywordsOn,
      keywordsLoad: pick(r.keywordsLoad, LOADS, d.keywordsLoad)
    };
  }

  // Only booleans under a column key: { pageKW: false }.
  function columnChoice(raw) {
    const out = {};
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach((k) => { if (/^[A-Za-z]{1,30}$/.test(k) && typeof raw[k] === 'boolean') out[k] = raw[k]; });
    }
    return out;
  }

  // A typed site: "https://www.Example.com/blog" → "example.com". Anything
  // that isn't a host name is left out.
  const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  function siteOf(text) {
    let s = String(text || '').trim().toLowerCase();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
    let host;
    try { host = new URL(s).hostname; } catch (e) { return ''; }
    host = host.replace(/\.$/, '').replace(/^www\./, '');
    return HOST_RE.test(host) ? host : '';
  }

  function normalizeSites(list) {
    const out = [];
    (list || []).forEach((item) => {
      const site = siteOf(item);
      if (site && !out.includes(site) && out.length < MAX_OWN_SITES) out.push(site);
    });
    return out;
  }

  /** The Options textarea: one site a line (or commas). */
  function parseSiteList(text) {
    return normalizeSites(String(text || '').split(/[\s,]+/));
  }

  /** Is `domain` (a result's bare host) one of `sites`, or under one? */
  function isOwnSite(domain, sites) {
    const d = String(domain || '').toLowerCase().replace(/^www\./, '');
    if (!d) return false;
    return (sites || []).some((s) => d === s || d.endsWith('.' + s));
  }

  async function load(storage) {
    const area = storage || chrome.storage.local;
    try {
      const got = await area.get(STORAGE_KEY);
      return normalize(got && got[STORAGE_KEY]);
    } catch (e) {
      return defaults();
    }
  }

  /** Merges `patch` into what's stored (figures merged key by key). */
  async function save(patch, storage) {
    const area = storage || chrome.storage.local;
    const current = await load(area);
    const next = normalize(Object.assign({}, current, patch || {}, {
      figures: Object.assign({}, current.figures, (patch && patch.figures) || {}),
      tableColumns: Object.assign({}, current.tableColumns, (patch && patch.tableColumns) || {})
    }));
    await area.set({ [STORAGE_KEY]: next });
    return next;
  }

  return {
    STORAGE_KEY,
    FIGURES,
    PLACEMENTS,
    LOOKS,
    LOADS,
    COMPARES,
    MAX_OWN_SITES,
    defaults,
    normalize,
    siteOf,
    parseSiteList,
    isOwnSite,
    load,
    save
  };
});
