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
// The search itself is never sent from here: the location simulator reads
// `q` only to build its own Google URL. 1.13.0's keyword data, which does
// send it, is serp-keywords.js, with its own consent; this script draws its
// rank history on the tracked site's bar and puts its figures in the exports
// (globalThis.SBWSerpKeywordsView).
//
// 1.13.3, the AI Overview study: a tab the study opened (the worker knows it,
// 'aioStudyTab') gets a "Send to study" group in the panel. It sends that
// page's export without figures or keyword data, and nothing in that tab asks
// for figures or keyword data (src/lib/aio-study.js holds the words). Bars
// still draw at once; figures wait for the worker's answer.
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
  const T = globalThis.SBWSerpTable; // 1.12.0: the results table
  if (!F || !Settings || !T) return;

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
  // Answers that may pass (a 429, the site busy, offline) are asked again
  // on their own, a few times: after Retry-After, or 30 s, 60 s, 90 s.
  const RETRY_CODES = ['rate_limited', 'unavailable', 'network', 'error'];
  const MAX_RETRIES = 3;
  let retries = 0;
  let retryTimer = null;

  // 1.12.0: each result's page checks (src/lib/serp-page-check.js), by key:
  // { state: 'working' | 'done' | 'error' | 'needs_access' | 'declined' |
  // 'hidden', row?, code? }. A pinned page and the AI Overview's sources
  // are keyed 'pin:' and 'ai:' + their address.
  const checksByKey = new Map();
  let pinned = null; // { url, key }
  let sortKey = null;
  let sortDir = 'asc';
  let tableTimer = null;

  // 1.11.0: #rso before #rcnt, so a page without #search still gets the
  // panel beside its results rather than after <body>.
  function resultsContainer() {
    return document.querySelector('#search') || document.querySelector('#rso') || document.querySelector('#rcnt') || document.body;
  }

  // Read only to build the location-simulator URL, and (1.11.0) to keep the
  // search out of the result addresses the figures ask for
  // (SBWSerpFigures.requestItem) — never placed in a request body or
  // message payload itself.
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

  // ---------- study mode (1.13.3) ----------
  //
  // The worker keeps a record of each tab it opened for a study term and
  // answers 'aioStudyTab' about this one, once, at load. Until it answers,
  // nothing is asked for that leaves the browser (figures wait; the keyword
  // strip awaits SBWSerpStudy.ready, set here, before this script's init, so
  // src/overlay/serp-keywords.js, which loads after it, finds it). No answer
  // or an error reads as an ordinary tab. In a study tab no figures and no
  // keyword data are asked for (the worker refuses them there too).
  const A = globalThis.SBWAioStudy;
  let studyInfo = null;      // the normalized answer for a study tab, else null
  let studyKnown = false;    // the worker's answer is in
  let studyBusy = false;     // a send or stop is on its way
  let studySent = false;     // this page went to the study
  let studyStopped = false;  // "Google stopped me" was recorded
  let studyOutcome = null;   // the last send or stop answer's state
  let studyTimer = null;
  let studyStopTimer = null; // set while "Google stopped me" waits for its second click

  const STUDY_STATUSES = ['open', 'late', 'sent'];

  // A worker that says `study: true` is believed even if the rest is
  // malformed: such a tab asks for nothing, and can't be sent.
  function readStudyAnswer(reply) {
    if (!reply || reply.study !== true) return null;
    const page = reply.page && typeof reply.page === 'object' ? reply.page : null;
    return {
      study: true,
      termId: typeof reply.termId === 'string' ? reply.termId : '',
      keyword: typeof reply.keyword === 'string' ? reply.keyword : '',
      accepted: reply.accepted === true,
      status: STUDY_STATUSES.includes(reply.status) ? reply.status : null,
      // The list's state; with no status, it tells a term that isn't on the
      // list from a list the worker couldn't get.
      today: typeof reply.today === 'string' ? reply.today : null,
      page: page && page.ok === true ? { ok: true } : { ok: false, reason: (page && page.reason) || 'error' }
    };
  }

  const studyReady = new Promise((resolve) => {
    send({ action: 'aioStudyTab' }, (reply) => {
      studyInfo = readStudyAnswer(reply);
      studyKnown = true;
      resolve(studyInfo || { study: false });
    });
  });
  globalThis.SBWSerpStudy = { ready: studyReady };
  studyReady.then(() => onStudyKnown());

  // Runs `fn` once the worker has answered, and not at all in a study tab.
  function unlessStudy(fn) {
    if (studyKnown) { if (!studyInfo) fn(); return; }
    studyReady.then(() => { if (!studyInfo) fn(); });
  }

  // A click the person made. A page script's click is not trusted, and
  // sends nothing.
  function trusted(e) {
    return !!(e && e.isTrusted === true);
  }

  function words(code) {
    return A ? A.message(code) : String(code);
  }

  // The bars and the panel show when "Show on Google results" is on, and
  // always in a study tab: a tester who turned them off still has Send to
  // study. (Figures and keyword data stay off there either way.)
  function overlayOn() {
    return settings.overlay || !!studyInfo;
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
    document.querySelectorAll('.sbw-serp-bar, .sbw-serp-analysis, .sbw-serp-check, .sbw-serp-tools, .sbw-serp-keywords, .sbw-kw-badge').forEach((el) => {
      el.setAttribute('data-sbw-look', look);
    });
  }

  // 1.13.0: the keyword strip (serp-keywords.js) takes the same look.
  globalThis.SBWSerpOverlay = { lookName };

  function keywordsView() {
    return globalThis.SBWSerpKeywordsView || null;
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
    if (!row.siteUnknown && row.domain) bar.setAttribute('data-domain', row.domain);
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
    analyzeLink.title = 'Checks this result\u2019s page from its HTML, here under the result; no tab opens.';
    // 1.12.0 (owner, 2026-11-01: "Stay on Google"): a plain click opens the
    // page's checks under the result. Ctrl/Cmd/Shift/Alt and middle clicks
    // stay the browser's. If the extension was reloaded under this page,
    // sendMessage throws and the link opens as a plain link.
    analyzeLink.addEventListener('click', (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (!analyzeRows([row])) return;
      e.preventDefault();
    });
    bar.appendChild(analyzeLink);

    // 1.13.0: the tracked site's rank history for this search.
    const kv = keywordsView();
    if (kv) kv.decorateBar(bar, row);
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
    if (!settings.figuresOn || row.siteUnknown || studyInfo || figState.state === 'study_tab') return;

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
          const monthly = figState.allowance && figState.allowance.period === 'month';
          box.appendChild(el('span', 'sbw-fig-note', notice.kind === 'limit_reached'
            ? `No figures: ${monthly ? 'this month’s' : 'today’s'} limit is reached` : 'New figures paused until next month'));
          if (notice.upgrade) box.appendChild(actionButton('Upgrade', 'upgrade', 'More searches with figures on Pro.'));
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
      else {
        box.appendChild(el('span', 'sbw-fig-note', words.text));
        if (RETRY_CODES.includes(code)) box.appendChild(actionButton('Try again', 'load'));
      }
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
    scheduleTable();
  }

  // Asks the worker for the figures of every result that has none yet.
  // `force`: a click on "Load figures" or "Show figures".
  function loadFigures(force) {
    if (force) figuresWanted = true;
    // 1.13.3: not before the worker has said whether this is a study tab,
    // and never in one.
    if (!studyKnown) { unlessStudy(() => loadFigures(false)); return; }
    if (studyInfo) return;
    if (!settings.overlay || !settings.figuresOn) return;
    if (settings.load === 'click' && !figuresWanted) { renderAllFigures(); return; }
    if (force) askedKeys.clear();
    const rows = Array.from(rowsByKey.values())
      .filter((r) => !figuresByKey.has(r._key) && !pendingKeys.has(r._key) && !askedKeys.has(r._key));
    const items = F.requestItems(rows, currentQuery());
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
        scheduleRetry(items, reply.code, reply.retryAfter);
      } else {
        figState = { state: reply.state };
      }
      renderAllFigures();
    });
    if (!sent) items.forEach((i) => pendingKeys.delete(i.key));
  }

  // A 429, a busy site or no connection: ask again for the results that got
  // nothing, after Retry-After or a growing pause, at most MAX_RETRIES times
  // a page.
  function scheduleRetry(items, code, retryAfter) {
    if (!RETRY_CODES.includes(code) || retries >= MAX_RETRIES || retryTimer) return;
    retries += 1;
    const wait = code === 'rate_limited' && Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 30000 * retries;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      items.forEach((i) => { if (!figuresByKey.has(i.key)) askedKeys.delete(i.key); });
      loadFigures(false);
    }, wait);
  }

  // ---------- the page's checks under a result (1.12.0) ----------
  //
  // Analyze opens a row under the result with the page's checks, read from
  // its HTML in the user's browser (src/lib/serp-page-check.js); no tab
  // opens. Keyed by the result (row._key), so a rescan that rebuilds rows
  // finds it again. Until 1.12.0 (1.10.2's) Analyze opened the result in a
  // background tab and put one checklist line here.
  const checkRows = new Map(); // key -> element
  const barsByKey = new Map(); // key -> bar

  const CHECKLIST_TITLE = "SEO Bandwagon's on-page checklist for this page: title, description, headings, images, links, schema and the other checks in the report. " +
    'It is not a ranking factor and does not predict where a page ranks.';

  const CHECK_ERRORS = {
    timeout: "The page didn't answer within 20 seconds.",
    network: "The page couldn't be reached from your browser.",
    not_html: "This result isn't a web page, so there is no HTML to check.",
    unreadable: "Couldn't read this page's HTML.",
    invalid_url: 'This address isn\u2019t one Analyze reads: a local or private address, or a Google page.',
    blocked_redirect: 'This page redirected to a local or private address, so it wasn\u2019t read.',
    // The worker names its browser with each page check (src/lib/browser.js,
    // which this content script doesn't load).
    unprotected: (browser) => `${browser || 'The browser'} didn\u2019t accept the rule that keeps Analyze off local addresses, so the page wasn\u2019t read. Reload this page to try again.`,
    unavailable: 'SEO Bandwagon was updated or reloaded. Reload this page to analyze.',
    failed: "Couldn't check this page."
  };

  // Results Google hides from a signed-out user can't be checked: their
  // address is behind Google's redirect, which is never followed for them.
  function isHidden(row) {
    return !!(row && (row.siteUnknown || row.urlResolved === false || !/^https?:\/\//i.test(row.url || '')));
  }

  // Sends the rows to the worker for their page checks; false when the
  // extension can't be reached (reloaded under this page).
  function analyzeRows(rows) {
    const items = [];
    rows.forEach((row) => {
      const key = row._key || row.url;
      if (isHidden(row)) setCheck(key, { state: 'hidden' });
      else items.push({ key, url: row.url });
    });
    if (!items.length) return true;
    items.forEach((i) => setCheck(i.key, { state: 'working' }));
    return send({ action: 'serpPageCheck', items }, (reply, failed) => {
      if (failed || !reply) items.forEach((i) => setCheck(i.key, { state: 'error', code: 'unavailable' }));
      else if (reply.state === 'needs_access') items.forEach((i) => setCheck(i.key, { state: 'needs_access' }));
    });
  }

  function setCheck(key, msg) {
    const before = checksByKey.get(key);
    // A later "working" never hides a row already read.
    if (msg.state === 'working' && before && before.state === 'done') return;
    checksByKey.set(key, msg);
    renderCheck(key);
    scheduleTable();
    renderAnalyzeLine();
  }

  function checkRowFor(key) {
    let line = checkRows.get(key);
    if (line && line.isConnected) return line;
    const bar = barsByKey.get(key);
    if (!bar || !bar.isConnected) return null;
    line = el('div', 'sbw-serp-check');
    line.setAttribute('data-sbw-look', lookName());
    line.setAttribute('role', 'region');
    bar.insertAdjacentElement('afterend', line);
    checkRows.set(key, line);
    return line;
  }

  function item(dl, label, value, flag, title) {
    const wrap = el('div', 'sbw-check-item');
    if (flag) wrap.setAttribute('data-flag', flag);
    wrap.appendChild(el('dt', null, label));
    const dd = el('dd', null, value);
    if (title) dd.title = title;
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  }

  function hostPath(url) {
    try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname); } catch (e) { return url; }
  }

  function smallButton(label, onClick, title) {
    const b = el('button', 'sbw-serp-open', label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderCheck(key) {
    if (/^(pin|ai):/.test(key)) return;
    const msg = checksByKey.get(key);
    const row = rowsByKey.get(key);
    const line = msg ? checkRowFor(key) : null;
    if (!line) return;
    line.textContent = '';
    line.setAttribute('data-state', msg.state || '');
    line.setAttribute('aria-label', `Page checks for ${row && row.domain ? row.domain : 'this result'}`);
    const head = el('div', 'sbw-check-head');
    line.appendChild(head);
    const text = (t) => { const span = el('span', 'sbw-serp-analysis-text', t); head.appendChild(span); return span; };
    const close = smallButton('Close', () => { checksByKey.delete(key); line.remove(); checkRows.delete(key); scheduleTable(); }, 'Hide these checks');

    if (msg.state === 'working') {
      text('Checking the page from its HTML…');
    } else if (msg.state === 'hidden') {
      text('Google hides this result’s address while you’re signed out of Google, so it can’t be checked here. Sign in to Google, or open the result.');
      if (row && row._href) {
        const a = el('a', 'sbw-serp-open sbw-link', 'Open the result');
        a.href = row._href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        head.appendChild(a);
      }
      head.appendChild(close);
    } else if (msg.state === 'needs_access') {
      text('Allow access in the SEO Bandwagon window that opened, and this page is checked here; you stay on Google.');
    } else if (msg.state === 'declined') {
      text('Analyze needs access to other sites to read the page. Click Analyze to ask again.');
      head.appendChild(close);
    } else if (msg.state === 'done' && msg.row) {
      renderCheckRow(line, head, msg.row, row, close);
    } else {
      const words = CHECK_ERRORS[msg.code] || CHECK_ERRORS.failed;
      text(typeof words === 'function' ? words(msg.browser) : words);
      head.appendChild(close);
    }
  }

  function renderCheckRow(line, head, c, row, close) {
    const title = el('span', 'sbw-check-title', 'Page checks');
    head.appendChild(title);
    const when = c.checkedAt ? new Date(c.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const note = el('span', 'sbw-check-src', `from the page’s HTML${when ? `, ${when}` : ''}${c.truncated ? ', first 3 MB' : ''}`);
    note.title = 'Read from the HTML the page sends, without your cookies and without running its scripts. Full report opens the page for the analysis of it as a browser shows it.';
    head.appendChild(note);
    head.appendChild(smallButton('Full report', () => {
      send({ action: 'analyzeResult', url: (row && (row._href || row.url)) || c.url });
    }, 'Opens the page in a new tab with the full analysis of it as your browser draws it.'));
    head.appendChild(close);

    const dl = el('dl', 'sbw-check-grid');
    const t = c.title || {};
    item(dl, 'Title', t.text ? `${t.chars} chars${typeof t.px === 'number' ? ` · ${t.px} px` : ''}${t.cut ? ', cut' : ''}` : 'missing',
      !t.text || t.cut || t.count > 1 ? 'warn' : 'ok', t.text ? `${t.text}${t.cut ? '\nGoogle cuts titles at about 600 px.' : ''}` : '');
    const d = c.description || {};
    item(dl, 'Description', d.text ? `${d.chars} chars${typeof d.px === 'number' ? ` · ${d.px} px` : ''}${d.cut ? ', cut' : ''}` : 'missing',
      !d.text || d.cut ? 'warn' : 'ok', d.text || '');
    item(dl, 'H1', c.h1 && c.h1.count ? `${c.h1.count}${c.h1.first ? ` · ${c.h1.first.slice(0, 60)}` : ''}` : 'missing',
      c.h1 && c.h1.count === 1 ? 'ok' : 'warn', c.h1 ? c.h1.first : '');
    item(dl, 'Words', typeof c.words === 'number' ? c.words.toLocaleString('en-US') : 'not read', null,
      'Counted in the HTML; a page built by scripts can have more once drawn.');
    item(dl, 'Schema', c.schema && c.schema.length ? c.schema.slice(0, 4).join(', ') + (c.schema.length > 4 ? ` +${c.schema.length - 4}` : '') : 'none',
      c.schema && c.schema.length ? 'ok' : null, c.schema ? c.schema.join(', ') : '');
    const can = c.canonical || {};
    item(dl, 'Canonical', !can.href ? 'none' : can.target === 'self' ? 'points to itself' : 'points elsewhere',
      can.target === 'elsewhere' || can.count > 1 ? 'warn' : can.href ? 'ok' : null, can.href || '');
    const ix = c.indexable || { ok: true, reasons: [] };
    item(dl, 'Indexable', ix.ok ? 'yes' : `no: ${ix.reasons.join('; ')}`, ix.ok ? 'ok' : 'bad');
    item(dl, 'Status', `${c.status || '?'}${c.redirected ? ` · redirected to ${hostPath(c.finalUrl)}` : ''}`,
      c.status >= 200 && c.status < 300 ? (c.redirected ? 'warn' : 'ok') : 'bad', c.finalUrl || '');
    item(dl, 'Hreflang', c.hreflang && c.hreflang.count ? `${c.hreflang.count} tag${c.hreflang.count === 1 ? '' : 's'}${c.hreflang.issues.length ? ` · ${c.hreflang.issues.length} issue${c.hreflang.issues.length === 1 ? '' : 's'}` : ''}` : 'none',
      c.hreflang && c.hreflang.issues.length ? 'warn' : null, c.hreflang ? c.hreflang.issues.join('\n') : '');
    item(dl, 'Technology', c.tech && c.tech.length ? c.tech.slice(0, 4).join(', ') : 'none found', null, c.tech ? c.tech.join(', ') : '');
    const rb = c.robots;
    item(dl, 'AI crawlers', !rb ? 'not read' : !rb.found ? 'no robots.txt: none blocked' : rb.blocked.length ? `blocked: ${rb.blocked.slice(0, 3).join(', ')}${rb.blocked.length > 3 ? ` +${rb.blocked.length - 3}` : ''}` : 'none blocked',
      rb && rb.blocked && rb.blocked.length ? 'warn' : null,
      rb && rb.found ? `From the site's robots.txt, for this page. Blocked: ${rb.blocked.join(', ') || 'none'}. Allowed: ${rb.allowed.join(', ') || 'none'}.` : '');
    item(dl, 'llms.txt', c.llms ? (c.llms.found ? 'yes' : 'no') : 'not read', null, 'Whether the site has an /llms.txt file for AI assistants.');
    const ck = c.checklist || {};
    const ckText = typeof ck.score === 'number' ? `${ck.score}/100${ck.grade ? ` (${ck.grade})` : ''} · ${ck.issues} issue${ck.issues === 1 ? '' : 's'}` : 'not scored';
    item(dl, 'On-page checklist', ckText, null, CHECKLIST_TITLE + (ck.top && ck.top.length ? `\nFirst issues: ${ck.top.join('; ')}.` : ''));
    line.appendChild(dl);
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
    if (!overlayOn()) return;
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
      renderStudy(rows.length);
    }
    if (settings.figuresOn && (settings.load === 'auto' || figuresWanted)) loadFigures(false);
  }

  // The rows as exported: each with the figures it was given and whether
  // it is one of the person's sites (Options).
  function exportRows(rows) {
    const kv = keywordsView();
    return rows.map((r) => Object.assign({}, r, {
      figures: figuresByKey.get(r._key) || undefined,
      ownSite: !r.siteUnknown && Settings.isOwnSite(r.domain, settings.ownSites),
      // 1.13.0: where the person's rank tracker last saw this site.
      trackedPosition: kv && !r.siteUnknown ? kv.trackedPositionFor(r.domain) : null
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
          context: S.collectContext(now)
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
    // 1.13.0: the search's keyword data, where loaded (blank where not).
    const kv = keywordsView();
    if (kv) Object.assign(ctx, kv.exportContext());
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

  // The panel's figures line: the plan and what is left of its allowance
  // (today's, or this month's on Free) from the last answer, what stopped
  // new figures, or how to get them.
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
    if (studyInfo || figState.state === 'study_tab') {
      box.textContent = 'Figures are off in a study search.';
    } else if (!settings.figuresOn) {
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
      short = line ? line.replace(/ searches with new figures left (today|this month) \(UTC\)\./, ' left $1') : '';
    } else if (figState.state === 'loading') {
      box.textContent = 'Loading figures…';
    } else if (figState.state === 'no_key' || figState.state === 'needs_consent' || figState.state === 'error') {
      const words = F.errorWords(figState.state === 'error' ? figState.code : figState.state);
      box.textContent = words.text + '.';
      if (words.action === 'connect') actions.appendChild(actionButton(figState.state === 'no_key' ? 'Connect free' : 'Reconnect', 'connect'));
      if (words.action === 'settings') actions.appendChild(actionButton('Turn on figures', 'settings'));
      if (figState.state === 'error' && RETRY_CODES.includes(figState.code)) actions.appendChild(actionButton('Try again', 'load'));
      short = figState.state === 'no_key' ? 'Connect free to see figures' : '';
    } else if (settings.load === 'click' && !figuresWanted) {
      box.textContent = 'Figures load when you ask for them.';
      actions.appendChild(actionButton('Load figures', 'load'));
    }
    if (summary) summary.textContent = short;
  }

  // ---------- the AI Overview study's group (1.13.3) ----------

  const AI_LINES = {
    loaded: 'AI Overview: loaded',
    none: 'AI Overview: none on this page',
    empty: "AI Overview: hasn't loaded yet. Wait for it, or send the page as it is."
  };

  function studyButton(role, label, onClick) {
    const b = el('button', 'sbw-btn', label);
    b.type = 'button';
    b.setAttribute('data-role', role);
    b.addEventListener('click', onClick);
    return b;
  }

  function studyLine(role) {
    const p = el('p', 'sbw-study-line');
    p.setAttribute('data-role', role);
    return p;
  }

  // The group is the first in the panel, built once the worker has said
  // this is a study tab and the panel exists.
  function ensureStudyGroup() {
    if (!studyInfo || !toolbarEl) return;
    if (toolbarEl.querySelector('[data-group="study"]')) { renderStudy(); return; }
    const body = toolbarEl.querySelector('[data-role="body"]');
    if (!body) return;
    const status = studyLine('study-status');
    status.classList.add('sbw-study-status');
    status.setAttribute('role', 'status');
    const sendBtn = studyButton('study-send', 'Send to study', studySend);
    sendBtn.classList.add('sbw-study-send');
    const g = group('study', 'AI Overview study',
      studyLine('study-term'), studyLine('study-ai'),
      sendBtn, studyButton('study-stop', A.STOP_LABEL, studyStop), status);
    body.insertBefore(g, body.querySelector('[data-group="figures"]') || body.firstChild);
    renderStudy();
  }

  // The worker answered that the list can't be had for now (the site's limit
  // on requests, or the site itself), so the term's status is unknown: not
  // the same as a term that isn't on the list. Send to study stays on, and
  // the worker checks the list again when it is clicked.
  function studyListLate() {
    return studyInfo.status === null && (studyInfo.today === 'rate_limited' || studyInfo.today === 'unavailable');
  }

  // Why the page can't be sent now, as a code `words` knows, or null.
  function studyBlocked(rowCount) {
    if (!studyInfo.termId) return 'not_study_tab';
    if (!studyInfo.accepted) return 'not_accepted';
    if (!studyInfo.page.ok) return studyInfo.page.reason;
    if (studyInfo.status === 'sent') return 'already_sent';
    if (studyInfo.status === null && !studyListLate()) return 'not_on_list';
    if (!rowCount) return 'empty';
    return null;
  }

  // `rowCount`: how many results the scan just read, where it is known.
  function renderStudy(rowCount) {
    if (!studyInfo || !toolbarEl) return;
    const g = toolbarEl.querySelector('[data-group="study"]');
    if (!g) return;
    const text = (role, value) => {
      const n = g.querySelector(`[data-role="${role}"]`);
      if (n && n.textContent !== value) n.textContent = value;
    };
    text('study-term', 'Term: ' + studyInfo.keyword);
    text('study-ai', AI_LINES[S.aiOverviewState(document)] || AI_LINES.none);

    const sendBtn = g.querySelector('[data-role="study-send"]');
    const stopBtn = g.querySelector('[data-role="study-stop"]');
    const blocked = studyBlocked(rowCount === undefined ? S.parseResults(document).length : rowCount);
    let status = '';
    if (studyOutcome) status = words(studyOutcome.state);
    else if (blocked) status = words(blocked);
    else if (studyListLate()) status = words(studyInfo.today);
    text('study-status', status);
    if (sendBtn) {
      sendBtn.textContent = studySent ? 'Sent' : 'Send to study';
      sendBtn.disabled = studySent || studyBusy || !!blocked;
    }
    if (stopBtn) {
      stopBtn.textContent = studyStopTimer !== null ? A.STOP_CONFIRM_LABEL : A.STOP_LABEL;
      stopBtn.disabled = studyBusy || studyStopped;
    }
  }

  // The page as the study takes it: this page's results and search context
  // only, with none of the figures, keyword data or "your site" marks that
  // Export CSV adds (the account's and settings' own).
  function studyCsv(rows) {
    return S.resultsToCsv(
      rows.map((r) => Object.assign({}, r, { figures: undefined, ownSite: false, trackedPosition: null })),
      S.searchContext(window.location, document)
    );
  }

  function studySend(e) {
    if (!trusted(e) || !studyInfo || studyBusy || studySent) return;
    const rows = S.parseResults(document);
    if (studyBlocked(rows.length)) { renderStudy(); return; }
    const csv = studyCsv(rows);
    studyBusy = true;
    studyOutcome = null;
    renderStudy();
    send({ action: 'aioStudySend', termId: studyInfo.termId, csv }, (reply, failed) => {
      studyBusy = false;
      const state = failed || !reply || typeof reply.state !== 'string' ? 'error' : reply.state;
      studyOutcome = { state };
      if (state === 'sent' || state === 'already_sent') studySent = true;
      renderStudy();
    });
  }

  // A stop moves the day's other terms to tomorrow, so the first click only
  // asks (the button says so for a few seconds) and the second records it.
  function studyStop(e) {
    if (!trusted(e) || !studyInfo || studyBusy || studyStopped) return;
    if (studyStopTimer === null) {
      studyStopTimer = setTimeout(() => { studyStopTimer = null; renderStudy(); }, A.STOP_CONFIRM_MS);
      renderStudy();
      return;
    }
    clearTimeout(studyStopTimer);
    studyStopTimer = null;
    studyBusy = true;
    studyOutcome = null;
    renderStudy();
    send({ action: 'aioStudyStop' }, (reply, failed) => {
      studyBusy = false;
      const state = failed || !reply || typeof reply.state !== 'string' ? 'error' : reply.state;
      studyOutcome = { state };
      if (state === 'stopped') studyStopped = true;
      renderStudy();
    });
  }

  // The worker said this is a study tab: no figures on the bars, the figures
  // line says so, and the panel gets its group. Nothing was asked before.
  function onStudyKnown() {
    if (!studyInfo) return;
    renderAllFigures();
    // The bars and the panel, even with "Show on Google results" off: the
    // scan that init ran when it read that setting stood down.
    if (!settings.overlay) processResults();
    // At the top, and open, whatever the person set or left in another tab:
    // the group with Send to study is in it. A click on Hide still folds it.
    placePanel();
    if (toolbarEl) setCollapsed(false);
    ensureStudyGroup();
    // The AI Overview often arrives after the results, and may sit outside
    // the results container the rescan watches: watch the page for it.
    if (typeof MutationObserver !== 'undefined' && document.body) {
      new MutationObserver((records) => {
        if (records.every(isOwnMutation)) return;
        if (studyTimer) clearTimeout(studyTimer);
        studyTimer = setTimeout(() => renderStudy(), DEBOUNCE_MS);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  // ---------- Analyze top 10, the table, AI Overview sources (1.12.0) ----------

  function currentRows() {
    return S.parseResults(document);
  }

  function renderAnalyzeLine() {
    if (!toolbarEl) return;
    const line = toolbarEl.querySelector('[data-role="analyze-line"]');
    if (!line) return;
    const rows = currentRows().slice(0, 10);
    const states = rows.map((r) => (checksByKey.get(r._key) || {}).state);
    const done = states.filter((st) => st === 'done').length;
    const working = states.filter((st) => st === 'working').length;
    const hidden = states.filter((st) => st === 'hidden').length;
    const waiting = states.filter((st) => st === 'needs_access').length;
    if (waiting) line.textContent = 'Allow access in the SEO Bandwagon window that opened; the pages are checked once you do.';
    else if (working) line.textContent = `Checking ${working} page${working === 1 ? '' : 's'}, three at a time… ${done} done.`;
    else if (done || hidden) line.textContent = `${done} of ${rows.length} checked from their HTML${hidden ? `; ${hidden} hidden by Google while you're signed out of it` : ''}.`;
    else line.textContent = 'Checks each result’s page from its HTML, in your browser, without your cookies. Nothing is sent to SEO Bandwagon.';
  }

  function scheduleTable() {
    if (tableTimer) return;
    tableTimer = setTimeout(() => { tableTimer = null; renderTable(); renderSources(); }, 60);
  }

  function figuresOf(key) { return figuresByKey.get(key) || null; }
  function checkOf(key) { const c = checksByKey.get(key); return c && c.state === 'done' ? c.row : null; }

  function pinnedRecord() {
    if (!pinned) return null;
    const check = checkOf(pinned.key);
    // Its own title and description stand in for what Google would show,
    // so the words columns compare like with like (blank until checked).
    const row = { position: null, url: pinned.url, domain: hostOf(pinned.url), title: (check && check.title.text) || pinned.url, snippet: check && check.description ? check.description.text : '' };
    Object.defineProperty(row, '_key', { value: pinned.key, enumerable: false });
    return T.records([row], currentQuery(), figuresOf, checkOf)[0];
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function markTitle(col, rec, base, mark, against) {
    const v = T.cellText(col, rec);
    const b = typeof base !== 'number' ? ''
      : col.key === 'age' ? `${Math.round(base)}y`
        : /^in[A-Z]/.test(col.key) ? `${Math.round(base * 100)}% of the words`
          : F.compact(base);
    return `${v} is ${mark === 'above' ? 'above' : 'below'} ${against}${b ? ` (${b})` : ''}.`;
  }

  // One table: `recs` its records, `cols` its columns, `pin` the pinned
  // record or null. Cells are marked ▲ above / ▼ below the baseline, never
  // by color alone.
  function buildTable(recs, cols, pin, caption) {
    const useInc = settings.compareTo === 'pinned' && pin;
    const base = T.baselines(recs, useInc ? pin : null);
    const against = useInc ? 'your page' : 'the median of these results';
    const table = el('table', 'sbw-table');
    if (caption) { const cap = el('caption', 'sbw-table-caption', caption); table.appendChild(cap); }
    const thead = el('thead');
    const hr = el('tr');
    cols.forEach((col) => {
      const th = el('th');
      th.scope = 'col';
      if (col.key === 'result') th.className = 'sbw-th-text';
      if (sortKey === col.key) th.setAttribute('aria-sort', sortDir === 'desc' ? 'descending' : 'ascending');
      const b = el('button', 'sbw-th', col.label);
      b.type = 'button';
      b.title = (col.title || col.label) + (col.source ? ` (${col.source})` : '') + '. Click to sort.';
      b.addEventListener('click', () => {
        sortDir = sortKey === col.key && sortDir === 'asc' ? 'desc' : 'asc';
        sortKey = col.key;
        scheduleTable();
      });
      th.appendChild(b);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    const ordered = sortKey ? T.sortRecords(recs, sortKey, sortDir) : recs;
    const rowsOut = pin ? [Object.assign({ pinnedRow: true }, pin)].concat(ordered) : ordered;
    rowsOut.forEach((rec) => {
      const tr = el('tr');
      if (rec.pinnedRow) tr.setAttribute('data-pinned', 'true');
      if (!rec.pinnedRow && rec.row.domain && Settings.isOwnSite(rec.row.domain, settings.ownSites)) tr.setAttribute('data-own', 'true');
      cols.forEach((col) => {
        const td = el(col.key === 'result' ? 'th' : 'td');
        if (col.key === 'result') {
          td.scope = 'row';
          const href = rec.row._href || rec.row.url;
          const a = el('a', 'sbw-table-link', (rec.pinnedRow ? 'Your page: ' : '') + (rec.row.title || rec.row.domain || 'unknown site'));
          if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          td.appendChild(a);
          td.appendChild(el('span', 'sbw-table-host', rec.row.domain || ''));
        } else {
          td.textContent = T.cellText(col, rec);
          const value = col.value(rec);
          const m = rec.pinnedRow && useInc ? null : T.mark(value, base[col.key]);
          // Marked only where higher is better: a title longer than the
          // median, or a later position, is neither good nor bad.
          if (m && m !== 'same' && col.better) {
            td.setAttribute('data-mark', m);
            if (col.better) td.setAttribute('data-better', col.better);
            const glyph = el('span', 'sbw-mark', m === 'above' ? ' ▲' : ' ▼');
            glyph.setAttribute('aria-hidden', 'true');
            td.appendChild(glyph);
            td.title = markTitle(col, rec, base[col.key], m, against);
          }
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderTable() {
    if (!toolbarEl) return;
    const box = toolbarEl.querySelector('[data-role="table"]');
    if (!box) return;
    const rows = currentRows();
    const recs = T.records(rows, currentQuery(), figuresOf, checkOf);
    const cols = T.columnsChosen(settings.tableColumns);
    box.textContent = '';
    if (!rows.length) return;
    const scroll = el('div', 'sbw-table-wrap');
    scroll.setAttribute('tabindex', '0');
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Results table');
    scroll.appendChild(buildTable(recs, cols, pinnedRecord(), null));
    box.appendChild(scroll);
    const legend = el('p', 'sbw-table-note',
      `▲ above and ▼ below ${settings.compareTo === 'pinned' && pinned ? 'your pinned page' : 'the median of these results'}. ` +
      'Link and traffic figures are DataForSEO’s (rank 0 to 100), domain age RDAP’s; Words, Schema and Checklist come from Analyze.');
    box.appendChild(legend);
  }

  function tableCsv() {
    const recs = T.records(currentRows(), currentQuery(), figuresOf, checkOf);
    const pin = pinnedRecord();
    return T.toCsv(pin ? [pin].concat(recs) : recs, settings.tableColumns, { query: currentQuery() });
  }

  // The pinned page: its checks from its HTML, and with figures on and
  // accepted, its figures, asked for on the Pin click only.
  function pinPage(url, btn) {
    let u;
    try { u = new URL(url.trim()); } catch (e) { flashLabel(btn, 'Type a full address'); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { flashLabel(btn, 'Type a full address'); return; }
    u.hash = '';
    pinned = { url: u.href, key: 'pin:' + u.href };
    send({ action: 'serpPageCheck', items: [{ key: pinned.key, url: pinned.url }] }, (reply) => {
      if (reply && reply.state === 'needs_access') setCheck(pinned.key, { state: 'needs_access' });
    });
    if (settings.figuresOn) loadExtraFigures([{ key: pinned.key, url: pinned.url, domain: hostOf(pinned.url) }]);
    scheduleTable();
  }

  // Figures for addresses that aren't results (a pinned page, the AI
  // Overview's sources), on the person's click. Same route, same consent.
  function loadExtraFigures(items, done) {
    // 1.13.3: not before the worker has said whether this is a study tab,
    // and never in one.
    if (!studyKnown) { unlessStudy(() => loadExtraFigures(items, done)); return; }
    if (studyInfo) return;
    // The same cleaning as the results': no fragment, no part of the search.
    const list = items.filter((i) => i.domain).map((i) => {
      const url = F.cleanAddress(i.url, i.domain, currentQuery());
      return url ? { key: i.key, url, domain: i.domain } : { key: i.key, url: null, domain: i.domain };
    });
    if (!list.length) return;
    send({ action: 'serpFigures', items: list }, (reply) => {
      if (reply && (reply.state === 'ok' || reply.state === 'error')) {
        Object.entries(reply.results || {}).forEach(([key, figures]) => figuresByKey.set(key, figures));
        if (reply.state === 'ok') figState = Object.assign({}, figState, { plan: reply.plan, allowance: reply.allowance, lookups: reply.lookups, notice: reply.notice });
      } else if (reply && reply.state) {
        figState = { state: reply.state };
      }
      renderFiguresLine();
      scheduleTable();
      if (done) done(reply);
    });
  }

  function sourceRows() {
    return S.aiOverviewCitations(document).map((c, i) => {
      const row = { position: i + 1, url: c.url, domain: c.domain, title: c.title || c.url };
      Object.defineProperty(row, '_key', { value: 'ai:' + c.url, enumerable: false });
      return row;
    });
  }

  const SOURCE_COLUMNS = ['pos', 'result', 'pageRD', 'pageRank', 'pageTraffic', 'siteRank', 'siteRD', 'age', 'words', 'schema', 'checklist'];

  function renderSources() {
    if (!toolbarEl) return;
    const group = toolbarEl.querySelector('[data-group="sources"]');
    const box = toolbarEl.querySelector('[data-role="sources"]');
    if (!group || !box) return;
    const rows = sourceRows();
    group.hidden = !rows.length;
    box.textContent = '';
    if (!rows.length) return;
    const recs = T.records(rows, currentQuery(), figuresOf, checkOf);
    const cols = SOURCE_COLUMNS.map((k) => T.COLUMNS.find((c) => c.key === k)).filter((c) => settings.tableColumns[c.key] !== false || c.key === 'result');
    const scroll = el('div', 'sbw-table-wrap');
    scroll.setAttribute('tabindex', '0');
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'AI Overview sources');
    scroll.appendChild(buildTable(recs, cols, null, null));
    box.appendChild(scroll);
  }

  function sourcesCsv() {
    const rows = sourceRows();
    const cols = {};
    T.COLUMNS.forEach((c) => { cols[c.key] = SOURCE_COLUMNS.includes(c.key); });
    return T.toCsv(T.records(rows, currentQuery(), figuresOf, checkOf), cols, { query: currentQuery() });
  }

  function downloadText(text, name) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.className = 'sbw-download';
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function placePanel() {
    if (!toolbarEl) return;
    const container = resultsContainer();
    if (!container || !container.parentNode) return;
    // A study tab has it at the top whatever the setting, so Send to study
    // is in view without scrolling past the results.
    const placement = studyInfo ? 'top' : settings.placement;
    toolbarEl.setAttribute('data-placement', placement);
    // At the top the panel goes above the results and pushes them down;
    // at the bottom, after them, as the toolbar always was. Never over them.
    const where = placement === 'top' ? 'beforebegin' : 'afterend';
    const sibling = placement === 'top' ? container.previousElementSibling : container.nextElementSibling;
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

    // 1.12.0: Analyze top 10, the table and the AI Overview's sources.
    const top10 = el('button', 'sbw-btn', 'Analyze top 10');
    top10.type = 'button';
    top10.title = 'Checks the page of every result here from its HTML, three at a time; no tab opens.';
    top10.addEventListener('click', () => {
      const rows = currentRows().slice(0, 10);
      if (!rows.length) { flashLabel(top10, 'No results found'); return; }
      if (!analyzeRows(rows)) flashLabel(top10, 'Reload this page');
    });
    const analyzeLine = el('p', 'sbw-figures-line');
    analyzeLine.setAttribute('data-role', 'analyze-line');
    analyzeLine.setAttribute('role', 'status');
    body.appendChild(group('analyze', 'Analyze', top10, analyzeLine));

    const pinInput = document.createElement('input');
    pinInput.type = 'url';
    pinInput.className = 'sbw-serp-location-custom sbw-pin-input';
    pinInput.placeholder = 'Your page, e.g. https://example.com/plumbing';
    pinInput.setAttribute('aria-label', 'Your page, to compare with the results');
    const ownRow = currentRows().find((r) => !r.siteUnknown && Settings.isOwnSite(r.domain, settings.ownSites));
    if (ownRow && ownRow.url) pinInput.value = ownRow.url;
    const pinBtn = el('button', 'sbw-btn', 'Pin');
    pinBtn.type = 'button';
    pinBtn.title = 'Adds your page as the first row: checked from its HTML in your browser, and with figures on, its figures from SEO Bandwagon, as for the results.';
    pinBtn.addEventListener('click', () => pinPage(pinInput.value, pinBtn));
    const exportTable = el('button', 'sbw-btn', 'Export table CSV');
    exportTable.type = 'button';
    exportTable.addEventListener('click', () => {
      if (!currentRows().length) { flashLabel(exportTable, 'No results found'); return; }
      const ctx = pageContext();
      downloadText(tableCsv(), csvFilename(ctx.query, ctx.page).replace(/^serp-/, 'serp-table-'));
    });
    const tableBox = el('div', 'sbw-table-box');
    tableBox.setAttribute('data-role', 'table');
    body.appendChild(group('table', 'Table', pinInput, pinBtn, exportTable, tableBox));

    const loadSources = el('button', 'sbw-btn', 'Load figures for sources');
    loadSources.type = 'button';
    loadSources.title = 'Asks SEO Bandwagon for the figures of the pages the AI Overview cites; with new figures, it counts as one search of your allowance.';
    loadSources.addEventListener('click', () => {
      if (studyInfo) { flashLabel(loadSources, 'Off in a study search'); return; }
      if (!settings.figuresOn) { flashLabel(loadSources, 'Figures are off'); return; }
      loadExtraFigures(sourceRows().map((r) => ({ key: r._key, url: r.url, domain: r.domain })));
    });
    const analyzeSources = el('button', 'sbw-btn', 'Analyze sources');
    analyzeSources.type = 'button';
    analyzeSources.addEventListener('click', () => {
      const items = sourceRows().map((r) => ({ key: r._key, url: r.url }));
      items.forEach((i) => checksByKey.set(i.key, { state: 'working' }));
      send({ action: 'serpPageCheck', items });
      scheduleTable();
    });
    const exportSources = el('button', 'sbw-btn', 'Export sources CSV');
    exportSources.type = 'button';
    exportSources.addEventListener('click', () => {
      if (!sourceRows().length) { flashLabel(exportSources, 'No sources'); return; }
      const ctx = pageContext();
      downloadText(sourcesCsv(), csvFilename(ctx.query, ctx.page).replace(/^serp-/, 'serp-ai-sources-'));
    });
    const sourcesBox = el('div', 'sbw-table-box');
    sourcesBox.setAttribute('data-role', 'sources');
    const sourcesGroup = group('sources', 'AI Overview sources', loadSources, analyzeSources, exportSources, sourcesBox);
    sourcesGroup.hidden = true;
    body.appendChild(sourcesGroup);

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
    setCollapsed(studyInfo ? false : settings.collapsed);
    renderFiguresLine();
    renderAnalyzeLine();
    ensureStudyGroup();
    scheduleTable();
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
    // Only a change to what is asked for asks again; folding the panel,
    // moving it or changing its look never re-sends anything.
    if (before.overlay !== next.overlay || before.figuresOn !== next.figuresOn || before.load !== next.load) askedKeys.clear();
    if (!overlayOn()) {
      document.querySelectorAll('.sbw-serp-bar, .sbw-serp-analysis, .sbw-serp-check, .sbw-serp-tools').forEach((n) => n.remove());
      toolbarEl = null;
      return;
    }
    if (!before.overlay && !studyInfo) {
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
    // A study tab's panel stays open, as renderToolbar leaves it.
    setCollapsed(studyInfo ? false : settings.collapsed);
    renderAllFigures();
    scheduleTable();
    if (settings.figuresOn && settings.load === 'auto') loadFigures(false);
  }

  function processResultsFresh() {
    barsByKey.clear();
    checkRows.clear();
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
  const OWN_SELECTOR = '.sbw-serp-bar, .sbw-serp-analysis, .sbw-serp-check, .sbw-serp-tools';

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
          } else if (area === 'local' && (changes.sbwConsent || changes.sbwAccountEpoch)) {
            // 1.13.7: an account change arrives as sbwAccountEpoch (src/lib/api.js),
            // written by the worker; content scripts can't see storage.sync.
            // Figures accepted or withdrawn in Options, or an account
            // connected: the open page asks again, without a reload. A new
            // account never shows the old one's figures (its checklist).
            askedKeys.clear();
            if (changes.sbwAccountEpoch) figuresByKey.clear();
            retries = 0;
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
  // promising bars it can't see. 1.12.0: the worker reports each page's
  // checks here ('serpPageChecked'). 1.11.0: the popup on a results page is this
  // page's panel: it asks for the search's features, the figures' state
  // and the exports ('serpExport'), and can load the figures.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'serpPageChecked' && typeof msg.key === 'string') {
        setCheck(msg.key, { state: msg.state, row: msg.row, code: msg.code, browser: msg.browser });
        return;
      }
      if (msg && msg.action === 'serpExport') {
        if (msg.kind === 'csv') sendResponse(resultsCsv());
        else if (msg.kind === 'tsv') sendResponse({ text: resultsTsv() });
        else if (msg.kind === 'paa') sendResponse({ text: S.paaToText(S.parsePaa(document)) || null });
        else if (msg.kind === 'ai') sendResponse({ text: S.aiOverviewCitations(document).map((c) => c.url).join('\n') || null });
        else if (msg.kind === 'keywords') sendResponse(keywordsView() ? keywordsView().keywordsCsv() : null);
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
        checked: rows.filter((r) => (checksByKey.get(r._key) || {}).state === 'done').length,
        features: S.detectFeatures(document),
        aiCitations: S.aiOverviewCitations(document).length,
        ownSites: rows.filter((r) => !r.siteUnknown && Settings.isOwnSite(r.domain, settings.ownSites)).map((r) => r.position),
        // 1.13.3: a tab the AI Overview study opened (the popup says figures
        // and keyword data are off there, and offers no Load figures).
        study: !!studyInfo,
        figures: {
          state: studyInfo ? 'study_tab' : figState.state,
          code: figState.code || null,
          loaded: rows.filter((r) => figuresByKey.has(r._key)).length,
          plan: figState.plan || null,
          allowance: figState.allowance || null,
          lookups: figState.lookups || null,
          notice: figState.notice || null
        },
        // 1.13.0: keyword data's state, for the popup.
        keywords: keywordsView() ? keywordsView().status() : null
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
