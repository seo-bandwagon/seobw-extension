// SEO Bandwagon side panel — citations API (src/lib/api.js SBW.ct.*)
// Sections: businesses · campaigns · citations

let spSection = 'businesses';
let spBiz = null;           // selected business
let spBusinesses = [];
let spFilter = '';          // active filter chip value
let spRunId = 0;            // bumped per render so stale async loops bail out

const SP_STORE_KEY = 'cfSelectedBusiness';

/* ---------- helpers ---------- */

function spEsc(t) {
  if (t === null || t === undefined) return '';
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    document.getElementById('spFilters').innerHTML = '';
    body.innerHTML = spEmpty('◎', 'NOT CONNECTED', 'Open the extension options page and connect your SEO Bandwagon account to see your citation data here.', 'spConnect', 'CONNECT');
    document.getElementById('spConnect').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  document.getElementById('spUser').textContent = auth.user ? spInitials(auth.user.name || auth.user.email) : '';
  document.getElementById('spUser').title = auth.user?.email || '';

  try {
    spBusinesses = await SBW.ct.businesses();
  } catch (e) {
    body.innerHTML = spEmpty('⚠', "CAN'T REACH SEO BANDWAGON", SBWCitations.ctErrorMessage(e.code, e.message), 'spRetry', 'TRY AGAIN');
    document.getElementById('spRetry').addEventListener('click', initSidePanel);
    return;
  }

  const stored = await chrome.storage.local.get(SP_STORE_KEY);
  spBiz = spBusinesses.find(b => b.id === stored[SP_STORE_KEY]) || spBusinesses[0] || null;

  loadSection(spSection);
}

/* ---------- nav + filters ---------- */

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
    } catch (e) { if (!isCurrent(run)) return; }
  }
}

/* ---------- campaigns ---------- */

async function sectionCampaigns(body, run) {
  renderFilters([]);
  if (!spBiz) { body.innerHTML = spEmpty('◎', 'PICK A BUSINESS', 'Select a business first — campaigns run per business.'); return; }

  const campaigns = await SBW.ct.campaigns(spBiz.id);
  if (!isCurrent(run)) return;

  body.innerHTML = `
    <button class="sp-trigger" id="spRun">RUN NEW CAMPAIGN</button>
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

  document.getElementById('spRun').addEventListener('click', () => runCampaign(spBiz.id));

  const running = campaigns.filter(c => c.status === 'running' || c.status === 'pending').length;
  setFoot(`${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}${running ? ` · ${running} active` : ''}`);
}

// The site runs a campaign synchronously and can take longer than the
// client's 60s timeout — a network/timeout failure (or a 504 from a proxy in
// between) doesn't mean the campaign didn't start, so poll for its outcome
// instead of reporting failure. See SBWCitations.shouldPollAfterTrigger /
// pollUntilDone (src/lib/citations-ui.js).
async function runCampaign(businessId) {
  const btn = document.getElementById('spRun');
  if (btn) { btn.disabled = true; btn.textContent = 'STARTING…'; }

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
      initSidePanel();
      return;
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'RUN NEW CAMPAIGN'; }
      setFoot('Failed: ' + SBWCitations.ctErrorMessage(e.code, e.message));
      return;
    }
  }

  // Refresh stats/list only if the user hasn't switched businesses or
  // sections while the campaign (or the poll) was running.
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

/* ---------- footer ---------- */

function setFoot(text) {
  document.getElementById('spFootStat').textContent = text;
}

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
