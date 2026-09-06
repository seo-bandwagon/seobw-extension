// SEO Bandwagon — SERP overlay content script (Task 6 rewrite)
//
// Runs on Google search results pages (see manifest.json's content_scripts
// entry for the exact host list — nine Google TLDs). Additive only, per the
// ledger ruling: this never hides, moves, covers, or restyles an ad or any
// Google UI. `.sbw-serp-bar` elements are appended AFTER each organic
// result block (never inside the title/URL area); `.sbw-serp-tools` is
// appended once, after the results container, never before it. Nothing is
// ever inserted near an ad — src/lib/serp.js's parseResults() already
// excludes every block under [data-text-ad]/#tads/#bottomads/
// [aria-label*="Ads" i], so this script never even sees an ad row to act on.
//
// This is an isolated-world content script: it has no fetch/chrome.storage
// access of its own beyond what chrome.* itself exposes to a content
// script, and per the ledger it must never call fetch() directly anyway —
// every third-party-shaped request goes through the worker bridge
// (service-worker.js's `request.action === 'sbwFetch'` handler, which is
// backed by src/lib/api.js's real sbwFetch/quickBatch). Only bare domains
// (SBWSerp.bareDomain output) ever go into that request body — never the
// query text, never a title or snippet. Result rows and PAA questions never
// leave the browser at all: "Copy results"/"Export CSV"/"Copy PAA" write to
// the clipboard or a local file download, nothing else.
//
// Legacy behavior deleted outright, not disabled, per the ledger ruling on
// the old collection/analysis endpoints: fetchDomainData(),
// collectSERPData(), sendSERPData() and the old inline analyze-button click
// handler are all gone from this file, along with every call they made.

(function () {
  'use strict';

  // Defensive guard, same pattern as src/content/analyzer.js's collectLinks/
  // analyzeHreflang: if src/lib/serp.js somehow isn't injected before this
  // file (manifest content_scripts order), do nothing rather than throw.
  if (!globalThis.SBWSerp) return;

  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes, per the ledger
  const MAX_BATCH = 20; // quick-batch's own per-request cap
  const DEBOUNCE_MS = 500;

  const processedBlocks = new WeakSet();
  let toolbarEl = null;
  let mutationTimer = null;
  let statsRequestInFlight = false;

  function resultsContainer() {
    return document.querySelector('#search') || document.querySelector('#rcnt') || document.body;
  }

  // Read only to build the location-simulator URL and as a *local* session-
  // storage cache key — never placed in a request body or message payload.
  // See the module comment: quick-batch only ever receives bare domains.
  function currentQuery() {
    try {
      return new URLSearchParams(window.location.search).get('q') || '';
    } catch (e) {
      return '';
    }
  }

  function cacheKey(q) {
    return 'sbwSerpStats::' + window.location.hostname + '::' + q;
  }

  function getCachedStats(q) {
    return new Promise((resolve) => {
      const key = cacheKey(q);
      try {
        chrome.storage.session.get(key, (result) => {
          const entry = result && result[key];
          if (entry && typeof entry.at === 'number' && (Date.now() - entry.at) < CACHE_TTL_MS) {
            resolve(entry.data);
          } else {
            resolve(null);
          }
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function setCachedStats(q, data) {
    try {
      chrome.storage.session.set({ [cacheKey(q)]: { at: Date.now(), data } });
    } catch (e) { /* storage unavailable — stats just won't be cached this run */ }
  }

  // The only network-shaped call this script ever makes, and it isn't even
  // a call — it's a message to the worker, which owns the real fetch (see
  // service-worker.js's 'sbwFetch' bridge -> SBW.sbwFetch, src/lib/api.js).
  function requestQuickBatch(domains) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'sbwFetch',
        path: '/domain/quick-batch',
        init: { method: 'POST', body: { domains } }
      }, (reply) => resolve(reply || { ok: false, code: 'network' }));
    });
  }

  // ---------- bars ----------

  function makeBar(row) {
    const bar = document.createElement('div');
    bar.className = 'sbw-serp-bar';

    const domainEl = document.createElement('span');
    domainEl.className = 'sbw-serp-domain';
    domainEl.textContent = row.domain;
    bar.appendChild(domainEl);

    const statEl = document.createElement('span');
    statEl.className = 'sbw-serp-stat';
    statEl.textContent = 'Score —';
    bar.appendChild(statEl);

    const analyzeLink = document.createElement('a');
    analyzeLink.className = 'sbw-serp-analyze';
    // The popup does the rest on open — no server call from here. Appending
    // the marker rather than replacing an existing hash so a result URL
    // that already carries one (rare, but seen on some anchor links) isn't
    // clobbered.
    analyzeLink.href = row.url + (row.url.indexOf('#') === -1 ? '#sbw-analyze' : '');
    analyzeLink.target = '_blank';
    analyzeLink.rel = 'noopener noreferrer';
    analyzeLink.textContent = 'Analyze';
    bar.appendChild(analyzeLink);

    return { bar, statEl };
  }

  function renderStat(statEl, quick) {
    if (!quick) {
      statEl.textContent = 'No data';
      return;
    }
    const parts = [];
    parts.push(typeof quick.avgScore === 'number' ? `Score ${quick.avgScore}` : 'Score —');
    if (typeof quick.sampleSize === 'number' && quick.sampleSize > 0) {
      parts.push(`${quick.sampleSize} capture${quick.sampleSize === 1 ? '' : 's'}`);
    }
    statEl.textContent = parts.join(' · ');
  }

  // no_key/unauthorized — the common case for a signed-out user (production
  // returns 401 with no key stored). Renders cleanly, once, no retry.
  function renderNoAccount(statEl) {
    statEl.textContent = '';
    const link = document.createElement('a');
    link.className = 'sbw-serp-connect';
    link.href = chrome.runtime.getURL('src/options/options.html');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Connect your account';
    statEl.appendChild(link);
  }

  // ---------- scan + process ----------

  function processResults() {
    const rows = globalThis.SBWSerp.parseResults(document);
    const newRows = [];

    rows.forEach((row) => {
      const block = row._el;
      if (!block || processedBlocks.has(block)) return;
      processedBlocks.add(block);
      const { bar, statEl } = makeBar(row);
      block.insertAdjacentElement('afterend', bar);
      row._statEl = statEl;
      newRows.push(row);
    });

    renderToolbar();
    updateToolbarCounts(rows.length);

    if (newRows.length) {
      fetchStatsFor(newRows);
    }
  }

  async function fetchStatsFor(rows) {
    // A single page load only ever needs one batch in flight — the debounced
    // MutationObserver won't fire another scan until this one settles, and
    // any result appearing after this batch started rides the next scan.
    if (statsRequestInFlight) return;

    const domains = [];
    const seen = new Set();
    rows.forEach((row) => {
      if (!seen.has(row.domain)) {
        seen.add(row.domain);
        domains.push(row.domain);
      }
    });
    const batch = domains.slice(0, MAX_BATCH);
    if (!batch.length) return;

    statsRequestInFlight = true;
    const q = currentQuery();
    try {
      let payload = await getCachedStats(q);
      if (!payload) {
        const reply = await requestQuickBatch(batch);
        if (!reply || reply.ok === false) {
          const code = reply && reply.code;
          if (code === 'no_key' || code === 'unauthorized') {
            rows.forEach((row) => { if (row._statEl) renderNoAccount(row._statEl); });
          } else {
            rows.forEach((row) => { if (row._statEl) row._statEl.textContent = 'No data'; });
          }
          return; // no retry, per the brief
        }
        payload = reply.data || { results: {}, invalid: [] };
        setCachedStats(q, payload);
      }
      const results = payload.results || {};
      rows.forEach((row) => {
        if (row._statEl) renderStat(row._statEl, results[row.domain] || null);
      });
    } finally {
      statsRequestInFlight = false;
    }
  }

  // ---------- toolbar ----------

  function rowsToTsv(rows) {
    const clean = (v) => String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
    const lines = [['Position', 'URL', 'Domain', 'Title'].join('\t')];
    rows.forEach((row) => {
      lines.push([row.position, row.url, row.domain, row.title].map(clean).join('\t'));
    });
    return lines.join('\n');
  }

  function flashLabel(btn, text, restoreTo) {
    btn.textContent = text;
    setTimeout(() => { btn.textContent = restoreTo; }, 1200);
  }

  function copyText(text, btn, restoreTo) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flashLabel(btn, 'Copy unsupported', restoreTo);
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => flashLabel(btn, 'Copied', restoreTo))
      .catch(() => flashLabel(btn, 'Copy failed', restoreTo));
  }

  function downloadCsv(csvText) {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'serp-results-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildLocationControl() {
    const wrap = document.createElement('div');
    wrap.className = 'sbw-serp-location';

    const label = document.createElement('span');
    label.className = 'sbw-serp-location-label';
    label.textContent = 'Location:';
    wrap.appendChild(label);

    const select = document.createElement('select');
    select.className = 'sbw-serp-location-select';
    const customOpt = document.createElement('option');
    customOpt.value = '';
    customOpt.textContent = 'Choose a metro…';
    select.appendChild(customOpt);
    globalThis.SBWSerp.PRESET_LOCATIONS.forEach((loc) => {
      const opt = document.createElement('option');
      opt.value = loc.canonical;
      opt.textContent = loc.label;
      select.appendChild(opt);
    });
    wrap.appendChild(select);

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'sbw-serp-location-custom';
    customInput.placeholder = 'Or type a location, e.g. Austin,Texas,United States';
    wrap.appendChild(customInput);

    const searchParams = (() => {
      try { return new URLSearchParams(window.location.search); } catch (e) { return new URLSearchParams(); }
    })();

    const glInput = document.createElement('input');
    glInput.type = 'text';
    glInput.className = 'sbw-serp-gl';
    glInput.maxLength = 2;
    glInput.placeholder = 'gl';
    glInput.title = 'Country code (gl)';
    glInput.value = searchParams.get('gl') || 'us';
    wrap.appendChild(glInput);

    const hlInput = document.createElement('input');
    hlInput.type = 'text';
    hlInput.className = 'sbw-serp-hl';
    hlInput.maxLength = 5;
    hlInput.placeholder = 'hl';
    hlInput.title = 'Language code (hl)';
    hlInput.value = searchParams.get('hl') || 'en';
    wrap.appendChild(hlInput);

    const pwsLabel = document.createElement('label');
    pwsLabel.className = 'sbw-serp-pws';
    const pwsCheckbox = document.createElement('input');
    pwsCheckbox.type = 'checkbox';
    pwsLabel.appendChild(pwsCheckbox);
    pwsLabel.appendChild(document.createTextNode('Personalization off (pws=0)'));
    wrap.appendChild(pwsLabel);

    const compareLabel = document.createElement('span');
    compareLabel.className = 'sbw-serp-location-label';
    compareLabel.textContent = 'vs.';
    wrap.appendChild(compareLabel);

    const compareSelect = document.createElement('select');
    compareSelect.className = 'sbw-serp-location-select';
    globalThis.SBWSerp.PRESET_LOCATIONS.forEach((loc) => {
      const opt = document.createElement('option');
      opt.value = loc.canonical;
      opt.textContent = loc.label;
      compareSelect.appendChild(opt);
    });
    // Default to the second preset so a first "Compare" click doesn't
    // silently compare a location against itself.
    if (compareSelect.options.length > 1) compareSelect.selectedIndex = 1;
    wrap.appendChild(compareSelect);

    function resolvedCanonical() {
      const typed = customInput.value.trim();
      return typed || select.value || '';
    }

    function openLocation(canonical) {
      const url = globalThis.SBWSerp.buildSearchUrl({
        q: currentQuery(),
        gl: glInput.value.trim(),
        hl: hlInput.value.trim(),
        pws: pwsCheckbox.checked,
        domain: window.location.hostname,
        uule: canonical ? globalThis.SBWSerp.uule(canonical) : undefined
      });
      window.open(url, '_blank', 'noopener');
    }

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'sbw-btn';
    openBtn.textContent = 'Open with this location';
    openBtn.addEventListener('click', () => openLocation(resolvedCanonical()));
    wrap.appendChild(openBtn);

    const compareBtn = document.createElement('button');
    compareBtn.type = 'button';
    compareBtn.className = 'sbw-btn';
    compareBtn.textContent = 'Compare in two tabs';
    compareBtn.addEventListener('click', () => {
      openLocation(resolvedCanonical());
      openLocation(compareSelect.value);
    });
    wrap.appendChild(compareBtn);

    const copy = document.createElement('span');
    copy.className = 'sbw-serp-location-copy';
    copy.textContent = 'Opens this search with location parameters so you can see what searchers in that area are shown.';
    wrap.appendChild(copy);

    return wrap;
  }

  function renderToolbar() {
    if (toolbarEl) return; // one per page
    const container = resultsContainer();
    if (!container || !container.parentNode) return;

    toolbarEl = document.createElement('div');
    toolbarEl.className = 'sbw-serp-tools';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'sbw-btn';
    copyBtn.appendChild(document.createTextNode('Copy results ('));
    const copyCount = document.createElement('span');
    copyCount.setAttribute('data-role', 'copy-count');
    copyCount.textContent = '0';
    copyBtn.appendChild(copyCount);
    copyBtn.appendChild(document.createTextNode(')'));
    copyBtn.addEventListener('click', () => {
      const rows = globalThis.SBWSerp.parseResults(document);
      copyText(rowsToTsv(rows), copyBtn, copyBtn.textContent);
    });
    toolbarEl.appendChild(copyBtn);

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'sbw-btn';
    exportBtn.textContent = 'Export CSV';
    exportBtn.addEventListener('click', () => {
      const rows = globalThis.SBWSerp.parseResults(document);
      downloadCsv(globalThis.SBWSerp.resultsToCsv(rows));
    });
    toolbarEl.appendChild(exportBtn);

    const paaBtn = document.createElement('button');
    paaBtn.type = 'button';
    paaBtn.className = 'sbw-btn';
    paaBtn.appendChild(document.createTextNode('Copy PAA ('));
    const paaCount = document.createElement('span');
    paaCount.setAttribute('data-role', 'paa-count');
    paaCount.textContent = '0';
    paaBtn.appendChild(paaCount);
    paaBtn.appendChild(document.createTextNode(')'));
    paaBtn.addEventListener('click', () => {
      const questions = globalThis.SBWSerp.parsePaa(document);
      copyText(globalThis.SBWSerp.paaToText(questions), paaBtn, paaBtn.textContent);
    });
    toolbarEl.appendChild(paaBtn);

    toolbarEl.appendChild(buildLocationControl());

    // "appended after the results container, not before"
    container.insertAdjacentElement('afterend', toolbarEl);
  }

  function updateToolbarCounts(resultCount) {
    if (!toolbarEl) return;
    const paaCount = globalThis.SBWSerp.parsePaa(document).length;
    const copyCountEl = toolbarEl.querySelector('[data-role="copy-count"]');
    const paaCountEl = toolbarEl.querySelector('[data-role="paa-count"]');
    if (copyCountEl) copyCountEl.textContent = String(resultCount);
    if (paaCountEl) paaCountEl.textContent = String(paaCount);
  }

  // ---------- observe + init ----------

  function scheduleRescan() {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(processResults, DEBOUNCE_MS);
  }

  function startObserver() {
    const target = resultsContainer();
    if (!target || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(scheduleRescan);
    observer.observe(target, { childList: true, subtree: true });
  }

  function init() {
    processResults();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
