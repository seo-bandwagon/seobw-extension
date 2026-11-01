/* SEO Bandwagon — themed page-checks panel.
 *
 * Live checks for the tab in front of you, from the same analyzer response the
 * toolbar popup renders and the same 14 checks it scores. Citations and link
 * building stay in src/sidepanel; the footer link swaps this tab's panel over
 * to that one, and neither replaces the other.
 *
 * Presentational only. Every value comes from src/lib/sbw-data.js, which is
 * the only route to the product, and nothing here calls fetch.
 */

import { applyTheme, watchThemeChanges, bindControl } from '../lib/theme-sync.js';
import {
  analyzeTab, pageChecks, checkTotals, directoryMatch, accountState,
  drainPending, drainLine, toolRow, isAnalyzable, hostOf, openPanel,
} from '../lib/sbw-data.js';

const $ = (id) => document.getElementById(id);

/* --------------------------------- checks --------------------------------- */

function renderChecks(rows, totals) {
  $('pnChecksHead').textContent = `On-page checks · ${totals.passed} of ${totals.of} passed`;
  const ul = $('pnChecks');
  ul.textContent = '';
  for (const r of rows) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'pn-dot';
    dot.dataset.s = r.status;
    const name = document.createElement('span');
    name.className = 'pn-name';
    name.textContent = r.name;
    const note = document.createElement('span');
    note.className = 'pn-note';
    note.textContent = r.note;
    li.append(dot, name, note);
    ul.append(li);
  }
}

function renderEmpty(message, action) {
  $('pnChecksHead').textContent = 'On-page checks';
  const ul = $('pnChecks');
  ul.textContent = '';
  const li = document.createElement('li');
  li.className = 'pn-empty';
  li.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-primary pn-allow';
    b.textContent = action.label;
    b.addEventListener('click', action.onClick);
    li.append(document.createElement('br'), b);
  }
  ul.append(li);
}

async function renderDirectory(url) {
  const match = await directoryMatch(url);
  if (!match) {
    $('pnDirSection').hidden = true;
    return;
  }
  $('pnDirLine').textContent =
    `${match.name} — one of the curated citation directories. Check the business listing in Citations.`;
  $('pnDirSection').hidden = false;
}

function renderTools(url) {
  const wrap = $('pnTools');
  wrap.textContent = '';
  for (const t of toolRow(url)) {
    const a = document.createElement('a');
    a.href = t.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = t.label;
    wrap.append(a);
  }
}

/* --------------------------------- account -------------------------------- */

/* One line per account state. Each one says what the panel can still do,
   because the checks above never need an account — they are computed from the
   page itself, on this device. */
const ACCOUNT_LINES = {
  connected: (email) =>
    email ? `Connected as ${email}. Captures sync.` : 'Connected. Captures sync.',
  unverified: () => 'Your API key is on this device; it is checked the first time it is used. Every check above works either way.',
  no_key: () => 'Signed out. Every check above still works, on this device.',
  invalid: () => 'Your API key was rejected. Reconnect in settings to sync again.',
  collection_off: () => 'Connected, but capture sync is off in settings.',
};

async function renderAccount() {
  const { state, email } = await accountState();
  const line = ACCOUNT_LINES[state] || ACCOUNT_LINES.no_key;
  $('pnAccount').textContent = line(email);
  $('pnOptions').hidden = state === 'connected';
}

/** Retry anything the account never received. Silent unless it did something. */
async function runDrain() {
  const { state } = await accountState();
  // An unverified key (a second device) is checked by this very drain.
  if (state !== 'connected' && state !== 'unverified') return;
  const line = drainLine(await drainPending({ max: 20 }));
  if (!line) return;
  $('pnSync').textContent = line;
  $('pnSync').hidden = false;
}

/* ---------------------------------- paint --------------------------------- */

// A person starts every scan (human in the loop). Until 1.7.9 the panel
// analyzed, saved and (signed in) synced every page as you switched tabs or
// it finished loading: once "access to all sites" was granted that read every
// page browsed. Now a tab switch or a load only shows a result already taken
// for the page (the popup's, say); anything else waits for "Scan this page".
// Opening the panel is a click, so it scans the tab it opened on.
async function paint(tab, { scan = false } = {}) {
  if (!tab || !isAnalyzable(tab.url)) {
    $('pnHost').textContent = '—';
    renderTools('');
    $('pnDirSection').hidden = true;
    renderEmpty('Open an http or https page to see its checks.');
    return;
  }
  $('pnHost').textContent = hostOf(tab.url);
  renderTools(tab.url);
  renderDirectory(tab.url);
  if (!scan) {
    const cached = await chrome.runtime.sendMessage({ action: 'getCachedAnalysis', tabId: tab.id, url: tab.url }).catch(() => null);
    if (cached && cached.hit) renderChecks(pageChecks(cached.data), checkTotals(cached.data));
    else renderEmpty('Click "Scan this page" to check it.');
    return;
  }
  renderEmpty('Reading the page…');
  try {
    const { data } = await analyzeTab(tab);
    renderChecks(pageChecks(data), checkTotals(data));
  } catch (e) {
    if (e && e.problem) { renderEmpty(e.problem.body); return; }
    // S53: Chrome gives a side panel no access of its own; it can read the
    // tab where the toolbar icon was clicked, or any tab once the optional
    // "access to all sites" is granted, which only a click here asks for.
    if (!(await globalThis.SBWPerms.hasAllUrls())) {
      renderEmpty('The extension can only read a tab after you click its toolbar icon there, or after you allow it to analyze other tabs. Nothing is read until you click Scan.', {
        label: 'Allow access to analyze other tabs',
        onClick: async () => {
          const granted = await globalThis.SBWPerms.requestAllUrls().catch(() => false);
          if (granted) paint(tab, { scan: true });
        }
      });
      return;
    }
    renderEmpty('Chrome blocked analysis on this page. Reload it, then scan again.');
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

(async function init() {
  await applyTheme();
  bindControl($('pnAppearance'));
  watchThemeChanges(() => {});

  renderAccount();
  runDrain();

  let tab = await activeTab();
  paint(tab, { scan: true }); // the panel was just opened with a click

  $('pnRescan').addEventListener('click', async () => {
    tab = await activeTab();
    paint(tab, { scan: true });
  });
  $('pnCitations').addEventListener('click', () => openPanel('citations', tab && tab.id));
  $('pnOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

  /* Follow the user across tab switches and reloads, without scanning (see paint). */
  chrome.tabs.onActivated.addListener(async () => { tab = await activeTab(); paint(tab); });
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (tab && id === tab.id && info.status === 'complete') paint(tab);
  });

  /* The options page and the other surfaces write the same account keys. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.sbwKeyStatus || changes.sbwUser || changes.dataCollection) renderAccount();
  });
})();
