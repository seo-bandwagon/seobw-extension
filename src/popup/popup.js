// SEO Bandwagon Extension — Popup UI

let pageData = null;
let currentTab = null;

/* ---------- shared helpers (also used by citations-tab.js) ---------- */

function esc(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      return;
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/content-analysis.js', 'lib/dom-extraction.js', 'src/content/analyzer.js'] });
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
    autoSaveCapture(response);

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
    `<div class="highlight-buttons"><button class="highlight-btn" data-type="headings">Highlight headings</button></div>`);

  /* --- Links & images --- */
  const missingAlt = data.images.missingAlt.count;
  html += section('links', 'Links & Images',
    missingAlt ? badge(`${missingAlt} NO ALT`, 'b-err') : badge(`${data.links.internal.count + data.links.external.count} LINKS`, ''),
    `${dataRow('Internal', esc(data.links.internal.count))}
    ${dataRow('External', esc(data.links.external.count))}
    ${dataRow('Nofollow', esc(data.links.nofollow))}
    ${dataRow('Images', esc(data.images.total))}
    ${dataRow('Missing alt', esc(missingAlt), missingAlt === 0 ? 'good' : 'bad')}
    <div class="highlight-buttons">
      <button class="highlight-btn" data-type="links-internal">Internal</button>
      <button class="highlight-btn" data-type="links-external">External</button>
      <button class="highlight-btn" data-type="nofollow">Nofollow</button>
      <button class="highlight-btn" data-type="images-missing-alt">Missing alt</button>
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
}

function setSeoStatus(msg, type) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
  if (msg) setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 2200);
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
