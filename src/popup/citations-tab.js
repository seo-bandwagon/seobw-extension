// Citations tab — CitationForge integration
// States: signedOut (1k) · picker (1l) · main (1e header + 1g actions) · results (1m/1n)

let cfInit = false;
let cfBiz = null;          // selected business (full record)
let cfStats = null;        // stats for selected business
let cfDir = null;          // matched directory for current tab
let cfTab = null;          // current chrome tab
let cfResult = null;       // { kind: 'loading'|'nap'|'proof'|'alert', ... }
let cfRecent = [];         // recent citations for the idle panel

const CF_STORE_KEY = 'cfSelectedBusiness';

/* ---------- utilities ---------- */

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Directory marks are a single glyph — "Y" for Yelp, "B" for BBB.
function dirGlyph(name) {
  const first = String(name || '?').trim()[0];
  return (first || '?').toUpperCase();
}

function shortAddress(b) {
  return [b.address_line1, b.city, b.state].filter(Boolean).join(', ');
}

function fullAddress(b) {
  return [b.address_line1, b.address_line2, b.city, b.state, b.zip_code].filter(Boolean).join(', ');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

function cfSetStatus(msg, type) {
  const el = document.getElementById('cfStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (type ? ' ' + type : '');
  if (type === 'success') setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}

/* ---------- entry ---------- */

async function initCitationsTab() {
  if (cfInit) return;
  cfInit = true;
  await refreshCitations();
}

async function refreshCitations() {
  const el = document.getElementById('cf-content');
  el.innerHTML = '<div class="loading">Connecting…</div>';

  const [tabs, loggedInRes] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    send({ action: 'cfIsLoggedIn' })
  ]);
  cfTab = tabs[0];
  cfDir = cfTab ? matchDirectory(cfTab.url || '') : null;

  if (!loggedInRes || !loggedInRes.loggedIn) {
    renderSignedOut(el);
    return;
  }

  let businesses;
  try {
    businesses = await cfGetBusinesses();
  } catch (e) {
    el.innerHTML = `<div class="empty">
      <div class="empty-glyph">⚠</div>
      <div class="empty-title">CAN'T REACH CITATIONFORGE</div>
      <div class="empty-sub">${esc(e.message)}</div>
      <button class="empty-cta" id="cfRetry">TRY AGAIN</button>
    </div>`;
    document.getElementById('cfRetry').addEventListener('click', refreshCitations);
    return;
  }

  if (!businesses.length) {
    el.innerHTML = `<div class="empty">
      <div class="empty-glyph">⌸</div>
      <div class="empty-title">NO BUSINESSES YET</div>
      <div class="empty-sub">Add a business in the CitationForge dashboard, then come back to check listings against it.</div>
      <button class="empty-cta" id="cfOpenDash">OPEN DASHBOARD</button>
    </div>`;
    document.getElementById('cfOpenDash').addEventListener('click', openDashboard);
    return;
  }

  // Restore previously selected business
  const stored = await chrome.storage.local.get(CF_STORE_KEY);
  const storedId = stored[CF_STORE_KEY];
  const match = businesses.find(b => b.id === storedId);

  if (!match) {
    renderPicker(el, businesses);
    return;
  }

  cfBiz = match;
  await renderMain(el);
}

/* ---------- 1k · signed out ---------- */

function renderSignedOut(el) {
  el.innerHTML = `
    <div class="signed-out">
      <div class="signed-out-body">
        <div class="signed-out-mark">SB</div>
        <div class="signed-out-title">CHECK EVERY LISTING<br>WITHOUT LEAVING THE PAGE</div>
        <div class="signed-out-sub">Connect CitationForge to compare a directory listing to your master NAP, capture proof, and log the citation in one click.</div>
        <button class="signed-out-cta" id="cfConnect">CONNECT CITATIONFORGE</button>
        <div class="signed-out-note">No account? <span class="link" id="cfSignup">Start free →</span></div>
      </div>
      <div class="proof-strip">
        <div class="proof-stat"><div class="proof-stat-v">40</div><div class="proof-stat-k">Directories</div></div>
        <div class="proof-stat"><div class="proof-stat-v">NAP</div><div class="proof-stat-k">Match scoring</div></div>
        <div class="proof-stat"><div class="proof-stat-v">1-CLICK</div><div class="proof-stat-k">Proof capture</div></div>
      </div>
    </div>`;

  document.getElementById('cfConnect').addEventListener('click', async () => {
    const btn = document.getElementById('cfConnect');
    btn.disabled = true;
    btn.textContent = 'CONNECTING…';
    const res = await send({ action: 'cfLogin' });
    if (res && res.ok) {
      await refreshCitations();
    } else {
      btn.disabled = false;
      btn.textContent = 'CONNECT CITATIONFORGE';
      el.querySelector('.signed-out-body').insertAdjacentHTML('beforeend',
        `<div class="alert alert-error" style="margin-top:14px;text-align:left"><b>COULDN'T CONNECT</b><span>${esc(res?.error || 'Sign-in failed')}</span></div>`);
    }
  });

  document.getElementById('cfSignup').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://seobandwagon.com/citationforge?utm_source=chrome_extension' });
  });
}

/* ---------- 1l · business picker ---------- */

function renderPicker(el, businesses) {
  el.innerHTML = `
    <div class="picker">
      <div class="picker-title">PICK A BUSINESS</div>
      <div class="picker-sub">Every check, proof, and report is filed against one business.</div>
      ${businesses.map(b => `
        <button class="picker-row" data-id="${esc(b.id)}">
          <span class="picker-mark">${esc(initials(b.name))}</span>
          <span class="picker-body">
            <span class="picker-name">${esc(b.name)}</span>
            <span class="picker-addr">${esc(shortAddress(b))}</span>
          </span>
          <span class="picker-cites" data-cites="${esc(b.id)}">—</span>
        </button>`).join('')}
    </div>`;

  el.querySelectorAll('.picker-row').forEach(row => {
    row.addEventListener('click', async () => {
      cfBiz = businesses.find(b => b.id === row.dataset.id);
      await chrome.storage.local.set({ [CF_STORE_KEY]: cfBiz.id });
      await renderMain(el);
    });
  });

  // Fill citation counts without blocking the render
  businesses.forEach(async b => {
    try {
      const s = await cfGetBusinessStats(b.id);
      const cell = el.querySelector(`[data-cites="${b.id}"]`);
      if (cell) cell.textContent = `${s.total_citations} cites`;
    } catch (e) { /* leave the dash */ }
  });
}

/* ---------- main view ---------- */

async function renderMain(el) {
  el.innerHTML = `
    ${dirHeader()}
    <div class="cf-actions">
      <button class="act-hero" id="cfNap">
        <span class="act-hero-glyph">◎</span>
        <span class="act-hero-body">
          <span class="act-hero-title">CHECK NAP</span>
          <span class="act-hero-sub">Compare this listing against your master record</span>
        </span>
        <span class="act-hero-arrow">→</span>
      </button>
      <div class="act-pair">
        <button class="act-tile" id="cfShot">
          <span class="act-tile-glyph">▣</span>
          <span class="act-tile-title">SCREENSHOT</span>
          <span class="act-tile-sub">Save proof of this listing</span>
        </button>
        <button class="act-tile" id="cfReport">
          <span class="act-tile-glyph">⚑</span>
          <span class="act-tile-title">REPORT</span>
          <span class="act-tile-sub">Log this citation to the campaign</span>
        </button>
      </div>
    </div>
    <div id="cfResult"></div>
    <div class="status" id="cfStatus"></div>
    <div class="cf-foot">
      <span class="cf-foot-stat" id="cfFootStat">${esc(cfBiz.name)}</span>
      <button class="cf-foot-link" id="cfDash">Open full dashboard →</button>
    </div>`;

  document.querySelector('.checking-as')?.addEventListener('click', switchBusiness);
  document.querySelector('.dir-avatar')?.addEventListener('click', signOut);
  document.getElementById('cfNap').addEventListener('click', runNapCheck);
  document.getElementById('cfShot').addEventListener('click', runScreenshot);
  document.getElementById('cfReport').addEventListener('click', () => runReport());
  document.getElementById('cfDash').addEventListener('click', openDashboard);

  renderResult();
  loadSidecarData();
}

function dirHeader() {
  const known = !!cfDir;
  const host = (() => {
    try { return new URL(cfTab.url).hostname.replace(/^www\./, ''); } catch { return 'this page'; }
  })();

  return `<div class="dir-head">
    <div class="dir-hero${known ? '' : ' unknown'}">
      <div class="dir-mark">${esc(known ? dirGlyph(cfDir.name) : '?')}</div>
      <div class="dir-body">
        <div class="dir-eyebrow">${known ? "You're on a known directory" : 'Not a tracked directory'}</div>
        <div class="dir-name" title="${esc(known ? cfDir.name : host)}">${esc((known ? cfDir.name : host).toUpperCase())}</div>
      </div>
      <div class="dir-avatar" title="Sign out">${esc(initials(cfBiz.name))}</div>
    </div>
    <div class="checking-as" title="Switch business">
      <span class="checking-as-k">Checking as</span>
      <span class="checking-as-v">${esc(cfBiz.name)}</span>
      <span class="checking-as-switch">SWITCH ▾</span>
    </div>
  </div>`;
}

/* ---------- result zone ---------- */

function renderResult() {
  const zone = document.getElementById('cfResult');
  if (!zone) return;

  if (!cfResult) { renderIdle(zone); return; }

  switch (cfResult.kind) {
    case 'loading': renderLoading(zone, cfResult.label); break;
    case 'nap': renderNap(zone, cfResult); break;
    case 'proof': renderProof(zone, cfResult); break;
    case 'alert': renderAlert(zone, cfResult); break;
  }

  // Results render below the actions — bring them into view so the popup
  // doesn't look like nothing happened.
  zone.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function sentence(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function renderIdle(zone) {
  if (!cfRecent.length) {
    zone.innerHTML = `<div class="recent">
      <div class="recent-label">No checks filed yet · this business</div>
      <div class="recent-row"><span class="recent-dir">Run a NAP check to start the record.</span></div>
    </div>`;
    return;
  }
  zone.innerHTML = `<div class="recent">
    <div class="recent-label">Last ${cfRecent.length} check${cfRecent.length === 1 ? '' : 's'} · this business</div>
    ${cfRecent.map(c => {
      const pct = c.nap_match_score != null ? Math.round(c.nap_match_score * 100) : null;
      return `<div class="recent-row">
        <span class="recent-dir">${esc(c.directory_name)}</span>
        <span class="recent-date">${esc(fmtDate(c.last_checked_at || c.created_at))}</span>
        ${pct != null ? `<span class="badge-mono ${statusClass(pct)}">${pct}%</span>` : '<span class="badge-mono">—</span>'}
      </div>`;
    }).join('')}
  </div>`;
}

function renderLoading(zone, label) {
  zone.innerHTML = `<div class="cf-card loading-card">
    <div class="load-label">${esc(label || 'Working…')}</div>
    <div class="skeleton"><i style="width:62%"></i><i style="width:88%"></i><i style="width:44%"></i></div>
  </div>`;
}

function renderAlert(zone, r) {
  zone.innerHTML = `<div style="margin:0 14px 12px">
    <div class="alert alert-${esc(r.tone)}"><b>${esc(r.title)}</b><span>${esc(r.body)}</span></div>
  </div>`;
}

function renderNap(zone, r) {
  const pct = Math.round(r.score.total * 100);
  const drift = r.fields.filter(f => f.pct < 80).length;
  const verdict = drift === 0 ? 'EVERYTHING MATCHES' : `${drift} FIELD${drift > 1 ? 'S' : ''} DRIFTING`;
  const driftNames = r.fields.filter(f => f.pct < 80).map(f => f.k.toLowerCase());
  const sub = drift === 0
    ? 'This listing matches your master record on every field we compare.'
    : sentence(`${driftNames.join(', ').replace(/, ([^,]*)$/, ' and $1')} differ${drift === 1 ? 's' : ''} from your master record.`);

  zone.innerHTML = `<div class="cf-card">
    <div class="nap-head">
      <div class="ring" style="background:${ringStyle(pct)}">
        <span><span class="ring-val">${pct}</span><span class="ring-cap">MATCH</span></span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="nap-verdict">${esc(verdict)}</div>
        <div class="nap-verdict-sub">${esc(sub)}</div>
      </div>
    </div>
    ${r.fields.map(f => `
      <div class="nap-field">
        <span class="nap-dot" style="background:${statusColor(f.pct)}"></span>
        <span class="nap-field-k">${esc(f.k)}</span>
        <span class="nap-field-v" title="${esc(f.found || 'not found')}">${esc(f.found || '— not found —')}</span>
        <span class="badge-mono ${statusClass(f.pct)}">${f.pct}%</span>
      </div>`).join('')}
    <div class="nap-foot">
      <button class="btn-fill" id="cfNapReport">FILE THIS CITATION</button>
      <button class="btn-ghost" id="cfNapDismiss">DISMISS</button>
    </div>
  </div>`;

  document.getElementById('cfNapReport').addEventListener('click', () => runReport(r));
  document.getElementById('cfNapDismiss').addEventListener('click', () => { cfResult = null; renderResult(); });
}

function renderProof(zone, r) {
  zone.innerHTML = `<div class="proof">
    <div class="proof-head">
      <span class="proof-check">✓</span>
      <span class="proof-title">${esc(r.saved ? 'PROOF SAVED' : 'PROOF CAPTURED')}</span>
      <span class="proof-dims">VIEWPORT · ${esc(r.w)}×${esc(r.h)} · ${esc(fmtBytes(r.bytes))}</span>
    </div>
    <div class="proof-body">
      <img class="proof-thumb" src="${r.dataUrl}" alt="Captured listing">
      <div class="proof-meta">
        <div class="proof-meta-text">${esc(cfDir ? cfDir.name : 'Untracked site')} · ${esc(cfBiz.name)}<br><span>${esc(new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span></div>
        <div class="proof-chips">
          ${r.saved
            ? `<button class="proof-chip" id="cfShotView">VIEW</button>`
            : `<button class="proof-chip" id="cfShotSave">SAVE TO CITATIONFORGE</button>`}
          <button class="proof-chip" id="cfShotAttach">ATTACH TO REPORT</button>
          <button class="proof-chip bare" id="cfShotClose">✕</button>
        </div>
      </div>
    </div>
  </div>`;

  document.getElementById('cfShotSave')?.addEventListener('click', saveScreenshot);
  document.getElementById('cfShotView')?.addEventListener('click', () => {
    if (cfResult.url) chrome.tabs.create({ url: getCfApiUrl() + cfResult.url });
  });
  document.getElementById('cfShotAttach')?.addEventListener('click', async () => {
    if (!cfResult.saved) await saveScreenshot();
    runReport(null, cfResult.url);
  });
  document.getElementById('cfShotClose').addEventListener('click', () => { cfResult = null; renderResult(); });
}

/* ---------- actions ---------- */

async function runNapCheck() {
  cfResult = { kind: 'loading', label: 'Reading listing…' };
  renderResult();

  const nap = await send({ action: 'cfExtractNap', tabId: cfTab.id });

  if (!nap || nap.error) {
    cfResult = {
      kind: 'alert', tone: 'error',
      title: "COULDN'T READ THIS PAGE",
      body: nap?.error || 'No NAP block found. Try scrolling to the business info, then check again.'
    };
    renderResult();
    return;
  }

  const canonical = {
    name: cfBiz.name || '',
    address: fullAddress(cfBiz),
    phone: cfBiz.phone || '',
    website: cfBiz.website || ''
  };
  const score = computeNapMatchScore(canonical, nap);

  const fields = [
    { k: 'Name', found: nap.name, pct: Math.round(score.breakdown.name * 100) },
    { k: 'Address', found: nap.address, pct: Math.round(score.breakdown.address * 100) },
    { k: 'Phone', found: nap.phone, pct: Math.round(score.breakdown.phone * 100) },
    { k: 'Website', found: nap.website, pct: Math.round(score.breakdown.website * 100) }
  ];

  cfResult = { kind: 'nap', score, fields, nap };
  renderResult();
}

async function runScreenshot() {
  cfResult = { kind: 'loading', label: 'Capturing proof…' };
  renderResult();

  const res = await send({ action: 'captureScreenshot' });
  if (!res || !res.ok) {
    cfResult = { kind: 'alert', tone: 'error', title: 'CAPTURE FAILED', body: res?.error || 'Chrome blocked the capture on this page.' };
    renderResult();
    return;
  }

  const dims = await imageDims(res.dataUrl);
  const bytes = Math.round((res.dataUrl.length - res.dataUrl.indexOf(',') - 1) * 0.75);

  cfResult = { kind: 'proof', dataUrl: res.dataUrl, w: dims.w, h: dims.h, bytes, saved: false, url: null };
  renderResult();
}

function imageDims(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

async function saveScreenshot() {
  if (!cfResult || cfResult.kind !== 'proof' || cfResult.saved) return;
  cfSetStatus('Uploading proof…');

  const res = await send({
    action: 'cfUploadScreenshot',
    businessId: cfBiz.id,
    dataUrl: cfResult.dataUrl,
    pageUrl: cfTab.url
  });

  if (res && res.ok) {
    cfResult.saved = true;
    cfResult.url = res.data.url;
    renderResult();
    cfSetStatus('Proof saved to CitationForge', 'success');
  } else {
    cfSetStatus(res?.error || 'Upload failed', 'error');
  }
}

async function runReport(napResult, screenshotUrl) {
  if (!cfDir && !napResult) {
    // Unknown site with no check run — warn but still allow
    cfResult = {
      kind: 'alert', tone: 'warning',
      title: 'UNKNOWN SITE',
      body: "This isn't a directory we track. Filing it anyway — you can still capture a proof screenshot."
    };
    renderResult();
  }

  cfSetStatus('Filing citation…');

  const nap = napResult?.nap || null;
  const scoreTotal = napResult?.score?.total ?? null;
  const pct = scoreTotal != null ? Math.round(scoreTotal * 100) : null;

  const payload = {
    directory_name: cfDir ? cfDir.name : hostOf(cfTab.url),
    directory_url: cfTab.url,
    status: pct == null ? 'active' : (pct >= 80 ? 'active' : 'inconsistent'),
    found_name: nap?.name || null,
    found_address: nap?.address || null,
    found_phone: nap?.phone || null,
    found_website: nap?.website || null,
    nap_match_score: scoreTotal,
    screenshot_url: screenshotUrl || (cfResult?.kind === 'proof' ? cfResult.url : null),
    notes: `Filed from the extension on ${new Date().toISOString().slice(0, 10)}`
  };

  try {
    await cfCreateCitation(cfBiz.id, payload);
    cfResult = {
      kind: 'alert', tone: 'success',
      title: 'CITATION FILED',
      body: `Logged to ${cfBiz.name}${pct != null ? ` at ${pct}% NAP match` : ''}.`
    };
    renderResult();
    cfSetStatus('');
    loadSidecarData();
  } catch (e) {
    cfSetStatus(e.message, 'error');
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Unknown'; }
}

/* ---------- background data ---------- */

async function loadSidecarData() {
  try {
    const [stats, citations] = await Promise.all([
      cfGetBusinessStats(cfBiz.id),
      cfGetCitations(cfBiz.id)
    ]);
    cfStats = stats;
    cfRecent = citations.slice(0, 3);

    const foot = document.getElementById('cfFootStat');
    if (foot) {
      const avg = stats.avg_nap_score != null ? ` · ${Math.round(stats.avg_nap_score * 100)}% avg` : '';
      foot.textContent = `${cfBiz.name} · ${stats.total_citations} citation${stats.total_citations === 1 ? '' : 's'}${avg}`;
    }
    if (!cfResult) renderResult();
  } catch (e) { /* footer stays with just the name */ }
}

/* ---------- nav ---------- */

async function switchBusiness() {
  await chrome.storage.local.remove(CF_STORE_KEY);
  cfBiz = null;
  cfResult = null;
  cfRecent = [];
  await refreshCitations();
}

async function signOut() {
  await send({ action: 'cfLogout' });
  await chrome.storage.local.remove(CF_STORE_KEY);
  cfBiz = null;
  cfResult = null;
  cfRecent = [];
  await refreshCitations();
}

function openDashboard() {
  send({ action: 'openSidePanel' });
  window.close();
}
