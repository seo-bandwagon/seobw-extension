/* SEO Bandwagon — new tab page (chrome_url_overrides.newtab, 1.9.0).
 *
 * Progress and the next task, from this device's own captures: the recent
 * audits with each page's change in score, the latest capture's checks, and
 * the analyzer's first issue on it as the next fix. The scan box opens a site
 * in this tab and analyzes it through the worker's analyzeResult flow, the
 * same as the results overlay's Analyze button.
 *
 * Opening a new tab sends no request: every value is read from
 * chrome.storage.local through src/lib/sbw-data.js, and nothing is written
 * here. Account-level progress (rank tracking, tasks) needs a website endpoint
 * that does not exist yet.
 *
 * Not a search box (Chrome Web Store policy: a new tab page must not change
 * the user's web search). Typed words that are not a site get a note, never a
 * search.
 */

import { applyTheme, watchThemeChanges, bindControl, listingUrl } from '../lib/theme-sync.js';
import {
  recentAudits, checkTotals, topFix, localHistoryLine, accountState, shortcutFor, scanSite, hostOf,
} from '../lib/sbw-data.js';

const $ = (id) => document.getElementById(id);

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

async function paint() {
  const rows = await recentAudits(5);
  renderAudits(rows);
  renderLatest(rows[0]);
  if (rows[0]) renderFix(topFix(rows[0].capture));
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

/* The matching Chrome theme for the mode on screen. Without the `management`
   permission (still declined) the extension cannot tell whether a theme is
   installed, so this is a quiet footer link, not a prompt. */
function renderTheme(mode) {
  const dark = mode !== 'light';
  const url = listingUrl(dark ? 'dark' : 'light');
  const a = $('ntTheme');
  if (!url) { a.hidden = true; return; }
  a.href = url;
  a.textContent = 'Matching Chrome theme: Neon ' + (dark ? 'Night' : 'Day') + ' →';
  a.hidden = false;
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
  renderTheme(await applyTheme());
  bindControl($('ntAppearance'), renderTheme);
  watchThemeChanges(renderTheme);

  $('ntScanForm').addEventListener('submit', onScan);

  paint();
  renderAccount();
  renderShortcut();

  /* A capture saved in another tab, or the account changing in settings. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => k.startsWith('capture_'))) paint();
    if (changes.sbwKeyStatus || changes.sbwUser || changes.dataCollection) renderAccount();
  });
})();
