// SEO Bandwagon — SERP overlay content script (Task 6 rewrite; 1.11.0 redraw)
//
// Runs on Google search results pages (see manifest.json's content_scripts
// entry for the exact host list — thirty Google domains since 1.11.0).
// Additive only, per the ledger ruling: this never hides, moves, covers, or
// restyles an ad or any Google UI. `.sbw-serp-bar` elements are appended
// AFTER each whole organic result (1.10.2: below its description and
// sitelinks, not between title and description). Nothing is ever inserted
// near an ad — src/lib/serp.js's parseResults() already excludes every block
// under [data-text-ad]/#tads/#bottomads/an "Ads" label, so this script never
// even sees an ad row to act on.
//
// 1.11.0:
//   - Each bar is one line: the position, the site, the figures chosen in
//     settings (DataForSEO's link and traffic figures for the page and the
//     site, RDAP's domain age, the person's own on-page checklist) and
//     Analyze. The figures come from the worker ('serpFigures',
//     src/lib/serp-figures-service.js), which sends the results' addresses
//     to SEO Bandwagon only with a key and the figures accepted in Options.
//     Without a key a bar says "Connect free to see figures"; position,
//     Analyze and every export work with no account.
//   - The toolbar is one collapsible SEO Bandwagon panel with groups
//     (Figures, Export, People also ask, Collect, Location), at the top of
//     the results (pushing them down) or below them, by setting
//     (src/lib/serp-settings.js). It is in the page's flow, never over it.
//   - The look follows the setting: Match Google (Google's own light or dark
//     page), Night or Day. Its tokens live on our own elements only
//     (serp-overlay.css), so nothing leaks into Google's cascade.
//   - Your own sites (a list in Options) are marked on their bars.
// The search itself is never sent: the location simulator reads `q` only to
// build its own Google URL.
//
// Analyze (1.10.2, owner 2026-11-01: "Stay on Google") hands the result to
// the worker, which opens it in a background tab, analyzes that tab and
// sends the outcome back here: one line under the result with the page's
// on-page checklist and "Open report" (src/lib/serp-analyze.js).

(function () {
  'use strict';

  // Defensive guard, same pattern as src/content/analyzer.js's collectLinks/
  // analyzeHreflang: if src/lib/serp.js somehow isn't injected before this
  // file (manifest content_scripts order), do nothing rather than throw.
  if (!globalThis.SBWSerp) return;
  const S = globalThis.SBWSerp;
  const F = globalThis.SBWSerpFigures;
  const Settings = globalThis.SBWSerpSettings;
  if (!F || !Settings) return;

  const DEBOUNCE_MS = 500;

  const processedBlocks = new WeakSet();
  let toolbarEl = null;
  let mutationTimer = null;
  let settings = Settings.defaults();

  // Figures, by the parser's result key (row._key). `figState` is the last
  // answer for the page as a whole: 'idle' (nothing asked yet), 'loading',
  // 'ok', 'no_key', 'needs_consent' or 'error' (with `code`).
  const rowsByKey = new Map();
  const figuresByKey = new Map();
  const pendingKeys = new Set();
  // Results asked for once already. A rescan asks only for new results; a
  // result whose figures didn't come (no key, not accepted, an error) is
  // asked again only on a click or a settings change.
  const askedKeys = new Set();
  let figState = { state: 'idle' };
  let figuresWanted = false; // "Load figures" was clicked (load on a click)

  // 1.11.0: #rso before #rcnt, so a page without #search still gets the
  // panel beside its results rather than after <body>.
  function resultsContainer() {
    return document.querySelector('#search') || document.querySelector('#rso') || document.querySelector('#rcnt') || document.body;
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

  function send(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, (reply) => {
        if (chrome.runtime.lastError) { cb && cb(undefined, true); return; }
        cb && cb(reply, false);
      });
      return true;
    } catch (e) {
      cb && cb(undefined, true); // extension reloaded under this page
      return false;
    }
  }

  // ---------- look ----------

  // Google's own page: dark when its background is. Read from the page
  // rather than from the system setting, since Google has its own switch.
  function luminance(rgb) {
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(rgb || '');
    if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]);
  }

  function googleIsDark() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      let bg = '';
      try { bg = getComputedStyle(el).backgroundColor; } catch (e) { bg = ''; }
      const l = luminance(bg);
      if (l !== null) return l < 0.2;
    }
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  function lookName() {
    if (settings.look === 'dark' || settings.look === 'light') return settings.look;
    return googleIsDark() ? 'google-dark' : 'google-light';
  }

  function applyLook() {
    const look = lookName();
    document.querySelectorAll('.sbw-serp-bar, .sbw-serp-analysis, .sbw-serp-tools').forEach((el) => {
      el.setAttribute('data-sbw-look', look);
    });
  }

  // ---------- bars ----------

  function positionTitle(row) {
    const parts = [`Organic position ${row.position} on this page.`];
    if (row.pagePosition) {
      parts.push(`Counting everything on the page (ads, AI Overview, People also ask, maps, videos and the other blocks above it): ${row.pagePosition}.`);
    }
    return parts.join(' ');
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function makeBar(row) {
    const bar = el('div', 'sbw-serp-bar');
    bar.setAttribute('data-sbw-look', lookName());
    const own = !row.siteUnknown && Settings.isOwnSite(row.domain, settings.ownSites);
    if (own) bar.setAttribute('data-own', 'true');

    const posEl = el('span', 'sbw-serp-pos', '#' + row.position);
    posEl.title = positionTitle(row);
    posEl.setAttribute('aria-label', posEl.title);
    bar.appendChild(posEl);

    const domainEl = el('span', 'sbw-serp-domain');
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

    if (own) {
      const mark = el('span', 'sbw-serp-own', 'Your site');
      mark.title = 'One of your sites, from the list in SEO Bandwagon’s settings.';
      bar.appendChild(mark);
    }

    const figs = el('span', 'sbw-serp-figs');
    figs.setAttribute('data-role', 'figures');
    bar.appendChild(figs);

    // Whose figures they are, on the first row beside Analyze; shown once a
    // link or traffic figure is.
    const source = el('span', 'sbw-fig-source', F.SOURCE);
    source.title = SOURCE_TITLE;
    source.hidden = true;
    bar.appendChild(source);

    const analyzeLink = el('a', 'sbw-serp-analyze', 'Analyze');
    // row._href is the link as Google rendered it; for a /goto result
    // row.url can be just the site's origin, or empty for an unknown site
    // (see SBWSerp.parseResults).
    analyzeLink.href = row._href || row.url;
    analyzeLink.target = '_blank';
    analyzeLink.rel = 'noopener noreferrer';
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

  function actionButton(label, page, title) {
    const b = el('button', 'sbw-serp-act', label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', () => {
      if (page === 'load') { loadFigures(true); return; }
      send({ action: 'serpOpen', page });
    });
    return b;
  }

  const SOURCE_TITLE = 'Link and traffic figures are DataForSEO’s, rank on its 0 to 100 scale; domain age is from RDAP. ' +
    'Figures, not a score of ours.';

  // The figures part of one bar, from what is known now.
  function renderFigures(bar, row) {
    const box = bar.querySelector('[data-role="figures"]');
    if (!box) return;
    const source = bar.querySelector('.sbw-fig-source');
    if (source) source.hidden = true;
    box.textContent = '';
    box.removeAttribute('data-state');
    if (!settings.figuresOn || row.siteUnknown) return;

    const figures = figuresByKey.get(row._key);
    if (figures) {
      const items = F.barItems(figures, settings.figures, row);
      box.setAttribute('data-state', 'ok');
      const group = (name, list) => {
        if (!list.length) return;
        const g = el('span', 'sbw-fig-group');
        g.setAttribute('data-group', name);
        g.appendChild(el('span', 'sbw-fig-label', name === 'page' ? 'Page' : 'Site'));
        list.forEach((it) => {
          const f = el('span', 'sbw-fig', it.text);
          f.title = it.title;
          f.setAttribute('data-figure', it.key);
          g.appendChild(f);
        });
        box.appendChild(g);
      };
      group('page', items.page);
      group('site', items.site);
      if (source && (items.page.length || items.site.length)) source.hidden = false;
      [items.age, items.checklist].forEach((it) => {
        if (!it) return;
        const f = el('span', 'sbw-fig sbw-fig-solo', it.text);
        f.title = it.title;
        f.setAttribute('data-figure', it.key);
        box.appendChild(f);
      });
      items.notes.forEach((t) => box.appendChild(el('span', 'sbw-fig-note', t)));
      if (F.isEmpty(items) && !items.notes.length) {
        const notice = figState.notice;
        if (notice && (notice.kind === 'limit_reached' || notice.kind === 'paused')) {
          box.appendChild(el('span', 'sbw-fig-note', notice.kind === 'limit_reached'
            ? 'No figures: today’s limit is reached' : 'New figures paused until next month'));
          if (notice.upgrade) box.appendChild(actionButton('Upgrade', 'upgrade', 'More searches with figures a day on Pro.'));
        } else {
          box.appendChild(el('span', 'sbw-fig-note', 'No figures for this result yet'));
        }
      }
      return;
    }

    const st = figState.state;
    if (st === 'no_key' || st === 'needs_consent' || st === 'error') {
      const code = st === 'error' ? figState.code : st;
      const words = F.errorWords(code);
      box.setAttribute('data-state', st);
      if (words.action === 'connect') box.appendChild(actionButton(words.text, 'connect'));
      else if (words.action === 'settings') box.appendChild(actionButton('Turn on figures', 'settings', words.text + '.'));
      else box.appendChild(el('span', 'sbw-fig-note', words.text));
      return;
    }
    if (pendingKeys.has(row._key) || st === 'loading') {
      box.setAttribute('data-state', 'loading');
      box.appendChild(el('span', 'sbw-fig-note', 'Loading figures…'));
      return;
    }
    if (st === 'ok') {
      box.appendChild(el('span', 'sbw-fig-note', 'No figures for this result yet'));
      return;
    }
    if (settings.load === 'click' && !figuresWanted) {
      box.appendChild(actionButton('Show figures', 'load', 'Loads the figures for every result on this page.'));
    }
  }

  function renderAllFigures() {
    barsByKey.forEach((bar, key) => {
      const row = rowsByKey.get(key);
      if (row && bar.isConnected) renderFigures(bar, row);
    });
    renderFiguresLine();
  }

  // Asks the worker for the figures of every result that has none yet.
  // `force`: a click on "Load figures" or "Show figures".
  function loadFigures(force) {
    if (force) figuresWanted = true;
    if (!settings.overlay || !settings.figuresOn) return;
    if (settings.load === 'click' && !figuresWanted) { renderAllFigures(); return; }
    if (force) askedKeys.clear();
    const rows = Array.from(rowsByKey.values())
      .filter((r) => !figuresByKey.has(r._key) && !pendingKeys.has(r._key) && !askedKeys.has(r._key));
    const items = F.requestItems(rows);
    if (!items.length) { renderAllFigures(); return; }
    items.forEach((i) => { pendingKeys.add(i.key); askedKeys.add(i.key); });
    if (figState.state === 'idle' || figState.state === 'error') figState = { state: 'loading' };
    renderAllFigures();
    const sent = send({ action: 'serpFigures', items }, (reply, failed) => {
      items.forEach((i) => pendingKeys.delete(i.key));
      if (failed || !reply) {
        figState = { state: 'error', code: 'reloaded' };
      } else if (reply.state === 'ok') {
        Object.entries(reply.results || {}).forEach(([key, figures]) => figuresByKey.set(key, figures));
        figState = { state: 'ok', plan: reply.plan, allowance: reply.allowance, lookups: reply.lookups, notice: reply.notice };
      } else if (reply.state === 'error') {
        Object.entries(reply.results || {}).forEach(([key, figures]) => figuresByKey.set(key, figures));
        figState = { state: 'error', code: reply.code, retryAfter: reply.retryAfter };
      } else {
        figState = { state: reply.state };
      }
      renderAllFigures();
    });
    if (!sent) items.forEach((i) => pendingKeys.delete(i.key));
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
    const btn = el('button', 'sbw-serp-open', label);
    btn.type = 'button';
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
    const line = el('div', 'sbw-serp-analysis');
    line.setAttribute('role', 'status');
    line.setAttribute('data-sbw-look', lookName());
    bar.insertAdjacentElement('afterend', line);
    entry = { el: line, tabId: null };
    analysisLines.set(key, entry);
    return entry;
  }

  function showAnalysis(key, msg) {
    const entry = lineFor(key);
    if (!entry || !msg) return;
    const line = entry.el;
    line.textContent = '';
    line.removeAttribute('title');
    line.removeAttribute('data-state');
    if (typeof msg.tabId === 'number') entry.tabId = msg.tabId;
    const text = (t) => {
      const span = el('span', 'sbw-serp-analysis-text', t);
      line.appendChild(span);
      return span;
    };
    line.setAttribute('data-state', msg.state || '');

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
      if (typeof entry.tabId === 'number') line.appendChild(openButton('Open report', entry.tabId, true));
    } else {
      const words = ERROR_TEXT[msg.code] || ERROR_TEXT.failed;
      text(msg.title ? `${words} ${msg.title}.` : words);
      if (typeof entry.tabId === 'number' && msg.code !== 'closed') line.appendChild(openButton('Open tab', entry.tabId, false));
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
    if (!settings.overlay) return;
    const rows = S.parseResults(document);
    warnIfUnparsed(rows.length);

    rows.forEach((row) => {
      if (row._key) rowsByKey.set(row._key, row);
      const block = row._el;
      if (!block || processedBlocks.has(block)) return;
      processedBlocks.add(block);
      const bar = makeBar(row);
      (row._end || block).insertAdjacentElement('afterend', bar);
      barsByKey.set(row._key || bar.querySelector('a').href, bar);
      renderFigures(bar, row);
    });

    if (rows.length || hasOrganicContainerH3()) {
      renderToolbar();
      updateToolbarCounts(rows.length);
      showUnreadNotice(rows.length);
    }
    if (settings.figuresOn && (settings.load === 'auto' || figuresWanted)) loadFigures(false);
  }

  // The rows as exported: each with the figures it was given and whether
  // it is one of the person's sites (Options).
  function exportRows(rows) {
    return rows.map((r) => Object.assign({}, r, {
      figures: figuresByKey.get(r._key) || undefined,
      ownSite: !r.siteUnknown && Settings.isOwnSite(r.domain, settings.ownSites)
    }));
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
    ta.className = 'sbw-copy'; // ours: its coming and going is no reason to rescan
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
    a.className = 'sbw-download';
    a.href = url;
    a.download = csvFilename(query, page);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildLocationControl() {
    // 1.11.0: no "Location:" label of its own; its panel group is titled so.
    const wrap = el('div', 'sbw-serp-location');

    const select = document.createElement('select');
    select.className = 'sbw-serp-location-select';
    select.setAttribute('aria-label', 'Location');
    const customOpt = document.createElement('option');
    customOpt.value = '';
    customOpt.textContent = 'Choose a metro…';
    select.appendChild(customOpt);
    S.PRESET_LOCATIONS.forEach((loc) => {
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
    customInput.setAttribute('aria-label', 'Location, typed');
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
    glInput.setAttribute('aria-label', 'Country code (gl)');
    glInput.value = searchParams.get('gl') || 'us';
    wrap.appendChild(glInput);

    const hlInput = document.createElement('input');
    hlInput.type = 'text';
    hlInput.className = 'sbw-serp-hl';
    hlInput.maxLength = 5;
    hlInput.placeholder = 'hl';
    hlInput.title = 'Language code (hl)';
    hlInput.setAttribute('aria-label', 'Language code (hl)');
    hlInput.value = searchParams.get('hl') || 'en';
    wrap.appendChild(hlInput);

    const pwsLabel = el('label', 'sbw-serp-pws');
    const pwsCheckbox = document.createElement('input');
    pwsCheckbox.type = 'checkbox';
    pwsLabel.appendChild(pwsCheckbox);
    pwsLabel.appendChild(document.createTextNode('Personalization off (pws=0)'));
    wrap.appendChild(pwsLabel);

    const compareLabel = el('span', 'sbw-serp-location-label', 'vs.');
    wrap.appendChild(compareLabel);

    const compareSelect = document.createElement('select');
    compareSelect.className = 'sbw-serp-location-select';
    compareSelect.setAttribute('aria-label', 'Compare with');
    S.PRESET_LOCATIONS.forEach((loc) => {
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
      return S.buildSearchUrl({
        q: currentQuery(),
        gl: glInput.value.trim(),
        hl: hlInput.value.trim(),
        pws: pwsCheckbox.checked,
        domain: window.location.hostname,
        uule: canonical ? S.uule(canonical) : undefined
      });
    }

    function openLocation(canonical) {
      window.open(locationUrl(canonical), '_blank', 'noopener');
    }

    const openBtn = el('button', 'sbw-btn', 'Open with this location');
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => openLocation(resolvedCanonical()));
    wrap.appendChild(openBtn);

    const compareBtn = el('button', 'sbw-btn', 'Compare in two tabs');
    compareBtn.type = 'button';
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

    const copy = el('span', 'sbw-serp-location-copy', 'Opens this search with location parameters so you can see what searchers in that area are shown.');
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
    toolbarEl.querySelectorAll('[data-collect-needs-rows]').forEach((b) => { b.disabled = !has; });
  }

  function collectButton(label, onClick) {
    const btn = el('button', 'sbw-btn', label);
    btn.type = 'button';
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
    const ctx = S.searchContext(window.location, document);
    const wrap = el('div', 'sbw-serp-collect');

    wrap.appendChild(collectButton(`Add page ${ctx.page}`, async (btn) => {
      const rows = S.parseResults(document);
      if (!rows.length) { flashLabel(btn, 'No results found'); return; }
      const now = S.searchContext(window.location, document);
      const reply = await collectAsk('add', {
        page: {
          start: now.start,
          // `link`, the href Google rendered, tells apart two results whose
          // URL is only their site's home address (SBWSerpCollect.matchKey).
          rows: exportRows(rows).map((r, i) => Object.assign(r, { link: rows[i]._href || rows[i].url })),
          context: { capturedAt: now.capturedAt, resultStats: now.resultStats, relatedSearches: now.relatedSearches, paa: now.paa, features: now.features, aiCitations: now.aiCitations }
        }
      });
      if (reply.error === 'full') { flashLabel(btn, "10 pages is the limit"); return; }
      if (reply.error) { flashLabel(btn, 'Could not add'); return; }
      showCollected(reply);
      flashLabel(btn, reply.added === 'replaced' ? `Added again: ${reply.moved} changed` : 'Added');
    }));

    const next = document.querySelector('#pnnext');
    if (next && next.href) {
      const a = el('a', 'sbw-btn sbw-link', 'Next page →');
      a.href = next.href;
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
      copyText(S.resultsToTsv(collected.rows, S.searchContext(window.location, document)), btn);
    });
    copyAll.appendChild(document.createTextNode('Copy collected ('));
    const count = el('span', null, '0');
    count.setAttribute('data-role', 'collect-count');
    copyAll.appendChild(count);
    copyAll.appendChild(document.createTextNode(')'));
    copyAll.setAttribute('data-collect-needs-rows', '');
    wrap.appendChild(copyAll);

    const exportAll = collectButton('Export collected CSV', (btn) => {
      if (!collected.rows.length) { flashLabel(btn, 'Nothing added yet'); return; }
      const base = S.searchContext(window.location, document);
      const pages = (collected.summary && collected.summary.pages || []).map((p) => p.page);
      downloadCsv(S.resultsToCsv(collected.rows, base), base.query, pages.length ? pages[0] + '-' + pages[pages.length - 1] : base.page);
    });
    exportAll.setAttribute('data-collect-needs-rows', '');
    wrap.appendChild(exportAll);

    const clear = collectButton('Clear', async (btn) => {
      showCollected(await collectAsk('clear'));
      flashLabel(btn, 'Cleared');
    });
    clear.setAttribute('data-collect-needs-rows', '');
    wrap.appendChild(clear);

    const line = el('span', 'sbw-serp-collect-line');
    line.setAttribute('data-role', 'collect-line');
    wrap.appendChild(line);

    // What was added before, for this search: read only, nothing fetched.
    collectAsk('get').then(showCollected);
    return wrap;
  }

  // This page's search context, with the organic results counted on the
  // earlier pages added to Collect, for "Absolute position (approx.)".
  function pageContext() {
    const ctx = S.searchContext(window.location, document);
    if (typeof collected.earlierOrganic === 'number') ctx.earlierOrganic = collected.earlierOrganic;
    return ctx;
  }

  function resultsCsv() {
    const rows = S.parseResults(document);
    if (!rows.length) return null;
    const ctx = pageContext();
    return { text: S.resultsToCsv(exportRows(rows), ctx), filename: csvFilename(ctx.query, ctx.page) };
  }

  function resultsTsv() {
    const rows = S.parseResults(document);
    return rows.length ? S.resultsToTsv(exportRows(rows), pageContext()) : null;
  }

  // One group of the panel: a heading and its controls. Not an <h3>: the
  // parser reads every h3 in a bare page as a result heading.
  function group(name, title, ...children) {
    const g = el('div', 'sbw-group');
    g.setAttribute('data-group', name);
    const h = el('div', 'sbw-group-title', title);
    h.setAttribute('role', 'heading');
    h.setAttribute('aria-level', '3');
    g.appendChild(h);
    const body = el('div', 'sbw-group-body');
    children.forEach((c) => body.appendChild(c));
    g.appendChild(body);
    return g;
  }

  // The panel's figures line: the plan and today's allowance from the last
  // answer, what stopped new figures, or how to get them.
  function renderFiguresLine() {
    if (!toolbarEl) return;
    const box = toolbarEl.querySelector('[data-role="figures-line"]');
    const actions = toolbarEl.querySelector('[data-role="figures-actions"]');
    const summary = toolbarEl.querySelector('[data-role="summary"]');
    if (!box || !actions) return;
    box.textContent = '';
    actions.textContent = '';
    box.removeAttribute('data-kind');
    let short = '';
    if (!settings.figuresOn) {
      box.textContent = 'Figures are off. Turn them on in Settings.';
    } else if (figState.state === 'ok') {
      const notice = figState.notice;
      const line = F.allowanceLine(figState);
      if (notice) {
        box.setAttribute('data-kind', notice.kind);
        box.textContent = notice.text + (line ? ' ' + line : '');
        if (notice.upgrade) actions.appendChild(actionButton('Upgrade for more figures', 'upgrade'));
      } else {
        box.textContent = (line || 'Figures loaded.') + ' Figures already looked up cost nothing.';
      }
      short = line ? line.replace(/ searches with new figures left today \(UTC\)\./, ' left today') : '';
    } else if (figState.state === 'loading') {
      box.textContent = 'Loading figures…';
    } else if (figState.state === 'no_key' || figState.state === 'needs_consent' || figState.state === 'error') {
      const words = F.errorWords(figState.state === 'error' ? figState.code : figState.state);
      box.textContent = words.text + '.';
      if (words.action === 'connect') actions.appendChild(actionButton(figState.state === 'no_key' ? 'Connect free' : 'Reconnect', 'connect'));
      if (words.action === 'settings') actions.appendChild(actionButton('Turn on figures', 'settings'));
      short = figState.state === 'no_key' ? 'Connect free to see figures' : '';
    } else if (settings.load === 'click' && !figuresWanted) {
      box.textContent = 'Figures load when you ask for them.';
      actions.appendChild(actionButton('Load figures', 'load'));
    }
    if (summary) summary.textContent = short;
  }

  function placePanel() {
    if (!toolbarEl) return;
    const container = resultsContainer();
    if (!container || !container.parentNode) return;
    toolbarEl.setAttribute('data-placement', settings.placement);
    // At the top the panel goes above the results and pushes them down;
    // at the bottom, after them, as the toolbar always was. Never over them.
    const where = settings.placement === 'top' ? 'beforebegin' : 'afterend';
    const sibling = settings.placement === 'top' ? container.previousElementSibling : container.nextElementSibling;
    if (sibling !== toolbarEl) container.insertAdjacentElement(where, toolbarEl);
  }

  function setCollapsed(collapsed) {
    if (!toolbarEl) return;
    const toggle = toolbarEl.querySelector('[data-role="toggle"]');
    const body = toolbarEl.querySelector('[data-role="body"]');
    toolbarEl.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    if (body) body.hidden = collapsed;
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.textContent = collapsed ? 'Show' : 'Hide';
    }
  }

  function renderToolbar() {
    if (toolbarEl) return; // one per page
    const container = resultsContainer();
    if (!container || !container.parentNode) return;

    toolbarEl = el('section', 'sbw-serp-tools');
    toolbarEl.setAttribute('aria-label', 'SEO Bandwagon');
    toolbarEl.setAttribute('data-sbw-look', lookName());

    const head = el('div', 'sbw-panel-head');
    head.appendChild(el('span', 'sbw-panel-mark', 'SEO Bandwagon'));
    const summary = el('span', 'sbw-panel-summary');
    summary.setAttribute('data-role', 'summary');
    head.appendChild(summary);
    const settingsBtn = actionButton('Settings', 'settings', 'Figures, placement and look of this panel, in SEO Bandwagon’s settings.');
    settingsBtn.className = 'sbw-panel-link';
    head.appendChild(settingsBtn);
    const toggle = el('button', 'sbw-panel-toggle', 'Hide');
    toggle.type = 'button';
    toggle.setAttribute('data-role', 'toggle');
    toggle.setAttribute('aria-controls', 'sbw-panel-body');
    toggle.addEventListener('click', () => {
      const collapsed = toolbarEl.getAttribute('data-collapsed') !== 'true';
      setCollapsed(collapsed);
      try { Settings.save({ collapsed }); } catch (e) { /* extension reloaded */ }
    });
    head.appendChild(toggle);
    toolbarEl.appendChild(head);

    const body = el('div', 'sbw-panel-body');
    body.id = 'sbw-panel-body';
    body.setAttribute('data-role', 'body');

    const notice = el('div', 'sbw-serp-notice', "SEO Bandwagon couldn't read the results on this page, so there are no bars and nothing to copy or export. " +
      'Google may have changed its layout; please let us know at seobandwagon.com.');
    notice.setAttribute('data-role', 'unread-notice');
    notice.setAttribute('role', 'status');
    notice.hidden = true;
    body.appendChild(notice);

    const figLine = el('p', 'sbw-figures-line');
    figLine.setAttribute('data-role', 'figures-line');
    figLine.setAttribute('role', 'status');
    const figActions = el('span', 'sbw-figures-actions');
    figActions.setAttribute('data-role', 'figures-actions');
    body.appendChild(group('figures', 'Figures', figLine, figActions));

    const copyBtn = el('button', 'sbw-btn');
    copyBtn.type = 'button';
    copyBtn.appendChild(document.createTextNode('Copy results ('));
    const copyCount = el('span', null, '0');
    copyCount.setAttribute('data-role', 'copy-count');
    copyBtn.appendChild(copyCount);
    copyBtn.appendChild(document.createTextNode(')'));
    // Issue #44: with nothing to copy or export, say so and leave the
    // clipboard and Downloads alone; a "Copied" over a header-only table hid
    // parser failures.
    copyBtn.addEventListener('click', () => {
      const tsv = resultsTsv();
      if (!tsv) {
        flashLabel(copyBtn, 'No results found');
        return;
      }
      // Same columns as the CSV (SBWSerp.resultsToTsv), so a paste and a file agree.
      copyText(tsv, copyBtn);
    });

    const exportBtn = el('button', 'sbw-btn', 'Export CSV');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', () => {
      const csv = resultsCsv();
      if (!csv) {
        flashLabel(exportBtn, 'No results found');
        return;
      }
      const ctx = pageContext();
      downloadCsv(csv.text, ctx.query, ctx.page);
    });
    body.appendChild(group('export', 'Export', copyBtn, exportBtn));

    const paaBtn = el('button', 'sbw-btn');
    paaBtn.type = 'button';
    paaBtn.appendChild(document.createTextNode('Copy PAA ('));
    const paaCount = el('span', null, '0');
    paaCount.setAttribute('data-role', 'paa-count');
    paaBtn.appendChild(paaCount);
    paaBtn.appendChild(document.createTextNode(')'));
    paaBtn.addEventListener('click', () => {
      const questions = S.parsePaa(document);
      if (!questions.length) {
        // Copying '' would wipe the user's clipboard and still say "Copied".
        flashLabel(paaBtn, 'No questions found');
        return;
      }
      copyText(S.paaToText(questions), paaBtn);
    });
    body.appendChild(group('paa', 'People also ask', paaBtn));

    body.appendChild(group('collect', 'Collect pages', buildCollectControl()));
    body.appendChild(group('location', 'Location', buildLocationControl()));
    toolbarEl.appendChild(body);

    placePanel();
    setCollapsed(settings.collapsed);
    renderFiguresLine();
  }

  function updateToolbarCounts(resultCount) {
    if (!toolbarEl) return;
    const paaCount = S.parsePaa(document).length;
    const copyCountEl = toolbarEl.querySelector('[data-role="copy-count"]');
    const paaCountEl = toolbarEl.querySelector('[data-role="paa-count"]');
    if (copyCountEl) copyCountEl.textContent = String(resultCount);
    if (paaCountEl) paaCountEl.textContent = String(paaCount);
  }

  // ---------- settings ----------

  // A setting saved in Options or the popup shows here at once.
  function applySettings(next) {
    const before = settings;
    settings = next;
    askedKeys.clear();
    if (!settings.overlay) {
      document.querySelectorAll('.sbw-serp-bar, .sbw-serp-analysis, .sbw-serp-tools').forEach((n) => n.remove());
      toolbarEl = null;
      return;
    }
    if (!before.overlay) {
      // Turned back on: every result gets its bar again.
      processResultsFresh();
      return;
    }
    applyLook();
    barsByKey.forEach((bar, key) => {
      const row = rowsByKey.get(key);
      if (!row || !bar.isConnected) return;
      const own = !row.siteUnknown && Settings.isOwnSite(row.domain, settings.ownSites);
      if (own !== (bar.getAttribute('data-own') === 'true')) {
        const fresh = makeBar(row);
        bar.replaceWith(fresh);
        barsByKey.set(key, fresh);
      }
    });
    placePanel();
    setCollapsed(settings.collapsed);
    renderAllFigures();
    if (settings.figuresOn && settings.load === 'auto') loadFigures(false);
  }

  function processResultsFresh() {
    barsByKey.clear();
    analysisLines.clear();
    rowsByKey.clear();
    S.parseResults(document).forEach((row) => row._el && processedBlocks.delete(row._el));
    processResults();
  }

  async function readSettings() {
    try {
      return await Settings.load(chrome.storage.local);
    } catch (e) {
      return Settings.defaults();
    }
  }

  // ---------- observe + init ----------

  function scheduleRescan() {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(processResults, DEBOUNCE_MS);
  }

  // 1.11.0: our own bars, lines and panel changing (figures arriving, a
  // flash on a button) are not Google's page changing, so they never cause
  // a rescan. Without this, a bar redrawn by a rescan scheduled the next
  // one, every half second, for as long as the page was open.
  const OWN_SELECTOR = '.sbw-serp-bar, .sbw-serp-analysis, .sbw-serp-tools';

  function isOwnNode(node) {
    if (!node) return false;
    if (node.nodeType !== 1) return isOwnNode(node.parentElement || node.parentNode);
    if (/(^|\s)sbw-/.test(typeof node.className === 'string' ? node.className : '')) return true;
    return !!(node.closest && node.closest(OWN_SELECTOR));
  }

  function isOwnMutation(record) {
    if (isOwnNode(record.target)) return true;
    const nodes = Array.from(record.addedNodes || []).concat(Array.from(record.removedNodes || []));
    return nodes.length > 0 && nodes.every(isOwnNode);
  }

  function startObserver() {
    const target = resultsContainer();
    if (!target || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver((records) => {
      if (records.every(isOwnMutation)) return;
      scheduleRescan();
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  async function init() {
    settings = await readSettings();
    processResults();
    startObserver();
    try {
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes[Settings.STORAGE_KEY]) {
            applySettings(Settings.normalize(changes[Settings.STORAGE_KEY].newValue));
          } else if ((area === 'local' && changes.sbwConsent) || (area === 'sync' && changes.apiKey)) {
            // Figures accepted or withdrawn in Options, or an account
            // connected: the open page asks again, without a reload.
            askedKeys.clear();
            figState = { state: 'idle' };
            if (settings.overlay && settings.figuresOn && (settings.load === 'auto' || figuresWanted)) loadFigures(false);
            else renderAllFigures();
          }
        });
      }
      if (typeof matchMedia === 'function') {
        const mq = matchMedia('(prefers-color-scheme: dark)');
        if (mq && mq.addEventListener) mq.addEventListener('change', applyLook);
      }
    } catch (e) { /* no storage events in this context */ }
  }

  // #56: the popup asks what this page actually yielded, instead of
  // promising bars it can't see. 1.10.2: the worker reports each Analyze
  // here ('serpAnalysis'). 1.11.0: the popup on a results page is this
  // page's panel: it asks for the search's features, the figures' state
  // and the exports ('serpExport'), and can load the figures.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'serpAnalysis' && typeof msg.key === 'string') {
        showAnalysis(msg.key, msg);
        return;
      }
      if (msg && msg.action === 'serpExport') {
        if (msg.kind === 'csv') sendResponse(resultsCsv());
        else if (msg.kind === 'tsv') sendResponse({ text: resultsTsv() });
        else if (msg.kind === 'paa') sendResponse({ text: S.paaToText(S.parsePaa(document)) || null });
        else if (msg.kind === 'ai') sendResponse({ text: S.aiOverviewCitations(document).map((c) => c.url).join('\n') || null });
        else sendResponse(null);
        return;
      }
      if (msg && msg.action === 'serpLoadFigures') {
        loadFigures(true);
        sendResponse({ ok: true });
        return;
      }
      if (!msg || msg.action !== 'serpStatus') return;
      const root = document.querySelector('#rso') || document.querySelector('#search');
      const rows = S.parseResults(document);
      sendResponse({
        rows: rows.length,
        headings: root ? root.querySelectorAll('h3').length : 0,
        questions: S.parsePaa(document).length,
        features: S.detectFeatures(document),
        aiCitations: S.aiOverviewCitations(document).length,
        ownSites: rows.filter((r) => !r.siteUnknown && Settings.isOwnSite(r.domain, settings.ownSites)).map((r) => r.position),
        figures: {
          state: figState.state,
          code: figState.code || null,
          loaded: rows.filter((r) => figuresByKey.has(r._key)).length,
          plan: figState.plan || null,
          allowance: figState.allowance || null,
          lookups: figState.lookups || null,
          notice: figState.notice || null
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
