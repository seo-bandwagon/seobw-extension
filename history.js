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
