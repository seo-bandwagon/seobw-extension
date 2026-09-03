let allCaptures = [];

// Load captures
async function loadCaptures() {
  const items = await chrome.storage.local.get(null);
  allCaptures = Object.entries(items)
    .filter(([k]) => k.startsWith('capture_'))
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  
  renderCaptures(allCaptures);
}

function renderCaptures(captures) {
  const list = document.getElementById('captureList');
  
  if (captures.length === 0) {
    list.innerHTML = '<div class="empty-state">No captures yet. Analyze some pages!</div>';
    return;
  }
  
  list.innerHTML = captures.map(c => `
    <div class="capture-item" data-key="${c.key}">
      <div class="capture-url">${c.url}</div>
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
  const query = e.target.value.toLowerCase();
  const filtered = allCaptures.filter(c => c.url.toLowerCase().includes(query));
  renderCaptures(filtered);
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

// Sync to SEO Bandwagon
document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  const status = document.getElementById('syncStatus');

  if (allCaptures.length === 0) {
    status.textContent = 'No captures to sync.';
    status.style.display = 'block';
    status.style.background = '#ffd16633';
    status.style.color = '#ffd166';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Syncing...';
  status.style.display = 'block';
  status.style.background = '#4cc9f033';
  status.style.color = '#4cc9f0';
  status.textContent = `Syncing ${allCaptures.length} captures...`;

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const capture of allCaptures) {
    try {
      const res = await fetch('https://seobandwagon.com/api/v1/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capture)
      });
      if (res.ok) {
        synced++;
      } else if (res.status === 409) {
        skipped++; // duplicate
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
    status.textContent = `Synced ${synced} / ${allCaptures.length} (${skipped} duplicates, ${failed} failed)`;
  }

  btn.disabled = false;
  btn.textContent = 'Sync to SEO Bandwagon';

  if (failed === 0) {
    status.style.background = '#06d6a033';
    status.style.color = '#06d6a0';
    status.textContent = `Done! ${synced} synced, ${skipped} already existed.`;
  } else {
    status.style.background = '#ef476f33';
    status.style.color = '#ef476f';
    status.textContent = `${synced} synced, ${skipped} duplicates, ${failed} failed.`;
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
