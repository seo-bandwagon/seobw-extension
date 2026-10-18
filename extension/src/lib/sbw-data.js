/* SEO Bandwagon — data bridge for the themed surfaces.
 *
 * One rule: nothing here invents a number. Every value comes from code that
 * already ships in this extension —
 *
 *   src/lib/api.js            SBW              account, captures, domain stats
 *   src/lib/sub-scores.js     SBWSubScores     the 14 checks and their totals
 *   src/lib/capture-strip.js  SBWCaptureStrip  what is safe to persist / sync
 *   src/lib/tool-links.js     SBWToolLinks     GSC / PSI / Rich Results / Wayback
 *   src/background/…          getCachedAnalysis · storeAnalysis · updateBadge ·
 *                             checkDirectory
 *
 * Those are classic scripts that attach to globalThis, so every page loads them
 * with plain <script src> before this module. This file adds no storage key of
 * its own: captures stay under `capture_<ts>`, the appearance mode under
 * `bwThemeMode`, the account under `sbwUser` / `sbwKeyStatus` / `dataCollection`.
 *
 * No fetch() here or in any surface that imports it. Network goes
 * page → sbw-data.js → SBW (src/lib/api.js) → seobandwagon.com, and third-party
 * probes go through the service worker. See docs/API-INVENTORY.md.
 *
 * Scope note: this carries what the themed page-checks panel and the new tab
 * page (src/newtab, owner ruling 2026-10-18, reversing the 2026-09-07 one) use.
 * From the design package's bridge, recentAudits() and topFix() came over for
 * the new tab. analyzeUrl() did not: the new tab's scan box hands the site to
 * the worker's analyzeResult flow (src/lib/analyze-link.js), so a scan opens
 * and analyzes the same way the results overlay's Analyze button does.
 * domainHistory() did not either: the new tab opens with no request at all,
 * and the popup already shows the account's history line for a page.
 */

/* Exactly the file list src/popup/popup.js injects before {action:'analyze'} —
   keep the two in step if the analyzer gains a dependency. */
export const ANALYZER_FILES = [
  'lib/content-analysis.js',
  'lib/dom-extraction.js',
  'src/lib/link-check.js',
  'src/lib/hreflang.js',
  'src/lib/structured-data.js',
  'src/lib/analysis-errors.js',
  'src/content/analyzer.js',
];

const api = () => globalThis.SBW;
const strip = () => globalThis.SBWCaptureStrip;
const tools = () => globalThis.SBWToolLinks;
const scores = () => globalThis.SBWSubScores;

/* ------------------------------- url helpers ------------------------------ */

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Bare host, matching how quickDomain keys history server-side. */
export function domainOf(url) {
  return hostOf(url).replace(/^www\./, '');
}

/* The same host + path shape as manifest.json's serp-overlay content_scripts
   entry (mirrors src/popup/popup.js): the page analyzer is noise on a results
   page — src/overlay/serp-overlay.js is what runs there. */
const GOOGLE_SERP_HOSTS = new Set([
  'www.google.com', 'www.google.co.uk', 'www.google.ca', 'www.google.com.au',
  'www.google.de', 'www.google.fr', 'www.google.es', 'www.google.it',
  'www.google.nl', 'www.google.in',
]);

export function isGoogleSerpUrl(url) {
  try {
    const u = new URL(url);
    return GOOGLE_SERP_HOSTS.has(u.hostname.toLowerCase()) && u.pathname === '/search';
  } catch { return false; }
}

export function isAnalyzable(url) {
  return /^https?:\/\//i.test(String(url || '')) && !isGoogleSerpUrl(url);
}

/* ------------------------------- page checks ------------------------------ */

/** The four sub-score groups, from the one implementation. */
export function subScores(data) {
  const S = scores();
  return S ? S.computeSubScores(data) : [];
}

/** `{ passed, of }` across all four groups — the "N of M checks" line. */
export function checkTotals(data) {
  const S = scores();
  return S ? S.checkTotals(data) : { passed: 0, of: 0 };
}

export function issuesOf(data) {
  return (data && data.seoScore && data.seoScore.issues) || [];
}

/**
 * Threshold-matched rows for the panel, at the same limits the popup renders.
 * Every note is formatted from the analyzer's own numbers; a row whose value
 * the analyzer did not produce is left out rather than shown as zero.
 */
export function pageChecks(data) {
  const d = data || {};
  const m = d.meta || {};
  const c = d.content || {};
  const h = d.headings || {};
  const l = d.links || {};
  const img = d.images || {};
  const t = d.technical || {};
  const wv = d.webVitals || {};

  const titleLen = (m.title && m.title.length) || 0;
  const descLen = (m.description && m.description.length) || 0;
  const h1 = (h.h1 || []).length;
  const schema = (m.schema || []).length;
  const noAlt = (img.missingAlt && img.missingAlt.count) || 0;
  const internal = (l.internal && l.internal.count) || 0;
  const words = c.wordCount || 0;
  const dom = t.domElements || 0;

  const state = (good, warn) => (good ? 'pass' : warn ? 'warn' : 'fail');

  const rows = [
    ['Title', titleLen + ' / 60', state(titleLen >= 30 && titleLen <= 60, titleLen > 0)],
    ['Description', descLen + ' / 160', state(descLen >= 120 && descLen <= 160, descLen > 0)],
    ['Canonical', m.canonical ? 'Set' : 'Missing', state(!!m.canonical, false)],
    ['H1', h1 + ' on page', state(h1 === 1, h1 > 1)],
    ['Structured data', schema + (schema === 1 ? ' block' : ' blocks'), state(schema > 0, false)],
    ['Open Graph', m.openGraph && m.openGraph.title ? 'Set' : 'Missing', state(!!(m.openGraph && m.openGraph.title), true)],
    ['Images without alt', noAlt + ' of ' + (img.total || 0), state(noAlt === 0, noAlt <= 3)],
    ['Internal links', String(internal), state(internal >= 3, internal > 0)],
    ['Words', words.toLocaleString(), state(words >= 600, words >= 300)],
    ['DOM nodes', dom.toLocaleString(), state(dom <= 2000, dom <= 3500)],
  ];
  if (wv.lcp !== null && wv.lcp !== undefined) {
    rows.push(['LCP', Math.round(wv.lcp) + ' ms', state(wv.lcp <= 2500, wv.lcp <= 4000)]);
  }
  if (c.readability) {
    rows.push(['Reading level', c.readability.level, state(c.readability.fleschKincaid <= 14, true)]);
  }
  return rows.map(([name, note, status]) => ({ name, note, status }));
}

/* -------------------------------- captures -------------------------------- */

/** A capture's score, by the same rule src/lib/domain-history.js uses. */
export function captureScore(c) {
  if (!c) return null;
  if (typeof c.overallScore === 'number') return c.overallScore;
  if (c.seoScore && typeof c.seoScore.score === 'number') return c.seoScore.score;
  return null;
}

/** When a capture was taken: its `capturedAt`, else the `capture_<ms>` key. */
export function captureTime(c) {
  const iso = Date.parse(c && c.capturedAt);
  if (!Number.isNaN(iso)) return iso;
  const fromKey = parseInt(String((c && c.key) || '').split('_')[1], 10);
  return Number.isFinite(fromKey) ? fromKey : 0;
}

/* A new tab must open instantly, and captures run 17 to 77 KB each (src/lib/
   api.js, #90), so only the newest are read. A page's change is measured
   against its previous capture inside this window. */
export const RECENT_WINDOW = 50;

async function newestCaptures() {
  const local = chrome.storage.local;
  const keyTime = (k) => parseInt(k.slice('capture_'.length), 10) || 0;
  const pick = (keys) => keys.filter((k) => k.startsWith('capture_'))
    .sort((a, b) => keyTime(b) - keyTime(a))
    .slice(0, RECENT_WINDOW);
  if (typeof local.getKeys === 'function') { // Chrome 130+
    const keys = pick(await local.getKeys());
    if (!keys.length) return [];
    const items = await local.get(keys);
    return keys.map((key) => items[key] && { key, ...items[key] }).filter(Boolean);
  }
  const all = await local.get(null);
  return pick(Object.keys(all)).map((key) => ({ key, ...all[key] }));
}

/**
 * The newest capture of each page, newest first, with the change in score
 * since that page's previous capture (null when there is none in the window).
 * `[{ url, host, score, grade, delta, at, captures, capture }]`
 */
export async function recentAudits(limit = 3) {
  let list = [];
  try { list = await newestCaptures(); } catch { return []; }
  const byUrl = new Map();
  for (const c of list) {
    if (!c || !c.url) continue;
    if (!byUrl.has(c.url)) byUrl.set(c.url, []);
    byUrl.get(c.url).push(c);
  }
  return [...byUrl.values()]
    .map((caps) => {
      const sorted = caps.slice().sort((a, b) => captureTime(b) - captureTime(a));
      const newest = sorted[0];
      const score = captureScore(newest);
      const prior = sorted.slice(1).map(captureScore).find((v) => v !== null);
      return {
        url: newest.url,
        host: hostOf(newest.url),
        score,
        grade: (newest.seoScore && newest.seoScore.grade) || null,
        delta: score !== null && prior !== undefined ? score - prior : null,
        at: captureTime(newest),
        captures: sorted.length,
        capture: newest,
      };
    })
    .filter((r) => r.score !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/** What the stored captures alone can say about a page's history. */
export function localHistoryLine(row) {
  if (!row) return null;
  const earlier = row.captures - 1;
  if (earlier < 1) return 'First capture of this page';
  const base = earlier + (earlier === 1 ? ' earlier capture' : ' earlier captures');
  if (row.delta === null || row.delta === undefined) return base;
  if (row.delta === 0) return base + ' · no change';
  return `${base} · ${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta)} since`;
}

/* ---------------------------------- fixes --------------------------------- */

/* One entry per issue string lib/content-analysis.js can push (a test holds
   the two together). Every body is built from the page's own numbers. */
const FIXES = {
  'Missing title': { title: 'No title tag', body: () => 'This page has no title. It is the first line of every search result.', tool: 'gsc' },
  'Title too short': { title: 'Title too short', body: (d) => `${d.meta.title.length} characters. Aim for 30 to 60.`, tool: 'gsc' },
  'Title too long': { title: 'Title too long', body: (d) => `${d.meta.title.length} characters. Search results cut off near 60.`, tool: 'gsc' },
  'Missing meta description': { title: 'No meta description', body: () => 'Google writes its own snippet when you leave this out.', tool: 'gsc' },
  'Description too short': { title: 'Description too short', body: (d) => `${d.meta.description.length} characters. Aim for 120 to 160.`, tool: 'gsc' },
  'Description too long': { title: 'Description too long', body: (d) => `${d.meta.description.length} characters. Snippets cut off near 160.`, tool: 'gsc' },
  'Missing H1': { title: 'No H1 heading', body: () => 'Nothing on the page states what it is about at heading level.', tool: null },
  'Multiple H1 tags': { title: 'More than one H1', body: (d) => `${d.headings.h1.length} H1 headings on the page. Use one.`, tool: null },
  'Many images missing alt': { title: 'Images without alt text', body: (d) => `${d.images.missingAlt.count} of ${d.images.total} images have no alt attribute.`, tool: null },
  'Some images missing alt': { title: 'Images without alt text', body: (d) => `${d.images.missingAlt.count} of ${d.images.total} images have no alt attribute.`, tool: null },
  'No canonical URL': { title: 'No canonical tag', body: () => 'Nothing tells Google which URL is the original.', tool: 'gsc' },
  'No structured data': { title: 'No structured data', body: () => 'No JSON-LD, Microdata or RDFa found, so no rich result is possible.', tool: 'rich-results' },
  'Missing Open Graph': { title: 'No Open Graph tags', body: () => 'Shared links fall back to whatever the platform can guess.', tool: null },
  'Thin content': { title: 'Thin content', body: (d) => `${(d.content.wordCount || 0).toLocaleString()} words on the page.`, tool: null },
  'Light content': { title: 'Light content', body: (d) => `${(d.content.wordCount || 0).toLocaleString()} words on the page.`, tool: null },
  'Few internal links': { title: 'Few internal links', body: (d) => `${d.links.internal.count} internal links point from this page to the rest of the site.`, tool: null },
  'Large DOM': { title: 'Large DOM', body: (d) => `${(d.technical.domElements || 0).toLocaleString()} nodes. Heavy pages render slowly.`, tool: 'pagespeed' },
  'Hard to read': { title: 'Hard to read', body: (d) => `Reading level ${d.content.readability.level}, grade ${d.content.readability.fleschKincaid}.`, tool: null },
};
const TOOL_LABELS = { gsc: 'Open in Search Console', pagespeed: 'PageSpeed Insights', 'rich-results': 'Rich Results Test' };

/** The issue strings that have fix text. */
export const FIX_ISSUES = Object.freeze(Object.keys(FIXES));

/**
 * The next fix for a capture: the analyzer's first issue that has fix text, in
 * the analyzer's own order (not a ranking of ours). `of` is how many issues
 * the page has. Null for a clean page.
 */
export function topFix(data) {
  const issues = issuesOf(data);
  const issue = issues.find((i) => FIXES[i]);
  if (!issue) return null;
  const spec = FIXES[issue];
  let body = '';
  try { body = spec.body(data); } catch { body = ''; }
  const url = spec.tool ? toolUrl(spec.tool, data.url) : null;
  return {
    issue,
    title: spec.title,
    body,
    url,
    label: url ? TOOL_LABELS[spec.tool] : null,
    host: hostOf(data.url),
    of: issues.length,
  };
}

/* ---------------------------------- scan ---------------------------------- */

/** A typed site as an http(s) URL, or null. Words are never turned into a search. */
export function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u.href;
  } catch { return null; }
}

/**
 * Open a typed site in this tab and analyze it there: the worker's
 * analyzeResult flow, the same one the results overlay's Analyze button uses.
 * The popup does the analysis (and asks for site access when it has none), so
 * a person's submit starts the scan and nothing reads a page by itself.
 */
export async function scanSite(raw) {
  const url = normalizeUrl(raw);
  if (!url) return { ok: false, error: 'invalid_url' };
  if (!isAnalyzable(url)) return { ok: false, error: 'not_analyzable' };
  try {
    return (await chrome.runtime.sendMessage({ action: 'analyzeResult', url, sameTab: true }))
      || { ok: false, error: 'tab_open_failed' };
  } catch {
    return { ok: false, error: 'tab_open_failed' };
  }
}

/* --------------------------------- analysis ------------------------------- */

/** Fail closed, exactly as src/popup/popup.js's stripForStorage does. */
function safeToStore(data) {
  const s = strip();
  if (s && typeof s.strip === 'function') return s.strip(data);
  if (!data) return data;
  const copy = Object.assign({}, data);
  delete copy.schemaValidation;
  if (copy.headings) { copy.headings = Object.assign({}, copy.headings); delete copy.headings.outline; }
  if (copy.links) { copy.links = Object.assign({}, copy.links); delete copy.links.list; delete copy.links.nofollowAnchors; }
  if (copy.images) { copy.images = Object.assign({}, copy.images); delete copy.images.list; }
  if (copy.meta) { copy.meta = Object.assign({}, copy.meta); delete copy.meta.schema; }
  return copy;
}

async function saveCapture(data) {
  const SBW = api();
  if (!SBW || typeof SBW.autoSaveLocal !== 'function') return;
  try {
    const key = await SBW.autoSaveLocal(safeToStore(data));
    SBW.syncCapture(key); // fire-and-forget; api.js records the outcome on the record
  } catch { /* storage quota etc. — never breaks the surface */ }
}

/**
 * Analyse a tab through the extension's own pipeline: cache first, then inject
 * the analyzer and ask for it. Stores the result in the tab cache, paints the
 * toolbar badge and saves the capture, same as the toolbar popup does.
 */
export async function analyzeTab(tab, { save = true } = {}) {
  const cached = await chrome.runtime.sendMessage({ action: 'getCachedAnalysis', tabId: tab.id, url: tab.url });
  if (cached && cached.hit) return { data: cached.data, cached: true };

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ANALYZER_FILES });
  } catch { /* already injected */ }

  const data = await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
  if (!data) throw new Error('No analysis returned');
  // #63/#89: not a web page, or the analysis threw. `problem` carries the words.
  const problem = globalThis.SBWAnalysisErrors?.describe(data);
  if (problem) throw Object.assign(new Error(problem.body), { problem });

  chrome.runtime.sendMessage({ action: 'storeAnalysis', tabId: tab.id, url: tab.url, data });
  if (data.seoScore) {
    chrome.runtime.sendMessage({ action: 'updateBadge', score: data.seoScore.score, grade: data.seoScore.grade, tabId: tab.id });
  }
  if (save) await saveCapture(data);
  return { data, cached: false };
}

/* ------------------------------ account state ----------------------------- */

/**
 * What the surfaces show in their account line, as one of six states. This
 * reads stored keys only — it sends no request, so a surface can paint it
 * before anything else resolves. `verify()` below is the opt-in check.
 *
 * `state` is one of: 'connected' · 'no_key' · 'invalid' · 'collection_off'.
 * The remaining wire states (`forbidden`, `rate_limited`, `unavailable`,
 * `network`) belong to whichever call produced them and are surfaced there —
 * see the state matrix in docs/API-INVENTORY.md.
 */
export async function accountState() {
  const SBW = api();
  const stored = await chrome.storage.local.get(['sbwUser', 'sbwKeyStatus']);
  let connected = stored.sbwKeyStatus === 'valid';
  let collecting = true;
  if (SBW) {
    try { connected = connected || (await SBW.hasApiKey()); } catch { /* keep */ }
    try { collecting = await SBW.isDataCollectionEnabled(); } catch { /* keep */ }
  }
  const user = stored.sbwUser && stored.sbwUser.data;
  const invalid = stored.sbwKeyStatus === 'invalid';

  let state = 'no_key';
  if (invalid) state = 'invalid';
  else if (!collecting) state = 'collection_off';
  else if (connected) state = 'connected';

  return { state, connected, collecting, email: (user && (user.email || user.name)) || null };
}

/** How long a verified key is trusted before another /v1/me round trip. */
export const VERIFY_TTL_MS = 10 * 60 * 1000;

/**
 * Opt-in key check. accountState() never validates, so a revoked key would
 * keep reading as connected until some other call happened to 401. This asks
 * /v1/me at most once per TTL, reusing the same `sbwUser` cache the options
 * page and citations tab already write — no new storage key, and no request
 * at all when there is no key or collection is off.
 */
export async function verifyAccount({ now = Date.now(), force = false } = {}) {
  const SBW = api();
  if (!SBW) return { checked: false, code: 'network' };

  const base = await accountState();
  if (base.state === 'no_key' || base.state === 'collection_off') {
    return { checked: false, code: 'no_key', ...base };
  }

  const { sbwUser } = await chrome.storage.local.get('sbwUser');
  const fresh = sbwUser && typeof sbwUser.at === 'number' && now - sbwUser.at < VERIFY_TTL_MS;
  if (fresh && !force) return { checked: false, code: 'ok', ...base, cached: true };

  const res = await SBW.verifyKey();
  if (res.ok) {
    await chrome.storage.local.set({ sbwUser: { data: res.data, at: now } });
    return {
      checked: true,
      code: 'ok',
      state: 'connected',
      connected: true,
      collecting: base.collecting,
      email: (res.data && (res.data.email || res.data.name)) || null,
    };
  }
  // api.js has already written sbwKeyStatus on a 401; re-read rather than guess.
  return { checked: true, code: res.code, ...(await accountState()), retryAfter: res.retryAfter };
}

/**
 * Retry captures that failed to reach the account, through the drainer that
 * already owns the backoff and the 15-minute alarm. Passes its result straight
 * through: `{ sent, synced, duplicates, stoppedOn, nextAt }`, where
 * `stoppedOn` is the sbwFetch code that ended the run early and `nextAt` is
 * when that capture may be retried.
 *
 * Silent by design. A surface reports a count when something synced and says
 * nothing at all when there was nothing due, which is the normal case.
 */
export async function drainPending({ max = 20, now = Date.now() } = {}) {
  const empty = { sent: 0, synced: 0, duplicates: 0, stoppedOn: null, nextAt: null };
  const SBW = api();
  if (!SBW || typeof SBW.drainPendingCaptures !== 'function') {
    return { ...empty, stoppedOn: 'network' };
  }
  try {
    return (await SBW.drainPendingCaptures({ max, now })) || empty;
  } catch {
    return { ...empty, stoppedOn: 'network' };
  }
}

/** A one-line summary of a drain, or null when there is nothing worth saying. */
export function drainLine(res) {
  if (!res) return null;
  const n = res.synced || 0;
  if (n > 0) return n === 1 ? '1 capture synced' : n + ' captures synced';
  if (res.stoppedOn === 'rate_limited' && res.nextAt) {
    const mins = Math.max(1, Math.round((res.nextAt - Date.now()) / 60000));
    return 'Sync paused, retrying in ' + mins + (mins === 1 ? ' minute' : ' minutes');
  }
  return null;
}

/* --------------------------------- links ---------------------------------- */

export function toolUrl(kind, pageUrl) {
  const T = tools();
  return (T && T.toolUrl(kind, { pageUrl })) || null;
}

export function toolRow(pageUrl) {
  return [
    ['gsc', 'Search Console'],
    ['pagespeed', 'PageSpeed'],
    ['rich-results', 'Rich results'],
    ['sitemap', 'sitemap.xml'],
    ['robots', 'robots.txt'],
  ]
    .map(([kind, label]) => ({ kind, label, url: toolUrl(kind, pageUrl) }))
    .filter((t) => t.url);
}

/** `{ name, domain }` when the URL is one of the curated citation directories. */
export async function directoryMatch(url) {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'checkDirectory', url });
    return (res && res.match) || null;
  } catch { return null; }
}

/** The real command's shortcut, or null if the user cleared it. */
export async function shortcutFor(name = 'analyze-current') {
  if (!chrome.commands || !chrome.commands.getAll) return null;
  try {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === name);
    return (cmd && cmd.shortcut) || null;
  } catch { return null; }
}

/* -------------------------------- side panel ------------------------------ */

export const PANEL_PATHS = {
  checks: 'src/panel/panel.html',
  citations: 'src/sidepanel/sidepanel.html',
};

/**
 * Both panels ship: this themed one shows live page checks, the existing one
 * owns Citations and Link Building. Per-tab setOptions() swaps between them,
 * so neither replaces the other and the manifest's default is untouched.
 */
export async function openPanel(which, tabId) {
  if (!chrome.sidePanel) return false;
  const path = PANEL_PATHS[which] || PANEL_PATHS.checks;
  try {
    await chrome.sidePanel.setOptions({ tabId, path, enabled: true });
    await chrome.sidePanel.open({ tabId });
    return true;
  } catch {
    // S34: this used to fall back to the worker's openSidePanel action, which
    // can't work (no user gesture there, and no window from an extension
    // page's sender). The 1.7.7 smoke test confirmed the path above opens.
    return false;
  }
}
