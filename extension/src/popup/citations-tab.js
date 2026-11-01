// Citations tab — SEO Bandwagon citations API (src/lib/api.js SBW.ct.*)
// States: signedOut (1k) · picker (1l) · main (1e header + 1g actions) · results (1m/1n)

let cfInit = false;
let cfBiz = null;          // selected business (full record)
let cfStats = null;        // stats for selected business
let cfDir = null;          // matched directory for current tab
let cfTab = null;          // current chrome tab
let cfResult = null;       // { kind: 'loading'|'nap'|'proof'|'alert', ... }
let cfRecent = [];         // recent citations for the idle panel
let cfProofUrl = null;     // blob: URL of the current full-page proof; revoked when the result changes
let cfProofPort = null;    // `fullpage-proof` port to the worker, which runs the capture (#48)

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

// Lets preview/stub.js show a result state directly (the preview harness has
// no real page to capture). Unused in the extension itself.
function cfShowResult(r) {
  cfResult = r;
  renderResult();
}

function cfSetStatus(msg, type) {
  const el = document.getElementById('cfStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (type ? ' ' + type : '');
  if (type === 'success') setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}

/* ---------- auth ---------- */

// "Signed in" = an API key is stored AND the cached (or freshly verified)
// /v1/me result says the key is good. sbwKeyStatus is set by sbwFetch()
// itself (src/lib/api.js) on a 401 and on a key's first good answer, so a
// stale 'invalid' short-circuits without another round trip. 1.10.3: a 429,
// a 503 or no connection is not "signed out" (SBWCitations.signedInAfterVerify);
// the businesses call that follows says what went wrong.
async function checkSignedIn() {
  const settings = await SBW.getApiSettings();
  if (!settings.apiKey) return { signedIn: false };

  const stored = await chrome.storage.local.get(['sbwUser', 'sbwKeyStatus']);
  if (stored.sbwKeyStatus === 'invalid') return { signedIn: false };

  if (SBWCitations.isUserCacheFresh(stored.sbwUser)) {
    return { signedIn: true, user: stored.sbwUser.data };
  }

  const res = await SBW.verifyKey();
  if (!res.ok) return { signedIn: SBWCitations.signedInAfterVerify(res), user: null };

  await chrome.storage.local.set({ sbwUser: { data: res.data, at: Date.now() } });
  return { signedIn: true, user: res.data };
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

  const [tabs, auth] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    checkSignedIn()
  ]);
  cfTab = tabs[0];
  cfDir = cfTab ? matchDirectory(cfTab.url || '') : null;

  if (!auth.signedIn) {
    renderSignedOut(el);
    return;
  }

  let businesses;
  try {
    businesses = await SBW.ct.businesses();
  } catch (e) {
    if (e.code === 'unauthorized') { renderSignedOut(el); return; }
    el.innerHTML = `<div class="empty">
      <div class="empty-glyph">⚠</div>
      <div class="empty-title">CAN'T REACH SEO BANDWAGON</div>
      <div class="empty-sub">${esc(SBWCitations.ctErrorMessage(e.code, e.message))}</div>
      <button class="empty-cta" id="cfRetry">TRY AGAIN</button>
    </div>`;
    document.getElementById('cfRetry').addEventListener('click', refreshCitations);
    return;
  }

  if (!businesses.length) {
    el.innerHTML = `<div class="empty">
      <div class="empty-glyph">⌸</div>
      <div class="empty-title">NO BUSINESSES YET</div>
      <div class="empty-sub">Add a business in your SEO Bandwagon dashboard, then come back to check listings against it.</div>
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
        <div class="signed-out-sub">Connect your SEO Bandwagon account to check a directory listing against your business's name, address, phone and website, and file it with your citations. Proof screenshots download to this computer.</div>
        <button class="signed-out-cta" id="cfConnect">CONNECT YOUR ACCOUNT</button>
        <div class="signed-out-note">No API key yet? <span class="link" id="cfSignup">Create one →</span></div>
      </div>
      <div class="proof-strip">
        <div class="proof-stat"><div class="proof-stat-v">40</div><div class="proof-stat-k">Directories</div></div>
        <div class="proof-stat"><div class="proof-stat-v">NAP</div><div class="proof-stat-k">Match scoring</div></div>
        <div class="proof-stat"><div class="proof-stat-v">PNG</div><div class="proof-stat-k">Proof download</div></div>
      </div>
    </div>`;

  document.getElementById('cfConnect').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('cfSignup').addEventListener('click', async () => {
    const settings = await SBW.getApiSettings();
    const origin = SBWOptions.dashboardOrigin(settings.apiUrl);
    chrome.tabs.create({ url: SBWSiteLinks.siteUrl(origin, '/dashboard/api-keys', 'citations_tab') });
  });
}

/* ---------- 1l · business picker ---------- */

function renderPicker(el, businesses) {
  el.innerHTML = `
    <div class="picker">
      <div class="picker-title">PICK A BUSINESS</div>
      <div class="picker-sub">The listings you check and file are compared with this business's record.</div>
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

  // Fill citation counts without blocking the render. `authFlipped` guards
  // against every concurrent call independently trying to flip back to the
  // signed-out view on a shared 401 (e.g. an expired/revoked key).
  let authFlipped = false;
  businesses.forEach(async b => {
    try {
      const s = await SBW.ct.stats(b.id);
      const cell = el.querySelector(`[data-cites="${b.id}"]`);
      if (cell) cell.textContent = `${s.total_citations} cites`;
    } catch (e) {
      if (e.code === 'unauthorized' && !authFlipped) {
        authFlipped = true;
        refreshCitations();
        return;
      }
      // otherwise leave the dash
    }
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
          <span class="act-tile-sub">Download full-page proof of this listing</span>
        </button>
        <button class="act-tile" id="cfReport">
          <span class="act-tile-glyph">⚑</span>
          <span class="act-tile-title">REPORT</span>
          <span class="act-tile-sub">Check this listing and file it with your citations</span>
        </button>
      </div>
      <button class="cf-shot-visible" id="cfShotVisible">Visible area only</button>
    </div>
    <div id="cfResult"></div>
    <div class="status" id="cfStatus"></div>
    <div class="cf-foot">
      <span class="cf-foot-stat" id="cfFootStat">${esc(cfBiz.name)}</span>
      <button class="cf-foot-link" id="cfDash">Open full dashboard →</button>
    </div>`;

  document.querySelector('.checking-as')?.addEventListener('click', switchBusiness);
  document.querySelector('.dir-avatar')?.addEventListener('click', disconnect);
  document.getElementById('cfNap').addEventListener('click', runNapCheck);
  document.getElementById('cfShot').addEventListener('click', runScreenshot);
  document.getElementById('cfShotVisible').addEventListener('click', runVisibleShot);
  document.getElementById('cfReport').addEventListener('click', () => runReport());
  document.getElementById('cfDash').addEventListener('click', openDashboard);

  renderResult();
  proofPost({ type: 'attach', tabId: cfTab.id, url: cfTab.url });
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
      <div class="dir-avatar" title="Disconnect">${esc(initials(cfBiz.name))}</div>
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
  // A full-page proof holds its PNG in a blob: URL. Free it once that proof
  // is no longer the result on screen.
  if (cfProofUrl && !(cfResult && cfResult.kind === 'proof' && cfResult.href === cfProofUrl)) {
    URL.revokeObjectURL(cfProofUrl);
    cfProofUrl = null;
  }
  const zone = document.getElementById('cfResult');
  if (!zone) return;

  if (!cfResult) { renderIdle(zone); return; }

  switch (cfResult.kind) {
    case 'loading': renderLoading(zone, cfResult.label, cfResult.onCancel, cfResult.note); break;
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

// 1.10.3: these are the business's citations (filed here, or found by a
// campaign), newest first, not a log of checks: a check is recorded only
// when it is filed. Until then the label said "Last 3 checks" over the
// first three by the site's priority order.
function renderIdle(zone) {
  if (!cfRecent.length) {
    zone.innerHTML = `<div class="recent">
      <div class="recent-label">No citations filed yet · this business</div>
      <div class="recent-row"><span class="recent-dir">Check a listing and file it to start the record.</span></div>
    </div>`;
    return;
  }
  zone.innerHTML = `<div class="recent">
    <div class="recent-label">Latest citation${cfRecent.length === 1 ? '' : 's'} · this business</div>
    ${cfRecent.map(c => {
      const score = SBWCitations.napScore(c);
      const pct = score != null ? Math.round(score * 100) : null;
      return `<div class="recent-row">
        <span class="recent-dir">${esc(c.directory_name)}</span>
        <span class="recent-date">${esc(fmtDate(c.last_checked_at || c.created_at))}</span>
        ${pct != null ? `<span class="badge-mono ${statusClass(pct)}">${pct}%</span>` : '<span class="badge-mono">—</span>'}
      </div>`;
    }).join('')}
  </div>`;
}

function renderLoading(zone, label, onCancel, note) {
  zone.innerHTML = `<div class="cf-card loading-card">
    <div class="load-label">${esc(label || 'Working…')}</div>
    ${note ? `<div class="load-note">${esc(note)}</div>` : ''}
    <div class="skeleton"><i style="width:62%"></i><i style="width:88%"></i><i style="width:44%"></i></div>
    ${onCancel ? '<button class="proof-chip bare" id="cfLoadCancel">CANCEL</button>' : ''}
  </div>`;
  if (onCancel) document.getElementById('cfLoadCancel').addEventListener('click', onCancel);
}

function renderAlert(zone, r) {
  zone.innerHTML = `<div style="margin:0 14px 12px">
    <div class="alert alert-${esc(r.tone)}"><b>${esc(r.title)}</b><span>${esc(r.body)}</span></div>
    ${r.retryVisible ? '<button class="proof-chip cf-retry-visible" id="cfShotVisibleRetry">CAPTURE VISIBLE AREA INSTEAD</button>' : ''}
  </div>`;
  if (r.retryVisible) document.getElementById('cfShotVisibleRetry').addEventListener('click', runVisibleShot);
}

function listWords(names) {
  return names.join(', ').replace(/, ([^,]*)$/, ' and $1');
}

// 1.10.3: a field the listing does not show is "not found", not "differs";
// a website is compared only when both the record and the listing have one.
function renderNap(zone, r) {
  const pct = Math.round(r.score.total * 100);
  const drifting = r.fields.filter(f => f.compared && f.pct < 80);
  const drift = drifting.length;
  const verdict = drift === 0 ? 'EVERYTHING MATCHES' : `${drift} FIELD${drift > 1 ? 'S' : ''} DRIFTING`;
  const missing = drifting.filter(f => !f.found).map(f => f.k.toLowerCase());
  const differ = drifting.filter(f => f.found).map(f => f.k.toLowerCase());
  const parts = [];
  if (differ.length) parts.push(`${listWords(differ)} differ${differ.length === 1 ? 's' : ''} from your master record`);
  if (missing.length) parts.push(`${listWords(missing)} ${missing.length === 1 ? 'is' : 'are'} not on this listing`);
  const sub = drift === 0
    ? 'This listing matches your master record on every field compared.'
    : sentence(parts.join('; ') + '.');

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
        <span class="nap-dot" style="background:${f.compared ? statusColor(f.pct) : 'var(--paper-40)'}"></span>
        <span class="nap-field-k">${esc(f.k)}</span>
        <span class="nap-field-v" title="${esc(f.found || f.note || 'not found')}">${esc(f.found || f.note || '— not found —')}</span>
        ${f.compared ? `<span class="badge-mono ${statusClass(f.pct)}">${f.pct}%</span>` : '<span class="badge-mono">—</span>'}
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
      <span class="proof-title">SCREENSHOT CAPTURED</span>
      <span class="proof-dims">${esc(r.label)}</span>
    </div>
    <div class="proof-body">
      <img class="proof-thumb" src="${esc(r.href)}" alt="Captured listing">
      <div class="proof-meta">
        <div class="proof-meta-text">${esc(cfDir ? cfDir.name : 'Untracked site')} · ${esc(cfBiz.name)}<br><span>${esc(new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span></div>
        <div class="proof-chips">
          <a class="proof-chip" id="cfShotDownload" href="${esc(r.href)}" download="${esc(SBWCitations.screenshotFilename(cfTab.url, new Date(), r.ext || 'png'))}">DOWNLOAD ${esc((r.ext || 'png').toUpperCase())}</a>
          <button class="proof-chip bare" id="cfShotClose">✕</button>
        </div>
      </div>
    </div>
  </div>`;

  document.getElementById('cfShotDownload').addEventListener('click', () => {
    if (cfResult) cfResult.downloaded = true;
    if (r.fromRun) proofPost({ type: 'downloaded', tabId: cfTab.id });
  });
  document.getElementById('cfShotClose').addEventListener('click', () => {
    if (r.fromRun) proofPost({ type: 'cancel', tabId: cfTab.id });
    cfResult = null;
    renderResult();
  });
}

/* ---------- actions ---------- */

// Reads the listing and scores it against the business's record. Resolves
// to the NAP result, or null after showing why the page could not be read.
async function checkListing(label) {
  cfResult = { kind: 'loading', label: label || 'Reading listing…' };
  renderResult();

  const nap = await send({ action: 'extractNap', tabId: cfTab.id });

  if (!nap || nap.error) {
    cfResult = {
      kind: 'alert', tone: 'error',
      title: "COULDN'T READ THIS PAGE",
      body: nap?.error || 'No NAP block found. Try scrolling to the business info, then check again.'
    };
    renderResult();
    return null;
  }

  const canonical = {
    name: cfBiz.name || '',
    address: fullAddress(cfBiz),
    phone: cfBiz.phone || '',
    website: cfBiz.website || ''
  };
  const score = computeNapMatchScore(canonical, nap);
  const websiteNote = !canonical.website ? 'not in your master record' : '';

  const fields = [
    { k: 'Name', found: nap.name, pct: Math.round(score.breakdown.name * 100), compared: true },
    { k: 'Address', found: nap.address, pct: Math.round(score.breakdown.address * 100), compared: true },
    { k: 'Phone', found: nap.phone, pct: Math.round(score.breakdown.phone * 100), compared: true },
    // Compared only when both sides have one; a listing without the record's
    // website is "not on this listing", one the record lacks is not judged.
    { k: 'Website', found: nap.website, pct: Math.round(score.breakdown.website * 100), compared: !!canonical.website, note: nap.website ? '' : websiteNote }
  ];

  return { kind: 'nap', score, fields, nap };
}

async function runNapCheck() {
  const r = await checkListing();
  if (!r) return;
  cfResult = r;
  renderResult();
}

// Full-page proof (#48): the worker scrolls, captures and builds the image
// (src/lib/fullpage-runs.js), so closing the popup doesn't stop it. The popup
// starts it, attaches when it opens, and shows what the worker reports. The
// finished image is read from the proof store (src/lib/proof-store.js).
function proofPost(msg) {
  if (!cfProofPort) {
    cfProofPort = chrome.runtime.connect({ name: 'fullpage-proof' });
    cfProofPort.onMessage.addListener(onProofMessage);
    cfProofPort.onDisconnect.addListener(() => { cfProofPort = null; });
  }
  cfProofPort.postMessage(msg);
}

function proofRunning() {
  return !!(cfResult && cfResult.fromRun && cfResult.kind === 'loading');
}

function proofProgressLabel(run) {
  if (run.phase === 'encoding') return 'Building the image…';
  if (run.phase !== 'capturing' || !run.total) return 'Measuring the page…';
  const secs = run.msLeft != null ? Math.max(1, Math.round(run.msLeft / 1000)) : null;
  return `Capturing ${run.frame} of ${run.total}${secs ? ` · about ${secs} s left` : ''}`;
}

async function onProofMessage(msg) {
  if (!msg) return;
  if (msg.type === 'cancelled') {
    if (cfResult && cfResult.fromRun) { cfResult = null; renderResult(); }
    return;
  }
  const run = msg.run;
  if (!run || !cfTab || run.tabId !== cfTab.id) return;

  if (run.status === 'running') {
    cfResult = {
      kind: 'loading', fromRun: true,
      label: proofProgressLabel(run),
      note: 'Keeps going if you close the popup. Stay on this tab until it’s done.',
      onCancel: () => proofPost({ type: 'cancel', tabId: cfTab.id })
    };
    renderResult();
    return;
  }

  if (run.status === 'error') {
    cfResult = {
      kind: 'alert', tone: 'error', title: 'CAPTURE FAILED', fromRun: true,
      body: (run.error && run.error.message) || 'Chrome blocked the capture on this page.',
      retryVisible: !!run.error && (run.error.code === 'canvas-failed' || run.error.code === 'capture-failed')
    };
    renderResult();
    // Shown now, so the worker needn't keep it for the next popup.
    proofPost({ type: 'cancel', tabId: cfTab.id });
    return;
  }

  if (run.status === 'done' && run.result) {
    let blob = null;
    try { blob = await SBWProofStore.get(run.result.key); } catch (_) { blob = null; }
    if (!blob) {
      cfResult = { kind: 'alert', tone: 'error', title: 'CAPTURE FAILED', fromRun: true, body: 'The finished image could not be read back. Try again.', retryVisible: true };
      renderResult();
      proofPost({ type: 'cancel', tabId: cfTab.id });
      return;
    }
    if (cfProofUrl) URL.revokeObjectURL(cfProofUrl);
    cfProofUrl = URL.createObjectURL(blob);
    cfResult = {
      kind: 'proof', fromRun: true,
      href: cfProofUrl,
      ext: /jpeg/.test(run.result.type) ? 'jpg' : 'png',
      label: SBWFullPage.describeProof(run.result, fmtBytes(run.result.bytes)),
      downloaded: !!run.downloaded
    };
    renderResult();
  }
}

function runScreenshot() {
  cfResult = { kind: 'loading', fromRun: true, label: 'Measuring the page…', onCancel: () => proofPost({ type: 'cancel', tabId: cfTab.id }) };
  renderResult();
  proofPost({ type: 'start', tabId: cfTab.id, windowId: cfTab.windowId, url: cfTab.url });
}

// Visible area only: the pre-1.7 one-frame capture through the service
// worker's captureScreenshot action.
async function runVisibleShot() {
  if (proofRunning()) {
    // A full-page capture is scrolling this page: stop it, and give the page
    // a moment to be put back before taking the visible area.
    proofPost({ type: 'cancel', tabId: cfTab.id });
    await new Promise(r => setTimeout(r, 400));
  }
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

  cfResult = {
    kind: 'proof',
    href: res.dataUrl,
    label: SBWFullPage.describeProof({ mode: 'viewport', reason: null, width: dims.w, height: dims.h }, fmtBytes(bytes)),
    downloaded: false
  };
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

// 1.10.3: every filing carries a NAP check. REPORT without one runs it
// first, so a citation's status comes from its score. Until then an
// unchecked filing was saved as "active" (matching), and the site has no
// status for an unchecked listing; a page the check cannot read is not filed.
async function runReport(napResultArg, screenshotDownloadedArg) {
  const screenshotDownloaded = screenshotDownloadedArg != null
    ? screenshotDownloadedArg
    : !!(cfResult && cfResult.kind === 'proof' && cfResult.downloaded);

  let napResult = napResultArg;
  if (!napResult) {
    napResult = await checkListing(cfDir ? 'Checking the listing before filing…' : 'Not a tracked directory: checking it before filing…');
    if (!napResult) return; // checkListing has said why; nothing filed
  }

  cfSetStatus('Filing citation…');

  const payload = SBWCitations.buildCitationPayload({
    directoryName: cfDir ? cfDir.name : hostOf(cfTab.url),
    directoryUrl: cfTab.url,
    nap: napResult.nap,
    scoreTotal: napResult.score.total,
    screenshotDownloaded
  });

  if (!payload) { cfSetStatus('Run Check NAP first', 'error'); return; }

  try {
    await SBW.ct.createCitation(cfBiz.id, payload);
    const pct = payload.nap_match_score != null ? Math.round(payload.nap_match_score * 100) : null;
    cfResult = {
      kind: 'alert', tone: 'success',
      title: 'CITATION FILED',
      body: `Logged to ${cfBiz.name}${pct != null ? ` at ${pct}% NAP match` : ''}.`
    };
    renderResult();
    cfSetStatus('');
    loadSidecarData();
  } catch (e) {
    if (e.code === 'unauthorized') { await refreshCitations(); return; }
    cfSetStatus(SBWCitations.ctErrorMessage(e.code, e.message), 'error');
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Unknown'; }
}

/* ---------- background data ---------- */

async function loadSidecarData() {
  try {
    const [stats, citations] = await Promise.all([
      SBW.ct.stats(cfBiz.id),
      SBW.ct.citations(cfBiz.id)
    ]);
    cfStats = stats;
    cfRecent = SBWCitations.latestCitations(citations, 3);

    const foot = document.getElementById('cfFootStat');
    if (foot) {
      const avg = stats.avg_nap_score != null ? ` · ${Math.round(stats.avg_nap_score * 100)}% avg` : '';
      foot.textContent = `${cfBiz.name} · ${stats.total_citations} citation${stats.total_citations === 1 ? '' : 's'}${avg}`;
    }
    if (!cfResult) renderResult();
  } catch (e) {
    if (e.code === 'unauthorized') { await refreshCitations(); return; }
    // otherwise the footer stays with just the name
  }
}

/* ---------- nav ---------- */

async function switchBusiness() {
  await chrome.storage.local.remove(CF_STORE_KEY);
  cfBiz = null;
  cfResult = null;
  cfRecent = [];
  await refreshCitations();
}

async function disconnect() {
  if (!confirm('Disconnect your SEO Bandwagon account?')) return;
  await chrome.storage.sync.set({ apiKey: '' });
  await SBW.clearAccountCaches(); // every per-account cache, the chosen business among them
  cfBiz = null;
  cfResult = null;
  cfRecent = [];
  await refreshCitations();
}

async function openDashboard() {
  const settings = await SBW.getApiSettings();
  const origin = SBWOptions.dashboardOrigin(settings.apiUrl);
  chrome.tabs.create({ url: SBWSiteLinks.siteUrl(origin, '/dashboard/citations', 'citations_tab') });
  window.close();
}
