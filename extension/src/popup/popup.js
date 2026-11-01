// SEO Bandwagon Extension — Popup UI

let pageData = null;
let currentTab = null;

/* ---------- shared helpers (also used by citations-tab.js) ---------- */

function esc(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Status color for a 0-100 value: good >= 80, fair >= 60, else poor
function statusColor(pct) {
  if (pct >= 80) return 'var(--success)';
  if (pct >= 60) return 'var(--warning)';
  return 'var(--error)';
}
function statusClass(pct) {
  if (pct >= 80) return 'b-ok';
  if (pct >= 60) return 'b-warn';
  return 'b-err';
}

// Donut ring background for a 0-100 value
function ringStyle(pct) {
  const p = Math.max(0, Math.min(100, pct));
  return `conic-gradient(${statusColor(p)} 0% ${p}%, rgba(245,245,245,.1) ${p}% 100%)`;
}

function meter(pct, color) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="meter"><i style="width:${p}%;background:${color || statusColor(p)}"></i></div>`;
}

function dataRow(label, value, cls) {
  return `<div class="data-row">
    <span class="data-label">${esc(label)}</span>
    <span class="data-value${cls ? ' ' + cls : ''}">${value}</span>
  </div>`;
}

function badge(text, kind) {
  return `<span class="badge-mono${kind ? ' ' + kind : ''}">${esc(text)}</span>`;
}

function section(id, title, badgeHtml, body, open) {
  return `<div class="section${open ? ' open' : ''}" data-section="${id}">
    <div class="section-header">
      <span class="section-arrow">▸</span>
      <span class="section-title">${esc(title)}</span>
      ${badgeHtml || ''}
    </div>
    <div class="section-content">${body}</div>
  </div>`;
}

// Google SERP detection (Task 6, item D) — the same host+path shape as
// manifest.json's serp-overlay content_scripts entry. Analyzing a Google
// results page with the normal page analyzer is noise (it's not a page a
// client owns); src/overlay/serp-overlay.js is what actually runs there.
const GOOGLE_SERP_HOSTS = new Set([
  'www.google.com', 'www.google.co.uk', 'www.google.ca', 'www.google.com.au',
  'www.google.de', 'www.google.fr', 'www.google.es', 'www.google.it',
  'www.google.nl', 'www.google.co.in'
]);

function isGoogleSerpUrl(url) {
  try {
    const u = new URL(url);
    return GOOGLE_SERP_HOSTS.has(u.hostname.toLowerCase()) && u.pathname === '/search';
  } catch (e) {
    return false;
  }
}

// Shared with feature UI modules loaded after this file (src/popup/<feature>.js,
// e.g. link-check.js) so they render sections/badges the same way the main
// SEO tab does, and can post status/reach the active tab without duplicating
// this file's module-scoped state. setSeoStatus is a function declaration
// (hoisted), so this works even though it's defined further down the file.
globalThis.SBWPopup = { esc, section, badge, setSeoStatus, getCurrentTab: () => currentTab };

/* ---------- tab switching ---------- */

document.querySelectorAll('.switcher button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.switcher button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'citations' && typeof initCitationsTab === 'function') {
      initCitationsTab();
    }
  });
});

/* ---------- data collection toggle ---------- */

// Stamp the running build into the footer. Read from the manifest rather than
// hardcoded so it can never drift from what Chrome actually loaded.
function stampVersion(el) {
  if (!el) return;
  const m = chrome.runtime.getManifest();
  el.textContent = 'v' + m.version;
  el.title = m.version_name || ('Version ' + m.version);
}
stampVersion(document.getElementById('versionTag'));
// "Rate us" opens the store's reviews page, the same URL the one-time review
// prompt uses (src/lib/review-prompt.js), so there is one place to change it.
document.querySelectorAll('[data-review-link]').forEach(a => { a.href = SBWReview.REVIEW_URL; });

async function initDataToggle() {
  const toggle = document.getElementById('dataToggle');
  if (!toggle) return;
  const result = await chrome.storage.local.get('dataCollection');
  toggle.checked = result.dataCollection !== false;
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ dataCollection: toggle.checked });
  });
}
initDataToggle();

/* ---------- Google results page (#56) ---------- */

// Until 1.7.7 the popup always said "the SEO Bandwagon bar is shown under
// each result", even when the overlay had read nothing (as on the /goto pages
// of #41). Now it asks the overlay (serp-overlay.js 'serpStatus') and says
// what the page actually yielded, and where the toolbar is.
// #45: what's been collected for this search, read from session storage.
function describeCollection(tab) {
  let search = '';
  try { search = new URL(tab.url).search; } catch (e) { return; }
  chrome.runtime.sendMessage({ action: 'serpCollect', op: 'get', search }, (reply) => {
    void chrome.runtime.lastError;
    if (!reply || !reply.summary || !reply.summary.pages.length) return;
    const notice = document.querySelector('.sbw-serp-notice');
    if (!notice) return;
    const line = document.createElement('div');
    line.className = 'empty-sub';
    line.id = 'serpCollectText';
    line.textContent = 'Collected for this search: ' + reply.line + ' Export it with Export collected CSV below the results.';
    notice.append(line);
  });
}

function describeSerp(tabId) {
  chrome.tabs.sendMessage(tabId, { action: 'serpStatus' }, (status) => {
    void chrome.runtime.lastError; // no overlay on this page: keep the neutral line
    const el = document.getElementById('serpNoticeText');
    if (!el || !status || typeof status.rows !== 'number') return;
    if (status.rows > 0) {
      const n = status.rows;
      el.textContent = `Found ${n} result${n === 1 ? '' : 's'} on this page, each with an SEO Bandwagon bar under it. ` +
        'Copy results, Export CSV, Copy PAA and Collect pages are below the last result.';
    } else if (status.headings > 0) {
      el.textContent = "Couldn't read the results on this page. Google may have changed its layout; " +
        'please let us know at seobandwagon.com.';
    } else {
      el.textContent = 'No web results to read on this page (an Images, Videos or News tab, or no results).';
    }
  });
}

/* ---------- analysis bootstrap ---------- */

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  currentTab = tab;

  if (tab && tab.url && isGoogleSerpUrl(tab.url)) {
    document.getElementById('content').innerHTML = `
      <div class="empty sbw-serp-notice">
        <div class="empty-title">SEARCH RESULTS PAGE</div>
        <div class="empty-sub" id="serpNoticeText">This is a search results page.</div>
      </div>`;
    describeSerp(tab.id);
    describeCollection(tab);
    // Task 7, item E: the review strip's visibility is a pure function of
    // storage (analyses/prompted), never of what this popup open did or
    // didn't analyze — a SERP-page open still shows it if a prior analysis
    // already crossed the threshold.
    globalThis.SBWReviewUI?.renderFromStorage();
    return;
  }

  // Recorded before the analyze message even goes out, so it predates any
  // capture this popup instance is about to post — see loadDomainHistory's
  // excludeSince, which uses it to keep a just-posted capture from being
  // misread as "prior" history for the same URL.
  const analysisStartedAt = Date.now();

  // #129: Chrome's own pages, the new tab, other extensions' pages and the
  // Chrome Web Store can't be scripted. Say so without trying: a failed
  // injection left the analyze message with no listener, and Chrome listed
  // that "Receiving end does not exist" on chrome://extensions as an error.
  const fileAccess = /^file:/i.test(tab?.url || '')
    ? await new Promise((resolve) => chrome.extension.isAllowedFileSchemeAccess(resolve))
    : false;
  const unreadable = tab && globalThis.SBWAnalysisErrors.unreadablePage(tab.url, { fileAccess });
  if (unreadable) {
    showCantAnalyze(unreadable.title, unreadable.body);
    globalThis.SBWReviewUI?.renderFromStorage();
    return;
  }

  // Kept for the log below: a web page that still refuses the analyzer
  // (an error page, a page Chrome is still loading) is named by this, not
  // by the "Receiving end does not exist" that follows it.
  let injectError = null;

  try {
    const cached = await chrome.runtime.sendMessage({
      action: 'getCachedAnalysis',
      tabId: tab.id,
      url: tab.url
    });

    if (cached && cached.hit) {
      pageData = cached.data;
      renderResults(cached.data);
      loadDomainHistory(tab, cached.data, analysisStartedAt);
      // A cached-hit popup open is still a real analysis from the user's
      // point of view (they got a result), so it counts toward the
      // review-prompt threshold same as a fresh one below.
      globalThis.SBWReviewUI?.recordAnalysis();
      return;
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/content-analysis.js', 'lib/dom-extraction.js', 'src/lib/link-check.js', 'src/lib/hreflang.js', 'src/lib/structured-data.js', 'src/lib/analysis-errors.js', 'src/content/analyzer.js'] });
    } catch (e) {
      // Re-injecting is harmless (analyzer.js guards itself), so a throw here
      // means Chrome refused the tab.
      injectError = e;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
    // #63/#89: a PDF, an SVG or a sitemap, or an analysis that threw. Nothing
    // to score, cache or save.
    const problem = globalThis.SBWAnalysisErrors.describe(response);
    if (problem) {
      showCantAnalyze(problem.title, problem.body);
      globalThis.SBWReviewUI?.renderFromStorage();
      return;
    }
    pageData = response;
    renderResults(response);
    // Started before autoSaveCapture/syncCapture so the popup's own
    // capturesForUrl() read isn't racing its own POST for this exact
    // analysis (see loadDomainHistory's excludeSince param below); the
    // pure-logic filter in SBWDomainHistory.summarize() is the second,
    // ordering-independent guard against the same race.
    loadDomainHistory(tab, response, analysisStartedAt);
    autoSaveCapture(stripForStorage(response));
    globalThis.SBWReviewUI?.recordAnalysis();

    chrome.runtime.sendMessage({ action: 'storeAnalysis', tabId: tab.id, url: tab.url, data: response });

    if (response.seoScore) {
      chrome.runtime.sendMessage({
        action: 'updateBadge',
        score: response.seoScore.score,
        grade: response.seoScore.grade,
        tabId: tab.id
      });
    }
  } catch (err) {
    console.error('Analysis error:', injectError || err);
    // S29: a web page the extension has no access to, e.g. the tab "Analyze
    // linked page" opened (the toolbar click's activeTab grant isn't there).
    // Ask only from a click; nothing is read until the person allows it.
    if (tab && /^https?:/i.test(tab.url || '') && globalThis.SBWPerms && !(await SBWPerms.hasAllUrls().catch(() => true))) {
      showCantAnalyze('NO ACCESS TO THIS TAB YET', 'Click the SEO Bandwagon icon while on this tab, or allow the extension to analyze other tabs.');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lc-allow-btn';
      btn.id = 'popupAllowBtn';
      btn.textContent = 'Allow access to analyze other tabs';
      btn.addEventListener('click', async () => {
        if (await SBWPerms.requestAllUrls().catch(() => false)) location.reload();
      });
      document.querySelector('#content .empty').append(btn);
    } else {
      showCantAnalyze("CAN'T READ THIS PAGE", 'Chrome blocks analysis on internal pages. Try refreshing, then click again.');
    }
    // Never gated on this run's outcome (ruling, Task 7 item E) — an error
    // page still shows the strip if a prior analysis already qualified.
    globalThis.SBWReviewUI?.renderFromStorage();
  }
});

function showCantAnalyze(title, body) {
  document.getElementById('content').innerHTML = `
    <div class="empty">
      <div class="empty-glyph">⌸</div>
      <div class="empty-title">${esc(title)}</div>
      <div class="empty-sub">${esc(body)}</div>
    </div>`;
}

/* ---------- sub-scores derived from real analyzer data ---------- */

// The sub-scores moved to src/lib/sub-scores.js so the themed surfaces can
// show the same numbers without a second copy of the thresholds. Loaded as a
// classic <script> before this file (see popup.html).
function computeSubScores(data) {
  return globalThis.SBWSubScores.computeSubScores(data);
}

/* ---------- main renderer ---------- */

// The score's checks for this analysis (lib/content-analysis.js), by id, and
// the row class each one's status reads as.
function checksById(data) {
  const A = globalThis.SEOBWAnalysis;
  const out = {};
  if (A) A.evaluateChecks(data).checks.forEach(c => { out[c.id] = c; });
  return out;
}
function checkClass(check) {
  if (!check || check.status === 'na') return '';
  return check.status === 'pass' ? 'good' : check.status === 'warn' ? 'warn' : 'bad';
}

// An issue with its fix and the points it costs (1.10.4; the fix text was
// only on the new tab).
function issueRow(issue, data) {
  const fix = globalThis.SEOBWAnalysis ? SEOBWAnalysis.fixFor(issue, data) : null;
  const body = fix && fix.body ? `<span class="issue-fix">${esc(fix.body)}</span>` : '';
  const pts = fix && fix.points
    ? `<span class="issue-points" title="Points this costs on the on-page checklist">−${fix.points}</span>`
    : '';
  return `<div class="issue"><span class="issue-main"><span class="issue-label">${esc(issue)}</span>${body}</span>${pts}</div>`;
}

const has = (v) => v !== null && v !== undefined;

function renderResults(data) {
  const content = document.getElementById('content');
  const score = data.seoScore || { score: 0, grade: 'F', issues: [] };
  const techStack = data.techStack || [];
  const subs = computeSubScores(data);
  const checks = checksById(data);

  let html = '';

  /* --- Score hero --- */
  html += `<div class="seo-hero">
    <div class="ring" style="background:${ringStyle(score.score)}" title="On-page checklist: 100 minus the points the issues below cost">
      <span>
        <span class="ring-val">${score.score}</span>
        <span class="ring-cap">SCORE</span>
      </span>
    </div>
    <div class="seo-hero-body">
      <div class="seo-url" title="${esc(data.url)}">${esc((data.url || '').replace(/^https?:\/\//, ''))}</div>
      <div class="subscores">
        ${subs.map(s => `
          <div class="subscore">
            <span class="subscore-k">${esc(s.k)}</span>
            ${meter(s.v)}
            <span class="subscore-v">${s.v}</span>
          </div>`).join('')}
      </div>
    </div>
  </div>`;

  /* --- Page history (populated async by loadDomainHistory) --- */
  html += `<div id="domainHistory" class="domain-history" hidden></div>`;

  /* --- Add current tab as a link-building outlet --- */
  html += `<div class="lb-add-outlet-mini">
    <button type="button" id="addOutletBtn" class="lb-add-btn-mini">+ ADD AS OUTLET</button>
  </div>`;

  /* --- Issues --- */
  const issueBadge = score.issues.length
    ? badge(`${score.issues.length} ${score.issues.length === 1 ? 'ISSUE' : 'ISSUES'}`, score.issues.length > 3 ? 'b-err' : 'b-warn')
    : badge('CLEAN', 'b-ok');
  html += section('issues', 'Issues', issueBadge,
    score.issues.length
      ? score.issues.map(i => issueRow(i, data)).join('')
      : '<div class="pass">No major issues found</div>',
    true);

  /* --- Page meta --- */
  html += section('meta', 'Page Meta', metaBadge(checks), renderPageMeta(data, checks));

  /* --- Core Web Vitals --- */
  if (data.webVitals) html += renderWebVitals(data.webVitals);

  /* --- Headings --- */
  const hCount = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(k => (data.headings[k] || []).length);
  const outline = SBWExportRows.headingsRows(data) || [];
  const skips = outline.filter(h => h.skipped).length;
  const empties = outline.filter(h => h.empty).length;
  const flags = [skips ? `${skips} SKIPPED` : '', empties ? `${empties} EMPTY` : ''].filter(Boolean).join(' · ');
  html += section('headings', 'Headings',
    badge(`H1×${hCount[0]} · H2×${hCount[1]} · H3×${hCount[2]}`, data.headings.h1.length === 1 ? '' : 'b-warn') +
      (flags ? ' ' + badge(flags, 'b-warn') : ''),
    renderHeadingTree(outline) +
    `<div class="highlight-buttons">
      <button class="highlight-btn" data-type="headings">Highlight headings</button>
      ${exportButtonHtml('hdExportBtn', 'Export CSV', SBWExportRows.headingsRows(data))}
      ${exportButtonHtml('hdCopyBtn', 'Copy outline', SBWExportRows.headingsRows(data))}
    </div>`);

  /* --- Links & images --- */
  const missingAlt = data.images.missingAlt.count;
  const nfAnchors = data.links.nofollowAnchors || [];
  const nfList = nfAnchors.slice(0, 50);
  html += section('links', 'Links & Images',
    missingAlt ? badge(`${missingAlt} NO ALT`, 'b-err') : badge(`${data.links.internal.count + data.links.external.count} LINKS`, ''),
    `${dataRow('Internal', esc(data.links.internal.count))}
    ${dataRow('External', esc(data.links.external.count))}
    ${dataRow('Nofollow', esc(data.links.nofollow))}
    ${dataRow('UGC', esc(data.links.ugc || 0))}
    ${dataRow('Sponsored', esc(data.links.sponsored || 0))}
    ${nfAnchors.length ? dataRow('Total links with any of nofollow/ugc/sponsored', esc(nfAnchors.length)) : ''}
    ${dataRow('Images', esc(data.images.total))}
    ${dataRow('Missing alt', esc(missingAlt), missingAlt === 0 ? 'good' : 'bad')}
    ${has(data.images.decorative) ? dataRow('Decorative', esc(data.images.decorative) + ' with alt=""') : ''}
    ${nfList.length ? `<details class="nf-details">
      <summary class="nf-summary">Nofollow / UGC / sponsored links (${nfList.length})</summary>
      <div class="nf-list">${nfList.map(l => `<div class="nf-row">
        <span class="nf-row-rel">${esc(l.rel || '')}</span>
        <span class="nf-row-anchor" title="${esc(l.text || '')}">${esc((l.text || '').slice(0, 40)) || '(no text)'}</span>
        <span class="nf-row-url" title="${esc(l.url)}">${esc(l.url && l.url.length > 50 ? l.url.slice(0, 50) + '…' : (l.url || ''))}</span>
      </div>`).join('')}</div>
    </details>` : ''}
    <div class="highlight-buttons">
      <button class="highlight-btn" data-type="links-internal">Internal</button>
      <button class="highlight-btn" data-type="links-external">External</button>
      <button class="highlight-btn" data-type="nofollow">Nofollow</button>
      <button class="highlight-btn" data-type="images-missing-alt">Missing alt</button>
      ${exportButtonHtml('imgExportBtn', 'Export images CSV', SBWExportRows.imagesRows(data))}
      ${exportButtonHtml('lnkExportBtn', 'Export links CSV', SBWExportRows.linksRows(data))}
    </div>`);

  /* --- Content --- */
  html += section('content', 'Content',
    badge(`${(data.content.wordCount || 0).toLocaleString()} WORDS`, data.content.wordCount >= 600 ? 'b-ok' : 'b-warn'),
    `${dataRow('Words', (data.content.wordCount || 0).toLocaleString())}
    ${data.content.scope === 'body-fallback' ? dataRow('Counted in', 'The page body: its main region has under 100 words') : ''}
    ${dataRow('Characters', (data.content.charCount || 0).toLocaleString())}
    ${dataRow('Sentences', esc(data.content.sentenceCount))}
    ${data.content.language ? dataRow('Language', esc(languageLine(data.content.language))) : ''}
    ${data.content.readability
      ? dataRow('Reading level', `${esc(data.content.readability.level)} · grade ${esc(data.content.readability.fleschKincaid)}`) +
        dataRow('Flesch ease', `${esc(data.content.readability.fleschEase)} / 100`)
      : dataRow('Reading level', esc(readabilitySkipped(data.content.language)))}
    <div class="tags-label">Top words</div>
    <div class="tags">${(data.content.topWords || []).slice(0, 10).map(w => `<span class="tag">${esc(w.word)}<span class="tag-count">${w.count}</span></span>`).join('')}</div>
    <div class="tags-label">Top phrases</div>
    <div class="tags">${(data.content.topPhrases || []).slice(0, 8).map(p => `<span class="tag">${esc(p.phrase)}<span class="tag-count">${p.count}</span></span>`).join('')}</div>`);

  /* --- Tech stack --- */
  if (techStack.length) {
    html += section('techstack', 'Tech Stack', badge(`${techStack.length} DETECTED`, ''),
      `<div class="tech-badges">${techStack.map(t => `<span class="tech-badge" title="${esc(t.category || '')}">${esc(t.name)}</span>`).join('')}</div>`);
  }

  /* --- Technical --- */
  html += section('technical', 'Technical',
    badge(`${(data.technical.domElements || 0).toLocaleString()} NODES`, data.technical.domElements > 2000 ? 'b-warn' : ''),
    `${dataRow('DOM elements', (data.technical.domElements || 0).toLocaleString(), data.technical.domElements > 2000 ? 'warn' : '')}
    ${dataRow('Scripts', esc(data.technical.scripts))}
    ${dataRow('Stylesheets', esc(data.technical.stylesheets))}
    ${dataRow('URL depth', `${esc(data.technical.urlDepth)} levels`)}
    ${data.technical.loadTimeMs ? dataRow('Load time', (data.technical.loadTimeMs / 1000).toFixed(2) + ' s', data.technical.loadTimeMs < 2000 ? 'good' : 'warn') : ''}
    ${data.textToHtml ? dataRow('Text ratio', data.textToHtml.ratio + ' %', data.textToHtml.status === 'good' ? 'good' : 'warn') : ''}
    ${data.mixedContent && data.mixedContent.isHttps ? dataRow('Mixed content', esc(data.mixedContent.mixedCount), data.mixedContent.mixedCount === 0 ? 'good' : 'bad') : ''}`);

  /* --- Actions --- */
  html += `<div class="actions">
    <button id="copyBtn">COPY JSON</button>
    <button id="exportBtn">EXPORT</button>
    <button id="clearHighlightBtn">CLEAR</button>
  </div>
  <div class="status" id="status"></div>`;

  content.innerHTML = html;
  wireSeoTab();
  // Indexability mounts first: it inserts itself right after "Page Meta"
  // (see src/popup/indexability.js). Hreflang mounts next and inserts
  // itself right after Indexability (see src/popup/hreflang.js) — or, with
  // no hreflang tags on the page, adds nothing but a muted line inside Page
  // Meta instead. Rendering mounts next and inserts itself right after
  // Hreflang, falling back the same way (see src/popup/render-check.js).
  // Structured Data mounts next and inserts itself right after Rendering,
  // falling back through the same chain (see src/popup/structured-data.js).
  // Link Check — which just appends to the end of #content — always ends up
  // last regardless of call order; mounting these first anyway keeps that
  // intent readable here.
  globalThis.SBWIndexabilityUI?.mount(document.getElementById('content'), data);
  globalThis.SBWHreflangUI?.mount(document.getElementById('content'), data);
  globalThis.SBWRenderCheckUI?.mount(document.getElementById('content'), data);
  globalThis.SBWSchemaUI?.mount(document.getElementById('content'), data);
  globalThis.SBWLinkCheckUI?.mount(document.getElementById('content'), data);
  // TOOLS row (Task 7, item C) — inserts itself as #content's first child,
  // above the score hero, so it has to mount last (every mount() above
  // targets a spot further down and would otherwise land above it).
  globalThis.SBWToolsUI?.mount(document.getElementById('content'), data);
}

/* ---------- section renderers (1.10.4) ---------- */

const META_CHECKS = ['indexable', 'title', 'description', 'canonical', 'duplicates', 'structuredData', 'openGraph', 'viewport', 'lang', 'charset'];

function metaBadge(checks) {
  const n = META_CHECKS.filter(id => checks[id] && (checks[id].status === 'warn' || checks[id].status === 'fail')).length;
  return n ? badge(`${n} WARNING${n > 1 ? 'S' : ''}`, 'b-warn') : badge('OK', 'b-ok');
}

function shortUrl(url) {
  return String(url || '').replace(/^https?:\/\//, '');
}

// Page Meta: the preview cut by pixel width, then every head tag the checks
// read, the canonical as its URL and where it points.
function renderPageMeta(data, checks) {
  const m = data.meta;
  const P = globalThis.SBWSerpPreview;
  const t = P ? P.title(m.title.text) : { text: m.title.text, cut: false, width: null };
  const d = P ? P.description(m.description.text) : { text: m.description.text, cut: false, width: null };
  const px = (fit, max) => (fit.width === null ? '' : ` · ${fit.width} px of about ${max}${fit.cut ? ', cut' : ''}`);
  const rowClass = (check, fit) => (fit.cut && checkClass(check) === 'good' ? 'warn' : checkClass(check));
  const value = (check, fallback) => esc((check && check.note) || fallback);

  const canonicalUrls = (m.canonicalUrls && m.canonicalUrls.length) ? m.canonicalUrls : (m.canonical ? [m.canonical] : []);
  const where = m.canonicalTarget === 'self' ? 'Points to itself'
    : m.canonicalTarget === 'elsewhere' ? 'Points elsewhere' : null;
  const canonicalValue = !m.canonical ? 'Missing'
    : canonicalUrls.length > 1 ? `${canonicalUrls.length} different URLs` : (where || 'Set');
  const canonicalClass = !m.canonical || canonicalUrls.length > 1 ? 'bad' : m.canonicalTarget === 'elsewhere' ? 'warn' : 'good';

  const sd = checks.structuredData;
  const dup = checks.duplicates;
  return `<div class="serp-preview">
      <div class="serp-title">${esc(t.text) || 'No title'}</div>
      <div class="serp-url">${esc(shortUrl(data.url).slice(0, 60))}</div>
      <div class="serp-desc">${esc(d.text) || 'No meta description'}</div>
      <div class="serp-note">Cut where Google's desktop results cut, by width: about 600 px of title and 920 px of description.</div>
    </div>
    ${dataRow('Title', `${esc(m.title.length)} chars${px(t, 600)}`, rowClass(checks.title, t))}
    ${dataRow('Description', `${esc(m.description.length)} chars${px(d, 920)}`, rowClass(checks.description, d))}
    ${dataRow('Canonical', esc(canonicalValue), canonicalClass)}
    ${canonicalUrls.map((u, i) => `<div class="data-row">
      <span class="data-label">${canonicalUrls.length > 1 ? 'URL ' + (i + 1) : 'Canonical URL'}</span>
      <span class="data-value" title="${esc(u)}">${esc(shortUrl(u))}</span>
    </div>`).join('')}
    ${checks.indexable ? dataRow('Indexable', value(checks.indexable, 'Yes'), checkClass(checks.indexable)) : ''}
    ${dataRow('Robots', esc(m.robots || 'Not set (index, follow)'))}
    ${m.googlebot ? dataRow('Googlebot', esc(m.googlebot)) : ''}
    ${dup && dup.status !== 'pass' && dup.status !== 'na' ? dataRow('Duplicates', value(dup, ''), 'bad') : ''}
    ${checks.lang && checks.lang.status !== 'na' ? dataRow('Lang', value(checks.lang, 'Missing'), checkClass(checks.lang)) : ''}
    ${checks.viewport && checks.viewport.status !== 'na' ? dataRow('Viewport', value(checks.viewport, 'Missing'), checkClass(checks.viewport)) : ''}
    ${checks.charset && checks.charset.status !== 'na' ? dataRow('Charset', value(checks.charset, ''), checkClass(checks.charset)) : ''}
    ${dataRow('Open Graph', m.openGraph.title ? 'Set' : 'Missing', m.openGraph.title ? 'good' : 'warn')}
    ${dataRow('Twitter', esc(m.twitter.card || 'Missing'), m.twitter.card ? 'good' : 'warn')}
    ${dataRow('Schema', value(sd, `${m.schema.length} block${m.schema.length === 1 ? '' : 's'}`), sd && sd.status === 'pass' ? 'good' : 'warn')}`;
}

// Core Web Vitals of this visit (src/content/analyzer.js). A value the page
// didn't report reads "No data", never 0 or GOOD.
function renderWebVitals(wv) {
  const vitals = [
    { k: 'LCP', v: wv.lcp, unit: 'ms', good: 2500, poor: 4000 },
    { k: 'INP', v: wv.inp, unit: 'ms', good: 200, poor: 500 },
    { k: 'CLS', v: wv.cls, unit: '', good: 0.1, poor: 0.25 }
  ];
  const measured = vitals.filter(v => has(v.v));
  const poor = measured.find(v => v.v > v.poor);
  const fair = measured.find(v => v.v > v.good);
  let state;
  if (!measured.length) state = badge('NO DATA', '');
  else if (poor) state = badge(`${poor.k} POOR`, 'b-err');
  else if (fair) state = badge(`${fair.k} FAIR`, 'b-warn');
  else if (measured.length < vitals.length) state = badge(`${measured.length} OF 3 GOOD`, 'b-ok');
  else state = badge('GOOD', 'b-ok');

  const notes = [];
  if (wv.loadedHidden) notes.push('This page loaded in a background tab, where Chrome measures no LCP. Reload it in front to measure it.');
  if (!has(wv.inp)) notes.push('INP needs an interaction: none was measured on this visit.');
  notes.push('Measured on this visit, in your browser: not Google\'s field data.');

  return section('webvitals', 'Core Web Vitals', state,
    `<div class="cwv-grid">
      ${vitals.map(v => {
        const on = has(v.v);
        const pctVal = on ? Math.max(6, 100 - Math.min(100, (v.v / v.poor) * 100)) : 0;
        return `<div class="cwv-cell">
          <div class="cwv-k">${v.k}</div>
          <div class="cwv-v${on ? '' : ' cwv-none'}">${on ? (v.unit ? Math.round(v.v) : v.v) : 'No data'}</div>
          ${meter(pctVal, on ? (v.v <= v.good ? 'var(--success)' : v.v <= v.poor ? 'var(--warning)' : 'var(--error)') : 'rgba(245,245,245,.1)')}
        </div>`;
      }).join('')}
    </div>
    ${has(wv.fcp) ? dataRow('FCP', Math.round(wv.fcp) + ' ms', wv.fcp <= 1800 ? 'good' : 'warn') : ''}
    ${has(wv.ttfb) ? dataRow('TTFB', Math.round(wv.ttfb) + ' ms', wv.ttfb <= 800 ? 'good' : 'warn') : ''}
    <div class="cwv-notes">${notes.map(n => `<div class="cwv-note">${esc(n)}</div>`).join('')}</div>`);
}

// The full H1–H6 tree in page order, indented by level; skipped levels and
// empty headings flagged (lib/dom-extraction.js's outline).
function renderHeadingTree(outline) {
  if (!outline.length) return '<div class="pass">No headings on this page</div>';
  return `<div class="h-tree">${outline.map(h => {
    const flags = [];
    if (h.skipped) flags.push(`<span class="h-flag" title="Jumps from H${h.skipped[0] - 1} to H${h.level}">skips H${h.skipped.join(', H')}</span>`);
    if (h.fromAlt) flags.push('<span class="h-flag h-flag-info" title="Read from the image\'s alt text">image alt</span>');
    return `<div class="data-row h-row" style="padding-left:${14 + (Math.min(6, h.level) - 1) * 9}px">
      <span class="h-tag">H${esc(h.level)}</span>
      <span class="data-value${h.empty ? ' bad' : ''}" title="${esc(h.text || '')}">${h.empty ? '(empty)' : esc(String(h.text).slice(0, 90))}</span>
      ${flags.join('')}
    </div>`;
  }).join('')}</div>`;
}

function languageLine(lang) {
  const code = lang.code || 'Unknown';
  return lang.source === 'lang' ? `${code} · from the page's lang attribute` : `${code} · from the text (no lang attribute)`;
}

function readabilitySkipped(lang) {
  if (lang && lang.code && lang.code !== 'en') return 'Not scored: the page is not in English';
  return 'Not scored: no English text recognised';
}

function wireSeoTab() {
  document.querySelectorAll('#content .section').forEach(sec => {
    const header = sec.querySelector('.section-header');
    header.addEventListener('click', () => sec.classList.toggle('open'));
    sec.querySelector('.section-content')?.addEventListener('click', e => e.stopPropagation());
  });

  document.querySelectorAll('#content .highlight-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      chrome.tabs.sendMessage(currentTab.id, { action: 'highlight', type });
      btn.classList.toggle('active');
      if (!btn.classList.contains('active')) {
        chrome.tabs.sendMessage(currentTab.id, { action: 'highlight', type: 'clear' });
      }
    });
  });

  document.getElementById('clearHighlightBtn').addEventListener('click', () => {
    chrome.tabs.sendMessage(currentTab.id, { action: 'highlight', type: 'clear' });
    document.querySelectorAll('#content .highlight-btn.active').forEach(b => b.classList.remove('active'));
    setSeoStatus('Highlights cleared');
  });

  document.getElementById('copyBtn').addEventListener('click', () => copyToClipboard(pageData));
  document.getElementById('exportBtn').addEventListener('click', () => exportAsJson(pageData));

  // Task 7, item A/B: headings outline + images/links CSV exports.
  document.getElementById('hdExportBtn')?.addEventListener('click', (e) => { e.stopPropagation(); exportHeadingsCsv(pageData); });
  document.getElementById('hdCopyBtn')?.addEventListener('click', (e) => { e.stopPropagation(); copyHeadingsOutline(pageData); });
  document.getElementById('imgExportBtn')?.addEventListener('click', (e) => { e.stopPropagation(); exportImagesCsv(pageData); });
  document.getElementById('lnkExportBtn')?.addEventListener('click', (e) => { e.stopPropagation(); exportLinksCsv(pageData); });

  document.getElementById('addOutletBtn')?.addEventListener('click', addCurrentTabAsOutlet);
  initAddOutletButton();
}

// Disables "+ ADD AS OUTLET" when there's no account connected — SBW.lb.addOutlet()
// would just short-circuit to a no_key result anyway (see src/lib/api.js), so
// this saves the click and tells the user why. Shared by the initial render
// and by addCurrentTabAsOutlet's `finally` (a request can finish after the
// key was removed elsewhere, e.g. Options in another tab; re-checking here
// instead of unconditionally re-enabling keeps the button honest either way).
async function applyOutletButtonKeyState(btn) {
  const settings = await SBW.getApiSettings();
  if (!btn.isConnected) return; // popup may have re-rendered while this awaited
  if (settings.apiKey) {
    btn.disabled = false;
    btn.title = '';
  } else {
    btn.disabled = true;
    btn.title = 'Connect your SEO Bandwagon account in Options';
  }
}

async function initAddOutletButton() {
  const btn = document.getElementById('addOutletBtn');
  if (!btn) return;
  await applyOutletButtonKeyState(btn);
}

// Guards against a double-click firing two POSTs while the first is still
// in flight — same intent as sidepanel.js's lbInFlight set, just for the
// single button the popup has.
let addOutletInFlight = false;

async function addCurrentTabAsOutlet() {
  if (addOutletInFlight) return;
  const btn = document.getElementById('addOutletBtn');
  if (!btn || !currentTab || !currentTab.url) return;

  addOutletInFlight = true;
  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = 'ADDING…';

  try {
    const res = await SBW.lb.addOutlet({ url: currentTab.url, name: currentTab.title, status: 'candidate' });
    // outletAddMessage()/lbErrorMessage() return null for `unauthorized` (the
    // convention elsewhere is to flip straight to a signed-out view instead
    // of showing an error) — the popup has no such view for this button, and
    // `no_key` isn't mapped to anything more specific than a generic error
    // message. Handle both explicitly so a missing/rejected key is never
    // silently swallowed here.
    if (res.code === 'no_key' || res.code === 'unauthorized') {
      setSeoStatus('Connect your SEO Bandwagon account in Options', 'error');
      return;
    }
    const msg = SBWLinkBuildingUI.outletAddMessage(res);
    if (msg) setSeoStatus(msg, res.ok ? 'success' : 'error');
  } finally {
    addOutletInFlight = false;
    if (btn.isConnected) {
      btn.textContent = prevText;
      await applyOutletButtonKeyState(btn);
    }
  }
}

function setSeoStatus(msg, type) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
  if (msg) setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 2200);
}

// Fix round 1, IMPORTANT 5 (Task 5) + item 3 (Task 7 fix round 1): a synced
// capture uploads structured-data type names and property NAMES (for the
// missing-required/recommended chips and the "Eligible for" rollup) but
// never property VALUES, and — as of item 3 — never the four page-text
// list fields the popup's own CSV/copy exports need (headings.outline,
// links.list, links.nofollowAnchors, images.list); only their counts sync.
// Only the copy handed to autoSaveCapture/autoSaveLocal is stripped;
// `pageData` (module-level, set from the same `response` right before this
// call) keeps everything intact so the export/copy buttons and
// structured-data.js's "Copy JSON-LD" button still have the real data.
//
// The actual stripping logic lives in src/lib/capture-strip.js
// (globalThis.SBWCaptureStrip) so it's unit-testable without chrome/DOM;
// this wrapper is only the fail-closed fallback for the (should-never-
// happen) case that module didn't load.
function stripForStorage(data) {
  if (globalThis.SBWCaptureStrip && typeof globalThis.SBWCaptureStrip.strip === 'function') {
    return globalThis.SBWCaptureStrip.strip(data);
  }
  // Fail closed: without the stripper module, drop everything it would
  // have stripped rather than risk uploading page text/property values.
  if (!data) return data;
  const copy = Object.assign({}, data);
  delete copy.schemaValidation;
  if (copy.headings) { copy.headings = Object.assign({}, copy.headings); delete copy.headings.outline; }
  if (copy.links) { copy.links = Object.assign({}, copy.links); delete copy.links.list; delete copy.links.nofollowAnchors; }
  if (copy.images) { copy.images = Object.assign({}, copy.images); delete copy.images.list; }
  return copy;
}

async function autoSaveCapture(data) {
  const key = await SBW.autoSaveLocal(data);
  SBW.syncCapture(key); // fire-and-forget; the outcome is recorded on the stored capture's `sync` field
}

/* ---------- page history strip ---------- */

// Only http(s) pages have a capture history (chrome://, file://, ... don't).
function isWebPage(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch (e) {
    return false;
  }
}

// Reads a chrome.storage.session cache entry ({ at, value }); on a miss or
// stale entry, calls `fetcher()` (an SBW.* sbwFetch-shaped call) and — only
// on success — writes the fresh value back under `key` so the next popup
// open within CACHE_TTL_MS skips the network round trip. Reads are rate
// limited server-side (60/h/IP), which is what the cache is protecting.
async function resolveCached(entry, now, key, fetcher) {
  if (SBWDomainHistory.isFresh(entry, now)) {
    return { ok: true, code: 'ok', data: entry.value };
  }
  const result = await fetcher();
  if (result.ok) {
    await chrome.storage.session.set({ [key]: { at: now, value: result.data } });
  }
  return result;
}

function renderDomainHistoryConnect(container) {
  container.innerHTML = `<div class="domain-history-row">
    <span class="domain-history-label">Page history</span>
    <span class="domain-history-line">Your key was refused. Reconnect to see this page's history</span>
    <button type="button" id="domainHistoryConnect" class="domain-history-link">OPTIONS</button>
  </div>`;
  container.hidden = false;
  document.getElementById('domainHistoryConnect').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderDomainHistorySummary(container, summary) {
  const lines = summary.hasHistory
    ? [summary.urlLine]
    : ['This page: no earlier captures'];

  container.innerHTML = `<div class="domain-history-row">
    <span class="domain-history-label">Page history</span>
    <div class="domain-history-lines">${lines.map(l => `<span class="domain-history-line">${esc(l)}</span>`).join('')}</div>
  </div>`;
  container.hidden = false;
}

// Populates #domainHistory under the score ring with the account's earlier
// captures of this page (src/lib/domain-history.js says what counts).
// Best-effort: any failure (disabled collection, no key, network error,
// non-401 API error) just leaves the strip hidden rather than showing an
// error state, per the brief. 1.10.3: one request, the page's captures; the
// pooled domain average (GET /api/domain/:domain/quick) is no longer asked.
async function loadDomainHistory(tab, data, analysisStartedAt) {
  const container = document.getElementById('domainHistory');
  if (!container) return;

  try {
    if (!(await SBW.isDataCollectionEnabled())) return;

    const settings = await SBW.getApiSettings();
    if (!settings.apiKey) return;

    if (!isWebPage(tab.url)) return;

    const now = Date.now();
    const urlKey = SBWDomainHistory.cacheKey('url', tab.url);
    const cached = await chrome.storage.session.get(urlKey);
    const capturesResult = await resolveCached(cached[urlKey], now, urlKey, () => SBW.capturesForUrl(tab.url));

    if (capturesResult.code === 'unauthorized') {
      renderDomainHistoryConnect(container);
      return;
    }

    if (!capturesResult.ok) return; // no error UI

    const currentScore = data.seoScore ? data.seoScore.score : null;
    const summary = SBWDomainHistory.summarize({
      captures: capturesResult.data,
      pageUrl: tab.url,
      currentScore,
      excludeSince: analysisStartedAt
    });

    renderDomainHistorySummary(container, summary);
  } catch (e) {
    // Best-effort strip — never blocks or breaks the rest of the popup.
  }
}

function copyToClipboard(data) {
  navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    .then(() => setSeoStatus('Copied to clipboard', 'success'))
    .catch(() => setSeoStatus('Copy failed', 'error'));
}

function exportAsJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // #55: same name scheme as the CSV exports, so two pages on one site (or
  // two exports of one page in a day) no longer collide.
  a.download = SBWCsv.csvFilename('seo', data.url, undefined, 'json');
  a.click();
  URL.revokeObjectURL(url);
  setSeoStatus('Exported', 'success');
}

/* ---------- headings outline / images / links CSV exports (Task 7) ---------- */

// Row selection (including the pre-1.6.0-cached-analysis null case) lives
// in src/lib/export-rows.js (globalThis.SBWExportRows) so it's unit-testable
// without chrome/DOM — see tests/unit/export-rows.test.js.

// Fix round 1, item 3: mirrors lib/dom-extraction.js's OUTLINE_CAP /
// LINKS_LIST_CAP / IMAGES_LIST_CAP (all 500) — used here only to detect
// "this list hit its cap" for the truncation row/label below, since
// dom-extraction.js isn't loaded into the popup's own page (only injected
// into the target tab).
const EXPORT_ROW_CAP = 500;

// Fix round 1, item 8: a rows value of `null` (see SBWExportRows above)
// means the field doesn't exist on this cached analysis at all — render
// the button disabled with an explanatory title instead of letting a click
// export/copy a header-only/empty result.
function exportButtonHtml(id, label, rows) {
  if (!rows) {
    return `<button type="button" class="section-action-btn" id="${id}" disabled title="Re-run the analysis to export this">${esc(label)}</button>`;
  }
  // Fix round 1, item 11: capped lists say so on the button itself, before
  // the click — not just in the footer row inside the downloaded file.
  const shownLabel = rows.length >= EXPORT_ROW_CAP ? `${label} (first ${EXPORT_ROW_CAP})` : label;
  return `<button type="button" class="section-action-btn" id="${id}">${esc(shownLabel)}</button>`;
}

// Fix round 1, item 11: a guarded footer row ("# truncated to 500 rows")
// appended to a capped export — same `SBWCsv.toCsv`/`cell()` formula-guard
// path as every other row, just a plain row object with the message under
// the first column and the rest blank.
function withTruncationRow(rows, columns) {
  if (rows.length < EXPORT_ROW_CAP) return rows;
  const footer = {};
  footer[columns[0].key] = '# truncated to ' + EXPORT_ROW_CAP + ' rows';
  return rows.concat([footer]);
}

const HEADINGS_CSV_COLUMNS = [
  { key: 'order', label: 'Order' },
  { key: 'level', label: 'Level' },
  { key: 'text', label: 'Text' },
  { key: 'flags', label: 'Flags' }
];

// 1.10.4: what the tree flags, as words in the export.
function headingFlags(r) {
  return [r.empty ? 'empty' : '', r.skipped ? 'skips H' + r.skipped.join(', H') : '', r.fromAlt ? 'image alt' : '']
    .filter(Boolean).join('; ');
}

function downloadCsv(prefix, rows, columns, pageUrl) {
  const csv = SBWCsv.toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = SBWCsv.csvFilename(prefix, pageUrl || 'https://page.example/');
  a.click();
  // See link-check.js's onExportClick for why the revoke is deferred a tick.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setSeoStatus('Exported', 'success');
}

// Each of the three functions below returns `null` (nothing exported/
// copied, no "Exported" status set) when the button should have been
// disabled — belt-and-suspenders in case a click reaches the handler
// anyway (e.g. a disabled attribute stripped by a stale render).
function exportHeadingsCsv(data) {
  const rows = SBWExportRows.headingsRows(data);
  if (!rows) return null;
  const flagged = rows.map(r => Object.assign({}, r, { flags: headingFlags(r) }));
  downloadCsv('headings', withTruncationRow(flagged, HEADINGS_CSV_COLUMNS), HEADINGS_CSV_COLUMNS, data && data.url);
  return true;
}

function copyHeadingsOutline(data) {
  const rows = SBWExportRows.headingsRows(data);
  if (!rows) return null;
  const text = rows.map(r => '  '.repeat(Math.max(0, r.level - 1)) + (r.empty ? '(empty)' : r.text)).join('\n');
  navigator.clipboard.writeText(text)
    .then(() => setSeoStatus('Outline copied', 'success'))
    .catch(() => setSeoStatus('Copy failed', 'error'));
  return true;
}

const IMAGES_CSV_COLUMNS = [
  { key: 'src', label: 'Src' },
  { key: 'alt', label: 'Alt' },
  { key: 'hasAlt', label: 'Has Alt' },
  { key: 'decorative', label: 'Decorative' },
  { key: 'lazy', label: 'Lazy' },
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' }
];

function exportImagesCsv(data) {
  const rows = SBWExportRows.imagesRows(data);
  if (!rows) return null;
  downloadCsv('images', withTruncationRow(rows, IMAGES_CSV_COLUMNS), IMAGES_CSV_COLUMNS, data && data.url);
  return true;
}

const LINKS_CSV_COLUMNS = [
  { key: 'url', label: 'URL' },
  { key: 'anchor', label: 'Anchor' },
  { key: 'rel', label: 'Rel' },
  { key: 'type', label: 'Type' }
];

function exportLinksCsv(data) {
  const rows = SBWExportRows.linksRows(data);
  if (!rows) return null;
  downloadCsv('links', withTruncationRow(rows, LINKS_CSV_COLUMNS), LINKS_CSV_COLUMNS, data && data.url);
  return true;
}

/* ---------- the "add a Neon theme" strip (1.9.5) ---------- */

// The new tab shows the dashboard only with Neon Night or Neon Day installed
// (src/lib/newtab-gate.js). Until one is, and until "Not now", the popup says
// so. Shown only under the default setting; Always and Never need no theme.
async function renderThemeStrip() {
  const gate = globalThis.SBWNewTabGate;
  const theme = globalThis.SBWTheme;
  const el = document.getElementById('themeStrip');
  if (!gate || !theme || !el) return;
  const [mode, stored] = await Promise.all([
    gate.installedThemeMode(theme.THEME_IDS),
    chrome.storage.local.get([gate.SETTING_KEY, gate.PROMPT_DISMISSED_KEY]),
  ]);
  if (!gate.shouldPrompt({ setting: stored[gate.SETTING_KEY], themeMode: mode, dismissed: stored[gate.PROMPT_DISMISSED_KEY] === true })) return;
  const night = theme.listingUrl('dark');
  const day = theme.listingUrl('light');
  if (!night || !day) return;
  const link = (href, text) => {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text;
    return a;
  };
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Not now';
  dismiss.addEventListener('click', async () => {
    await chrome.storage.local.set({ [gate.PROMPT_DISMISSED_KEY]: true });
    el.hidden = true;
  });
  el.textContent = '';
  el.append('Your dashboard on every new tab: add ', link(night, 'Neon Night'), ' or ', link(day, 'Neon Day'), dismiss);
  el.hidden = false;
}

renderThemeStrip();
