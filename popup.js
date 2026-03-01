// SEO Bandwagon Extension - Popup UI

let pageData = null;

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
    pageData = response;
    renderResults(response);
    
    // Auto-save to local storage
    autoSaveCapture(response);
    
    // Update badge
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
      <div class="loading">Cannot analyze this page.<br><small style="color:#666">Try refreshing and click again.</small></div>
    `;
  }
});

function renderResults(data) {
  const content = document.getElementById('content');
  const score = data.seoScore || { score: 0, grade: 'F', issues: [] };
  
  content.innerHTML = `
    <div class="header">
      <h1><img src="icons/icon48.png" alt="">SEO Bandwagon</h1>
      <a href="https://seobandwagon.dev/dashboard" target="_blank">Dashboard →</a>
    </div>
    
    <div class="url">${esc(data.url)}</div>
    
    <!-- Score + Quick Stats -->
    <div class="score-header">
      <div class="score-circle score-${score.grade.toLowerCase()}">
        <span class="grade">${score.grade}</span>
        <span class="number">${score.score}/100</span>
      </div>
      <div class="score-stats">
        <div class="stat">
          <div class="stat-value">${data.content.wordCount}</div>
          <div class="stat-label">Words</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.links.internal.count}</div>
          <div class="stat-label">Links</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.images.total}</div>
          <div class="stat-label">Images</div>
        </div>
      </div>
    </div>
    
    <!-- Issues Section -->
    <div class="section open" data-section="issues" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Issues (${score.issues.length})</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        ${score.issues.length > 0 
          ? score.issues.map(i => `<div class="issue">⚠️ ${esc(i)}</div>`).join('')
          : '<div class="pass">✓ No major issues found</div>'}
      </div>
    </div>
    
    <!-- SERP Preview Section -->
    <div class="section" data-section="serp" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">SERP Preview</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="serp-preview">
          <div class="serp-title">${esc(data.meta.title.text.slice(0, 60))}${data.meta.title.length > 60 ? '...' : ''}</div>
          <div class="serp-url">${esc(data.url.replace(/^https?:\/\//, '').slice(0, 50))}</div>
          <div class="serp-desc">${esc(data.meta.description.text.slice(0, 155))}${data.meta.description.length > 155 ? '...' : ''}</div>
        </div>
        <div class="data-row">
          <span class="data-label">Title length</span>
          <span class="data-value ${data.meta.title.length <= 60 ? 'good' : 'bad'}">${data.meta.title.length}/60</span>
        </div>
        <div class="data-row">
          <span class="data-label">Description length</span>
          <span class="data-value ${data.meta.description.length <= 160 ? 'good' : 'bad'}">${data.meta.description.length}/160</span>
        </div>
      </div>
    </div>
    
    <!-- Meta Tags Section -->
    <div class="section" data-section="meta" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Meta Tags</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="data-row">
          <span class="data-label">Canonical</span>
          <span class="data-value">${data.meta.canonical ? '✓ Set' : '✗ Missing'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Robots</span>
          <span class="data-value">${data.meta.robots || 'Default'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Open Graph</span>
          <span class="data-value ${data.meta.openGraph.title ? 'good' : 'warn'}">${data.meta.openGraph.title ? '✓ Set' : '✗ Missing'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Schema.org</span>
          <span class="data-value ${data.meta.schema.length > 0 ? 'good' : 'warn'}">${data.meta.schema.length} block(s)</span>
        </div>
      </div>
    </div>
    
    <!-- Headings Section -->
    <div class="section" data-section="headings" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Headings</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="data-row">
          <span class="data-label">H1</span>
          <span class="data-value ${data.headings.h1.length === 1 ? 'good' : data.headings.h1.length > 1 ? 'warn' : 'bad'}">${data.headings.h1.length} tag(s)</span>
        </div>
        ${data.headings.h1.length > 0 ? `<div style="color:#888;font-size:10px;margin-bottom:4px">"${esc(data.headings.h1[0].slice(0,50))}"</div>` : ''}
        <div class="data-row">
          <span class="data-label">H2</span>
          <span class="data-value">${data.headings.h2.length}</span>
        </div>
        <div class="data-row">
          <span class="data-label">H3-H6</span>
          <span class="data-value">${data.headings.h3.length + data.headings.h4.length + data.headings.h5.length + data.headings.h6.length}</span>
        </div>
      </div>
    </div>
    
    <!-- Links Section -->
    <div class="section" data-section="links" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Links & Images</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="data-row">
          <span class="data-label">Internal links</span>
          <span class="data-value">${data.links.internal.count}</span>
        </div>
        <div class="data-row">
          <span class="data-label">External links</span>
          <span class="data-value">${data.links.external.count}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Nofollow links</span>
          <span class="data-value">${data.links.nofollow}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Images</span>
          <span class="data-value">${data.images.total}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Missing alt text</span>
          <span class="data-value ${data.images.missingAlt.count === 0 ? 'good' : 'bad'}">${data.images.missingAlt.count}</span>
        </div>
      </div>
    </div>
    
    <!-- Content Section -->
    <div class="section" data-section="content" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Content Analysis</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="data-row">
          <span class="data-label">Word count</span>
          <span class="data-value">${data.content.wordCount.toLocaleString()}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Sentences</span>
          <span class="data-value">${data.content.sentenceCount}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Reading level</span>
          <span class="data-value">Grade ${data.content.readability.fleschKincaid}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Flesch ease</span>
          <span class="data-value">${data.content.readability.fleschEase}/100</span>
        </div>
        <div style="margin-top:8px;color:#888;font-size:10px">Top words:</div>
        <div class="tags">
          ${data.content.topWords.slice(0,8).map(w => `<span class="tag">${esc(w.word)}<span class="tag-count">${w.count}</span></span>`).join('')}
        </div>
      </div>
    </div>
    
    <!-- Technical Section -->
    <div class="section" data-section="tech" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Technical</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="data-row">
          <span class="data-label">DOM elements</span>
          <span class="data-value ${data.technical.domElements > 1500 ? 'warn' : ''}">${data.technical.domElements.toLocaleString()}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Scripts</span>
          <span class="data-value">${data.technical.scripts}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Stylesheets</span>
          <span class="data-value">${data.technical.stylesheets}</span>
        </div>
        <div class="data-row">
          <span class="data-label">URL depth</span>
          <span class="data-value">${data.technical.urlDepth} level(s)</span>
        </div>
        ${data.technical.loadTimeMs ? `
        <div class="data-row">
          <span class="data-label">Load time</span>
          <span class="data-value ${data.technical.loadTimeMs < 2000 ? 'good' : 'warn'}">${(data.technical.loadTimeMs / 1000).toFixed(2)}s</span>
        </div>
        ` : ''}
      </div>
    </div>
    
    <!-- Actions -->
    <div class="actions">
      <button id="saveBtn">Save</button>
      <button id="copyBtn" class="secondary">Copy JSON</button>
      <button id="exportBtn" class="secondary">Export</button>
    </div>
    <div class="status" id="status"></div>
  `;
  
  // Setup collapsible sections
  document.querySelectorAll('.section-header').forEach(header => {
    header.onclick = function() {
      console.log('Section clicked:', this.parentElement.dataset.section);
      this.parentElement.classList.toggle('open');
    };
  });
  console.log('Sections initialized:', document.querySelectorAll('.section-header').length);
  
  // Setup buttons
  document.getElementById('saveBtn').addEventListener('click', () => saveData(data));
  document.getElementById('copyBtn').addEventListener('click', () => copyToClipboard(data));
  document.getElementById('exportBtn').addEventListener('click', () => exportAsJson(data));
}

async function autoSaveCapture(data) {
  // Always save to local storage when popup opens
  const key = `capture_${Date.now()}`;
  
  // Check if we already captured this URL recently (within 1 minute)
  const items = await chrome.storage.local.get(null);
  const recentCapture = Object.entries(items)
    .filter(([k]) => k.startsWith('capture_'))
    .find(([k, v]) => v.url === data.url && (Date.now() - parseInt(k.split('_')[1])) < 60000);
  
  if (!recentCapture) {
    chrome.storage.local.set({ [key]: data });
    console.log('Auto-saved capture:', data.url);
  }
  
  // Cleanup: keep only last 500 captures
  const captureKeys = Object.keys(items)
    .filter(k => k.startsWith('capture_'))
    .sort()
    .reverse();
  
  if (captureKeys.length > 500) {
    chrome.storage.local.remove(captureKeys.slice(500));
  }
}

function esc(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function saveData(data) {
  const btn = document.getElementById('saveBtn');
  const status = document.getElementById('status');
  
  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  const settings = await new Promise(resolve => {
    chrome.storage.sync.get({
      apiKey: '',
      apiUrl: 'https://api.seobandwagon.dev',
      localBackup: true
    }, resolve);
  });
  
  // Local backup
  if (settings.localBackup) {
    const key = `capture_${Date.now()}`;
    chrome.storage.local.set({ [key]: data });
  }
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) {
      headers['Authorization'] = `Bearer ${settings.apiKey}`;
    }
    
    const response = await fetch(`${settings.apiUrl}/v1/captures`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
    
    if (response.ok) {
      btn.textContent = '✓ Saved';
      btn.classList.add('success');
      status.textContent = 'Saved to SEO Bandwagon';
    } else {
      throw new Error(response.status === 401 ? 'Invalid API key' : 'API error');
    }
  } catch (err) {
    btn.textContent = 'Save';
    btn.disabled = false;
    status.textContent = err.message + ' (saved locally)';
  }
}

function copyToClipboard(data) {
  navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
    document.getElementById('status').textContent = 'Copied to clipboard!';
    setTimeout(() => { document.getElementById('status').textContent = ''; }, 2000);
  });
}

function exportAsJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seo-${new URL(data.url).hostname}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
