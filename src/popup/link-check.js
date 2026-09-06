// Broken-link checker — popup UI (Task 1)
//
// Owns the LINK CHECK collapsible section mounted at the end of
// renderResults() in popup.js. Reads shared render helpers off
// `globalThis.SBWPopup` (esc/section/badge/setSeoStatus/getCurrentTab) and
// the pure logic off `globalThis.SBWLinkCheck`/`SBWPerms`/`SBWCsv` (all
// classic <script> loads before this file — see popup.html).
//
// States: no-permission -> idle -> running -> done (or back to idle via
// Cancel). The check NEVER auto-runs — every transition into 'running'
// starts from a real click on "Check N links".

(function () {

  const CLASS_LABELS = { ok: 'OK', redirect: 'REDIRECT', client: '4XX', server: '5XX', timeout: 'TIMEOUT', network: 'NETWORK' };
  const CLASS_ORDER = ['ok', 'redirect', 'client', 'server', 'timeout', 'network'];
  const BROKEN_CLASSES = ['client', 'server', 'timeout', 'network'];

  let sectionEl = null;
  let tab = null;
  let port = null;
  let permsUnsub = null; // unsubscribe for the pending SBWPerms.onAllUrlsGranted() watch, or null

  // Incremented on every mount() — the async chains started by a given
  // mount (init/loadLinks) capture their own `my` and bail out if `gen` has
  // moved on by the time they wake up from an await, instead of writing
  // module-level state (planned/progress/results) that a newer mount has
  // already reset. `sectionEl` alone can't detect this: mount() always
  // reassigns it to the freshly-created section, so `if (!sectionEl) return`
  // was never actually false for a stale caller.
  let gen = 0;

  // 'checking-permission' | 'no-permission' | 'loading-links' | 'idle' |
  // 'running' | 'done' | 'error'
  let state = 'checking-permission';
  let planned = null;              // { links, total } from collectLinks
  let progress = { done: 0, total: 0 };
  let results = [];

  function popup() {
    return globalThis.SBWPopup || {};
  }

  function esc(s) {
    return (popup().esc || (x => String(x)))(s);
  }

  function badgeKindFor(cls) {
    if (cls === 'ok') return 'b-ok';
    if (cls === 'redirect') return 'b-warn';
    return 'b-err'; // client / server / timeout / network
  }

  function truncateMiddle(s, max) {
    if (!s) return '';
    if (s.length <= max) return s;
    const half = Math.floor((max - 1) / 2);
    return s.slice(0, half) + '…' + s.slice(s.length - half);
  }

  function sendToTab(msg) {
    return new Promise((resolve, reject) => {
      if (!tab || !tab.id) { reject(new Error('no active tab')); return; }
      chrome.tabs.sendMessage(tab.id, msg, (res) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        resolve(res);
      });
    });
  }

  /* ---------- mount / (re)init ---------- */

  function mount(container, data) {
    if (!container || typeof globalThis.SBWLinkCheck === 'undefined') return;
    const { section, getCurrentTab } = popup();
    if (!section) return;

    tab = getCurrentTab ? getCurrentTab() : null;
    if (port) { try { port.disconnect(); } catch (e) { /* already gone */ } }
    port = null;
    if (permsUnsub) { permsUnsub(); permsUnsub = null; }
    const my = ++gen;
    state = 'checking-permission';
    planned = null;
    progress = { done: 0, total: 0 };
    results = [];

    const holder = document.createElement('div');
    holder.innerHTML = section('link-check', 'LINK CHECK', '<span class="lc-badge-slot"></span>', '<div class="lc-body"></div>');
    sectionEl = holder.firstElementChild;
    container.appendChild(sectionEl);

    sectionEl.querySelector('.section-header').addEventListener('click', () => sectionEl.classList.toggle('open'));
    sectionEl.querySelector('.section-content').addEventListener('click', e => e.stopPropagation());

    render();
    init(my);
  }

  async function init(my) {
    const has = await SBWPerms.hasAllUrls();
    if (my !== gen) return; // a newer mount() superseded this one while we awaited
    if (!has) {
      state = 'no-permission';
      render();
      watchForGrant(my);
      return;
    }
    await loadLinks(my);
  }

  // Re-renders out of the "Allow access" card the moment the permission is
  // granted some other way while this popup is still open — e.g. from
  // chrome://extensions in another tab, rather than only through this
  // card's own Allow button (item 9, task-3 fix round 1).
  function watchForGrant(my) {
    if (permsUnsub) { permsUnsub(); permsUnsub = null; }
    permsUnsub = SBWPerms.onAllUrlsGranted(() => {
      if (my !== gen || state !== 'no-permission') return;
      loadLinks(my);
    });
  }

  // Reads the page's links via the content script. A cached-analysis popup
  // load (task-1-fix-1-brief item 1) skips popup.js's own executeScript
  // call entirely, so the content script may simply not be there yet — the
  // first collectLinks send then fails with "receiving end does not exist".
  // On that failure (and only that one), inject the same file list
  // popup.js's own analyze path uses and retry collectLinks exactly once
  // before giving up.
  async function loadLinks(my) {
    state = 'loading-links';
    render();
    let res;
    let failed = false;
    try {
      try {
        res = await sendToTab({ action: 'collectLinks' });
      } catch (e) {
        if (my !== gen) return;
        if (tab && tab.id) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['lib/content-analysis.js', 'lib/dom-extraction.js', 'src/lib/link-check.js', 'src/lib/hreflang.js', 'src/lib/structured-data.js', 'src/content/analyzer.js']
            });
          } catch (e2) { /* already injected, or injection itself failed — retry regardless */ }
        }
        if (my !== gen) return;
        res = await sendToTab({ action: 'collectLinks' });
      }
    } catch (e) {
      failed = true;
    }
    if (my !== gen) return;
    if (failed || (res && res.error)) {
      state = 'error';
    } else {
      planned = (res && Array.isArray(res.links)) ? res : { links: [], total: 0 };
      state = 'idle';
    }
    render();
  }

  /* ---------- render ---------- */

  function render() {
    if (!sectionEl) return;
    const bodyEl = sectionEl.querySelector('.lc-body');
    if (bodyEl) bodyEl.innerHTML = renderBody();
    const badgeSlot = sectionEl.querySelector('.lc-badge-slot');
    if (badgeSlot) badgeSlot.outerHTML = renderBadgeSlot();
    wire();
  }

  function renderBadgeSlot() {
    const { badge } = popup();
    let inner = '';
    if (state === 'done') {
      const { broken } = SBWLinkCheck.groupResults(results);
      inner = broken > 0 ? badge(`${broken} BROKEN`, 'b-err') : badge('ALL OK', 'b-ok');
    }
    return `<span class="lc-badge-slot">${inner}</span>`;
  }

  function renderBody() {
    switch (state) {
      case 'no-permission':
        return `<div class="lc-perm-card">
          <p class="lc-perm-copy">${esc(SBWPerms.ALL_URLS_REASON)}</p>
          <button type="button" class="lc-allow-btn" id="lcAllowBtn">Allow access to check other sites</button>
        </div>`;

      case 'checking-permission':
      case 'loading-links':
        return `<div class="lc-loading">Reading links on this page…</div>`;

      case 'error':
        return `<div class="lc-error">Couldn't read links on this page.</div>`;

      case 'idle': {
        const links = (planned && planned.links) || [];
        const total = (planned && planned.total) || 0;
        const n = links.length;
        const label = total > n ? `Check first ${n} of ${total} links` : `Check ${n} link${n === 1 ? '' : 's'}`;
        return `<button type="button" class="lc-check-btn" id="lcCheckBtn"${n === 0 ? ' disabled' : ''}>${esc(label)}</button>`;
      }

      case 'running':
        return `<div class="lc-progress">Checked ${progress.done} / ${progress.total}</div>
          <button type="button" class="lc-cancel-btn" id="lcCancelBtn">Cancel</button>`;

      case 'done':
        return renderDone();

      default:
        return '';
    }
  }

  function renderDone() {
    const { groups, counts, broken } = SBWLinkCheck.groupResults(results);

    const chips = CLASS_ORDER.map(cls => `<span class="lc-chip lc-chip-${cls}" data-class="${cls}">
      ${esc(CLASS_LABELS[cls])} <span class="lc-chip-count">${counts[cls]}</span>
    </span>`).join('');

    const groupsHtml = CLASS_ORDER
      .filter(cls => counts[cls] > 0)
      .map(cls => {
        // Everything that isn't the clean/ok bucket starts expanded — see
        // the Task 1 report for why redirect is grouped with the broken
        // classes here even though groupResults()'s `broken` count excludes it.
        const openClass = cls === 'ok' ? '' : ' open';
        const rows = groups[cls].map(r => `<div class="lc-row">
          <span class="lc-row-status badge-mono ${badgeKindFor(cls)}">${r.status}</span>
          <span class="lc-row-url" title="${esc(r.url)}">${esc(truncateMiddle(r.url, 60))}</span>
          <span class="lc-row-anchor">${esc(truncateMiddle(r.text || '', 40))}</span>
        </div>`).join('');
        return `<div class="lc-group${openClass}" data-class="${cls}">
          <div class="lc-group-head">${esc(CLASS_LABELS[cls])} (${counts[cls]})</div>
          <div class="lc-group-rows">${rows}</div>
        </div>`;
      }).join('');

    return `<div class="lc-chips">${chips}</div>
      <div class="lc-groups">${groupsHtml}</div>
      <div class="lc-actions">
        <button type="button" class="lc-highlight-btn" id="lcHighlightBtn"${broken === 0 ? ' disabled' : ''}>Highlight broken on page</button>
        <button type="button" class="lc-export-btn" id="lcExportBtn">Export CSV</button>
      </div>`;
  }

  /* ---------- wiring ---------- */

  function wire() {
    if (!sectionEl) return;
    sectionEl.querySelector('#lcAllowBtn')?.addEventListener('click', onAllowClick);
    sectionEl.querySelector('#lcCheckBtn')?.addEventListener('click', onCheckClick);
    sectionEl.querySelector('#lcCancelBtn')?.addEventListener('click', onCancelClick);
    sectionEl.querySelector('#lcHighlightBtn')?.addEventListener('click', onHighlightClick);
    sectionEl.querySelector('#lcExportBtn')?.addEventListener('click', onExportClick);
    sectionEl.querySelectorAll('.lc-group-head').forEach(head => {
      head.addEventListener('click', () => head.parentElement.classList.toggle('open'));
    });
  }

  // Calls chrome.permissions.request() as the very first statement, still
  // inside this click handler's call stack — required for it to count as a
  // user gesture. Everything after the `await` runs on the resolved
  // permission, not the gesture, which is fine: only the request() call
  // itself needs the gesture.
  async function onAllowClick() {
    const my = gen;
    const granted = await SBWPerms.requestAllUrls();
    if (my !== gen) return;
    if (!granted) {
      popup().setSeoStatus?.('Permission request was not granted', 'error');
      return;
    }
    await loadLinks(my);
  }

  function onCheckClick() {
    if (!planned || !planned.links.length) return;
    state = 'running';
    progress = { done: 0, total: planned.links.length };
    results = [];
    render();

    port = chrome.runtime.connect({ name: 'link-check' });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => { port = null; });
    port.postMessage({ type: 'start', links: planned.links });
  }

  function onCancelClick() {
    if (port) { try { port.disconnect(); } catch (e) { /* already gone */ } }
    port = null;
    state = 'idle';
    render();
  }

  function onPortMessage(msg) {
    if (!msg || !sectionEl) return;
    if (msg.type === 'progress') {
      progress = { done: msg.done, total: msg.total };
      render();
    } else if (msg.type === 'done') {
      results = msg.results || [];
      state = 'done';
      if (port) { try { port.disconnect(); } catch (e) { /* already gone */ } }
      port = null;
      render();
    } else if (msg.type === 'error') {
      if (port) { try { port.disconnect(); } catch (e) { /* already gone */ } }
      port = null;
      if (msg.code === 'no_permission') {
        state = 'no-permission';
        popup().setSeoStatus?.('Page access was revoked — allow it again to check links', 'error');
      } else {
        state = 'idle';
        popup().setSeoStatus?.('Link check failed', 'error');
      }
      render();
    }
  }

  function onHighlightClick() {
    if (!tab || !tab.id) return;
    const { groups } = SBWLinkCheck.groupResults(results);
    const brokenUrls = BROKEN_CLASSES.reduce((acc, cls) => acc.concat(groups[cls].map(r => r.url)), []);
    sendToTab({ action: 'highlight', type: 'broken', urls: brokenUrls })
      .then(() => {
        popup().setSeoStatus?.(`Highlighted ${brokenUrls.length} broken link${brokenUrls.length === 1 ? '' : 's'}`, 'success');
      })
      .catch(() => {
        popup().setSeoStatus?.('Highlight failed', 'error');
      });
  }

  const CSV_COLUMNS = [
    { key: 'url', label: 'URL' },
    { key: 'status', label: 'Status' },
    { key: 'class', label: 'Class' },
    { key: 'finalUrl', label: 'Final URL' },
    { key: 'anchor', label: 'Anchor Text' },
    { key: 'rel', label: 'Rel' },
    { key: 'type', label: 'Type' },
    { key: 'ms', label: 'Time (ms)' },
    { key: 'error', label: 'Error' }
  ];

  function onExportClick() {
    const rows = SBWLinkCheck.resultRows(results);
    const csv = SBWCsv.toCsv(rows, CSV_COLUMNS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SBWCsv.csvFilename('links', (tab && tab.url) || 'https://page.example/');
    a.click();
    // Some browsers (notably Firefox) read the blob URL asynchronously to
    // start the download; revoking it in the same tick as click() can race
    // that read and produce an empty/failed download. Deferring the revoke
    // is the standard workaround for that race.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    popup().setSeoStatus?.('Exported', 'success');
  }

  globalThis.SBWLinkCheckUI = { mount };
})();
