// Indexability panel — popup UI (Task 2)
//
// Owns the INDEXABILITY collapsible section, mounted directly after the
// "Page Meta" section in renderResults() (popup.js) — Link Check stays the
// last section, so this inserts itself right after `[data-section="meta"]`
// instead of appending to the end of #content the way link-check.js does.
//
// Reads shared render helpers off `globalThis.SBWPopup` (esc/section/badge/
// setSeoStatus/getCurrentTab) and pure logic off `globalThis.SBWRedirects`/
// `SBWPerms`/`SBWCsv` (classic <script> loads before this file — see
// popup.html). Follows src/popup/link-check.js's mount/gen-counter/
// permission-card pattern rather than inventing a new one.
//
// The redirect chain itself is only ever OBSERVED by the background worker
// (chrome.webRequest/webNavigation, gated on the optional <all_urls>
// permission — see service-worker.js) — this module never fetches
// anything itself, it only asks the worker what it already captured for
// this tab, or asks it to open a background tab to trace a different URL.

(function () {

  let sectionEl = null;
  let tab = null;
  let pageData = null;
  let permsUnsub = null; // unsubscribe for the pending SBWPerms.onAllUrlsGranted() watch, or null

  // See link-check.js for why this exists: every mount() bumps `gen`, and
  // every async continuation (init/loadChain/onTraceClick) captures its own
  // `my` and bails if a newer mount has superseded it while it was awaiting.
  let gen = 0;

  // 'checking-permission' | 'no-permission' | 'ready'
  let state = 'checking-permission';
  let chain = null;     // SBWRedirects.chainSummary() result, or null (nothing captured yet)
  let events = [];      // raw events backing `chain`, for CSV export and header lookup
  let traceState = 'idle'; // 'idle' | 'loading' | 'done' | 'error'
  let traceResult = null;
  let traceError = null;
  let traceInputValue = ''; // survives render()'s innerHTML rebuild — see render()

  function popup() {
    return globalThis.SBWPopup || {};
  }

  function esc(s) {
    return (popup().esc || (x => String(x)))(s);
  }

  // Escapes both label and value — the safe default for the plain-text
  // rows this panel renders (Cache-Control, Content-Type, HSTS, CSP).
  function dataRow(label, value, cls) {
    return `<div class="data-row">
      <span class="data-label">${esc(label)}</span>
      <span class="data-value${cls ? ' ' + cls : ''}">${esc(value)}</span>
    </div>`;
  }

  // Raw variant — only for a call site that intentionally passes pre-built
  // markup (e.g. an inline chip/badge) rather than plain text. Nothing in
  // this file currently needs it; kept alongside dataRow() so a future row
  // that does can reach for the right one instead of losing the escaping
  // dataRow() now does by default.
  function dataRowHtml(label, value, cls) {
    return `<div class="data-row">
      <span class="data-label">${esc(label)}</span>
      <span class="data-value${cls ? ' ' + cls : ''}">${value}</span>
    </div>`;
  }

  function truncateMiddle(s, max) {
    if (!s) return '';
    if (s.length <= max) return s;
    const half = Math.floor((max - 1) / 2);
    return s.slice(0, half) + '…' + s.slice(s.length - half);
  }

  function statusBadgeClass(status) {
    if (status >= 200 && status < 300) return 'b-ok';
    if (status >= 300 && status < 400) return 'b-warn';
    return 'b-err'; // 4xx/5xx and 0/unknown
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

  function isEmptyChain(c) {
    return !c || (c.hopCount === 0 && c.finalStatus === null);
  }

  /* ---------- mount / (re)init ---------- */

  function mount(container, data) {
    if (!container || typeof globalThis.SBWRedirects === 'undefined') return;
    const { section, getCurrentTab } = popup();
    if (!section) return;

    pageData = data;
    tab = getCurrentTab ? getCurrentTab() : null;
    if (permsUnsub) { permsUnsub(); permsUnsub = null; }
    const my = ++gen;
    state = 'checking-permission';
    chain = null;
    events = [];
    traceState = 'idle';
    traceResult = null;
    traceError = null;
    traceInputValue = '';

    const holder = document.createElement('div');
    holder.innerHTML = section('indexability', 'INDEXABILITY', '<span class="ix-badge-slot"></span>', '<div class="ix-body"></div>');
    sectionEl = holder.firstElementChild;

    // Land directly after "Page Meta" — Link Check (mounted right after
    // this call, in popup.js) must stay the last section in the tab.
    const metaSection = container.querySelector('[data-section="meta"]');
    if (metaSection && metaSection.parentElement === container) {
      metaSection.insertAdjacentElement('afterend', sectionEl);
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
    await loadChain(my);
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
      loadChain(my);
    });
  }

  async function loadChain(my) {
    if (!tab || !tab.id) { render(); return; }
    const res = await sendToWorker({ action: 'getRedirectChain', tabId: tab.id });
    if (my !== gen) return;
    let nextChain = (res && res.chain) || null;
    let nextEvents = (res && res.events) || [];

    // Staleness guard (closes M-9): a tab can navigate away and back, or the
    // popup can be reopened on a tab whose last-captured chain belongs to a
    // page it no longer shows (e.g. the worker had nothing fresh yet and
    // this is left over from a previous load). If the chain's own final URL
    // doesn't match what the tab is actually showing right now, it describes
    // a different page — treat it as if nothing had been captured rather
    // than show a verdict for the wrong URL.
    if (nextChain && nextChain.finalUrl && tab.url) {
      const finalNorm = SBWRedirects.normalizeUrlForCompare(nextChain.finalUrl);
      const tabNorm = SBWRedirects.normalizeUrlForCompare(tab.url);
      if (finalNorm !== tabNorm) {
        nextChain = null;
        nextEvents = [];
      }
    }

    chain = nextChain;
    events = nextEvents;
    render();
  }

  /* ---------- verdict ---------- */

  function latestResponseHeaders() {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i] && events[i].kind === 'response') return events[i].headers || {};
    }
    return {};
  }

  function computeVerdict() {
    const headers = latestResponseHeaders();
    const linkEntries = headers.link ? SBWRedirects.parseLinkHeader(headers.link) : [];
    const canonicalHeaderEntry = linkEntries.find(l => (l.rel || '').toLowerCase() === 'canonical') || null;

    const meta = (pageData && pageData.meta) || {};
    const result = SBWRedirects.indexability({
      metaRobots: meta.robots || '',
      xRobotsTag: headers['x-robots-tag'] || null,
      finalStatus: chain ? chain.finalStatus : null,
      canonicalDom: meta.canonical || null,
      canonicalHeader: canonicalHeaderEntry ? canonicalHeaderEntry.url : null,
      pageUrl: pageData && pageData.url
    });

    return { result, headers, canonicalHeaderEntry };
  }

  /* ---------- render ---------- */

  function render() {
    if (!sectionEl) return;
    // renderBody() rebuilds .ix-body's innerHTML from scratch on every call
    // (state changes, trace results, a reload finishing) — that would wipe
    // out whatever the user had typed into "Trace another URL" mid-render
    // (e.g. loadChain() resolving right after they start typing) unless the
    // value is captured here and reapplied to the freshly built input below.
    const existingInput = sectionEl.querySelector('#ixTraceInput');
    if (existingInput) traceInputValue = existingInput.value;

    const bodyEl = sectionEl.querySelector('.ix-body');
    if (bodyEl) bodyEl.innerHTML = renderBody();
    const badgeSlot = sectionEl.querySelector('.ix-badge-slot');
    if (badgeSlot) badgeSlot.outerHTML = renderBadgeSlot();

    const newInput = sectionEl.querySelector('#ixTraceInput');
    if (newInput && traceInputValue) newInput.value = traceInputValue;

    wire();
  }

  function renderBadgeSlot() {
    const { badge } = popup();
    let inner = '';
    if (state === 'ready') {
      // No false INDEXABLE (fix round item 5): with nothing captured yet,
      // indexability() would only be judging DOM signals — that's not the
      // same claim as "this page is indexable," so the badge stays neutral
      // rather than green.
      if (isEmptyChain(chain)) {
        inner = badge('UNKNOWN');
      } else {
        const { result } = computeVerdict();
        inner = result.indexable ? badge('INDEXABLE', 'b-ok') : badge('NOT INDEXABLE', 'b-err');
      }
    }
    return `<span class="ix-badge-slot">${inner}</span>`;
  }

  function renderBody() {
    switch (state) {
      case 'no-permission':
        return `<div class="lc-perm-card">
          <p class="lc-perm-copy">${esc(SBWPerms.ALL_URLS_REASON)}</p>
          <button type="button" class="lc-allow-btn" id="ixAllowBtn">Allow access to check other sites</button>
        </div>`;

      case 'checking-permission':
        return `<div class="lc-loading">Checking permission…</div>`;

      case 'ready':
        return renderReadyBody();

      default:
        return '';
    }
  }

  function renderReadyBody() {
    const chainEmpty = isEmptyChain(chain);
    const { result, headers, canonicalHeaderEntry } = computeVerdict();
    return `
      ${chainEmpty ? renderUnknownVerdict() : renderVerdict(result)}
      <div class="ix-section-label">Redirect chain</div>
      ${renderChainBlock()}
      <div class="ix-section-label">Response headers</div>
      ${renderHeadersBlock(headers, canonicalHeaderEntry, chainEmpty)}
      <div class="ix-actions">
        <button type="button" class="ix-export-btn" id="ixExportBtn"${events.length ? '' : ' disabled'}>Export CSV</button>
      </div>
      <div class="ix-section-label">Trace another URL</div>
      ${renderTraceBlock()}
    `;
  }

  function renderVerdict(result) {
    const label = result.indexable ? 'Indexable' : `Not indexable — ${result.reasons[0]}`;
    return `<div class="ix-verdict ${result.indexable ? 'good' : 'bad'}">
      <span class="badge-mono ${result.indexable ? 'b-ok' : 'b-err'}">${result.indexable ? 'INDEXABLE' : 'NOT INDEXABLE'}</span>
      <span class="ix-verdict-label">${esc(label)}</span>
    </div>
    ${result.reasons.length > 1 ? `<div class="ix-verdict-extra">${result.reasons.slice(1).map(esc).join(' · ')}</div>` : ''}`;
  }

  // No false INDEXABLE (fix round item 5): nothing has been captured for
  // this tab, so there is no HTTP signal to judge — a DOM-only verdict would
  // silently omit noindex delivered via X-Robots-Tag, a non-200 final
  // status, or a canonical response header, any of which can flip the real
  // answer. Say so plainly instead of guessing green.
  function renderUnknownVerdict() {
    return `<div class="ix-verdict">
      <span class="badge-mono">UNKNOWN</span>
      <span class="ix-verdict-label">From page HTML only — reload to capture HTTP signals</span>
    </div>`;
  }

  function renderHopRow(hop) {
    return `<div class="ix-hop">
      <span class="ix-hop-url" title="${esc(hop.from || '')}">${esc(truncateMiddle(hop.from || '—', 34))}</span>
      <span class="ix-arrow">→</span>
      <span class="badge-mono ${statusBadgeClass(hop.status)}">${esc(hop.status)}</span>
      <span class="ix-arrow">→</span>
      <span class="ix-hop-url" title="${esc(hop.to || '')}">${esc(truncateMiddle(hop.to || '—', 34))}</span>
    </div>`;
  }

  function renderFinalRow(c) {
    return `<div class="ix-final">
      <span class="badge-mono ${statusBadgeClass(c.finalStatus)}">${c.finalStatus === null ? '—' : esc(c.finalStatus)}</span>
      <span class="ix-hop-url" title="${esc(c.finalUrl || '')}">${esc(truncateMiddle(c.finalUrl || '—', 50))}</span>
      ${c.hasClientRedirect ? '<span class="ix-chip">Client-side redirect</span>' : ''}
      ${c.loops ? '<span class="badge-mono b-err">Loop detected</span>' : ''}
    </div>`;
  }

  function renderChainBlock() {
    if (isEmptyChain(chain)) {
      return `<div class="ix-empty">
        <p class="ix-muted">No request data for this tab yet.</p>
        <button type="button" class="ix-reload-btn" id="ixReloadBtn">Reload to capture</button>
      </div>`;
    }
    return `<div class="ix-hops">${chain.hops.map(renderHopRow).join('')}</div>
      ${renderFinalRow(chain)}`;
  }

  function renderHeadersBlock(headers, canonicalHeaderEntry, chainEmpty) {
    const h = headers || {};
    const xrt = h['x-robots-tag'] ? SBWRedirects.parseXRobotsTag(h['x-robots-tag']) : null;
    // Direct URL comparison (closes M-9) — this used to route through
    // indexability(), which exists to compute an indexable/not-indexable
    // verdict, not to answer "do these two URLs match"; normalizeUrlForCompare
    // is the actual primitive that call needed, and is now exported for it.
    const headerMatchesDom = (canonicalHeaderEntry && pageData && pageData.meta && pageData.meta.canonical)
      ? SBWRedirects.normalizeUrlForCompare(canonicalHeaderEntry.url) === SBWRedirects.normalizeUrlForCompare(pageData.meta.canonical)
      : null;

    // No false INDEXABLE (fix round item 5): with no response captured for
    // this tab, "none captured" / "Absent" read as real negative findings
    // (no X-Robots-Tag, no HSTS) when they're actually just unobserved —
    // "not observed" says only what's true.
    const directiveChips = chainEmpty
      ? '<span class="ix-muted">not observed</span>'
      : (xrt && xrt.directives.length)
        ? xrt.directives.map(d => `<span class="badge-mono ${(d === 'noindex' || d === 'nofollow') ? 'b-err' : ''}">${esc(d)}</span>`).join(' ')
        : '<span class="ix-muted">none captured</span>';

    const canonicalHeaderHtml = canonicalHeaderEntry
      ? `${esc(truncateMiddle(canonicalHeaderEntry.url, 40))} ${headerMatchesDom === null ? ''
          : headerMatchesDom ? '<span class="badge-mono b-ok">matches page canonical ✓</span>'
          : '<span class="badge-mono b-err">differs ✗</span>'}`
      : '<span class="ix-muted">none</span>';

    const hstsRow = chainEmpty
      ? dataRow('HSTS', 'not observed', 'warn')
      : dataRow('HSTS', h['strict-transport-security'] ? 'Present' : 'Absent', h['strict-transport-security'] ? 'good' : 'warn');
    const cspRow = chainEmpty
      ? dataRow('CSP', 'not observed', 'warn')
      : dataRow('CSP', h['content-security-policy'] ? 'Present' : 'Absent', h['content-security-policy'] ? 'good' : 'warn');

    return `<div class="ix-headers">
      <div class="ix-header-row">
        <span class="ix-header-k">X-Robots-Tag</span>
        <span class="ix-header-v">${directiveChips}</span>
      </div>
      ${dataRow('Cache-Control', h['cache-control'] || '—')}
      ${dataRow('Content-Type', h['content-type'] || '—')}
      <div class="ix-header-row">
        <span class="ix-header-k">Link rel=canonical</span>
        <span class="ix-header-v">${canonicalHeaderHtml}</span>
      </div>
      ${hstsRow}
      ${cspRow}
    </div>`;
  }

  function renderTraceBlock() {
    return `<div class="ix-trace-form">
      <input type="text" class="ix-trace-input" id="ixTraceInput" placeholder="https://example.com/page">
      <button type="button" class="ix-trace-btn" id="ixTraceBtn"${traceState === 'loading' ? ' disabled' : ''}>${traceState === 'loading' ? 'Tracing…' : 'Trace'}</button>
    </div>
    <div class="ix-trace" id="ixTraceResult">${renderTraceResult()}</div>`;
  }

  function renderTraceResult() {
    if (traceState === 'idle') return '';
    if (traceState === 'loading') return '<div class="ix-muted">Tracing…</div>';
    if (traceState === 'error') {
      const msg = traceError === 'no_permission' ? 'Page access was revoked — allow it again above.'
        : traceError === 'invalid_url' ? 'Enter a full http(s) URL to trace.'
        : 'Trace failed.';
      return `<div class="ix-error">${esc(msg)}</div>`;
    }
    const c = traceResult && traceResult.chain;
    if (isEmptyChain(c)) {
      return '<div class="ix-muted">No redirects observed — request completed directly.</div>';
    }
    return `<div class="ix-hops">${c.hops.map(renderHopRow).join('')}</div>
      ${renderFinalRow(c)}`;
  }

  /* ---------- wiring ---------- */

  function wire() {
    if (!sectionEl) return;
    sectionEl.querySelector('#ixAllowBtn')?.addEventListener('click', onAllowClick);
    sectionEl.querySelector('#ixReloadBtn')?.addEventListener('click', onReloadClick);
    sectionEl.querySelector('#ixTraceBtn')?.addEventListener('click', onTraceClick);
    sectionEl.querySelector('#ixExportBtn')?.addEventListener('click', onExportClick);
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
    await loadChain(my);
  }

  function onReloadClick() {
    if (!tab || !tab.id) return;
    const my = gen;
    const tabId = tab.id;

    if (chrome.webNavigation && chrome.webNavigation.onCompleted) {
      const onCompleted = (details) => {
        if (details.tabId !== tabId || details.frameId !== 0) return;
        chrome.webNavigation.onCompleted.removeListener(onCompleted);
        if (my !== gen) return;
        loadChain(my);
      };
      chrome.webNavigation.onCompleted.addListener(onCompleted);
    }

    chrome.tabs.reload(tabId);
    popup().setSeoStatus?.('Reloading the page to capture its requests…', 'success');
  }

  async function onTraceClick() {
    const input = sectionEl && sectionEl.querySelector('#ixTraceInput');
    const url = ((input && input.value) || '').trim();
    const my = gen;

    if (!/^https?:\/\//i.test(url)) {
      traceState = 'error';
      traceError = 'invalid_url';
      render();
      return;
    }

    traceState = 'loading';
    traceError = null;
    render();

    const res = await sendToWorker({ action: 'traceUrl', url });
    if (my !== gen) return;

    if (!res || res.error) {
      traceState = 'error';
      traceError = (res && res.error) || 'failed';
      traceResult = null;
    } else {
      traceState = 'done';
      traceResult = res;
    }
    render();
  }

  const CSV_COLUMNS = [
    { key: 'url', label: 'URL' },
    { key: 'status', label: 'Status' },
    { key: 'location', label: 'Location' },
    { key: 'xRobotsTag', label: 'X-Robots-Tag' }
  ];

  function onExportClick() {
    const rows = events
      .filter(e => e && (e.kind === 'redirect' || e.kind === 'response'))
      .map(e => ({
        url: e.url,
        status: e.statusCode,
        location: e.location || '',
        xRobotsTag: (e.headers && e.headers['x-robots-tag']) || ''
      }));
    const csv = SBWCsv.toCsv(rows, CSV_COLUMNS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SBWCsv.csvFilename('redirects', (tab && tab.url) || (pageData && pageData.url) || 'https://page.example/');
    a.click();
    // See link-check.js's onExportClick for why the revoke is deferred a tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    popup().setSeoStatus?.('Exported', 'success');
  }

  globalThis.SBWIndexabilityUI = { mount };
})();
