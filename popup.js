// SEO Bandwagon Extension - Popup UI

let pageData = null;
let currentTab = null;

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  currentTab = tab;
  
  try {
    // Check background cache first — instant if same page
    const cached = await chrome.runtime.sendMessage({
      action: 'getCachedAnalysis',
      tabId: tab.id,
      url: tab.url
    });

    if (cached && cached.hit) {
      pageData = cached.data;
      renderResults(cached.data);
      const s = document.getElementById('status');
      if (s) { s.textContent = '⚡ Cached'; setTimeout(() => { s.textContent = ''; }, 1500); }
      return;
    }

    // No cache — run fresh analysis
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
    pageData = response;
    renderResults(response);
    autoSaveCapture(response);

    // Store in background cache for next open
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
      <div class="loading">Cannot analyze this page.<br><small style="color:#666">Try refreshing and click again.</small></div>
    `;
  }
});

function renderResults(data) {
  const content = document.getElementById('content');
  const score = data.seoScore || { score: 0, grade: 'F', issues: [] };
  const techStack = data.techStack || [];
  
  let html = `
    <div class="header">
      <h1><img src="icons/icon48.png" alt="">SEO Bandwagon</h1>
      <a href="https://seobandwagon.dev/dashboard" target="_blank">Dashboard</a> · <a href="https://seobandwagon.com" target="_blank">seobandwagon.com</a> · <a href="${chrome.runtime.getURL('history.html')}" target="_blank">History →</a>
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
          <div class="stat-value">${data.content.wordCount.toLocaleString()}</div>
          <div class="stat-label">Words</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.content.readability.level || 'N/A'}</div>
          <div class="stat-label">Reading</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.links.internal.count + data.links.external.count}</div>
          <div class="stat-label">Links</div>
        </div>
      </div>
    </div>
    
    <!-- Top Keywords Section (N-grams) - AT TOP -->
    <div class="section open" data-section="keywords" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Top Keywords</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div style="margin-bottom:8px;color:#888;font-size:10px">Single words:</div>
        <div class="tags">
          ${data.content.topWords.slice(0,10).map(w => `<span class="tag">${esc(w.word)}<span class="tag-count">${w.count}</span></span>`).join('')}
        </div>
        <div style="margin-top:10px;margin-bottom:8px;color:#888;font-size:10px">Phrases (2-3 words):</div>
        <div class="tags">
          ${data.content.topPhrases.slice(0,8).map(p => `<span class="tag">${esc(p.phrase)}<span class="tag-count">${p.count}</span></span>`).join('')}
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
    
    <!-- Headings Section (HTML SEO) -->
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
        <button class="highlight-btn" data-type="headings">Highlight Headings</button>
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
          <span class="data-label">Title</span>
          <span class="data-value"><span class="length-badge ${data.meta.title.length <= 60 ? 'good' : 'bad'}">${data.meta.title.length}/60</span></span>
        </div>
        <div class="data-row">
          <span class="data-label">Description</span>
          <span class="data-value"><span class="length-badge ${data.meta.description.length <= 160 ? 'good' : 'bad'}">${data.meta.description.length}/160</span></span>
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
          <span class="data-label">Twitter Card</span>
          <span class="data-value ${data.meta.twitter.card ? 'good' : 'warn'}">${data.meta.twitter.card || '✗ Missing'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Schema.org</span>
          <span class="data-value ${data.meta.schema.length > 0 ? 'good' : 'warn'}">${data.meta.schema.length} block(s)</span>
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
        <div class="highlight-buttons">
          <button class="highlight-btn" data-type="links-internal">Internal</button>
          <button class="highlight-btn" data-type="links-external">External</button>
          <button class="highlight-btn" data-type="nofollow">Nofollow</button>
          <button class="highlight-btn" data-type="images-missing-alt">Missing Alt</button>
        </div>
      </div>
    </div>
    
    <!-- Tech Stack Section -->
    ${techStack.length > 0 ? `
    <div class="section" data-section="techstack" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Tech Stack (${techStack.length})</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="tech-badges">
          ${techStack.map(t => `<span class="tech-badge" title="${t.category}">${t.icon} ${t.name}</span>`).join('')}
        </div>
      </div>
    </div>
    ` : ''}
    
    <!-- Content Stats Section -->
    <div class="section" data-section="content" onclick="this.classList.toggle('open')">
      <div class="section-header">
        <span class="section-title">Content Stats</span>
        <span class="section-arrow">▼</span>
      </div>
      <div class="section-content">
        <div class="data-row">
          <span class="data-label">Word count</span>
          <span class="data-value">${data.content.wordCount.toLocaleString()}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Characters</span>
          <span class="data-value">${data.content.charCount.toLocaleString()}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Sentences</span>
          <span class="data-value">${data.content.sentenceCount}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Reading level</span>
          <span class="data-value">${data.content.readability.level} (Grade ${data.content.readability.fleschKincaid})</span>
        </div>
        <div class="data-row">
          <span class="data-label">Flesch ease</span>
          <span class="data-value">${data.content.readability.fleschEase}/100</span>
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
    `;

  // ========== ADVANCED ANALYZERS (v1.1.0) ==========


  // N-grams
  if (data.ngrams) {
    const ng = data.ngrams;
    html += renderSection('ngrams', 'N-gram Analysis', `
      ${dataRow('Total words', ng.totalWords.toLocaleString())}
      ${dataRow('Unique words', ng.uniqueWords.toLocaleString())}
      ${ng.bigrams.length > 0 ? '<div style="color:#888;font-size:10px;margin-top:4px">Top 2-word phrases:</div>' : ''}
      <div class="tags">${ng.bigrams.slice(0,6).map(b => '<span class="tag">' + esc(b.phrase) + '<span class="tag-count">' + b.count + '</span></span>').join('')}</div>
      ${ng.trigrams.length > 0 ? '<div style="color:#888;font-size:10px;margin-top:4px">Top 3-word phrases:</div>' : ''}
      <div class="tags">${ng.trigrams.slice(0,5).map(t => '<span class="tag">' + esc(t.phrase) + '<span class="tag-count">' + t.count + '</span></span>').join('')}</div>
    `);
  }

  // Keyword Density
  if (data.keywordDensity && data.keywordDensity.totalWords > 0) {
    const kd = data.keywordDensity;
    html += renderSection('keywords', 'Keyword Density', `
      ${kd.titleTerms.length > 0 ? '<div style="color:#888;font-size:10px;margin-bottom:4px">Title terms:</div>' : ''}
      ${kd.titleTerms.slice(0, 5).map(t => dataRow(t.term, t.count + 'x (' + t.density + '%)')).join('')}
      ${kd.h1Terms.length > 0 ? '<div style="color:#888;font-size:10px;margin-bottom:4px;margin-top:4px">H1 terms:</div>' : ''}
      ${kd.h1Terms.slice(0, 5).map(t => dataRow(t.term, t.count + 'x (' + t.density + '%)')).join('')}
    `);
  }

  // Core Web Vitals
  if (data.webVitals) {
    const wv = data.webVitals;
    html += renderSection('webvitals', 'Core Web Vitals', `
      ${dataRow('LCP', wv.lcp ? wv.lcp + 'ms' : 'N/A', wv.lcp && wv.lcp <= 2500 ? 'good' : wv.lcp && wv.lcp <= 4000 ? 'warn' : '')}
      ${dataRow('CLS', wv.cls !== null ? wv.cls : 'N/A', wv.cls !== null && wv.cls <= 0.1 ? 'good' : wv.cls !== null && wv.cls <= 0.25 ? 'warn' : '')}
      ${dataRow('INP', wv.inp ? wv.inp + 'ms' : 'N/A', wv.inp && wv.inp <= 200 ? 'good' : wv.inp && wv.inp <= 500 ? 'warn' : '')}
      ${dataRow('FCP', wv.fcp ? wv.fcp + 'ms' : 'N/A', wv.fcp && wv.fcp <= 1800 ? 'good' : wv.fcp && wv.fcp <= 3000 ? 'warn' : '')}
      ${dataRow('TTFB', wv.ttfb ? wv.ttfb + 'ms' : 'N/A', wv.ttfb && wv.ttfb <= 800 ? 'good' : wv.ttfb && wv.ttfb <= 1800 ? 'warn' : '')}
    `);
  }

  // Performance
  if (data.performance) {
    const p = data.performance;
    html += renderSection('performance', 'Page Performance', `
      ${dataRow('Load time', p.loadTime ? (p.loadTime / 1000).toFixed(2) + 's' : 'N/A', p.loadTime && p.loadTime < 3000 ? 'good' : 'warn')}
      ${dataRow('DOM ready', p.domContentLoaded ? (p.domContentLoaded / 1000).toFixed(2) + 's' : 'N/A')}
      ${dataRow('DOM size', p.domSize.toLocaleString() + ' elements', p.domSize > 1500 ? 'warn' : 'good')}
      ${dataRow('Resources', p.resourceCounts.total + ' total')}
      ${dataRow('Transfer size', (p.totalTransferSize / 1024).toFixed(0) + ' KB')}
      <div style="color:#888;font-size:10px;margin-top:4px">Scripts: ${p.resourceCounts.scripts} · CSS: ${p.resourceCounts.stylesheets} · Images: ${p.resourceCounts.images} · Fonts: ${p.resourceCounts.fonts}</div>
    `);
  }

  // Text-to-HTML Ratio
  if (data.textToHtml) {
    const t = data.textToHtml;
    html += renderSection('textratio', 'Text-to-HTML Ratio', `
      ${dataRow('Ratio', t.ratio + '%', t.status === 'good' ? 'good' : t.status === 'fair' ? 'warn' : 'bad')}
      ${dataRow('Text size', (t.textSize / 1024).toFixed(1) + ' KB')}
      ${dataRow('HTML size', (t.htmlSize / 1024).toFixed(1) + ' KB')}
    `);
  }

  // Above the Fold
  if (data.aboveFold) {
    const af = data.aboveFold;
    html += renderSection('abovefold', 'Above the Fold', `
      ${dataRow('Elements visible', af.totalElements)}
      ${dataRow('Text elements', af.textElements)}
      ${dataRow('Text length', af.textLength.toLocaleString() + ' chars')}
      ${dataRow('Images', af.imageCount)}
      ${dataRow('CTAs', af.ctaCount)}
    `);
  }

  // Social Cards
  if (data.socialCards) {
    const sc = data.socialCards;
    html += renderSection('socialcards', 'Social Cards', `
      ${dataRow('OG tags', sc.og.tagCount + ' found', sc.og.issues.length === 0 ? 'good' : 'warn')}
      ${sc.og.issues.map(i => '<div class="issue" style="font-size:10px">⚠️ ' + esc(i) + '</div>').join('')}
      ${dataRow('Twitter tags', sc.twitter.tagCount + ' found', sc.twitter.issues.length === 0 ? 'good' : 'warn')}
      ${sc.twitter.issues.map(i => '<div class="issue" style="font-size:10px">⚠️ ' + esc(i) + '</div>').join('')}
    `);
  }

  // Schema Validation
  if (data.schemaValidation && data.schemaValidation.length > 0) {
    html += renderSection('schemaval', 'Schema Validation',
      data.schemaValidation.map(s =>
        dataRow(s.type, s.valid ? '✓ Valid' : '✗ Missing fields', s.valid ? 'good' : 'bad') +
        (!s.valid ? '<div style="color:#ef476f;font-size:10px;margin-bottom:4px">Missing: ' + s.missingFields.join(', ') + '</div>' : '')
      ).join('')
    );
  }

  // Hreflang
  if (data.hreflang && data.hreflang.count > 0) {
    html += renderSection('hreflang', 'Hreflang (' + data.hreflang.count + ')', `
      ${data.hreflang.entries.slice(0, 10).map(e => dataRow(e.lang, esc(e.href ? e.href.substring(0, 50) : ''))).join('')}
      ${data.hreflang.issues.map(i => '<div class="issue" style="font-size:10px">⚠️ ' + esc(i) + '</div>').join('')}
    `);
  }

  // Lazy Images
  if (data.lazyImages) {
    const li = data.lazyImages;
    html += renderSection('lazyimages', 'Image Loading', `
      ${dataRow('Lazy loaded', li.lazy)}
      ${dataRow('Eager loaded', li.eager)}
      ${dataRow('No attribute', li.noAttribute)}
      ${dataRow('data-src pattern', li.dataSrcPattern)}
    `);
  }

  // Mixed Content
  if (data.mixedContent && data.mixedContent.isHttps) {
    html += renderSection('mixed', 'Mixed Content', `
      ${dataRow('Mixed resources', data.mixedContent.mixedCount, data.mixedContent.mixedCount === 0 ? 'good' : 'bad')}
      ${data.mixedContent.items.slice(0, 5).map(i => '<div style="color:#ef476f;font-size:10px;margin-bottom:2px">' + esc(i.type) + ': ' + esc(i.url) + '</div>').join('')}
    `);
  }

  // iFrames
  if (data.iframes && data.iframes.count > 0) {
    html += renderSection('iframes', 'iFrames (' + data.iframes.count + ')',
      data.iframes.items.slice(0, 10).map(f => dataRow(f.type, esc(f.title || f.src.substring(0, 40)))).join('')
    );
  }

  // Media Types
  if (data.mediaTypes) {
    const mt = data.mediaTypes;
    if (mt.videos.count + mt.audio.count + mt.pdfs.count > 0) {
      html += renderSection('media', 'Media', `
        ${mt.videos.count > 0 ? dataRow('Videos', mt.videos.count) : ''}
        ${mt.audio.count > 0 ? dataRow('Audio', mt.audio.count) : ''}
        ${mt.pdfs.count > 0 ? dataRow('PDF links', mt.pdfs.count) : ''}
      `);
    }
  }

  // Favicon & Feeds
  if (data.faviconAndFeeds) {
    const ff = data.faviconAndFeeds;
    html += renderSection('favicon', 'Favicon & Feeds', `
      ${dataRow('Favicon', ff.favicon.hasFavicon ? '✓ Found (' + ff.favicon.count + ')' : '✗ Missing', ff.favicon.hasFavicon ? 'good' : 'bad')}
      ${dataRow('RSS/Atom feeds', ff.feeds.count > 0 ? ff.feeds.count + ' found' : 'None', ff.feeds.count > 0 ? 'good' : '')}
    `);
  }

  // TOC Navigation
  if (data.tocNavigation) {
    const toc = data.tocNavigation;
    html += renderSection('toc', 'Table of Contents', `
      ${dataRow('Has TOC', toc.hasToc ? '✓ Yes' : '✗ No', toc.hasToc ? 'good' : '')}
      ${dataRow('Jump links', toc.jumpLinkCount)}
    `);
  }



  html += `
    <!-- Actions -->
    <div class="actions">
      <button id="saveBtn">Save</button>
      <button id="copyBtn" class="secondary">Copy JSON</button>
      <button id="exportBtn" class="secondary">Export</button>
    </div>
    <div class="actions" style="margin-top:4px">
      <button id="clearHighlightBtn" class="secondary" style="width:100%">Clear Highlights</button>
    </div>
    <div class="status" id="status"></div>
  `;
  
  content.innerHTML = html;
  
  // Setup collapsible sections (click on section-header only, not buttons inside)
  document.querySelectorAll('.section').forEach(section => {
    section.querySelector('.section-header').onclick = function(e) {
      section.classList.toggle('open');
    };
    // Prevent section from closing when clicking inside content
    section.querySelector('.section-content')?.addEventListener('click', e => e.stopPropagation());
  });
  
  // Setup highlight buttons
  document.querySelectorAll('.highlight-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      chrome.tabs.sendMessage(currentTab.id, { action: 'highlight', type });
      
      // Toggle button state
      btn.classList.toggle('active');
      if (btn.classList.contains('active')) {
        btn.textContent = btn.textContent.replace('Highlight ', 'Hide ');
      } else {
        btn.textContent = btn.textContent.replace('Hide ', 'Highlight ');
        chrome.tabs.sendMessage(currentTab.id, { action: 'highlight', type: 'clear' });
      }
    });
  });
  
  // Clear all highlights button
  document.getElementById('clearHighlightBtn').addEventListener('click', () => {
    chrome.tabs.sendMessage(currentTab.id, { action: 'highlight', type: 'clear' });
    document.querySelectorAll('.highlight-btn.active').forEach(btn => {
      btn.classList.remove('active');
      btn.textContent = btn.textContent.replace('Hide ', 'Highlight ');
    });
    document.getElementById('status').textContent = 'Highlights cleared';
    setTimeout(() => { document.getElementById('status').textContent = ''; }, 1500);
  });
  
  // Setup main buttons
  document.getElementById('saveBtn').addEventListener('click', () => saveData(data));
  document.getElementById('copyBtn').addEventListener('click', () => copyToClipboard(data));
  document.getElementById('exportBtn').addEventListener('click', () => exportAsJson(data));
}

async function autoSaveCapture(data) {
  // Auto-send to API (fire and forget)
  try {
    fetch('https://api.seobandwagon.dev/v1/captures', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});
  } catch (e) {}

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



function renderSection(id, title, body, open) {
  return '<div class="section' + (open ? ' open' : '') + '" data-section="' + id + '">' +
    '<div class="section-header">' +
      '<span class="section-title">' + title + '</span>' +
      '<span class="section-arrow">▼</span>' +
    '</div>' +
    '<div class="section-content">' + body + '</div>' +
  '</div>';
}

function dataRow(label, value, cls) {
  return '<div class="data-row"><span class="data-label">' + label + '</span><span class="data-value' + (cls ? ' ' + cls : '') + '">' + value + '</span></div>';
}
