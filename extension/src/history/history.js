let allCaptures = [];

// A captured page's URL is untrusted, attacker-controllable text (it's
// whatever page the user visited) rendered straight into innerHTML below —
// escape it the same way popup.js's esc()/sidepanel.js's spEsc() do.
function esc(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Load captures
async function loadCaptures() {
  const items = await chrome.storage.local.get(null);
  allCaptures = Object.entries(items)
    .filter(([k]) => k.startsWith('capture_'))
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  
  renderCaptures(allCaptures);
  renderLegacyBanner(allCaptures);
}

// Sync status -> badge pill class + label. A capture without a `sync` field
// (saved before this feature existed) reads as pending, same as SBWSync.isDue.
const SYNC_BADGE = {
  synced: { label: 'synced', cls: 'b-ok' },
  pending: { label: 'pending', cls: 'b-warn' },
  duplicate: { label: 'duplicate', cls: 'b-pink' },
  failed: { label: 'failed', cls: 'b-err' },
  skipped: { label: 'skipped', cls: '' }
};

function syncBadge(capture) {
  const status = (capture.sync && capture.sync.status) || 'pending';
  const badge = SYNC_BADGE[status] || SYNC_BADGE.pending;
  return `<span class="badge-mono ${badge.cls}">${badge.label}</span>`;
}

function countByStatus(captures) {
  const counts = { synced: 0, pending: 0, duplicate: 0, failed: 0, skipped: 0 };
  captures.forEach(c => {
    const status = (c.sync && c.sync.status) || 'pending';
    if (counts[status] === undefined) counts[status] = 0;
    counts[status]++;
  });
  return counts;
}

// Captures from before 1.5.0 are stamped `{ status: 'skipped', error:
// 'legacy' }` by SBW.markLegacyPending() (src/lib/api.js) rather than
// `pending`, so a 1.4.0 upgrader's local backlog isn't silently bulk-
// uploaded the first time the sync alarm fires. This banner is the opt-in.
function legacyPendingCaptures(captures) {
  return captures.filter(c => c.sync && c.sync.status === 'skipped' && c.sync.error === 'legacy');
}

function renderLegacyBanner(captures) {
  const banner = document.getElementById('legacyBanner');
  if (!banner) return;

  const legacy = legacyPendingCaptures(captures);
  if (!legacy.length) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  banner.hidden = false;
  const n = legacy.length;
  banner.innerHTML = `
    <span>${n} capture${n === 1 ? '' : 's'} from before 1.5.0 ${n === 1 ? 'is' : 'are'} stored locally only</span>
    <button type="button" id="includeLegacyBtn">Include them in sync</button>`;
  document.getElementById('includeLegacyBtn').addEventListener('click', includeLegacyInSync);
}

// Converts every legacy-skipped capture back to `pending` (via
// SBWSync.unskipLegacy) and drains — same bounded manual-drain size the
// "Sync to SEO Bandwagon" button uses.
async function includeLegacyInSync() {
  const btn = document.getElementById('includeLegacyBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Including…'; }

  try {
    const legacy = legacyPendingCaptures(allCaptures);
    const updates = {};
    legacy.forEach(c => {
      const record = Object.assign({}, c);
      delete record.key;
      record.sync = SBWSync.unskipLegacy(c.sync);
      updates[c.key] = record;
    });
    if (Object.keys(updates).length) {
      await chrome.storage.local.set(updates);
    }
    showSyncStatus('Syncing…', 'info');
    await runSync(60);
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Include them in sync'; }
  }
}

function renderCaptures(captures, query) {
  const list = document.getElementById('captureList');

  if (captures.length === 0) {
    // #62: an empty search result isn't an empty history.
    list.innerHTML = query && allCaptures.length
      ? `<div class="empty-state">No captures match “${esc(query)}”.</div>`
      : '<div class="empty-state">No captures yet. Analyze some pages!</div>';
    return;
  }

  list.innerHTML = captures.map(c => `
    <div class="capture-item" data-key="${c.key}">
      <div class="capture-url">${esc(c.url)} ${syncBadge(c)}</div>
      <div class="capture-meta">
        <span class="capture-stat">📅 ${new Date(c.capturedAt).toLocaleString()}</span>
        <span class="capture-stat">📝 ${c.content?.wordCount || 0} words</span>
        <span class="capture-stat">🔗 ${(c.links?.internal?.count || 0) + (c.links?.external?.count || 0)} links</span>
        <span class="capture-stat">🖼️ ${c.images?.total || 0} images</span>
      </div>
    </div>
  `).join('');
  
  // Add click handlers
  list.querySelectorAll('.capture-item').forEach(item => {
    item.addEventListener('click', () => {
      const capture = allCaptures.find(c => c.key === item.dataset.key);
      showModal(capture);
    });
  });
}

function showModal(capture) {
  document.getElementById('modalTitle').textContent = capture.url;
  document.getElementById('modalData').textContent = JSON.stringify(capture, null, 2);
  document.getElementById('modal').classList.add('open');
}

// Search
document.getElementById('search').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  renderCaptures(SBWHistorySearch.filter(allCaptures, query), query);
});

// Export URLs only (for crawlers)
document.getElementById('exportUrlsBtn').addEventListener('click', () => {
  const urls = allCaptures.map(c => c.url).join('\n');
  const blob = new Blob([urls], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seo-urls-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// Export all
document.getElementById('exportAllBtn').addEventListener('click', () => {
  const json = JSON.stringify(allCaptures, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seo-captures-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

function showSyncStatus(text, tone) {
  const status = document.getElementById('syncStatus');
  const tones = {
    info: ['#4cc9f033', '#4cc9f0'],
    success: ['#06d6a033', '#06d6a0'],
    warn: ['#ffd16633', '#ffd166'],
    error: ['#ef476f33', '#ef476f']
  };
  const [background, color] = tones[tone] || tones.info;
  status.style.display = 'block';
  status.style.background = background;
  status.style.color = color;
  status.textContent = text;
}

// Runs a bounded drain, then reports counts across ALL local captures (not
// just the ones this run touched) so the message reflects the real backlog.
async function runSync(max) {
  const result = await SBW.drainPendingCaptures({ max });
  await loadCaptures();
  const counts = countByStatus(allCaptures);

  if (result.stoppedOn === 'rate_limited') {
    const mins = result.nextAt ? Math.max(1, Math.round((result.nextAt - Date.now()) / 60000)) : null;
    showSyncStatus(`Rate limit reached — next batch in ~${mins ?? '?'} min`, 'warn');
  } else if (result.stoppedOn === 'unauthorized' || result.stoppedOn === 'no_key') {
    showSyncStatus('Add your API key in Options', 'error');
  } else if (result.stoppedOn === 'collection_off') {
    showSyncStatus('Data collection is off — turn it on in Options to sync', 'warn');
  } else if (counts.failed > 0) {
    showSyncStatus(
      `${counts.synced} synced, ${counts.duplicate} duplicates, ${counts.pending} pending, ${counts.failed} failed.`,
      'error'
    );
  } else {
    showSyncStatus(
      `${counts.synced} synced, ${counts.duplicate} duplicates, ${counts.pending} pending.`,
      'success'
    );
  }

  return { result, counts };
}

// Sync to SEO Bandwagon
document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');

  if (allCaptures.length === 0) {
    showSyncStatus('No captures to sync.', 'warn');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Syncing...';
  showSyncStatus('Syncing…', 'info');

  try {
    await runSync(60);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync to SEO Bandwagon';
  }
});

// Retry failed: reset every failed capture back to pending, then drain.
document.getElementById('retryFailedBtn').addEventListener('click', async () => {
  const btn = document.getElementById('retryFailedBtn');
  const failedCaptures = allCaptures.filter(c => c.sync && c.sync.status === 'failed');

  if (failedCaptures.length === 0) {
    showSyncStatus('No failed captures to retry.', 'warn');
    return;
  }

  btn.disabled = true;
  try {
    const updates = {};
    failedCaptures.forEach(c => {
      const record = Object.assign({}, c);
      delete record.key;
      record.sync = SBWSync.resetFailed(c.sync);
      updates[c.key] = record;
    });
    await chrome.storage.local.set(updates);
    await runSync(60);
  } finally {
    btn.disabled = false;
  }
});

// Clear history
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (confirm('Delete all local captures? This cannot be undone.')) {
    const keys = allCaptures.map(c => c.key);
    await chrome.storage.local.remove(keys);
    allCaptures = [];
    renderCaptures([]);
  }
});

// Close modal
document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modal').classList.remove('open');
});

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') {
    document.getElementById('modal').classList.remove('open');
  }
});

// Init
loadCaptures();
