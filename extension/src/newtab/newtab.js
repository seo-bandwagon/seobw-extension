/* SEO Bandwagon — new tab page (chrome_url_overrides.newtab, 1.9.0).
 *
 * Progress and the next task, from this device's own captures: the recent
 * audits with each page's change in score, the latest capture's checks, and
 * the analyzer's first issue on it as the next fix. The scan box opens a site
 * in this tab and analyzes it through the worker's analyzeResult flow, the
 * same as the results overlay's Analyze button.
 *
 * With an account connected, two more cards come from the account
 * (GET /api/extension/progress through accountProgress(), at most one request
 * every 10 minutes): Rank tracking, and Tasks, which puts the next fix first
 * and then the tasks the site derives from rank data. A 403 (a key from before
 * the `progress` scope) shows Reconnect; a 404 or a network failure (the site
 * does not have the route yet) leaves the page as it is signed out: local
 * cards only. Signed out, opening a new tab sends nothing.
 *
 * The scan box is not a search box: typed words that are not a site get a
 * note, never a search.
 *
 * 1.9.5: shown only to people with Neon Night or Neon Day installed (or who
 * chose Always in settings); anyone else is handed to Chrome's own new tab
 * before anything paints (src/lib/newtab-gate.js). With a Neon theme on, the
 * page follows that theme's Night or Day. An option adds Chrome's usual items
 * below the dashboard: a search box that searches with the person's own
 * default engine (chrome.search, so the extension never changes their search)
 * and their most visited sites (chrome.topSites). Both permissions are
 * optional and asked for only when the option is turned on.
 */

import { applyTheme, watchThemeChanges, bindControl, listingUrl, installedThemeMode, pinMode } from '../lib/theme-sync.js';
import {
  recentAudits, checkTotals, topFix, localHistoryLine, accountState, shortcutFor, scanSite, hostOf,
  accountProgress, progressLink,
} from '../lib/sbw-data.js';

const $ = (id) => document.getElementById(id);
const GATE = globalThis.SBWNewTabGate;
const EXTRAS_KEY = 'bwNewTabExtras';
/* The Neon theme found when this tab opened: 'dark', 'light' or null. */
let themeOn = null;

/* --------------------------------- audits --------------------------------- */

function renderAudits(rows) {
  const ul = $('ntAudits');
  if (!rows.length) return; // the empty state in the markup stays
  ul.textContent = '';
  for (const r of rows) {
    const li = document.createElement('li');
    const host = document.createElement('a');
    host.className = 'nt-domain';
    host.href = r.url;
    host.textContent = r.host;
    host.title = r.url;
    const right = document.createElement('span');
    right.className = 'nt-right';
    if (r.delta !== null && r.delta !== 0) {
      const d = document.createElement('span');
      d.className = 'nt-delta';
      d.dataset.dir = r.delta > 0 ? 'up' : 'down';
      d.textContent = (r.delta > 0 ? '+' : '−') + Math.abs(r.delta);
      d.title = 'Change since this page\'s previous capture';
      right.append(d);
    }
    const s = document.createElement('span');
    s.className = 'nt-score';
    s.textContent = r.score;
    right.append(s);
    li.append(host, right);
    ul.append(li);
  }
}

function renderLatest(row) {
  if (!row) return;
  const totals = checkTotals(row.capture);
  $('ntLatestScore').textContent = row.score;
  $('ntLatestChecks').textContent = (row.grade ? row.grade + ' · ' : '') + totals.passed + ' of ' + totals.of + ' checks';
  $('ntLatestHost').textContent = row.host;
  $('ntLatestBar').style.width = Math.max(0, Math.min(100, row.score)) + '%';
  $('ntHistoryLine').textContent = localHistoryLine(row) || '';
}

function renderFix(fix) {
  $('ntFixCard').hidden = !fix; // a clean latest capture has no next fix
  if (!fix) return;
  $('ntFixTitle').textContent = fix.title;
  $('ntFixBody').textContent = fix.body;
  $('ntFixCount').textContent = fix.of === 1
    ? 'The one issue found on ' + fix.host
    : '1 of ' + fix.of + ' issues found on ' + fix.host;
  const link = $('ntFixLink');
  link.hidden = !fix.url;
  if (fix.url) {
    link.href = fix.url;
    link.textContent = fix.label + ' →';
  }
}

/* ------------------------------ account cards ----------------------------- */

const MAX_TRACKERS = 3;
const MAX_MOVERS = 3;
const MAX_TASKS = 5;

function li(className, ...children) {
  const el = document.createElement('li');
  if (className) el.className = className;
  el.append(...children);
  return el;
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function setLink(a, url, text) {
  a.hidden = !url;
  if (!url) return;
  a.href = url;
  a.textContent = text;
}

function renderRank(result) {
  const card = $('ntRankCard');
  const trackersUl = $('ntTrackers');
  const moversUl = $('ntMovers');
  trackersUl.textContent = '';
  moversUl.textContent = '';
  $('ntRankNote').textContent = '';

  if (result.state === 'reconnect') {
    $('ntRankNote').textContent = 'Reconnect your account to see rank tracking and tasks here. Your key was made before this page existed.';
    setLink($('ntRankLink'), progressLink(result.origin, '/dashboard/api-keys'), 'Reconnect →');
    card.hidden = false;
    return;
  }
  if (result.state !== 'ok') { card.hidden = true; return; }

  const { trackers, movers } = result.data.rankTracking;
  const days = result.data.windowDays;
  for (const t of trackers.slice(0, MAX_TRACKERS)) {
    const moves = [];
    if (t.movedUp) moves.push('+' + t.movedUp + ' up');
    if (t.movedDown) moves.push(t.movedDown + ' down');
    const line = `${t.top10} of ${t.keywords} in the top 10 · ${t.top3} in the top 3`
      + (moves.length ? ` · ${moves.join(', ')} in ${days} days` : '');
    const head = document.createElement('span');
    head.className = 'nt-tr-head';
    head.append(span('nt-tr-domain', t.domain), span('nt-tr-market', t.market + (t.status === 'paused' ? ' · paused' : '')));
    trackersUl.append(li('', head, span('nt-tr-line', line)));
  }
  for (const m of movers.slice(0, MAX_MOVERS)) {
    const change = span('nt-delta', (m.change > 0 ? '+' : '−') + Math.abs(m.change));
    change.dataset.dir = m.change > 0 ? 'up' : 'down';
    const right = document.createElement('span');
    right.className = 'nt-right';
    right.append(span('nt-mv-pos', m.from + ' → ' + m.to), change);
    const kw = span('nt-domain', m.keyword);
    kw.title = m.domain;
    moversUl.append(li('', kw, right));
  }
  if (!trackers.length) $('ntRankNote').textContent = 'No rank trackers on your account yet.';
  else if (trackers.length > MAX_TRACKERS) $('ntRankNote').textContent = `${trackers.length - MAX_TRACKERS} more in the dashboard.`;
  setLink($('ntRankLink'), progressLink(result.origin, '/dashboard/rank-tracker/'),
    trackers.length ? 'Open the rank tracker →' : 'Track keywords →');
  card.hidden = false;
}

/* Tasks: the next fix from the latest capture first, then the account's. */
function renderTasks(result, fix) {
  const card = $('ntTasksCard');
  if (result.state !== 'ok') { card.hidden = true; return false; }
  const ul = $('ntTasks');
  ul.textContent = '';
  const items = [];
  if (fix) items.push({ title: `${fix.title} on ${fix.host}`, detail: fix.body, url: fix.url });
  for (const t of result.data.tasks) {
    items.push({ title: t.title, detail: t.detail, url: progressLink(result.origin, t.path) });
  }
  for (const item of items.slice(0, MAX_TASKS)) {
    const title = item.url ? document.createElement('a') : document.createElement('span');
    title.className = 'nt-task-title';
    title.textContent = item.title;
    if (item.url) { title.href = item.url; title.target = '_blank'; title.rel = 'noopener'; }
    ul.append(li('', title, span('nt-task-detail', item.detail)));
  }
  if (!items.length) ul.append(li('nt-empty', document.createTextNode('Nothing to do on your trackers right now.')));
  card.hidden = false;
  return true;
}

async function paint({ force = false } = {}) {
  const rows = await recentAudits(5);
  renderAudits(rows);
  renderLatest(rows[0]);
  const fix = rows[0] ? topFix(rows[0].capture) : null;
  renderFix(fix); // local first: the account cards never hold the page up

  const progress = await accountProgress({ force });
  renderRank(progress);
  // With the account's tasks on screen the next fix is their first row.
  if (renderTasks(progress, fix)) $('ntFixCard').hidden = true;
}

/* -------------------------------- account --------------------------------- */

const ACCOUNT_BADGES = {
  connected: { text: 'Synced', title: (email) => (email ? 'Connected as ' + email : 'Account connected') },
  collection_off: { text: 'Sync off', title: () => 'Capture sync is off in settings' },
  invalid: { text: 'Key rejected', title: () => 'Your API key was rejected. Reconnect in settings to sync again.' },
  no_key: { text: 'Signed out', title: () => 'Everything on this page works signed out. Connect an account in settings to sync captures.' },
};

async function renderAccount() {
  const { state, email } = await accountState();
  const badge = ACCOUNT_BADGES[state] || ACCOUNT_BADGES.no_key;
  const el = $('ntAccount');
  el.textContent = badge.text;
  el.title = badge.title(email);
  el.dataset.state = state;
}

/* --------------------------------- footer --------------------------------- */

async function renderShortcut() {
  const shortcut = await shortcutFor('analyze-current');
  $('ntShortcut').textContent = shortcut
    ? shortcut + ' analyzes the current page'
    : 'Click the toolbar icon to analyze a page';
}

/* With a Neon theme on, the footer offers the other one; without one (the
   Always setting), the one matching the mode on screen. */
function renderTheme(mode) {
  const shown = themeOn ? (themeOn === 'dark' ? 'light' : 'dark') : (mode === 'light' ? 'light' : 'dark');
  const url = listingUrl(shown);
  const a = $('ntTheme');
  if (!url) { a.hidden = true; return; }
  const name = 'Neon ' + (shown === 'dark' ? 'Night' : 'Day');
  a.href = url;
  a.textContent = (themeOn ? 'Also available: ' : 'Matching Chrome theme: ') + name + ' →';
  a.hidden = false;
}

/* ------------------------- Chrome's usual items --------------------------- */

async function renderExtras() {
  const granted = await chrome.permissions.contains({ permissions: ['topSites', 'search'] }).catch(() => false);
  if (!granted || !chrome.topSites || !chrome.search) return;
  $('ntExtras').hidden = false;
  $('ntSearchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('ntSearch').value.trim();
    if (text) chrome.search.query({ text, disposition: 'CURRENT_TAB' });
  });
  const sites = (await chrome.topSites.get().catch(() => [])).slice(0, 8);
  const ul = $('ntTopSites');
  ul.textContent = '';
  for (const site of sites) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = site.url;
    a.textContent = site.title || hostOf(site.url);
    a.title = site.url;
    li.append(a);
    ul.append(li);
  }
}

/* ---------------------------------- gate ---------------------------------- */

/* The dashboard or Chrome's own new tab (src/lib/newtab-gate.js). Returns null
   once the tab has been handed over. */
async function gate() {
  const [mode, stored] = await Promise.all([
    installedThemeMode(),
    chrome.storage.local.get([GATE.SETTING_KEY, EXTRAS_KEY]).catch(() => ({})),
  ]);
  if (GATE.decide(stored[GATE.SETTING_KEY], mode) === 'chrome') {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab && tab.id != null) {
        await chrome.tabs.update(tab.id, { url: GATE.CHROME_NEW_TAB_URL });
        return null;
      }
    } catch (_) { /* no handoff possible: show the dashboard rather than a blank tab */ }
  }
  return { mode, extras: stored[EXTRAS_KEY] === true };
}

/* ---------------------------------- scan ---------------------------------- */

const SCAN_NOTES = {
  invalid_url: 'Type a site address, like example.com.',
  not_analyzable: 'That is a Google results page. Open a result instead.',
  tab_open_failed: 'Chrome did not open that page. Try again.',
};

async function onScan(e) {
  e.preventDefault();
  const raw = $('ntUrl').value.trim();
  if (!raw) return;
  const note = $('ntScanNote');
  const res = await scanSite(raw);
  if (!res.ok) { note.textContent = SCAN_NOTES[res.error] || SCAN_NOTES.tab_open_failed; return; }
  note.textContent = 'Opening ' + hostOf(/^https?:/i.test(raw) ? raw : 'https://' + raw) + '…';
}

/* ---------------------------------- boot ---------------------------------- */

(async function init() {
  const ready = await gate();
  if (!ready) return;
  themeOn = ready.mode;
  if (themeOn) {
    // The installed theme decides this page's look, through every later
    // repaint; the saved Night/Day choice for the popup and panel is left alone.
    pinMode(themeOn);
    $('ntAppearance').hidden = true;
    renderTheme(themeOn);
  } else {
    renderTheme(await applyTheme());
    bindControl($('ntAppearance'), renderTheme);
    watchThemeChanges(renderTheme);
  }
  document.documentElement.classList.remove('nt-pending');
  if (ready.extras) renderExtras();

  $('ntScanForm').addEventListener('submit', onScan);

  paint();
  renderAccount();
  renderShortcut();

  /* A capture saved in another tab, or the account changing in settings. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => k.startsWith('capture_'))) paint();
    if (changes.sbwKeyStatus || changes.sbwUser || changes.dataCollection) {
      renderAccount();
      paint({ force: true }); // a reconnect brings a key that may now carry the scope
    }
  });
})();
