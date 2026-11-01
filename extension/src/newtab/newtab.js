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
 *
 * 1.10.0: rank drops first. With the account's summary on screen the page
 * leads with "Rank changes" for one tracker at a time (a switcher when there
 * are several, the one with the most drops first): each drop's keyword, from
 * → to as the site gives it, the page that lost it, the page Google ranks
 * instead when it swapped them, who holds the old spot, the next fix for that
 * page when it has been captured, and a link to the drop page on the site.
 * Then the keywords that went up. Tasks sit beside it, and the recent audits
 * run below, each with its full address, first two issues and date. Signed
 * out, or when the summary can't be had, the page is the 1.9 layout, with
 * the same audit rows.
 */

import { applyTheme, watchThemeChanges, bindControl, listingUrl, installedThemeMode, pinMode } from '../lib/theme-sync.js';
import {
  recentAudits, checkTotals, topFix, localHistoryLine, accountState, shortcutFor, scanSite, hostOf,
  accountProgress, progressLink, trackerOrder, dropView, trackerGains, auditDetail,
} from '../lib/sbw-data.js';

const $ = (id) => document.getElementById(id);
const GATE = globalThis.SBWNewTabGate;
const EXTRAS_KEY = 'bwNewTabExtras';
/* The Neon theme found when this tab opened: 'dark', 'light' or null. */
let themeOn = null;

/* --------------------------------- audits --------------------------------- */

/* Each row: the score, the page's full address, its first two issues and the
   capture's date, and the change since that page's previous capture. */
function renderAudits(rows) {
  const ul = $('ntAudits');
  if (!rows.length) return; // the empty state in the markup stays
  ul.textContent = '';
  for (const r of rows) {
    const body = document.createElement('span');
    body.className = 'nt-audit-body';
    const url = document.createElement('a');
    url.className = 'nt-domain';
    url.href = r.url;
    url.textContent = r.url;
    url.title = r.url;
    body.append(url, span('nt-audit-detail', auditDetail(r)));
    const right = document.createElement('span');
    right.className = 'nt-right';
    if (r.delta !== null && r.delta !== 0) {
      const d = span('nt-delta', (r.delta > 0 ? '+' : '−') + Math.abs(r.delta));
      d.dataset.dir = r.delta > 0 ? 'up' : 'down';
      d.title = 'Change since this page\'s previous capture';
      right.append(d);
    }
    right.append(span('nt-score', r.score));
    ul.append(li('', body, right));
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
  // 1.10.4: and what it costs on the on-page checklist, as the popup says.
  const cost = fix.points ? ' · costs ' + fix.points + (fix.points === 1 ? ' point' : ' points') : '';
  $('ntFixCount').textContent = (fix.of === 1
    ? 'The one issue found on ' + fix.host
    : '1 of ' + fix.of + ' issues found on ' + fix.host) + cost;
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
/* The tracker picked in the switcher, kept through repaints of this tab. */
let trackerChoice = null;

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

/* A line of text that may hold a link: `parts` are strings, nodes, or
   { text, href } for an address (shown in full, linked when href is set). */
function line(className, ...parts) {
  const p = document.createElement('p');
  p.className = className;
  for (const part of parts) {
    if (typeof part === 'string' || part instanceof Node) { p.append(part); continue; }
    const el = part.href ? document.createElement('a') : document.createElement('span');
    el.className = 'nt-url';
    el.textContent = part.text;
    if (part.href) { el.href = part.href; el.title = part.text; }
    p.append(el);
  }
  return p;
}

function dropItem(d, siteHost) {
  const pos = span('nt-mv-pos', `${d.from} → ${d.out ? 'out' : d.to}`);
  pos.title = `Position ${d.from}${d.since ? ' on ' + d.since : ''}, `
    + (d.out ? 'out of the checked results now' : d.to + ' now');
  const right = document.createElement('span');
  right.className = 'nt-right';
  right.append(pos);
  if (d.fell) {
    const change = span('nt-delta', '−' + d.fell);
    change.dataset.dir = 'down';
    right.append(change);
  }
  const head = document.createElement('div');
  head.className = 'nt-drop-head';
  head.append(span('nt-drop-kw', d.keyword), right);

  const item = li('nt-drop', head);
  if (d.lostUrl) item.append(line('nt-drop-line', span('nt-drop-label', 'Page that lost it'), ' ', { text: d.lostUrl, href: d.lostUrl }));
  if (d.nowUrl) item.append(line('nt-drop-line', 'Google now ranks ', { text: d.nowUrl, href: d.nowUrl }, ' instead'));
  if (d.out) item.append(line('nt-drop-line', 'Out of the checked results now'));
  if (d.tookSpot) item.append(line('nt-drop-line', `At ${d.from} now: `, { text: d.tookSpot }));
  if (d.fix) item.append(line('nt-drop-fix', 'Next fix for this page: ', d.fix));
  if (d.analyzeUrl) {
    const a = document.createElement('a');
    a.className = 'nt-minilink';
    a.href = d.analyzeUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `Analyze this drop on ${siteHost} →`;
    item.append(a);
  }
  return item;
}

function gainItem(m) {
  const change = span('nt-delta', '+' + m.change);
  change.dataset.dir = 'up';
  const right = document.createElement('span');
  right.className = 'nt-right';
  right.append(span('nt-mv-pos', m.from + ' → ' + m.to), change);
  const kw = span('nt-domain', m.keyword);
  kw.title = m.url || m.domain;
  return li('', kw, right);
}

function trackerName(t, all) {
  const twin = all.some((o) => o.tracker !== t && o.tracker.domain === t.domain);
  return twin ? `${t.domain} · ${t.market}` : t.domain;
}

function renderRank(result) {
  const card = $('ntRankCard');
  const dropsUl = $('ntDrops');
  const gainsUl = $('ntGains');
  const switcher = $('ntTrackerSwitch');
  dropsUl.textContent = '';
  gainsUl.textContent = '';
  switcher.textContent = '';
  switcher.hidden = true;
  $('ntGainsHead').hidden = true;
  $('ntTrackerLine').textContent = '';
  $('ntRankNote').textContent = '';
  $('ntRankTitle').textContent = 'Rank tracking';

  if (result.state === 'reconnect') {
    $('ntRankNote').textContent = 'Reconnect your account to see rank tracking and tasks here. Your key was made before this page existed.';
    setLink($('ntRankLink'), progressLink(result.origin, '/dashboard/api-keys'), 'Reconnect →');
    card.hidden = false;
    return;
  }
  if (result.state !== 'ok') { card.hidden = true; return; }

  const { trackers, movers } = result.data.rankTracking;
  const drops = result.data.rankTracking.drops || []; // a site from before PR 3 sends none
  const days = result.data.windowDays;
  const order = trackerOrder(trackers, drops).slice(0, MAX_TRACKERS);
  setLink($('ntRankLink'), progressLink(result.origin, '/dashboard/rank-tracker/'),
    trackers.length ? 'Open the rank tracker →' : 'Track keywords →');
  card.hidden = false;
  if (!order.length) { $('ntRankNote').textContent = 'No rank trackers on your account yet.'; return; }

  const shown = order.find((o) => o.tracker.id === trackerChoice) || order[0];
  const t = shown.tracker;
  $('ntRankTitle').textContent = `Rank changes · last ${days} days · ${t.domain}`;
  if (order.length > 1) {
    for (const o of order) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(o === shown));
      b.title = `${o.tracker.domain} · ${o.tracker.market}`;
      b.append(trackerName(o.tracker, order), ' ', span('nt-switch-count', String(o.drops.length)));
      b.addEventListener('click', () => { trackerChoice = o.tracker.id; renderRank(result); });
      switcher.append(b);
    }
    switcher.hidden = false;
  }
  $('ntTrackerLine').textContent = `${t.top10} of ${t.keywords} in the top 10 · ${t.top3} in the top 3 · ${t.market}`
    + (t.status === 'paused' ? ' · paused' : '');

  const siteHost = hostOf(result.origin) || 'seobandwagon.com';
  for (const d of shown.drops) dropsUl.append(dropItem(dropView(d, result.origin), siteHost));
  if (!shown.drops.length) dropsUl.append(li('nt-empty', document.createTextNode(`No keyword on ${t.domain} fell in the last ${days} days.`)));

  const gains = trackerGains(movers, t.id).slice(0, MAX_MOVERS);
  for (const m of gains) gainsUl.append(gainItem(m));
  $('ntGainsHead').hidden = !gains.length;

  if (trackers.length > MAX_TRACKERS) $('ntRankNote').textContent = `${trackers.length - MAX_TRACKERS} more trackers in the dashboard.`;
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
  // With the account's tasks on screen the next fix is their first row, and
  // the page leads with rank changes (newtab.css, [data-layout='account']).
  const account = renderTasks(progress, fix);
  if (account) $('ntFixCard').hidden = true;
  document.querySelector('.nt').dataset.layout = account ? 'account' : 'local';
}

/* -------------------------------- account --------------------------------- */

const ACCOUNT_BADGES = {
  connected: { text: 'Synced', title: (email) => (email ? 'Connected as ' + email : 'Account connected') },
  unverified: { text: 'Checking key', title: () => 'Your API key is on this device but SEO Bandwagon has not answered for it yet.' },
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

  /* A capture saved in another tab, or the account changing in settings.
     A verify writes two keys, so the account repaint waits a moment and runs
     once. It needs no force: a reconnect clears the cached progress
     (SBW.clearAccountCaches), so a key that now carries the scope is asked. */
  let accountTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => k.startsWith('capture_'))) paint();
    if (changes.sbwKeyStatus || changes.sbwUser || changes.dataCollection) {
      clearTimeout(accountTimer);
      accountTimer = setTimeout(() => { renderAccount(); paint(); }, 50);
    }
  });
})();
