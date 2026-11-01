// SEO Bandwagon — SERP overlay content script (Task 6 rewrite)
//
// Runs on Google search results pages (see manifest.json's content_scripts
// entry for the exact host list — ten Google domains). Additive only, per the
// ledger ruling: this never hides, moves, covers, or restyles an ad or any
// Google UI. `.sbw-serp-bar` elements are appended AFTER each whole organic
// result (1.10.2: below its description and sitelinks, not between title and
// description); `.sbw-serp-tools` is appended once, after the results
// container, never before it. Nothing is ever inserted near an ad —
// src/lib/serp.js's parseResults() already excludes every block under
// [data-text-ad]/#tads/#bottomads/[aria-label*="Ads" i], so this script never
// even sees an ad row to act on.
//
// 1.10.2: nothing on this page goes to SEO Bandwagon. Until then each bar
// showed "Score N · M captures" from POST /api/domain/quick-batch: an
// on-page grade averaged over the whole host and every account's captures,
// "No score yet · 0 captures" for nearly every site, and read beside a
// ranking as if it were a ranking factor. The bar shows the result's
// position instead: the organic position, and in its tooltip the position
// counting everything on the page, the same numbers as Copy results, the
// CSV and Collect. Result rows and PAA questions never leave the browser:
// "Copy results"/"Export CSV"/"Copy PAA" write to the clipboard or a local
// file download, nothing else.
//
// Analyze (1.10.2, owner 2026-11-01: "Stay on Google") hands the result to
// the worker, which opens it in a background tab, analyzes that tab and
// sends the outcome back here: one line under the result with the page's
// on-page checklist and "Open report" (src/lib/serp-analyze.js).
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

  const DEBOUNCE_MS = 500;

  const processedBlocks = new WeakSet();
  let toolbarEl = null;
  let mutationTimer = null;

  function resultsContainer() {
    return document.querySelector('#search') || document.querySelector('#rcnt') || document.body;
  }

  // Read only to build the location-simulator URL — never placed in a
  // request body or message payload.
  function currentQuery() {
    try {
      return new URLSearchParams(window.location.search).get('q') || '';
    } catch (e) {
      return '';
    }
  }

  // ---------- bars ----------

  function positionTitle(row) {
    const parts = [`Organic position ${row.position} on this page.`];
    if (row.pagePosition) {
      parts.push(`Counting everything on the page (ads, AI Overview, People also ask, maps, videos and the other blocks above it): ${row.pagePosition}.`);
    }
    return parts.join(' ');
  }

  function makeBar(row) {
    const bar = document.createElement('div');
    bar.className = 'sbw-serp-bar';

    const posEl = document.createElement('span');
    posEl.className = 'sbw-serp-pos';
    posEl.textContent = '#' + row.position;
    posEl.title = positionTitle(row);
    posEl.setAttribute('aria-label', posEl.title);
    bar.appendChild(posEl);

    const domainEl = document.createElement('span');
    domainEl.className = 'sbw-serp-domain';
    if (row.siteUnknown) {
      domainEl.textContent = 'unknown site';
      domainEl.title = "Google links this result through a redirect that doesn't name its site. It keeps its place, so the positions after it stay right.";
    } else {
      domainEl.textContent = row.domain;
      if (row.urlResolved === false) {
        domainEl.title = "Only the site is known: Google's link hides the page's address.";
      }
    }
    bar.appendChild(domainEl);

    const analyzeLink = document.createElement('a');
    analyzeLink.className = 'sbw-serp-analyze';
    // row._href is the link as Google rendered it; for a /goto result
    // row.url can be just the site's origin, or empty for an unknown site
    // (see SBWSerp.parseResults).
    analyzeLink.href = row._href || row.url;
    analyzeLink.target = '_blank';
    analyzeLink.rel = 'noopener noreferrer';
    analyzeLink.textContent = 'Analyze';
    analyzeLink.title = 'Opens this result in a background tab and checks its on-page SEO; you stay here.';
    // A plain click hands the result to the worker (serpAnalyze). Ctrl/Cmd/
    // Shift/Alt and middle clicks stay the browser's. If the extension was
    // reloaded under this page, sendMessage throws and the link opens as a
    // plain link.
    analyzeLink.addEventListener('click', (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const key = row._key || analyzeLink.href;
      try {
        chrome.runtime.sendMessage({ action: 'serpAnalyze', url: analyzeLink.href, key }, (reply) => {
          if (chrome.runtime.lastError || !reply) {
            showAnalysis(key, { state: 'error', code: 'unavailable' });
            return;
          }
          showAnalysis(key, reply);
        });
      } catch (err) {
        return;
      }
      e.preventDefault();
      showAnalysis(key, { state: 'working' });
    });
    bar.appendChild(analyzeLink);

    return bar;
  }

  // ---------- the analysis line under a result (1.10.2) ----------
  //
  // One line per result, under its bar, once Analyze was clicked. Keyed by
  // the result (row._key), so a rescan that rebuilds rows finds it again.
  const analysisLines = new Map(); // key -> { el, tabId }
  const barsByKey = new Map(); // key -> bar

  const CHECKLIST_TITLE = "SEO Bandwagon's on-page checklist for this page: title, description, headings, images, links, schema and the other checks in the report. " +
    'It is not a ranking factor and does not predict where a page ranks.';

  const ERROR_TEXT = {
    timeout: "The page didn't finish loading within a minute.",
    closed: 'The tab was closed before the page was analyzed.',
    unreadable: "Couldn't analyze this page.",
    invalid_url: 'This result has no link to open.',
    unavailable: 'SEO Bandwagon was updated or reloaded. Reload this page to analyze.',
    failed: "Couldn't analyze this page."
  };

  function openButton(label, tabId, report) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sbw-serp-open';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ action: 'serpAnalysisOpen', tabId, report }, () => void chrome.runtime.lastError);
      } catch (e) { /* extension reloaded */ }
    });
    return btn;
  }

  function lineFor(key) {
    let entry = analysisLines.get(key);
    if (entry && entry.el.isConnected) return entry;
    const bar = barsByKey.get(key);
    if (!bar || !bar.isConnected) return null;
    const el = document.createElement('div');
    el.className = 'sbw-serp-analysis';
    el.setAttribute('role', 'status');
    bar.insertAdjacentElement('afterend', el);
    entry = { el, tabId: null };
    analysisLines.set(key, entry);
    return entry;
  }

  function showAnalysis(key, msg) {
    const entry = lineFor(key);
    if (!entry || !msg) return;
    const { el } = entry;
    el.textContent = '';
    el.removeAttribute('title');
    el.removeAttribute('data-state');
    if (typeof msg.tabId === 'number') entry.tabId = msg.tabId;
    const text = (t) => {
      const span = document.createElement('span');
      span.className = 'sbw-serp-analysis-text';
      span.textContent = t;
      el.appendChild(span);
      return span;
    };
    el.setAttribute('data-state', msg.state || '');

    if (msg.state === 'working') {
      text('Analyzing in a background tab…');
    } else if (msg.state === 'needs_access') {
      text('Allow access in the SEO Bandwagon window that opened, and this result is analyzed; you stay on Google.');
    } else if (msg.state === 'declined') {
      text('Analyze needs access to other sites to read the page. Click Analyze to ask again.');
    } else if (msg.state === 'done') {
      const score = typeof msg.score === 'number' ? `${msg.score}/100${msg.grade ? ` (${msg.grade})` : ''}` : 'done';
      const issues = typeof msg.issues === 'number'
        ? ` · ${msg.issues} issue${msg.issues === 1 ? '' : 's'}`
        : '';
      const label = text(`On-page checklist: ${score}${issues}`);
      label.title = CHECKLIST_TITLE;
      if (typeof entry.tabId === 'number') el.appendChild(openButton('Open report', entry.tabId, true));
    } else {
      const words = ERROR_TEXT[msg.code] || ERROR_TEXT.failed;
      text(msg.title ? `${words} ${msg.title}.` : words);
      if (typeof entry.tabId === 'number' && msg.code !== 'closed') el.appendChild(openButton('Open tab', entry.tabId, false));
    }
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

  // Issue #44: a results page that has result headings but yields no rows
  // means Google's markup moved under the parser (as /goto links did in
  // #41). Say so once per page in the console, instead of every export
  // silently coming out empty. The flag lives on the document, not in this
  // script, so a second copy injected after an extension reload stays quiet.
  // 1.10.2: and on the page itself, in the toolbar (showUnreadNotice).
  function warnIfUnparsed(rowCount) {
    if (rowCount || document.__sbwWarnedUnparsed || !hasOrganicContainerH3()) return;
    document.__sbwWarnedUnparsed = true;
    const root = document.querySelector('#rso') || document.querySelector('#search');
    console.warn('[SBW] SERP overlay read 0 results from a page with ' +
      root.querySelectorAll('h3').length + ' result headings (' +
      root.querySelectorAll('a[href^="/goto?"], a[href^="/url?"]').length +
      ' Google redirect links). Google\'s results markup may have changed.');
  }

  // 1.10.2: a page with result headings that yields no rows says so where
  // the person looks, not only in the console. Hidden again once a rescan
  // reads results.
  function showUnreadNotice(rowCount) {
    if (!toolbarEl) return;
    const notice = toolbarEl.querySelector('[data-role="unread-notice"]');
    if (!notice) return;
    notice.hidden = !!rowCount || !hasOrganicContainerH3();
  }

  function processResults() {
    const rows = globalThis.SBWSerp.parseResults(document);
    warnIfUnparsed(rows.length);

    rows.forEach((row) => {
      const block = row._el;
      if (!block || processedBlocks.has(block)) return;
      processedBlocks.add(block);
      const bar = makeBar(row);
      (row._end || block).insertAdjacentElement('afterend', bar);
      barsByKey.set(row._key || bar.querySelector('a').href, bar);
    });

    if (rows.length || hasOrganicContainerH3()) {
      renderToolbar();
      updateToolbarCounts(rows.length);
      showUnreadNotice(rows.length);
    }
  }

  // ---------- toolbar ----------

  // Fix round 1, item 8: runs every cell through the exact same
  // formula-injection guard as resultsToCsv's CSV path (SBWSerp.guardCell)
  // before stripping the tab/newline characters that would otherwise break
  // TSV's own column/row delimiters — guarding first matters, since a
  // guard-triggering leading tab or CR would otherwise be collapsed away by
  // the whitespace cleanup before ever being seen.
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
      // #54: a hidden flash left "Copied" in the button's textContent
      // ("Copy PAA (9)Copied"), which tests, agents and screen readers read.
      flashEl.textContent = '';
      holder.style.display = '';
    }, 1200);
  }

  // Issue #37: navigator.clipboard.writeText() always rejects here
  // ("NotAllowedError: Write permission denied"). A content script's
  // isolated world doesn't inherit the page's clipboard grant, and the
  // `clipboardWrite` permission that would allow it shows users a "Modify
  // data you copy and paste" warning, which disables the extension on update
  // until they accept it. execCommand('copy') needs only the click's user
  // activation, so it goes first; the async API stays as a second try.
  function copyText(text, btn) {
    if (execCopy(text)) {
      flashLabel(btn, 'Copied');
      return;
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flashLabel(btn, 'Copy failed');
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => flashLabel(btn, 'Copied'))
      .catch((err) => {
        console.warn('[SBW] copy failed:', err && err.name, err && err.message);
        flashLabel(btn, 'Copy failed');
      });
  }

  // Copies through a throwaway, off-screen textarea, then gives focus and the
  // page's text selection back, so the click leaves Google's page as it was.
  function execCopy(text) {
    if (typeof document.execCommand !== 'function') return false;
    const previousFocus = document.activeElement;
    const selection = document.getSelection && document.getSelection();
    const ranges = [];
    if (selection) {
      for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    let ok = false;
    try {
      ta.select();
      ok = document.execCommand('copy') === true;
    } catch (e) {
      ok = false;
    }
    ta.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus({ preventScroll: true }); } catch (e) { /* element went away */ }
    }
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((r) => selection.addRange(r));
    }
    return ok;
  }

  // The old name was the date alone, so two exports on one day overwrote each
  // other and neither said which search it came from.
  // #55: per-minute stamps collided when exporting pages 1–5 of one search
  // ("… (1).csv", "… (2).csv"), and the page number was only inside the file.
  // serp-seo-stats-chrome-p3-2026-10-12-191305.csv
  function csvFilename(query, page) {
    const slug = String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const iso = new Date().toISOString();
    const stamp = iso.slice(0, 10) + '-' + iso.slice(11, 19).replace(/:/g, '');
    return 'serp-' + (slug || 'results') + '-p' + (page || 1) + '-' + stamp + '.csv';
  }

  function downloadCsv(csvText, query, page) {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename(query, page);
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

    function locationUrl(canonical) {
      return globalThis.SBWSerp.buildSearchUrl({
        q: currentQuery(),
        gl: glInput.value.trim(),
        hl: hlInput.value.trim(),
        pws: pwsCheckbox.checked,
        domain: window.location.hostname,
        uule: canonical ? globalThis.SBWSerp.uule(canonical) : undefined
      });
    }

    function openLocation(canonical) {
      window.open(locationUrl(canonical), '_blank', 'noopener');
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
    // 1.10.2: the worker opens both. Two window.open() calls from one click
    // opened one tab, since Chrome allows a page one pop-up per click.
    compareBtn.addEventListener('click', () => {
      const urls = [locationUrl(resolvedCanonical()), locationUrl(compareSelect.value)];
      try {
        chrome.runtime.sendMessage({ action: 'serpOpenSearches', urls }, (reply) => {
          if (chrome.runtime.lastError || !reply || !reply.ok) flashLabel(compareBtn, 'Could not open the tabs');
        });
      } catch (e) {
        openLocation(resolvedCanonical()); // extension reloaded under this page
      }
    });
    wrap.appendChild(compareBtn);

    const copy = document.createElement('span');
    copy.className = 'sbw-serp-location-copy';
    copy.textContent = 'Opens this search with location parameters so you can see what searchers in that area are shown.';
    wrap.appendChild(copy);

    return wrap;
  }

  // ---------- collect pages (#45) ----------
  //
  // Google ignores &num=, so a top 50 is five pages. A person adds each page
  // here and moves on with Google's own Next link; nothing walks pages by
  // itself (a human in the loop: Google's terms rule out automated scraping).
  // The worker keeps what was added in session storage and combines it
  // (src/lib/serp-collect.js): one list, deduped by URL, with an absolute
  // position. Nothing is sent anywhere.
  let collected = { rows: [], summary: null, line: '', earlierOrganic: undefined };

  function collectAsk(op, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ action: 'serpCollect', op, search: window.location.search, withRows: true }, extra || {}), (reply) => {
          if (chrome.runtime.lastError || !reply) { resolve({ error: 'unavailable' }); return; }
          resolve(reply);
        });
      } catch (e) {
        resolve({ error: 'unavailable' }); // extension reloaded under this page
      }
    });
  }

  function showCollected(reply) {
    if (!reply || reply.error === 'unavailable' || reply.error === 'no-query') return;
    collected = {
      rows: reply.rows || [],
      summary: reply.summary,
      line: reply.line || '',
      earlierOrganic: typeof reply.earlierOrganic === 'number' ? reply.earlierOrganic : undefined
    };
    if (!toolbarEl) return;
    const line = toolbarEl.querySelector('[data-role="collect-line"]');
    if (line) line.textContent = collected.line;
    const n = toolbarEl.querySelector('[data-role="collect-count"]');
    if (n) n.textContent = String(collected.rows.length);
    const has = collected.rows.length > 0;
    toolbarEl.querySelectorAll('[data-collect-needs-rows]').forEach((el) => { el.disabled = !has; });
  }

  function collectButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sbw-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  // The Web tab as Google links it on this page; never built by hand, so it
  // follows whatever Google uses. Looked up on the click: the Web tab sits in
  // the tab row's "More" menu, filled in after load. 1.10.2: Google's Web
  // filter is `udm=14`; until then only `udm=web` was looked for, which
  // Google's tab row doesn't use, so the button said "No Web tab on this
  // page". Both are accepted.
  const WEB_FILTER_UDM = ['14', 'web'];

  function onWebOnlyPage() {
    return WEB_FILTER_UDM.includes((new URLSearchParams(window.location.search).get('udm') || '').toLowerCase());
  }

  function webOnlyLink() {
    const a = [...document.querySelectorAll('a[href*="udm="]')].find((x) => {
      try { return WEB_FILTER_UDM.includes((new URL(x.href, location.href).searchParams.get('udm') || '').toLowerCase()); } catch (e) { return false; }
    });
    return a ? a.href : null;
  }

  function buildCollectControl() {
    const ctx = globalThis.SBWSerp.searchContext(window.location, document);
    const wrap = document.createElement('div');
    wrap.className = 'sbw-serp-collect';

    const label = document.createElement('span');
    label.className = 'sbw-serp-location-label';
    label.textContent = 'Collect pages:';
    wrap.appendChild(label);

    wrap.appendChild(collectButton(`Add page ${ctx.page}`, async (btn) => {
      const rows = globalThis.SBWSerp.parseResults(document);
      if (!rows.length) { flashLabel(btn, 'No results found'); return; }
      const now = globalThis.SBWSerp.searchContext(window.location, document);
      const reply = await collectAsk('add', {
        page: {
          start: now.start,
          // `link`, the href Google rendered, tells apart two results whose
          // URL is only their site's home address (SBWSerpCollect.matchKey).
          rows: rows.map((r) => Object.assign({}, r, { link: r._href || r.url })),
          context: { capturedAt: now.capturedAt, resultStats: now.resultStats, relatedSearches: now.relatedSearches, paa: now.paa }
        }
      });
      if (reply.error === 'full') { flashLabel(btn, "10 pages is the limit"); return; }
      if (reply.error) { flashLabel(btn, 'Could not add'); return; }
      showCollected(reply);
      flashLabel(btn, reply.added === 'replaced' ? `Added again: ${reply.moved} changed` : 'Added');
    }));

    const next = document.querySelector('#pnnext');
    if (next && next.href) {
      const a = document.createElement('a');
      a.className = 'sbw-btn sbw-link';
      a.href = next.href;
      a.textContent = 'Next page →';
      wrap.appendChild(a);
    }
    if (!onWebOnlyPage()) {
      const web = collectButton('Web results only', (btn) => {
        const href = webOnlyLink();
        if (!href) { flashLabel(btn, 'No Web tab on this page'); return; }
        window.location.assign(href);
      });
      web.title = "Google's Web tab: organic results without AI Overviews, videos and other features. Pages collected there are kept separately.";
      wrap.appendChild(web);
    }

    const copyAll = collectButton('', (btn) => {
      if (!collected.rows.length) { flashLabel(btn, 'Nothing added yet'); return; }
      copyText(globalThis.SBWSerp.resultsToTsv(collected.rows, globalThis.SBWSerp.searchContext(window.location, document)), btn);
    });
    copyAll.appendChild(document.createTextNode('Copy collected ('));
    const count = document.createElement('span');
    count.setAttribute('data-role', 'collect-count');
    count.textContent = '0';
    copyAll.appendChild(count);
    copyAll.appendChild(document.createTextNode(')'));
    copyAll.setAttribute('data-collect-needs-rows', '');
    wrap.appendChild(copyAll);

    const exportAll = collectButton('Export collected CSV', (btn) => {
      if (!collected.rows.length) { flashLabel(btn, 'Nothing added yet'); return; }
      const base = globalThis.SBWSerp.searchContext(window.location, document);
      const pages = (collected.summary && collected.summary.pages || []).map((p) => p.page);
      downloadCsv(globalThis.SBWSerp.resultsToCsv(collected.rows, base), base.query, pages.length ? pages[0] + '-' + pages[pages.length - 1] : base.page);
    });
    exportAll.setAttribute('data-collect-needs-rows', '');
    wrap.appendChild(exportAll);

    const clear = collectButton('Clear', async (btn) => {
      showCollected(await collectAsk('clear'));
      flashLabel(btn, 'Cleared');
    });
    clear.setAttribute('data-collect-needs-rows', '');
    wrap.appendChild(clear);

    const line = document.createElement('span');
    line.className = 'sbw-serp-collect-line';
    line.setAttribute('data-role', 'collect-line');
    wrap.appendChild(line);

    // What was added before, for this search: read only, nothing fetched.
    collectAsk('get').then(showCollected);
    return wrap;
  }

  // This page's search context, with the organic results counted on the
  // earlier pages added to Collect, for "Absolute position (approx.)".
  function pageContext() {
    const ctx = globalThis.SBWSerp.searchContext(window.location, document);
    if (typeof collected.earlierOrganic === 'number') ctx.earlierOrganic = collected.earlierOrganic;
    return ctx;
  }

  function renderToolbar() {
    if (toolbarEl) return; // one per page
    const container = resultsContainer();
    if (!container || !container.parentNode) return;

    toolbarEl = document.createElement('div');
    toolbarEl.className = 'sbw-serp-tools';

    const notice = document.createElement('div');
    notice.className = 'sbw-serp-notice';
    notice.setAttribute('data-role', 'unread-notice');
    notice.setAttribute('role', 'status');
    notice.hidden = true;
    notice.textContent = "SEO Bandwagon couldn't read the results on this page, so there are no bars and nothing to copy or export. " +
      'Google may have changed its layout; please let us know at seobandwagon.com.';
    toolbarEl.appendChild(notice);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'sbw-btn';
    copyBtn.appendChild(document.createTextNode('Copy results ('));
    const copyCount = document.createElement('span');
    copyCount.setAttribute('data-role', 'copy-count');
    copyCount.textContent = '0';
    copyBtn.appendChild(copyCount);
    copyBtn.appendChild(document.createTextNode(')'));
    // Issue #44: with nothing to copy or export, say so and leave the
    // clipboard and Downloads alone; a "Copied" over a header-only table hid
    // parser failures.
    copyBtn.addEventListener('click', () => {
      const rows = globalThis.SBWSerp.parseResults(document);
      if (!rows.length) {
        flashLabel(copyBtn, 'No results found');
        return;
      }
      // Same columns as the CSV (SBWSerp.resultsToTsv), so a paste and a file agree.
      copyText(globalThis.SBWSerp.resultsToTsv(rows, pageContext()), copyBtn);
    });
    toolbarEl.appendChild(copyBtn);

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'sbw-btn';
    exportBtn.textContent = 'Export CSV';
    exportBtn.addEventListener('click', () => {
      const rows = globalThis.SBWSerp.parseResults(document);
      if (!rows.length) {
        flashLabel(exportBtn, 'No results found');
        return;
      }
      const ctx = pageContext();
      downloadCsv(globalThis.SBWSerp.resultsToCsv(rows, ctx), ctx.query, ctx.page);
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
      if (!questions.length) {
        // Copying '' would wipe the user's clipboard and still say "Copied".
        flashLabel(paaBtn, 'No questions found');
        return;
      }
      copyText(globalThis.SBWSerp.paaToText(questions), paaBtn);
    });
    toolbarEl.appendChild(paaBtn);

    toolbarEl.appendChild(buildLocationControl());
    toolbarEl.appendChild(buildCollectControl());

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

  // #56: the popup asks what this page actually yielded, instead of
  // promising bars it can't see. 1.10.2: the worker reports each Analyze
  // here ('serpAnalysis').
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'serpAnalysis' && typeof msg.key === 'string') {
        showAnalysis(msg.key, msg);
        return;
      }
      if (!msg || msg.action !== 'serpStatus') return;
      const root = document.querySelector('#rso') || document.querySelector('#search');
      sendResponse({
        rows: globalThis.SBWSerp.parseResults(document).length,
        headings: root ? root.querySelectorAll('h3').length : 0,
        questions: globalThis.SBWSerp.parsePaa(document).length
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
