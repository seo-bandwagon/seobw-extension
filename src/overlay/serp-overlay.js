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
  const PENDING_TEXT = '—'; // em dash — "not looked up yet"

  const processedBlocks = new WeakSet();
  let toolbarEl = null;
  let mutationTimer = null;

  // Fix round 1, items 4/5/6: the stats pipeline is a single queue rather
  // than a one-shot per-scan fetch.
  //   - `pendingRows` holds every row not yet resolved (looked up in cache
  //     or answered by a quick-batch request). A scan appends to it
  //     unconditionally — it is never dropped just because a request
  //     happens to be in flight (item 4).
  //   - `statsRequestInFlight` gates re-entrancy: only one drainQueue() pass
  //     runs at a time; its `finally` re-checks the queue so rows queued
  //     mid-flight, or left over from a >20-domain chunk (item 6), get
  //     picked up by the next pass automatically.
  //   - The per-domain cache (item 5) means a domain already resolved this
  //     page-load is never re-requested, even for a brand-new row.
  let pendingRows = [];
  let statsRequestInFlight = false;

  function resultsContainer() {
    return document.querySelector('#search') || document.querySelector('#rcnt') || document.body;
  }

  // Read only to build the location-simulator URL — never placed in a
  // request body or message payload. See the module comment: quick-batch
  // only ever receives bare domains. (Fix round 1, item 5: the stats cache
  // itself is keyed by domain now, not by this query string at all.)
  function currentQuery() {
    try {
      return new URLSearchParams(window.location.search).get('q') || '';
    } catch (e) {
      return '';
    }
  }

  function statCacheKey(domain) {
    return 'sbwSerpStat::' + domain;
  }

  // Resolves the cached `quick` value (which may legitimately be `null` —
  // "server has no data for this domain") when a fresh cache entry exists,
  // or `undefined` when nothing usable is cached (missing or stale) and a
  // lookup is needed.
  function getCachedStat(domain) {
    return new Promise((resolve) => {
      const key = statCacheKey(domain);
      try {
        chrome.storage.session.get(key, (result) => {
          const entry = result && result[key];
          if (entry && typeof entry.at === 'number' && (Date.now() - entry.at) < CACHE_TTL_MS) {
            resolve(entry.stat);
          } else {
            resolve(undefined);
          }
        });
      } catch (e) {
        resolve(undefined);
      }
    });
  }

  // Writes every domain in `domainStatMap` (value may be `null`) as its own
  // `sbwSerpStat::<domain>` entry in one storage.session.set call.
  function setCachedStats(domainStatMap) {
    const obj = {};
    Object.keys(domainStatMap).forEach((domain) => {
      obj[statCacheKey(domain)] = { at: Date.now(), stat: domainStatMap[domain] };
    });
    try {
      chrome.storage.session.set(obj);
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
    statEl.textContent = PENDING_TEXT;
    bar.appendChild(statEl);

    const analyzeLink = document.createElement('a');
    analyzeLink.className = 'sbw-serp-analyze';
    // Fix round 1, item 16 (controller ruling): a plain link to the result,
    // with no marker hash appended — README already describes this as
    // "opens the result in a new tab", and nothing in the popup consumes
    // such a marker.
    analyzeLink.href = row.url;
    analyzeLink.target = '_blank';
    analyzeLink.rel = 'noopener noreferrer';
    analyzeLink.textContent = 'Analyze';
    bar.appendChild(analyzeLink);

    return { bar, statEl };
  }

  // Fix round 1, item 10: three distinct stat states, each with its own
  // text (never the old "Score —" placeholder once anything has actually
  // resolved):
  //   - `quick === null`               -> "No data" (server has nothing)
  //   - `quick` resolved, avgScore null -> "No score yet · N captures"
  //   - `quick` resolved, avgScore set  -> "Score N [· M captures]"
  //   - not yet resolved / awaiting a later chunk -> PENDING_TEXT ("—")
  // Passing `undefined` (rather than calling this at all) is how a row
  // stays at its initial pending state — see drainQueue().
  function renderStat(statEl, quick) {
    statEl.removeAttribute('title');
    if (quick === null) {
      statEl.textContent = 'No data';
      return;
    }
    if (quick && typeof quick === 'object') {
      if (typeof quick.avgScore === 'number') {
        const parts = [`Score ${quick.avgScore}`];
        if (typeof quick.sampleSize === 'number' && quick.sampleSize > 0) {
          parts.push(`${quick.sampleSize} capture${quick.sampleSize === 1 ? '' : 's'}`);
        }
        statEl.textContent = parts.join(' · ');
        return;
      }
      const captures = typeof quick.sampleSize === 'number' ? quick.sampleSize : 0;
      statEl.textContent = `No score yet · ${captures} capture${captures === 1 ? '' : 's'}`;
      return;
    }
    statEl.textContent = PENDING_TEXT;
  }

  // Worker bridge failed, or the reply otherwise couldn't be used — distinct
  // from "No data" (which means the server answered and has nothing) and
  // from the pending placeholder (which means no request has resolved yet).
  function renderUnavailable(statEl) {
    statEl.textContent = 'Unavailable';
    statEl.title = 'Could not reach SEO Bandwagon';
  }

  // no_key/unauthorized — the common case for a signed-out user (production
  // returns 401 with no key stored). Renders cleanly, once, no retry.
  function renderNoAccount(statEl) {
    statEl.removeAttribute('title');
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

  // Fix round 1, item 11: an Images/Videos/News tab (or a zero-result page)
  // has no #rso/#search organic container carrying any h3 at all — the
  // toolbar (and its export buttons, which would just offer 0 rows/0
  // questions) has nothing to do there.
  function hasOrganicContainerH3() {
    const rso = document.querySelector('#rso');
    if (rso && rso.querySelector('h3')) return true;
    const search = document.querySelector('#search');
    if (search && search.querySelector('h3')) return true;
    return false;
  }

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

    if (rows.length || hasOrganicContainerH3()) {
      renderToolbar();
      updateToolbarCounts(rows.length);
    }

    if (newRows.length) {
      enqueueRows(newRows);
    }
  }

  // Fix round 1, items 4/5/6: queue-based stats pipeline.
  //
  // A scan always enqueues its new rows, never drops them — a request
  // already in flight just means drainQueue() no-ops immediately and its
  // own `finally` re-invokes drainQueue() once it settles, picking up
  // whatever arrived in the meantime (item 4). Rows are resolved from the
  // per-domain cache first (item 5); whatever's left is split into
  // successive batches of at most MAX_BATCH unique domains — never
  // truncated, just deferred to the next pass (item 6), during which the
  // deferred rows' bars stay at PENDING_TEXT rather than flipping to
  // "No data".

  function enqueueRows(rows) {
    pendingRows.push(...rows);
    drainQueue();
  }

  async function drainQueue() {
    if (statsRequestInFlight) return; // this pass's `finally` will re-drain
    if (!pendingRows.length) return;

    // Claimed synchronously, before any await, so a rescan that fires while
    // this function is still resolving the cache (i.e. before the network
    // request even starts) can't start a second concurrent pass.
    statsRequestInFlight = true;
    try {
      const rowsThisPass = pendingRows.splice(0, pendingRows.length);

      const stillNeeded = [];
      for (const row of rowsThisPass) {
        const cached = await getCachedStat(row.domain);
        if (cached !== undefined) {
          if (row._statEl) renderStat(row._statEl, cached);
        } else {
          stillNeeded.push(row);
        }
      }
      if (!stillNeeded.length) return;

      const domains = [];
      const seen = new Set();
      stillNeeded.forEach((row) => {
        if (!seen.has(row.domain)) {
          seen.add(row.domain);
          domains.push(row.domain);
        }
      });
      const chunk = domains.slice(0, MAX_BATCH);
      const chunkSet = new Set(chunk);
      const rowsInChunk = stillNeeded.filter((row) => chunkSet.has(row.domain));
      const rowsForLater = stillNeeded.filter((row) => !chunkSet.has(row.domain));
      // Deferred rows go back on the queue for the next pass (this pass's
      // `finally`, below) — they stay at PENDING_TEXT until then.
      if (rowsForLater.length) pendingRows.push(...rowsForLater);

      const reply = await requestQuickBatch(chunk);
      if (!reply || reply.ok === false) {
        const code = reply && reply.code;
        if (code === 'no_key' || code === 'unauthorized') {
          rowsInChunk.forEach((row) => { if (row._statEl) renderNoAccount(row._statEl); });
        } else {
          rowsInChunk.forEach((row) => { if (row._statEl) renderUnavailable(row._statEl); });
        }
        return; // no retry this pass, per the brief
      }

      const payload = reply.data || { results: {}, invalid: [] };
      const results = payload.results || {};
      const toCache = {};
      chunk.forEach((domain) => {
        toCache[domain] = Object.prototype.hasOwnProperty.call(results, domain) ? results[domain] : null;
      });
      setCachedStats(toCache);
      rowsInChunk.forEach((row) => {
        const has = Object.prototype.hasOwnProperty.call(results, row.domain);
        renderStat(row._statEl, has ? results[row.domain] : null);
      });
    } finally {
      statsRequestInFlight = false;
      if (pendingRows.length) drainQueue();
    }
  }

  // ---------- toolbar ----------

  // Fix round 1, item 8: runs every cell through the exact same
  // formula-injection guard as resultsToCsv's CSV path (SBWSerp.guardCell)
  // before stripping the tab/newline characters that would otherwise break
  // TSV's own column/row delimiters — guarding first matters, since a
  // guard-triggering leading tab or CR would otherwise be collapsed away by
  // the whitespace cleanup before ever being seen.
  function rowsToTsv(rows) {
    const clean = (v) => globalThis.SBWSerp.guardCell(v).replace(/[\t\r\n]+/g, ' ').trim();
    const lines = [['Position', 'URL', 'Domain', 'Title'].join('\t')];
    rows.forEach((row) => {
      lines.push([row.position, row.url, row.domain, row.title].map(clean).join('\t'));
    });
    return lines.join('\n');
  }

  // Fix round 1, item 9: flashing a Copy button used to overwrite its
  // entire textContent, which permanently destroyed the
  // `[data-role="copy-count"]`/`[data-role="paa-count"]` child span the
  // first time it was clicked — updateToolbarCounts() would then silently
  // stop finding it, and the count would never update again. Flashing now
  // hides the real label (a `[data-role="label-holder"]` wrapper around the
  // button's original children, built lazily) behind a separate
  // `[data-role="flash"]` span instead of replacing anything, so the count
  // span always survives and keeps receiving updates even while hidden.
  function flashLabel(btn, text) {
    let holder = btn.querySelector('[data-role="label-holder"]');
    if (!holder) {
      holder = document.createElement('span');
      holder.setAttribute('data-role', 'label-holder');
      while (btn.firstChild) holder.appendChild(btn.firstChild);
      btn.appendChild(holder);
    }
    let flashEl = btn.querySelector('[data-role="flash"]');
    if (!flashEl) {
      flashEl = document.createElement('span');
      flashEl.setAttribute('data-role', 'flash');
      btn.appendChild(flashEl);
    }
    if (btn._sbwFlashTimer) clearTimeout(btn._sbwFlashTimer);
    holder.style.display = 'none';
    flashEl.style.display = '';
    flashEl.textContent = text;
    btn._sbwFlashTimer = setTimeout(() => {
      flashEl.style.display = 'none';
      holder.style.display = '';
    }, 1200);
  }

  function copyText(text, btn) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flashLabel(btn, 'Copy unsupported');
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => flashLabel(btn, 'Copied'))
      .catch(() => flashLabel(btn, 'Copy failed'));
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
      copyText(rowsToTsv(rows), copyBtn);
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
      copyText(globalThis.SBWSerp.paaToText(questions), paaBtn);
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
