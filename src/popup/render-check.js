// Rendering panel — popup UI (Task 4)
//
// Owns the RENDERING collapsible section, mounted directly after Hreflang
// in renderResults() (popup.js) — falling back to Indexability, then Page
// Meta, if Hreflang didn't render an actual section (a page with no
// hreflang tags gets a note inside Page Meta instead, see
// src/popup/hreflang.js's renderEmptyNote — there's no `[data-section=
// "hreflang"]` to land after in that case). Link Check — which always
// appends to the end of #content — stays the last section regardless.
//
// Reads shared render helpers off `globalThis.SBWPopup` (esc/section/badge/
// setSeoStatus/getCurrentTab) and pure logic off `globalThis.SBWHtmlDiff`/
// `SBWUaSwitch`/`SBWPerms`/`SBWCsv` (classic <script> loads before this
// file — see popup.html). Follows src/popup/hreflang.js and
// src/popup/indexability.js's mount/gen-counter/permission-card pattern.
//
// Two independent things live in this one section, both gated on the same
// optional <all_urls> permission (the raw-HTML fetch needs it to fetch a
// second copy of the page; the UA switcher's DNR rule needs
// declarativeNetRequestWithHostAccess, which only actually rewrites a
// header on hosts the extension currently has host access to):
//   - "Raw vs rendered": fetches the current tab's own URL a second time,
//     unrendered, via the background worker's fetchRawHtml, and diffs it
//     against the already-computed rendered-DOM analysis (SBWHtmlDiff).
//   - "View as": a <select> of user-agent presets (SBWUaSwitch.PRESETS).
//     Changing it asks the worker to set/clear a per-tab DNR session rule
//     and reload the tab — this is for testing server-side rendering and
//     cloaking, never for bypassing a paywall or "seeing Google as a bot"
//     (see the ledger's binding copy rulings).

(function () {

  let sectionEl = null;
  let tab = null;
  let pageData = null;
  let permsUnsub = null; // unsubscribe for the pending SBWPerms.onAllUrlsGranted() watch, or null

  // See hreflang.js/indexability.js for why this exists: every mount() bumps
  // `gen`, and every async continuation (init/loadUaState/onCompareClick/
  // onUaChange) captures its own `my` and bails if a newer mount has
  // superseded it while it was awaiting.
  let gen = 0;

  // 'checking-permission' | 'no-permission' | 'ready'
  let state = 'checking-permission';

  // 'idle' | 'loading' | 'done' | 'error' — the raw-vs-rendered check's own
  // lifecycle, independent of the UA switcher below.
  let diffState = 'idle';
  let diffResult = null; // SBWHtmlDiff.diffSummaries() result, or null before a compare completes
  let diffError = null;

  let uaPresetId = 'default'; // the tab's current preset, from getUserAgent
  let uaLoading = false;      // true while a setUserAgent round-trip (and the reload it triggers) is in flight

  function popup() {
    return globalThis.SBWPopup || {};
  }

  function esc(s) {
    return (popup().esc || (x => String(x)))(s);
  }

  function truncateMiddle(s, max) {
    if (!s) return '';
    if (s.length <= max) return s;
    const half = Math.floor((max - 1) / 2);
    return s.slice(0, half) + '…' + s.slice(s.length - half);
  }

  function fmtVal(v) {
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  }

  function sendToWorker(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /* ---------- mount / (re)init ---------- */

  function mount(container, data) {
    if (!container) return;
    if (typeof globalThis.SBWHtmlDiff === 'undefined' || typeof globalThis.SBWUaSwitch === 'undefined') return;
    if (permsUnsub) { permsUnsub(); permsUnsub = null; }

    const { section, getCurrentTab } = popup();
    if (!section) return;

    pageData = data;
    tab = getCurrentTab ? getCurrentTab() : null;
    const my = ++gen;
    state = 'checking-permission';
    diffState = 'idle';
    diffResult = null;
    diffError = null;
    uaPresetId = 'default';
    uaLoading = false;

    const holder = document.createElement('div');
    holder.innerHTML = section('render', 'RENDERING', '<span class="rc-badge-slot"></span>', '<div class="rc-body"></div>');
    sectionEl = holder.firstElementChild;

    // Land directly after Hreflang (falling back to Indexability, then Page
    // Meta) — see the module comment.
    const anchor = container.querySelector('[data-section="hreflang"]')
      || container.querySelector('[data-section="indexability"]')
      || container.querySelector('[data-section="meta"]');
    if (anchor && anchor.parentElement === container) {
      anchor.insertAdjacentElement('afterend', sectionEl);
    } else {
      container.appendChild(sectionEl);
    }

    sectionEl.querySelector('.section-header').addEventListener('click', () => sectionEl.classList.toggle('open'));
    sectionEl.querySelector('.section-content').addEventListener('click', e => e.stopPropagation());

    render();
    init(my);
  }

  async function init(my) {
    const has = await SBWPerms.hasAllUrls();
    if (my !== gen) return;
    if (!has) {
      state = 'no-permission';
      render();
      watchForGrant(my);
      return;
    }
    state = 'ready';
    render();
    await loadUaState(my);
  }

  // Re-renders out of the "Allow access" card the moment the permission is
  // granted some other way while this popup is still open — e.g. from
  // chrome://extensions in another tab, rather than only through this
  // card's own Allow button (same pattern as hreflang.js/indexability.js).
  function watchForGrant(my) {
    if (permsUnsub) { permsUnsub(); permsUnsub = null; }
    permsUnsub = SBWPerms.onAllUrlsGranted(() => {
      if (my !== gen || state !== 'no-permission') return;
      state = 'ready';
      render();
      loadUaState(my);
    });
  }

  async function loadUaState(my) {
    if (!tab || !tab.id) return;
    const res = await sendToWorker({ action: 'getUserAgent', tabId: tab.id });
    if (my !== gen) return;
    uaPresetId = (res && res.presetId) || 'default';
    render();
  }

  /* ---------- render ---------- */

  function render() {
    if (!sectionEl) return;
    const bodyEl = sectionEl.querySelector('.rc-body');
    if (bodyEl) bodyEl.innerHTML = renderBody();
    const badgeSlot = sectionEl.querySelector('.rc-badge-slot');
    if (badgeSlot) badgeSlot.outerHTML = renderBadgeSlot();
    wire();
  }

  // A visible "UA override active" chip on the section badge while a preset
  // is set — the one thing about this section's state worth surfacing even
  // when the section itself is collapsed, since it changes what every
  // request from this tab looks like to the site until it's turned off.
  function renderBadgeSlot() {
    const { badge } = popup();
    const inner = (state === 'ready' && uaPresetId && uaPresetId !== 'default')
      ? badge('UA OVERRIDE ACTIVE', 'b-warn')
      : '';
    return `<span class="rc-badge-slot">${inner}</span>`;
  }

  function renderBody() {
    switch (state) {
      case 'no-permission':
        return `<div class="lc-perm-card">
          <p class="lc-perm-copy">${esc(SBWPerms.ALL_URLS_REASON)}</p>
          <button type="button" class="lc-allow-btn" id="rcAllowBtn">Allow access to check other sites</button>
        </div>`;

      case 'checking-permission':
        return `<div class="lc-loading">Checking permission…</div>`;

      case 'ready':
        return `
          <div class="rc-section-label">Raw vs rendered</div>
          ${renderDiffBlock()}
          <div class="rc-section-label">View as</div>
          ${renderUaBlock()}
        `;

      default:
        return '';
    }
  }

  /* ---------- raw vs rendered ---------- */

  function renderDiffBlock() {
    if (diffState === 'idle') {
      return `<div class="rc-actions">
        <button type="button" class="rc-compare-btn" id="rcCompareBtn">Compare raw HTML with rendered DOM</button>
      </div>`;
    }
    if (diffState === 'loading') {
      return `<div class="lc-loading">Fetching raw HTML…</div>`;
    }
    if (diffState === 'error') {
      const msg = diffError === 'no_permission' ? 'Page access was revoked — allow it again above.'
        : diffError === 'invalid_url' ? 'This tab has no fetchable page URL to compare.'
        : diffError === 'timeout' ? 'The raw-HTML fetch timed out.'
        : 'Comparison failed.';
      return `<div class="rc-actions">
        <button type="button" class="rc-compare-btn" id="rcCompareBtn">Compare raw HTML with rendered DOM</button>
      </div>
      <div class="rc-error">${esc(msg)}</div>`;
    }
    // diffState === 'done'
    return `
      ${renderVerdict()}
      <div class="rc-table">${diffResult.rows.map(renderDiffRow).join('')}</div>
      <div class="rc-actions">
        <button type="button" class="rc-compare-btn" id="rcCompareBtn">Re-compare</button>
        <button type="button" class="rc-export-btn" id="rcExportBtn">Export CSV</button>
      </div>
    `;
  }

  const VERDICT_LABEL = {
    static: 'Static HTML',
    hydrated: 'Hydrated — same content'
  };

  function renderVerdict() {
    const v = diffResult.verdict;
    let label;
    if (v === 'js-rendered') {
      const n = diffResult.rows.filter(r => r.status === 'js-only').length;
      label = `JavaScript-rendered — ${n} field${n === 1 ? '' : 's'} exist only after JS`;
    } else {
      label = VERDICT_LABEL[v] || v;
    }
    const cls = v === 'js-rendered' ? 'b-warn' : 'b-ok';
    return `<div class="rc-verdict">
      <span class="badge-mono ${cls}">${esc(label)}</span>
    </div>`;
  }

  const STATUS_LABEL = { same: 'SAME', 'js-only': 'JS ONLY', 'raw-only': 'RAW ONLY', changed: 'CHANGED' };

  function statusChipClass(status) {
    if (status === 'same') return 'b-ok';
    if (status === 'changed') return 'b-err';
    return 'b-warn'; // js-only / raw-only
  }

  function renderDiffRow(row) {
    const rawStr = fmtVal(row.raw);
    const renderedStr = fmtVal(row.rendered);
    return `<div class="rc-row">
      <span class="rc-field">${esc(row.field)}</span>
      <span class="rc-val" title="${esc(rawStr)}">${esc(truncateMiddle(rawStr, 24))}</span>
      <span class="rc-val" title="${esc(renderedStr)}">${esc(truncateMiddle(renderedStr, 24))}</span>
      <span class="badge-mono ${statusChipClass(row.status)}">${STATUS_LABEL[row.status] || esc(row.status)}</span>
    </div>`;
  }

  /* ---------- view as (UA switcher) ---------- */

  function renderUaBlock() {
    const opts = SBWUaSwitch.PRESETS.map(p =>
      `<option value="${esc(p.id)}"${p.id === uaPresetId ? ' selected' : ''}>${esc(p.label)}</option>`
    ).join('');
    return `<div class="rc-ua-row">
      <select class="rc-ua-select" id="rcUaSelect"${uaLoading ? ' disabled' : ''}>${opts}</select>
    </div>
    <p class="rc-ua-help">Reloads this tab with a different User-Agent header to test server-side rendering and cloaking. Turn it off when you're done.</p>`;
  }

  /* ---------- wiring ---------- */

  function wire() {
    if (!sectionEl) return;
    sectionEl.querySelector('#rcAllowBtn')?.addEventListener('click', onAllowClick);
    sectionEl.querySelector('#rcCompareBtn')?.addEventListener('click', onCompareClick);
    sectionEl.querySelector('#rcExportBtn')?.addEventListener('click', onExportClick);
    sectionEl.querySelector('#rcUaSelect')?.addEventListener('change', onUaChange);
  }

  // Calls chrome.permissions.request() as the very first statement inside
  // this click handler's call stack — see link-check.js's onAllowClick for
  // why that ordering matters (it must still count as a user gesture).
  async function onAllowClick() {
    const my = gen;
    const granted = await SBWPerms.requestAllUrls();
    if (my !== gen) return;
    if (!granted) {
      popup().setSeoStatus?.('Permission request was not granted', 'error');
      return;
    }
    state = 'ready';
    render();
    await loadUaState(my);
  }

  async function onCompareClick() {
    if (diffState === 'loading') return;
    const my = gen;
    const url = (tab && tab.url) || (pageData && pageData.url);

    if (!/^https?:\/\//i.test(url || '')) {
      diffState = 'error';
      diffError = 'invalid_url';
      render();
      return;
    }

    diffState = 'loading';
    diffError = null;
    render();

    const res = await sendToWorker({ action: 'fetchRawHtml', url });
    if (my !== gen) return;

    if (!res || res.error) {
      diffState = 'error';
      diffError = (res && res.error) || 'failed';
      if (diffError === 'no_permission') state = 'no-permission';
      render();
      return;
    }

    const rawSummary = SBWHtmlDiff.summarizeHtml(res.html, res.finalUrl || url);
    const domSummary = SBWHtmlDiff.summarizeDom(pageData);
    diffResult = SBWHtmlDiff.diffSummaries(rawSummary, domSummary);
    diffState = 'done';
    render();
  }

  async function onUaChange() {
    const select = sectionEl && sectionEl.querySelector('#rcUaSelect');
    const presetId = select ? select.value : 'default';
    const my = gen;

    uaLoading = true;
    render();

    const res = await sendToWorker({ action: 'setUserAgent', tabId: tab && tab.id, presetId });
    if (my !== gen) return;
    uaLoading = false;

    if (!res || res.error) {
      if (res && res.error === 'no_permission') {
        state = 'no-permission';
        popup().setSeoStatus?.('Page access was revoked — allow it again to switch user-agent', 'error');
      } else {
        popup().setSeoStatus?.('Could not switch user-agent', 'error');
      }
      render();
      return;
    }

    uaPresetId = res.presetId || presetId;
    popup().setSeoStatus?.(
      uaPresetId === 'default' ? 'Reloading this tab with its normal User-Agent…' : 'Reloading this tab with the new User-Agent…',
      'success'
    );
    render();
  }

  const CSV_COLUMNS = [
    { key: 'field', label: 'Field' },
    { key: 'raw', label: 'Raw HTML' },
    { key: 'rendered', label: 'Rendered DOM' },
    { key: 'status', label: 'Status' }
  ];

  function onExportClick() {
    if (!diffResult) return;
    const csv = SBWCsv.toCsv(diffResult.rows, CSV_COLUMNS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SBWCsv.csvFilename('render-diff', (tab && tab.url) || (pageData && pageData.url) || 'https://page.example/');
    a.click();
    // See link-check.js's onExportClick for why the revoke is deferred a tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    popup().setSeoStatus?.('Exported', 'success');
  }

  globalThis.SBWRenderCheckUI = { mount };
})();
