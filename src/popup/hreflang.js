// Hreflang panel — popup UI (Task 3)
//
// Owns the HREFLANG collapsible section, mounted directly after the
// Indexability section in renderResults() (popup.js) — the same
// "insert-after-the-previous-section's-anchor" trick indexability.js uses
// for Page Meta, so Link Check (still appended at the very end) stays last.
// When the page has no hreflang tags at all, no section is built — a single
// muted line is appended inside the Page Meta section instead (see the
// ledger/task-3 brief: "do not add an empty section").
//
// Reads shared render helpers off `globalThis.SBWPopup` (esc/section/badge/
// setSeoStatus/getCurrentTab) and pure logic off `globalThis.SBWHreflang`/
// `SBWPerms`/`SBWCsv` (classic <script> loads before this file — see
// popup.html). Follows src/popup/indexability.js's mount/gen-counter/
// permission-card pattern.
//
// The set itself (tags, code validity, duplicates, x-default/self-ref) is
// computed by the content script (src/content/analyzer.js's
// analyzeHreflang(), via SBWHreflang.validateSet) and arrives as
// data.hreflang — this module never re-derives it. Only the return-tag
// check is this module's own doing, and only on a real click: it asks the
// background worker to fetch each alternate (gated on the optional
// <all_urls> permission, same as Link Check/Indexability) and renders what
// comes back through SBWHreflang.reciprocity().

(function () {

  let sectionEl = null;
  let tab = null;
  let pageData = null;
  let permsUnsub = null; // unsubscribe for the pending SBWPerms.onAllUrlsGranted() watch, or null

  // See indexability.js/link-check.js for why this exists: every mount()
  // bumps `gen`, and the async continuation started by a click (onCheckClick)
  // captures its own `my` and bails if a newer mount has superseded it.
  let gen = 0;

  // 'checking-permission' | 'no-permission' | 'ready' — whether the
  // optional <all_urls> permission the return-tag check needs is available.
  // Independent of whether a check has actually been run yet.
  let state = 'checking-permission';

  // 'idle' | 'checking' | 'checked' — the return-tag check's own lifecycle.
  let checkState = 'idle';
  let checkResultsByUrl = null; // Map<url, SBWHreflang.reciprocity() entry>, or null before a check completes

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

  function statusBadgeClass(status) {
    if (status === null || status === undefined) return '';
    if (status >= 200 && status < 300) return 'b-ok';
    if (status >= 300 && status < 400) return 'b-warn';
    return 'b-err'; // 4xx/5xx/0
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

  // Unique, resolvable alternate URLs to check — dedup by URL (matches the
  // worker's own dedup), excludes the page's own URL (its return tag isn't
  // fetched — it's validated locally, the same way validateSet() already
  // checks for a self-referencing entry), and caps at 50 to mirror the
  // worker's hard ceiling, so the button's "(N)" count is never a promise
  // the worker can't keep.
  function checkableUrls() {
    const hf = pageData && pageData.hreflang;
    if (!hf) return [];
    const pageUrl = (pageData && pageData.url) || (tab && tab.url);
    const pageNorm = (pageUrl && globalThis.SBWHreflang) ? SBWHreflang.normalizeUrl(pageUrl) : null;
    const seen = new Set();
    const urls = [];
    (hf.entries || []).forEach(e => {
      if (!e || !e.url) return;
      if (seen.has(e.url)) return;
      if (pageNorm && e.url === pageNorm) return;
      seen.add(e.url);
      urls.push(e.url);
    });
    return urls.slice(0, 50);
  }

  /* ---------- mount / (re)init ---------- */

  function mount(container, data) {
    if (!container) return;
    if (permsUnsub) { permsUnsub(); permsUnsub = null; }

    // Without the lib there's no way to validate a set or check return tags
    // — but a whole-section bailout would silently show nothing at all.
    // Fall back to the same "no hreflang tags" note an actually-empty page
    // gets, rather than leaving a gap where the section would be.
    if (typeof globalThis.SBWHreflang === 'undefined') {
      sectionEl = null;
      ++gen;
      renderEmptyNote(container);
      return;
    }

    const { section, getCurrentTab } = popup();
    if (!section) return;

    pageData = data;
    tab = getCurrentTab ? getCurrentTab() : null;
    ++gen;

    const hf = data && data.hreflang;
    if (!hf || !hf.count) {
      sectionEl = null;
      renderEmptyNote(container);
      return;
    }

    const my = gen;
    state = 'checking-permission';
    checkState = 'idle';
    checkResultsByUrl = null;

    const holder = document.createElement('div');
    holder.innerHTML = section('hreflang', 'HREFLANG', '<span class="hf-badge-slot"></span>', '<div class="hf-body"></div>');
    sectionEl = holder.firstElementChild;

    // Land directly after Indexability (falling back to Page Meta, then the
    // end of #content, if either is missing) — see the module comment.
    const anchor = container.querySelector('[data-section="indexability"]') || container.querySelector('[data-section="meta"]');
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

  // No hreflang tags on the page at all — a whole collapsible section would
  // be empty chrome. One muted line inside Page Meta says the same thing
  // more honestly (mirrors ix-muted's styling, see indexability.js).
  function renderEmptyNote(container) {
    const metaBody = container.querySelector('[data-section="meta"] .section-content');
    if (!metaBody) return;
    const note = document.createElement('div');
    note.className = 'ix-muted hf-empty-note';
    note.textContent = 'No hreflang tags found on this page.';
    metaBody.appendChild(note);
  }

  async function init(my) {
    const has = await SBWPerms.hasAllUrls();
    if (my !== gen) return;
    state = has ? 'ready' : 'no-permission';
    render();
    if (!has) watchForGrant(my);
  }

  // Re-renders out of the "Allow access" card the moment the permission is
  // granted some other way while this popup is still open — e.g. from
  // chrome://extensions in another tab, rather than only through this
  // card's own Allow button (item 9, task-3 fix round 1).
  function watchForGrant(my) {
    if (permsUnsub) { permsUnsub(); permsUnsub = null; }
    permsUnsub = SBWPerms.onAllUrlsGranted(() => {
      if (my !== gen || state !== 'no-permission') return;
      state = 'ready';
      render();
    });
  }

  /* ---------- render ---------- */

  function render() {
    if (!sectionEl) return;
    const bodyEl = sectionEl.querySelector('.hf-body');
    if (bodyEl) bodyEl.innerHTML = renderBody();
    const badgeSlot = sectionEl.querySelector('.hf-badge-slot');
    if (badgeSlot) badgeSlot.outerHTML = renderBadgeSlot();
    wire();
  }

  // Set-level issue count (tag validity/duplicates/x-default/self-ref, from
  // SBWHreflang.validateSet via the content script) — independent of
  // whether a return-tag check has run. "OK" only when there are none.
  function renderBadgeSlot() {
    const { badge } = popup();
    const hf = pageData && pageData.hreflang;
    const n = (hf && hf.issues) ? hf.issues.length : 0;
    const inner = n > 0 ? badge(`${n} ISSUE${n === 1 ? '' : 'S'}`, 'b-err') : badge('OK', 'b-ok');
    return `<span class="hf-badge-slot">${inner}</span>`;
  }

  function renderBody() {
    const hf = pageData.hreflang;
    return `
      ${renderIssueChips(hf.issues)}
      <div class="hf-table">${(hf.entries || []).map(renderRow).join('')}</div>
      ${renderActionArea()}
    `;
  }

  function renderIssueChips(issues) {
    if (!issues || !issues.length) {
      return `<div class="hf-chips"><span class="hf-chip hf-chip-ok">No set-level issues</span></div>`;
    }
    return `<div class="hf-chips">${issues.map(i => `<span class="hf-chip hf-chip-bad">${esc(i)}</span>`).join('')}</div>`;
  }

  function renderRow(entry) {
    const rec = (checkResultsByUrl && entry.url) ? checkResultsByUrl.get(entry.url) : null;
    return `<div class="hf-row">
      <span class="badge-mono ${entry.valid ? '' : 'b-err'}">${esc(entry.lang)}</span>
      <span class="hf-url" title="${esc(entry.url || entry.href || '')}">${esc(truncateMiddle(entry.url || entry.href || '—', 34))}</span>
      ${rec ? `<span class="badge-mono ${statusBadgeClass(rec.status)}">${rec.status === null || rec.status === undefined ? '—' : esc(rec.status)}</span>` : ''}
      ${rec ? renderReturnBadge(rec) : ''}
    </div>`;
  }

  function renderReturnBadge(rec) {
    const semantic = rec.returnTag === 'yes' ? 'good' : rec.returnTag === 'no' ? 'bad' : 'warn';
    const cls = rec.returnTag === 'yes' ? 'b-ok' : rec.returnTag === 'no' ? 'b-err' : 'b-warn';
    const label = rec.returnTag === 'yes' ? 'RETURN OK' : rec.returnTag === 'no' ? 'NO RETURN' : 'UNREACHABLE';
    return `<span class="hf-return ${semantic}"><span class="badge-mono ${cls}">${label}</span></span>`;
  }

  function renderActionArea() {
    if (state === 'checking-permission') {
      return `<div class="lc-loading">Checking permission…</div>`;
    }
    if (state === 'no-permission') {
      return `<div class="lc-perm-card">
        <p class="lc-perm-copy">${esc(SBWPerms.ALL_URLS_REASON)}</p>
        <button type="button" class="lc-allow-btn" id="hfAllowBtn">Allow access to check other sites</button>
      </div>`;
    }
    const n = checkableUrls().length;
    const checking = checkState === 'checking';
    const checkLabel = checking ? 'Checking…' : `Check return tags (${n})`;
    return `<div class="hf-actions">
      <button type="button" class="hf-check-btn" id="hfCheckBtn"${checking || n === 0 ? ' disabled' : ''}>${esc(checkLabel)}</button>
      <button type="button" class="hf-export-btn" id="hfExportBtn">Export CSV</button>
    </div>
    ${checking ? `<div class="hf-progress">Checking ${n} alternate${n === 1 ? '' : 's'}…</div>` : ''}`;
  }

  /* ---------- wiring ---------- */

  function wire() {
    if (!sectionEl) return;
    sectionEl.querySelector('#hfAllowBtn')?.addEventListener('click', onAllowClick);
    sectionEl.querySelector('#hfCheckBtn')?.addEventListener('click', onCheckClick);
    sectionEl.querySelector('#hfExportBtn')?.addEventListener('click', onExportClick);
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
  }

  async function onCheckClick() {
    if (checkState === 'checking') return;
    const urls = checkableUrls();
    if (!urls.length) return;

    const my = gen;
    checkState = 'checking';
    render();

    // No pageUrl in this message — the worker's checkHreflangAlternates
    // handler only ever needs the candidate `urls` to fetch; reciprocity()
    // below is computed here in the popup, which already has pageUrl.
    const res = await sendToWorker({
      action: 'checkHreflangAlternates',
      urls
    });
    if (my !== gen) return;

    if (!res || res.error) {
      checkState = 'idle';
      if (res && res.error === 'no_permission') {
        state = 'no-permission';
        popup().setSeoStatus?.('Page access was revoked — allow it again to check return tags', 'error');
      } else {
        popup().setSeoStatus?.('Return-tag check failed', 'error');
      }
      render();
      return;
    }

    const fetchedMap = new Map((res.fetched || []).map(f => [f.url, f]));
    const pageEntries = (pageData.hreflang.entries || []).filter(e => e && e.url);
    const rec = SBWHreflang.reciprocity((pageData && pageData.url) || (tab && tab.url), pageEntries, fetchedMap);
    checkResultsByUrl = new Map(rec.entries.map(r => [r.url, r]));
    checkState = 'checked';
    render();
  }

  const CSV_COLUMNS = [
    { key: 'lang', label: 'Tag' },
    { key: 'url', label: 'URL' },
    { key: 'status', label: 'Status' },
    { key: 'returnTag', label: 'Return Tag' }
  ];

  function onExportClick() {
    const hf = pageData.hreflang;
    const rows = (hf.entries || []).map(e => {
      const rec = (checkResultsByUrl && e.url) ? checkResultsByUrl.get(e.url) : null;
      return {
        lang: e.lang,
        url: e.url || e.href || '',
        status: rec ? rec.status : '',
        returnTag: rec ? rec.returnTag : ''
      };
    });
    const csv = SBWCsv.toCsv(rows, CSV_COLUMNS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SBWCsv.csvFilename('hreflang', (tab && tab.url) || (pageData && pageData.url) || 'https://page.example/');
    a.click();
    // See link-check.js's onExportClick for why the revoke is deferred a tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    popup().setSeoStatus?.('Exported', 'success');
  }

  globalThis.SBWHreflangUI = { mount };
})();
