// SEO Bandwagon side panel — citations API (src/lib/api.js SBW.ct.*) and
// link-building API (SBW.lb.*)
//
// Two modes, toggled above the section nav and persisted in
// chrome.storage.local.spMode:
//   citations — sections: businesses · campaigns · citations
//   links     — sections: outlets · pitches · results
//
// SBW.ct.* throws (CtError) on a non-ok response; SBW.lb.* does NOT — every
// lb.* call is branched on `.ok`/`.code` inline rather than via try/catch.

let spMode = 'citations';  // 'citations' | 'links'
let spSection = 'businesses';
let spBiz = null;           // selected business (citations mode)
let spBusinesses = [];
let spFilter = '';          // active filter chip value
let spRunId = 0;            // bumped per render so stale async loops bail out

const SP_STORE_KEY = 'cfSelectedBusiness';

const MODE_SECTIONS = {
  citations: ['businesses', 'campaigns', 'citations'],
  links: ['outlets', 'pitches', 'results']
};
const MODE_DEFAULT_SECTION = { citations: 'businesses', links: 'outlets' };
const NAV_HTML = {
  citations: `
    <button class="active" data-section="businesses">BUSINESSES</button>
    <button data-section="campaigns">CAMPAIGNS</button>
    <button data-section="citations">CITATIONS</button>`,
  links: `
    <button class="active" data-section="outlets">OUTLETS</button>
    <button data-section="pitches">PITCHES</button>
    <button data-section="results">RESULTS</button>`
};

/* ---------- helpers ---------- */

function spEsc(t) {
  if (t === null || t === undefined) return '';
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function spInitials(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '—';
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
function spColor(pct) {
  if (pct >= 80) return 'var(--success)';
  if (pct >= 60) return 'var(--warning)';
  return 'var(--error)';
}
function spBadgeCls(pct) {
  if (pct >= 80) return 'b-ok';
  if (pct >= 60) return 'b-warn';
  return 'b-err';
}
function spDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}
function spBar(pct) {
  return `<div class="sp-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${spColor(pct)}"></i></div>`;
}
function spEmpty(glyph, title, sub, ctaId, ctaLabel) {
  return `<div class="empty">
    <div class="empty-glyph">${glyph}</div>
    <div class="empty-title">${spEsc(title)}</div>
    <div class="empty-sub">${spEsc(sub)}</div>
    ${ctaId ? `<button class="empty-cta" id="${ctaId}">${spEsc(ctaLabel)}</button>` : ''}
  </div>`;
}
function spSkeleton(rows) {
  return Array.from({ length: rows }, () => `
    <div class="sp-row">
      <div class="sp-idx" style="background:rgba(245,245,245,.05)"></div>
      <div class="sp-row-body"><div class="skeleton"><i style="width:70%"></i></div></div>
      <div class="sp-bar"></div>
    </div>`).join('');
}

/* ---------- auth ---------- */

// Same "signed in" definition as the popup's citations tab (see
// src/popup/citations-tab.js's checkSignedIn) — duplicated rather than
// shared because it's the one piece of UI wiring both surfaces need and
// this codebase keeps tab/panel wiring independent (see spEsc/esc, etc.).
// Shared by both modes — a key with only link-building scopes is still
// "signed in"; forbidden shows up per-section instead (see lbErrorMessage).
async function checkSignedIn() {
  const settings = await SBW.getApiSettings();
  if (!settings.apiKey) return { signedIn: false };

  const stored = await chrome.storage.local.get(['sbwUser', 'sbwKeyStatus']);
  if (stored.sbwKeyStatus === 'invalid') return { signedIn: false };

  if (SBWCitations.isUserCacheFresh(stored.sbwUser)) {
    return { signedIn: true, user: stored.sbwUser.data };
  }

  const res = await SBW.verifyKey();
  if (!res.ok) return { signedIn: false };

  await chrome.storage.local.set({ sbwUser: { data: res.data, at: Date.now() } });
  return { signedIn: true, user: res.data };
}

/* ---------- boot ---------- */

async function initSidePanel() {
  const body = document.getElementById('spBody');

  const vEl = document.getElementById('spVersion');
  if (vEl) {
    const m = chrome.runtime.getManifest();
    vEl.textContent = 'v' + m.version;
    vEl.title = m.version_name || ('Version ' + m.version);
  }

  const auth = await checkSignedIn();
  if (!auth.signedIn) {
    // Leave #spModeNav's static markup alone (same as #spNav below) — its
    // buttons are only ever toggled/replaced, never rebuilt from scratch, so
    // clearing them here would leave the mode toggle permanently empty if
    // the user reconnects without a full page reload.
    document.getElementById('spFilters').innerHTML = '';
    body.innerHTML = spEmpty('◎', 'NOT CONNECTED', 'Open the extension options page and connect your SEO Bandwagon account to see your citation data here.', 'spConnect', 'CONNECT');
    document.getElementById('spConnect').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  if (globalThis.SBWTheme) SBWTheme.bindControl(document.getElementById('spAppearance'));
  document.getElementById('spUser').textContent = auth.user ? spInitials(auth.user.name || auth.user.email) : '';
  document.getElementById('spUser').title = auth.user?.email || '';

  const storedMode = await chrome.storage.local.get('spMode');
  spMode = storedMode.spMode === 'links' ? 'links' : 'citations';
  renderModeNav();
  renderSectionNav(spMode);
  setExportVisible(spMode === 'citations');
  spSection = MODE_DEFAULT_SECTION[spMode];
  spFilter = '';

  if (spMode === 'citations') {
    try {
      spBusinesses = await SBW.ct.businesses();
    } catch (e) {
      body.innerHTML = spEmpty('⚠', "CAN'T REACH SEO BANDWAGON", SBWCitations.ctErrorMessage(e.code, e.message), 'spRetry', 'TRY AGAIN');
      document.getElementById('spRetry').addEventListener('click', initSidePanel);
      return;
    }

    const stored = await chrome.storage.local.get(SP_STORE_KEY);
    spBiz = spBusinesses.find(b => b.id === stored[SP_STORE_KEY]) || spBusinesses[0] || null;
  }

  loadSection(spSection);
}

/* ---------- mode toggle ---------- */

function renderModeNav() {
  document.querySelectorAll('#spModeNav button').forEach(b => b.classList.toggle('active', b.dataset.mode === spMode));
}
function renderSectionNav(mode) {
  document.getElementById('spNav').innerHTML = NAV_HTML[mode];
}
function setExportVisible(visible) {
  const btn = document.getElementById('spExport');
  if (btn) btn.hidden = !visible;
}

document.getElementById('spModeNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  switchMode(btn.dataset.mode);
});

async function switchMode(mode) {
  if (mode === spMode || !MODE_SECTIONS[mode]) return;
  spMode = mode;
  await chrome.storage.local.set({ spMode: mode });
  renderModeNav();
  renderSectionNav(mode);
  setExportVisible(mode === 'citations');
  spSection = MODE_DEFAULT_SECTION[mode];
  spFilter = '';

  // Businesses are only fetched up front for citations mode (see
  // initSidePanel) — if the panel started in links mode, fetch them now,
  // the first time citations mode is opened.
  if (mode === 'citations' && !spBusinesses.length) {
    try {
      spBusinesses = await SBW.ct.businesses();
      const stored = await chrome.storage.local.get(SP_STORE_KEY);
      spBiz = spBusinesses.find(b => b.id === stored[SP_STORE_KEY]) || spBusinesses[0] || null;
    } catch (e) {
      if (e.code === 'unauthorized') { initSidePanel(); return; }
      renderFilters([]);
      document.getElementById('spBody').innerHTML = spEmpty('⚠', "CAN'T REACH SEO BANDWAGON", SBWCitations.ctErrorMessage(e.code, e.message), 'spRetryMode', 'TRY AGAIN');
      document.getElementById('spRetryMode')?.addEventListener('click', () => switchMode(mode));
      return;
    }
  }

  loadSection(spSection);
}

/* ---------- section nav + filters ---------- */

document.getElementById('spNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#spNav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  spSection = btn.dataset.section;
  spFilter = '';
  loadSection(spSection);
});

function renderFilters(chips) {
  const el = document.getElementById('spFilters');
  if (!chips || !chips.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sp-filters">${chips.map(c =>
    `<button class="sp-chip${spFilter === c.v ? ' active' : ''}" data-v="${spEsc(c.v)}">${spEsc(c.k)}</button>`
  ).join('')}</div>`;
  el.querySelectorAll('.sp-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      spFilter = chip.dataset.v;
      loadSection(spSection);
    });
  });
}

/* ---------- section router ---------- */

async function loadSection(name) {
  const body = document.getElementById('spBody');
  const run = ++spRunId;
  body.innerHTML = spSkeleton(6);

  try {
    switch (name) {
      case 'businesses': return await sectionBusinesses(body, run);
      case 'campaigns': return await sectionCampaigns(body, run);
      case 'citations': return await sectionCitations(body, run);
      case 'outlets': return await sectionOutlets(body, run);
      case 'pitches': return await sectionPitches(body, run);
      case 'results': return await sectionResults(body, run);
    }
  } catch (e) {
    if (run !== spRunId) return;
    if (e.code === 'unauthorized') { initSidePanel(); return; }
    renderFilters([]);
    body.innerHTML = spEmpty('⚠', 'SOMETHING BROKE', SBWCitations.ctErrorMessage(e.code, e.message), 'spRetry2', 'TRY AGAIN');
    document.getElementById('spRetry2')?.addEventListener('click', () => loadSection(name));
  }
}

// True while `run` is still the active render; async fills check this before
// touching the DOM so a section switch can't be overwritten by a stale loop.
function isCurrent(run) { return run === spRunId; }

/* ---------- businesses ---------- */

async function sectionBusinesses(body, run) {
  renderFilters([]);

  if (!spBusinesses.length) {
    body.innerHTML = spEmpty('⌸', 'NO BUSINESSES', 'Add one in your SEO Bandwagon dashboard to start tracking citations.');
    setFoot('0 businesses');
    return;
  }

  body.innerHTML = spBusinesses.map((b, i) => `
    <div class="sp-row${spBiz && b.id === spBiz.id ? ' selected' : ''}" data-id="${spEsc(b.id)}">
      <div class="sp-idx">${spEsc(spInitials(b.name))}</div>
      <div class="sp-row-body">
        <div class="sp-row-t">${spEsc(b.name)}</div>
        <div class="sp-row-s">${spEsc([b.city, b.state].filter(Boolean).join(', '))}</div>
      </div>
      <div class="sp-bar" data-bar="${spEsc(b.id)}"></div>
      <span class="badge-mono" data-badge="${spEsc(b.id)}">—</span>
    </div>`).join('');

  body.querySelectorAll('.sp-row').forEach(row => {
    row.addEventListener('click', async () => {
      spBiz = spBusinesses.find(b => b.id === row.dataset.id);
      await chrome.storage.local.set({ [SP_STORE_KEY]: spBiz.id });
      body.querySelectorAll('.sp-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      setFoot(`${spBiz.name} selected`);
    });
  });

  setFoot(`${spBusinesses.length} business${spBusinesses.length === 1 ? '' : 'es'}`);

  // Fill NAP averages progressively; bail out if the user switched sections
  let totalCites = 0;
  for (const b of spBusinesses) {
    try {
      const s = await SBW.ct.stats(b.id);
      if (!isCurrent(run)) return;
      totalCites += s.total_citations;
      const pct = s.avg_nap_score != null ? Math.round(s.avg_nap_score * 100) : null;
      const bar = body.querySelector(`[data-bar="${b.id}"]`);
      const badge = body.querySelector(`[data-badge="${b.id}"]`);
      if (bar && pct != null) bar.innerHTML = `<i style="width:${pct}%;background:${spColor(pct)}"></i>`;
      if (badge) {
        badge.textContent = `${s.total_citations}`;
        badge.className = 'badge-mono' + (pct != null ? ' ' + spBadgeCls(pct) : '');
        badge.title = pct != null ? `${pct}% average NAP match` : 'No scored citations yet';
      }
      setFoot(`${spBusinesses.length} business${spBusinesses.length === 1 ? '' : 'es'} · ${totalCites} citations`);
    } catch (e) {
      if (!isCurrent(run)) return;
      if (e.code === 'unauthorized') { initSidePanel(); return; }
    }
  }
}

/* ---------- campaigns ---------- */

// businessId -> in-flight trigger+poll. Without this, re-rendering the
// campaigns section (e.g. switching sections and back) redraws the button
// enabled even while a previous trigger (or its poll, up to a minute-plus)
// is still running, and a second click creates a duplicate campaign
// server-side — the site has no idempotency guard on the trigger endpoint.
const campaignInFlight = new Set();

async function sectionCampaigns(body, run) {
  renderFilters([]);
  if (!spBiz) { body.innerHTML = spEmpty('◎', 'PICK A BUSINESS', 'Select a business first — campaigns run per business.'); return; }

  const campaigns = await SBW.ct.campaigns(spBiz.id);
  if (!isCurrent(run)) return;

  const inFlight = campaignInFlight.has(spBiz.id);

  body.innerHTML = `
    <button class="sp-trigger" id="spRun"${inFlight ? ' disabled' : ''}>${inFlight ? 'RUNNING…' : 'RUN NEW CAMPAIGN'}</button>
    ${campaigns.length ? campaigns.map((c, i) => {
      const tone = SBWCitations.campaignBadgeTone(c.status);
      return `<div class="sp-row" data-cid="${spEsc(c.id)}">
        <div class="sp-idx">${campaigns.length - i}</div>
        <div class="sp-row-body">
          <div class="sp-row-t">${spEsc(spDate(c.created_at))}</div>
          <div class="sp-row-s">${spEsc(c.campaign_type || 'discovery')}</div>
        </div>
        <span class="badge-mono ${tone}">${spEsc(String(c.status).toUpperCase())}</span>
      </div>`;
    }).join('') : spEmpty('⌸', 'NO CAMPAIGNS YET', 'Run one to discover directories and audit every listing automatically.')}`;

  if (!inFlight) {
    document.getElementById('spRun').addEventListener('click', () => runCampaign(spBiz.id));
  }

  const activeCount = campaigns.filter(c => c.status === 'running' || c.status === 'pending').length;
  setFoot(`${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}${activeCount ? ` · ${activeCount} active` : ''}`);
}

// The site runs a campaign synchronously and can take longer than the
// client's 60s timeout — a network/timeout failure (or a 504 from a proxy in
// between) doesn't mean the campaign didn't start, so poll for its outcome
// instead of reporting failure. See SBWCitations.shouldPollAfterTrigger /
// pollUntilDone (src/lib/citations-ui.js).
async function runCampaign(businessId) {
  if (campaignInFlight.has(businessId)) return;
  campaignInFlight.add(businessId);

  const btn = document.getElementById('spRun');
  if (btn) { btn.disabled = true; btn.textContent = 'RUNNING…'; }

  let needsReauth = false;

  try {
    await SBW.ct.triggerCampaign(businessId);
    setFoot('Campaign complete');
  } catch (e) {
    if (SBWCitations.shouldPollAfterTrigger(e)) {
      setFoot('Campaign started — refreshing…');
      const { done } = await SBWCitations.pollUntilDone({
        fetchOnce: () => SBW.ct.campaigns(businessId),
        isDone: (campaigns) => {
          const newest = SBWCitations.newestCampaign(campaigns);
          return !!newest && SBWCitations.isCampaignDone(newest.status);
        }
      });
      setFoot(done ? 'Campaign complete' : 'Still running — check back soon');
    } else if (e.code === 'unauthorized') {
      needsReauth = true;
    } else {
      setFoot('Failed: ' + SBWCitations.ctErrorMessage(e.code, e.message));
    }
  } finally {
    // Always clear the flag, on every path (success, poll, failure, or
    // reauth) — otherwise a failed trigger would permanently lock out
    // retries for that business.
    campaignInFlight.delete(businessId);
  }

  if (needsReauth) {
    initSidePanel();
    return;
  }

  // Refresh stats/list only if the user hasn't switched businesses or
  // sections while the campaign (or the poll) was running. This re-render
  // is also what clears the disabled "RUNNING…" button state.
  if (spBiz && spBiz.id === businessId && spSection === 'campaigns') {
    loadSection('campaigns');
  }
}

/* ---------- citations ---------- */

async function sectionCitations(body, run) {
  if (!spBiz) { renderFilters([]); body.innerHTML = spEmpty('◎', 'PICK A BUSINESS', 'Select a business to see its citations.'); return; }

  const all = await SBW.ct.citations(spBiz.id);
  if (!isCurrent(run)) return;
  const counts = all.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});

  renderFilters([
    { k: `ALL ${all.length}`, v: '' },
    { k: `ACTIVE ${counts.active || 0}`, v: 'active' },
    { k: `DRIFT ${counts.inconsistent || 0}`, v: 'inconsistent' },
    { k: `MISSING ${counts.missing || 0}`, v: 'missing' }
  ]);

  const rows = spFilter ? all.filter(c => c.status === spFilter) : all;

  if (!rows.length) {
    body.innerHTML = spEmpty('⌸', 'NO CITATIONS YET', "Visit a directory listing and report it — it'll show up here.");
    setFoot(`${all.length} citations · ${spBiz.name}`);
    return;
  }

  body.innerHTML = rows.map((c, i) => {
    const pct = c.nap_match_score != null ? Math.round(c.nap_match_score * 100) : null;
    return `<div class="sp-row" data-url="${spEsc(c.directory_url)}">
      <div class="sp-idx">${i + 1}</div>
      <div class="sp-row-body">
        <div class="sp-row-t">${spEsc(c.directory_name)}</div>
        <div class="sp-row-s">${spEsc(spDate(c.last_checked_at || c.created_at))} · ${spEsc(c.status)}</div>
      </div>
      ${pct != null ? spBar(pct) : '<div class="sp-bar"></div>'}
      <span class="badge-mono ${pct != null ? spBadgeCls(pct) : ''}">${pct != null ? pct + '%' : '—'}</span>
    </div>`;
  }).join('');

  body.querySelectorAll('.sp-row').forEach(row => {
    row.addEventListener('click', () => {
      if (row.dataset.url) chrome.tabs.create({ url: row.dataset.url });
    });
  });

  const scored = all.filter(c => c.nap_match_score != null);
  const avg = scored.length ? Math.round(scored.reduce((s, c) => s + c.nap_match_score, 0) / scored.length * 100) : null;
  setFoot(`${rows.length} shown · ${all.length} total${avg != null ? ` · ${avg}% avg` : ''}`);
}

/* ---------- link building: shared bits ---------- */

// prospect/pitch id -> in-flight review/dispatch action, same guard pattern
// as campaignInFlight above — a re-render (section switch and back) must not
// re-enable a button while its request is still outstanding.
const lbInFlight = new Set();

let spSenderAddress = null;      // from the last GET .../pitches response
let spPitchesById = {};          // id -> pitch, so Gmail compose/mark-sent
                                  // don't need another round trip

function setCardActionsDisabled(id, disabled) {
  const card = document.querySelector(`.lb-card[data-id="${id}"]`);
  if (!card) return;
  card.querySelectorAll('.lb-actions button').forEach(b => { b.disabled = disabled; });
}

async function openSetSenderPage() {
  const settings = await SBW.getApiSettings();
  const origin = settings.apiUrl.replace(/\/api$/, '');
  chrome.tabs.create({ url: SBWSiteLinks.siteUrl(origin, '/dashboard/link-building', 'side_panel') });
}

/* ---------- outlets ---------- */

function outletCard(o) {
  const pct = o.quality_score != null ? Math.round(Number(o.quality_score)) : null;
  const journalists = o.journalist_count || 0;
  return `<div class="lb-card" data-id="${spEsc(o.id)}">
    <div class="lb-card-top">
      <div class="sp-row-body">
        <div class="sp-row-t"><a href="https://${spEsc(o.domain)}" target="_blank" rel="noopener">${spEsc(o.domain)}</a></div>
        <div class="sp-row-s">${journalists} journalist${journalists === 1 ? '' : 's'}${o.is_competitor ? ' · competitor' : ''}</div>
      </div>
      ${pct != null ? spBar(pct) : '<div class="sp-bar"></div>'}
      <span class="badge-mono${pct != null ? ' ' + spBadgeCls(pct) : ''}">${pct != null ? pct : '—'}</span>
    </div>
    <div class="lb-actions">
      <button data-act="approve">APPROVE</button>
      <button data-act="hold">HOLD</button>
      <button data-act="reject">REJECT</button>
    </div>
  </div>`;
}

const OUTLET_STATUS_CHIPS = [
  { k: 'QUALIFIED', v: 'qualified' },
  { k: 'HELD', v: 'held' },
  { k: 'APPROVED', v: 'approved' },
  { k: 'CANDIDATE', v: 'candidate' }
];

async function sectionOutlets(body, run) {
  if (!spFilter) spFilter = 'qualified';
  renderFilters(OUTLET_STATUS_CHIPS);

  const res = await SBW.lb.prospects(spFilter);
  if (!isCurrent(run)) return;

  const addBar = `<div class="lb-add-outlet">
    <button class="lb-add-btn" id="spAddOutlet">+ ADD CURRENT TAB AS OUTLET</button>
    <label class="lb-skip-scoring"><input type="checkbox" id="spSkipScoring"> Skip scoring — send straight to review</label>
  </div>`;

  if (!res.ok) {
    if (res.code === 'unauthorized') { initSidePanel(); return; }
    body.innerHTML = addBar + spEmpty('⚠', 'SOMETHING BROKE', SBWLinkBuildingUI.lbErrorMessage(res.code, (res.data && res.data.error)), 'spRetryLb', 'TRY AGAIN');
    document.getElementById('spAddOutlet')?.addEventListener('click', addCurrentTabAsOutlet);
    document.getElementById('spRetryLb')?.addEventListener('click', () => loadSection('outlets'));
    setFoot('');
    return;
  }

  const prospects = (res.data && res.data.prospects) || [];

  if (!prospects.length) {
    body.innerHTML = addBar + spEmpty('⌸', 'NO OUTLETS', `Nothing ${spFilter} right now.`);
    document.getElementById('spAddOutlet')?.addEventListener('click', addCurrentTabAsOutlet);
    setFoot('0 outlets');
    return;
  }

  body.innerHTML = addBar + prospects.map(outletCard).join('');

  document.getElementById('spAddOutlet')?.addEventListener('click', addCurrentTabAsOutlet);
  body.querySelectorAll('.lb-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="approve"]')?.addEventListener('click', () => reviewOutlet(id, 'approve'));
    card.querySelector('[data-act="hold"]')?.addEventListener('click', () => reviewOutlet(id, 'hold'));
    card.querySelector('[data-act="reject"]')?.addEventListener('click', () => reviewOutlet(id, 'reject'));
  });

  setFoot(`${prospects.length} outlet${prospects.length === 1 ? '' : 's'}`);
}

async function reviewOutlet(id, action) {
  if (lbInFlight.has(id)) return;

  let reason;
  if (action === 'reject') {
    // Server max (sql/033 prospects/review schema): reason.max(500).
    const input = window.prompt('Reason for rejecting this outlet (3-500 characters):');
    if (input === null) return; // cancelled
    reason = input.trim();
    if (reason.length < 3) { setFoot('Reason must be at least 3 characters'); return; }
    if (reason.length > 500) { setFoot('Reason must be 500 characters or fewer'); return; }
  }

  lbInFlight.add(id);
  setCardActionsDisabled(id, true);
  try {
    const res = await SBW.lb.reviewProspects([id], action, reason);
    if (res.code === 'unauthorized') { initSidePanel(); return; }
    if (res.ok) {
      // The route's WHERE clause only matches rows still in
      // qualified/held — updated:0 means someone else (or another tab)
      // already reviewed it since this list loaded, not success.
      const updated = res.data && res.data.updated;
      setFoot(updated === 0
        ? 'Nothing changed (already reviewed?)'
        : (action === 'approve' ? 'Outlet approved' : action === 'hold' ? 'Outlet held' : 'Outlet rejected'));
      if (spSection === 'outlets') loadSection('outlets');
      return;
    }
    setFoot(SBWLinkBuildingUI.lbErrorMessage(res.code, (res.data && res.data.error) || 'Failed to record review'));
  } finally {
    lbInFlight.delete(id);
    setCardActionsDisabled(id, false);
  }
}

async function addCurrentTabAsOutlet() {
  const btn = document.getElementById('spAddOutlet');
  const skip = document.getElementById('spSkipScoring');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = 'ADDING…';

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.url) { setFoot('No active tab URL'); return; }

    const skipScoring = !!(skip && skip.checked);
    const res = await SBW.lb.addOutlet({
      url: tab.url,
      name: tab.title,
      status: skipScoring ? 'qualified' : 'candidate'
    });

    if (res.code === 'unauthorized') { initSidePanel(); return; }

    const msg = SBWLinkBuildingUI.outletAddMessage(res);
    if (msg) setFoot(msg);

    if (res.ok && spSection === 'outlets') loadSection('outlets');
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = prevText; }
  }
}

/* ---------- pitches ---------- */

function contactBadge(status) {
  if (status === 'valid') return 'b-ok';
  if (status === 'invalid') return 'b-err';
  return 'b-warn';
}

function pitchCardTop(p) {
  const m = SBWLinkBuildingUI.pitchCardModel(p);
  return `<div class="lb-card-top">
    <div class="sp-row-body">
      <div class="sp-row-t">${spEsc(m.name)} <span class="badge-mono ${contactBadge(m.verified)}">${spEsc(m.verified)}</span></div>
      <div class="sp-row-s">${spEsc(m.email || 'no email on file')} · ${spEsc(m.domain)}</div>
    </div>
  </div>`;
}

function pitchDraftCard(p) {
  const bodyText = p.body_markdown || '';
  const preview = bodyText.length > 180 ? bodyText.slice(0, 180) + '…' : bodyText;
  return `<div class="lb-card" data-id="${spEsc(p.id)}">
    ${pitchCardTop(p)}
    <div class="lb-pitch-subject">${spEsc(p.subject_line)}</div>
    <div class="lb-pitch-body" data-collapsed="true">${spEsc(preview)}</div>
    ${bodyText.length > 180 ? '<button class="lb-expand" data-act="expand">Expand</button>' : ''}
    <div class="lb-actions">
      <button data-act="approve">APPROVE</button>
      <button data-act="reject">REJECT</button>
    </div>
  </div>`;
}

function pitchApprovedCard(p) {
  const gmailAction = spSenderAddress
    ? `<button data-act="gmail">Open Gmail compose</button>`
    : `<a href="#" class="lb-set-sender" data-act="set-sender">Set your sender address on the dashboard</a>`;
  return `<div class="lb-card" data-id="${spEsc(p.id)}">
    ${pitchCardTop(p)}
    <div class="lb-pitch-subject">${spEsc(p.subject_line)}</div>
    <div class="lb-actions">
      ${gmailAction}
      <button data-act="sent">Mark sent</button>
    </div>
  </div>`;
}

function pitchSentRow(p) {
  return `<div class="lb-card" data-id="${spEsc(p.id)}">
    ${pitchCardTop(p)}
    <div class="lb-pitch-subject">${spEsc(p.subject_line)}</div>
  </div>`;
}

const PITCH_STATUS_CHIPS = [
  { k: 'DRAFT', v: 'draft' },
  { k: 'APPROVED', v: 'approved' },
  { k: 'SENT', v: 'sent' }
];

async function sectionPitches(body, run) {
  if (!spFilter) spFilter = 'draft';
  renderFilters(PITCH_STATUS_CHIPS);

  const res = await SBW.lb.pitches(spFilter);
  if (!isCurrent(run)) return;

  if (!res.ok) {
    if (res.code === 'unauthorized') { initSidePanel(); return; }
    body.innerHTML = spEmpty('⚠', 'SOMETHING BROKE', SBWLinkBuildingUI.lbErrorMessage(res.code, (res.data && res.data.error)), 'spRetryLb', 'TRY AGAIN');
    document.getElementById('spRetryLb')?.addEventListener('click', () => loadSection('pitches'));
    setFoot('');
    return;
  }

  const pitches = (res.data && res.data.pitches) || [];
  spSenderAddress = (res.data && res.data.senderAddress) || null;
  spPitchesById = {};
  pitches.forEach(p => { spPitchesById[p.id] = p; });

  if (!pitches.length) {
    body.innerHTML = spEmpty('⌸', 'NO PITCHES', `Nothing ${spFilter} right now.`);
    setFoot('0 pitches');
    return;
  }

  const renderCard = spFilter === 'approved' ? pitchApprovedCard : spFilter === 'sent' ? pitchSentRow : pitchDraftCard;
  body.innerHTML = pitches.map(renderCard).join('');

  wirePitchActions(body);
  setFoot(`${pitches.length} pitch${pitches.length === 1 ? '' : 'es'}`);
}

function wirePitchActions(body) {
  body.querySelectorAll('[data-act="expand"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.lb-card');
      const id = card.dataset.id;
      const bodyEl = card.querySelector('.lb-pitch-body');
      const full = (spPitchesById[id] && spPitchesById[id].body_markdown) || '';
      const collapsed = bodyEl.dataset.collapsed !== 'false';
      if (collapsed) {
        bodyEl.textContent = full;
        bodyEl.dataset.collapsed = 'false';
        btn.textContent = 'Collapse';
      } else {
        bodyEl.textContent = full.length > 180 ? full.slice(0, 180) + '…' : full;
        bodyEl.dataset.collapsed = 'true';
        btn.textContent = 'Expand';
      }
    });
  });

  body.querySelectorAll('[data-act="approve"]').forEach(btn => {
    btn.addEventListener('click', () => reviewPitch(btn.closest('.lb-card').dataset.id, 'approve'));
  });
  body.querySelectorAll('[data-act="reject"]').forEach(btn => {
    btn.addEventListener('click', () => reviewPitch(btn.closest('.lb-card').dataset.id, 'reject'));
  });
  body.querySelectorAll('[data-act="gmail"]').forEach(btn => {
    btn.addEventListener('click', () => openGmailCompose(btn.closest('.lb-card').dataset.id));
  });
  body.querySelectorAll('[data-act="sent"]').forEach(btn => {
    btn.addEventListener('click', () => markPitchSent(btn.closest('.lb-card').dataset.id));
  });
  body.querySelectorAll('[data-act="set-sender"]').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); openSetSenderPage(); });
  });
}

async function reviewPitch(id, action) {
  if (lbInFlight.has(id)) return;

  let reason;
  if (action === 'reject') {
    // Server max (pitches/review schema): reason.max(1000) — pitches allow a
    // longer reason than outlets (500) since it doubles as angle/template
    // tuning data (§10).
    const input = window.prompt('Reason for rejecting this pitch (3-1000 characters):');
    if (input === null) return; // cancelled
    reason = input.trim();
    if (reason.length < 3) { setFoot('Reason must be at least 3 characters'); return; }
    if (reason.length > 1000) { setFoot('Reason must be 1000 characters or fewer'); return; }
  }

  lbInFlight.add(id);
  setCardActionsDisabled(id, true);
  try {
    const res = await SBW.lb.reviewPitch(id, action, reason ? { reason } : {});
    if (res.code === 'unauthorized') { initSidePanel(); return; }
    if (res.ok) {
      setFoot(action === 'approve' ? 'Pitch approved' : 'Pitch rejected');
      if (spSection === 'pitches') loadSection('pitches');
      return;
    }
    setFoot(SBWLinkBuildingUI.pitchReviewErrorMessage(res) || 'Failed to record review');
  } finally {
    lbInFlight.delete(id);
    setCardActionsDisabled(id, false);
  }
}

function openGmailCompose(id) {
  const p = spPitchesById[id];
  const m = p && SBWLinkBuildingUI.pitchCardModel(p);
  if (!p || !spSenderAddress || !m.email) { setFoot('Missing sender address or contact email'); return; }

  const url = SBWLinkBuildingUI.gmailComposeUrl({
    senderAddress: spSenderAddress,
    email: m.email,
    subject: m.subject,
    body: m.body
  });
  chrome.tabs.create({ url });
}

async function markPitchSent(id) {
  if (lbInFlight.has(id)) return;

  lbInFlight.add(id);
  setCardActionsDisabled(id, true);
  try {
    const res = await SBW.lb.markSent(id);
    if (res.code === 'unauthorized') { initSidePanel(); return; }
    if (res.ok) {
      setFoot('Marked sent');
      if (spSection === 'pitches') loadSection('pitches');
      return;
    }
    setFoot(SBWLinkBuildingUI.pitchReviewErrorMessage(res) || 'Failed to mark sent');
  } finally {
    lbInFlight.delete(id);
    setCardActionsDisabled(id, false);
  }
}

/* ---------- results ---------- */

async function sectionResults(body, run) {
  renderFilters([]);

  const res = await SBW.lb.results();
  if (!isCurrent(run)) return;

  if (!res.ok) {
    if (res.code === 'unauthorized') { initSidePanel(); return; }
    body.innerHTML = spEmpty('⚠', 'SOMETHING BROKE', SBWLinkBuildingUI.lbErrorMessage(res.code, (res.data && res.data.error)), 'spRetryLb', 'TRY AGAIN');
    document.getElementById('spRetryLb')?.addEventListener('click', () => loadSection('results'));
    setFoot('');
    return;
  }

  const data = res.data || {};
  const rows = SBWLinkBuildingUI.funnelRows(data);
  const spend = (data.spend && data.spend.totalUsd) || 0;
  const placements = (data.placements || []).slice(0, 5);
  const sends = (data.sends || []).slice(0, 5);

  body.innerHTML = `
    <div class="lb-results-spend">Spend to date: $${spEsc(spend.toFixed(2))}</div>
    <table class="lb-funnel">
      ${rows.map(r => `<tr><td>${spEsc(r.label)}</td><td>${spEsc(r.value)}</td></tr>`).join('')}
    </table>
    <div class="lb-results-sub">LAST PLACEMENTS</div>
    ${placements.length
      ? placements.map(p => `<div class="sp-row-s lb-list-row">${spEsc(p.outlet_domain || '—')} · ${spEsc(p.anchor_text || 'no anchor')} · ${spEsc(spDate(p.published_at || p.detected_at))}</div>`).join('')
      : '<div class="sp-row-s lb-list-row">None yet</div>'}
    <div class="lb-results-sub">LAST SENDS</div>
    ${sends.length
      ? sends.map(s => `<div class="sp-row-s lb-list-row">${spEsc(s.domain || '—')} · ${spEsc(s.full_name || '')} · ${spEsc(spDate(s.sent_at))}</div>`).join('')
      : '<div class="sp-row-s lb-list-row">None yet</div>'}
  `;

  const prospectsTotal = rows.find(r => r.label === 'Prospects')?.value ?? 0;
  setFoot(`${prospectsTotal} prospect${prospectsTotal === 1 ? '' : 's'} tracked`);
}

/* ---------- footer ---------- */

function setFoot(text) {
  document.getElementById('spFootStat').textContent = text;
}

// Swap this tab's panel to the themed page-checks panel (src/panel/). Both
// panels ship; setOptions changes the path for this tab only, and the themed
// panel's own footer link swaps back. No manifest default is touched.
document.getElementById('spPageChecks').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.setOptions({ tabId: tab && tab.id, path: 'src/panel/panel.html', enabled: true });
  } catch (e) {
    console.warn('[SBW] could not open the page-checks panel', e);
  }
});

document.getElementById('spExport').addEventListener('click', async () => {
  if (!spBiz) { setFoot('Pick a business first'); return; }
  try {
    const citations = await SBW.ct.citations(spBiz.id);
    const head = ['Directory', 'URL', 'Status', 'NAP score', 'Found name', 'Found phone', 'Last checked'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(',')].concat(citations.map(c => [
      c.directory_name, c.directory_url, c.status,
      c.nap_match_score != null ? Math.round(c.nap_match_score * 100) + '%' : '',
      c.found_name || '', c.found_phone || '',
      c.last_checked_at || c.created_at
    ].map(esc).join(','))).join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `citations-${spBiz.name.replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setFoot(`Exported ${citations.length} citations`);
  } catch (e) {
    setFoot('Export failed: ' + SBWCitations.ctErrorMessage(e.code, e.message));
  }
});

initSidePanel();
