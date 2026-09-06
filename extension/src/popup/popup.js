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
  'www.google.nl', 'www.google.in'
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

/* ---------- analysis bootstrap ---------- */

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  currentTab = tab;

  if (tab && tab.url && isGoogleSerpUrl(tab.url)) {
    document.getElementById('content').innerHTML = `
      <div class="empty sbw-serp-notice">
        <div class="empty-title">SEARCH RESULTS PAGE</div>
        <div class="empty-sub">This is a search results page — the SEO Bandwagon bar is shown under each result.</div>
      </div>`;
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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/content-analysis.js', 'lib/dom-extraction.js', 'src/lib/link-check.js', 'src/lib/hreflang.js', 'src/lib/structured-data.js', 'src/content/analyzer.js'] });
    } catch (e) { /* already injected */ }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
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
    console.error('Analysis error:', err);
    document.getElementById('content').innerHTML = `
      <div class="empty">
        <div class="empty-glyph">⌸</div>
        <div class="empty-title">CAN'T READ THIS PAGE</div>
        <div class="empty-sub">Chrome blocks analysis on internal pages. Try refreshing, then click again.</div>
      </div>`;
    // Never gated on this run's outcome (ruling, Task 7 item E) — an error
    // page still shows the strip if a prior analysis already qualified.
    globalThis.SBWReviewUI?.renderFromStorage();
  }
});

/* ---------- sub-scores derived from real analyzer data ---------- */

function computeSubScores(data) {
  const m = data.meta || {};
  const c = data.content || {};
  const h = data.headings || {};
  const l = data.links || {};
  const t = data.technical || {};
  const img = data.images || {};

  const pct = (passed, total) => total ? Math.round((passed / total) * 100) : 0;

  // META — title, description, canonical, Open Graph, schema
  let metaPass = 0;
  if (m.title && m.title.text && m.title.length >= 30 && m.title.length <= 60) metaPass++;
  if (m.description && m.description.text && m.description.length >= 120 && m.description.length <= 160) metaPass++;
  if (m.canonical) metaPass++;
  if (m.openGraph && m.openGraph.title) metaPass++;
  if (m.schema && m.schema.length > 0) metaPass++;

  // CONTENT — depth, readability, single H1
  let contentPass = 0;
  if ((c.wordCount || 0) >= 600) contentPass++;
  else if ((c.wordCount || 0) >= 300) contentPass += 0.5;
  if (c.readability && c.readability.fleschKincaid <= 14) contentPass++;
  if (h.h1 && h.h1.length === 1) contentPass++;

  // LINKS — internal depth, external presence, images with alt
  let linksPass = 0;
  if ((l.internal?.count || 0) >= 3) linksPass++;
  if ((l.external?.count || 0) > 0) linksPass++;
  if (!img.total || (img.missingAlt?.count || 0) === 0) linksPass++;

  // TECH — DOM size, https, no mixed content
  let techPass = 0;
  if ((t.domElements || 0) <= 2000) techPass++;
  if ((data.url || '').startsWith('https://')) techPass++;
  if (!data.mixedContent || data.mixedContent.mixedCount === 0) techPass++;

  return [
    { k: 'Meta', v: pct(metaPass, 5) },
    { k: 'Content', v: pct(contentPass, 3) },
    { k: 'Links', v: pct(linksPass, 3) },
    { k: 'Tech', v: pct(techPass, 3) }
  ];
}

/* ---------- main renderer ---------- */

function renderResults(data) {
  const content = document.getElementById('content');
  const score = data.seoScore || { score: 0, grade: 'F', issues: [] };
  const techStack = data.techStack || [];
  const subs = computeSubScores(data);

  let html = '';

  /* --- Score hero --- */
  html += `<div class="seo-hero">
    <div class="ring" style="background:${ringStyle(score.score)}">
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

  /* --- Domain history (populated async by loadDomainHistory) --- */
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
      ? score.issues.map(i => `<div class="issue">${esc(i)}</div>`).join('')
      : '<div class="pass">No major issues found</div>',
    true);

  /* --- Page meta --- */
  const metaWarnings = [
    !data.meta.canonical,
    !data.meta.openGraph.title,
    data.meta.schema.length === 0,
    data.meta.title.length > 60 || data.meta.title.length < 30,
    data.meta.description.length > 160 || data.meta.description.length < 120
  ].filter(Boolean).length;

  html += section('meta', 'Page Meta',
    metaWarnings ? badge(`${metaWarnings} WARNING${metaWarnings > 1 ? 'S' : ''}`, 'b-warn') : badge('OK', 'b-ok'),
    `<div class="serp-preview">
      <div class="serp-title">${esc(data.meta.title.text.slice(0, 60)) || 'No title'}${data.meta.title.length > 60 ? '…' : ''}</div>
      <div class="serp-url">${esc((data.url || '').replace(/^https?:\/\//, '').slice(0, 60))}</div>
      <div class="serp-desc">${esc(data.meta.description.text.slice(0, 155)) || 'No meta description'}${data.meta.description.length > 155 ? '…' : ''}</div>
    </div>
    ${dataRow('Title', esc(data.meta.title.length) + ' / 60', data.meta.title.length <= 60 && data.meta.title.length >= 30 ? 'good' : 'warn')}
    ${dataRow('Description', esc(data.meta.description.length) + ' / 160', data.meta.description.length <= 160 && data.meta.description.length >= 120 ? 'good' : 'warn')}
    ${dataRow('Canonical', data.meta.canonical ? 'Set' : 'Missing', data.meta.canonical ? 'good' : 'bad')}
    ${dataRow('Robots', esc(data.meta.robots || 'Default'))}
    ${dataRow('Open Graph', data.meta.openGraph.title ? 'Set' : 'Missing', data.meta.openGraph.title ? 'good' : 'warn')}
    ${dataRow('Twitter', esc(data.meta.twitter.card || 'Missing'), data.meta.twitter.card ? 'good' : 'warn')}
    ${dataRow('Schema', `${data.meta.schema.length} block${data.meta.schema.length === 1 ? '' : 's'}`, data.meta.schema.length ? 'good' : 'warn')}`);

  /* --- Core Web Vitals --- */
  if (data.webVitals) {
    const wv = data.webVitals;
    const vitals = [
      { k: 'LCP', v: wv.lcp, unit: 'ms', good: 2500, poor: 4000 },
      { k: 'INP', v: wv.inp, unit: 'ms', good: 200, poor: 500 },
      { k: 'CLS', v: wv.cls, unit: '', good: 0.1, poor: 0.25 }
    ];
    const worst = vitals.filter(v => v.v !== null && v.v !== undefined)
      .find(v => v.v > v.poor) || vitals.find(v => v.v !== null && v.v !== undefined && v.v > v.good);

    html += section('webvitals', 'Core Web Vitals',
      worst ? badge(`${worst.k} ${worst.v > worst.poor ? 'POOR' : 'FAIR'}`, worst.v > worst.poor ? 'b-err' : 'b-warn') : badge('GOOD', 'b-ok'),
      `<div class="cwv-grid">
        ${vitals.map(v => {
          const has = v.v !== null && v.v !== undefined;
          const pctVal = has ? Math.max(6, 100 - Math.min(100, (v.v / v.poor) * 100)) : 0;
          return `<div class="cwv-cell">
            <div class="cwv-k">${v.k}</div>
            <div class="cwv-v">${has ? (v.unit ? Math.round(v.v) : v.v) : '—'}</div>
            ${meter(pctVal, has ? (v.v <= v.good ? 'var(--success)' : v.v <= v.poor ? 'var(--warning)' : 'var(--error)') : 'rgba(245,245,245,.1)')}
          </div>`;
        }).join('')}
      </div>
      ${wv.fcp !== null && wv.fcp !== undefined ? dataRow('FCP', Math.round(wv.fcp) + ' ms', wv.fcp <= 1800 ? 'good' : 'warn') : ''}
      ${wv.ttfb !== null && wv.ttfb !== undefined ? dataRow('TTFB', Math.round(wv.ttfb) + ' ms', wv.ttfb <= 800 ? 'good' : 'warn') : ''}`);
  }

  /* --- Headings --- */
  const hCount = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(k => (data.headings[k] || []).length);
  html += section('headings', 'Headings',
    badge(`H1×${hCount[0]} · H2×${hCount[1]} · H3×${hCount[2]}`, data.headings.h1.length === 1 ? '' : 'b-warn'),
    ['h1', 'h2', 'h3'].map(level =>
      (data.headings[level] || []).slice(0, 4).map(text =>
        `<div class="data-row">
          <span class="h-tag">${level.toUpperCase()}</span>
          <span class="data-value">${esc(String(text).slice(0, 70))}</span>
        </div>`).join('')
    ).join('') +
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
    ${dataRow('Characters', (data.content.charCount || 0).toLocaleString())}
    ${dataRow('Sentences', esc(data.content.sentenceCount))}
    ${dataRow('Reading level', `${esc(data.content.readability.level)} · grade ${esc(data.content.readability.fleschKincaid)}`)}
    ${dataRow('Flesch ease', `${esc(data.content.readability.fleschEase)} / 100`)}
    <div class="tags-label">Top words</div>
    <div class="tags">${(data.content.topWords || []).slice(0, 10).map(w => `<span class="tag">${esc(w.word)}<span class="tag-count">${w.count}</span></span>`).join('')}</div>
    <div class="tags-label">Top phrases</div>
    <div class="tags">${(data.content.topPhrases || []).slice(0, 8).map(p => `<span class="tag">${esc(p.phrase)}<span class="tag-count">${p.count}</span></span>`).join('')}</div>`);

  /* --- Tech stack --- */
  if (techStack.length) {
    html += section('techstack', 'Tech Stack', badge(`${techStack.length} DETECTED`, ''),
      `<div class="tech-badges">${techStack.map(t => `<span class="tech-badge">${esc(t.name)}</span>`).join('')}</div>`);
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

/* ---------- domain history strip ---------- */

// Strips a leading "www." so the domain lines up with how quickDomain keys
// server-side history (bare registrable-ish host, not the exact hostname).
function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return null; // non-http(s) pages (chrome://, file://, ...) have no domain
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
    <span class="domain-history-label">Domain history</span>
    <span class="domain-history-line">Connect your account to see history</span>
    <button type="button" id="domainHistoryConnect" class="domain-history-link">OPTIONS</button>
  </div>`;
  container.hidden = false;
  document.getElementById('domainHistoryConnect').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderDomainHistorySummary(container, summary) {
  const lines = summary.hasHistory
    ? [summary.domainLine, summary.urlLine].filter(Boolean)
    : ['No history yet'];

  container.innerHTML = `<div class="domain-history-row">
    <span class="domain-history-label">Domain history</span>
    <div class="domain-history-lines">${lines.map(l => `<span class="domain-history-line">${esc(l)}</span>`).join('')}</div>
  </div>`;
  container.hidden = false;
}

// Populates #domainHistory under the score ring with what SEO Bandwagon
// already knows about this domain/URL. Best-effort: any failure (disabled
// collection, no key, network error, non-401 API error) just leaves the
// strip hidden rather than showing an error state, per the brief.
async function loadDomainHistory(tab, data, analysisStartedAt) {
  const container = document.getElementById('domainHistory');
  if (!container) return;

  try {
    if (!(await SBW.isDataCollectionEnabled())) return;

    const settings = await SBW.getApiSettings();
    if (!settings.apiKey) return;

    const domain = domainFromUrl(tab.url);
    if (!domain) return;

    const now = Date.now();
    const quickKey = SBWDomainHistory.cacheKey('quick', domain);
    const urlKey = SBWDomainHistory.cacheKey('url', tab.url);
    const cached = await chrome.storage.session.get([quickKey, urlKey]);

    const [quickResult, capturesResult] = await Promise.all([
      resolveCached(cached[quickKey], now, quickKey, () => SBW.quickDomain(domain)),
      resolveCached(cached[urlKey], now, urlKey, () => SBW.capturesForUrl(tab.url))
    ]);

    if (quickResult.code === 'unauthorized' || capturesResult.code === 'unauthorized') {
      renderDomainHistoryConnect(container);
      return;
    }

    if (!quickResult.ok || !capturesResult.ok) return; // no error UI

    const currentScore = data.seoScore ? data.seoScore.score : null;
    const summary = SBWDomainHistory.summarize({
      quick: quickResult.data,
      captures: capturesResult.data,
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
  a.download = `seo-${new URL(data.url).hostname}-${new Date().toISOString().slice(0, 10)}.json`;
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
  { key: 'text', label: 'Text' }
];

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
  downloadCsv('headings', withTruncationRow(rows, HEADINGS_CSV_COLUMNS), HEADINGS_CSV_COLUMNS, data && data.url);
  return true;
}

function copyHeadingsOutline(data) {
  const rows = SBWExportRows.headingsRows(data);
  if (!rows) return null;
  const text = rows.map(r => '  '.repeat(Math.max(0, r.level - 1)) + r.text).join('\n');
  navigator.clipboard.writeText(text)
    .then(() => setSeoStatus('Outline copied', 'success'))
    .catch(() => setSeoStatus('Copy failed', 'error'));
  return true;
}

const IMAGES_CSV_COLUMNS = [
  { key: 'src', label: 'Src' },
  { key: 'alt', label: 'Alt' },
  { key: 'hasAlt', label: 'Has Alt' },
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
