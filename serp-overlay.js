// SERP Overlay - Runs on Google Search Results

(function() {
  'use strict';
  
  const API_BASE = 'https://api.seobandwagon.dev';
  
  // Wait for search results to load
  function init() {
    const results = document.querySelectorAll('div.g');
    if (results.length === 0) {
      setTimeout(init, 500);
      return;
    }
    
    processResults(results);
    collectSERPData();
  }
  
  function processResults(results) {
    results.forEach((result, index) => {
      // Skip if already processed
      if (result.dataset.seoToolkit) return;
      result.dataset.seoToolkit = 'true';
      
      const link = result.querySelector('a[href^="http"]');
      if (!link) return;
      
      const url = new URL(link.href);
      const domain = url.hostname.replace('www.', '');
      
      // Create overlay bar
      const overlay = document.createElement('div');
      overlay.className = 'seo-toolkit-serp-bar';
      overlay.innerHTML = `
        <span class="seo-toolkit-domain">${domain}</span>
        <span class="seo-toolkit-stat" data-domain="${domain}" data-type="age">
          <span class="label">Age:</span>
          <span class="value">...</span>
        </span>
        <span class="seo-toolkit-stat" data-domain="${domain}" data-type="words">
          <span class="label">Words:</span>
          <span class="value">...</span>
        </span>
        <span class="seo-toolkit-stat" data-domain="${domain}" data-type="schema">
          <span class="label">Schema:</span>
          <span class="value">...</span>
        </span>
        <button class="seo-toolkit-analyze" data-url="${link.href}">Analyze</button>
      `;
      
      result.appendChild(overlay);
      
      // Fetch domain data
      fetchDomainData(domain);
    });
  }
  
  async function fetchDomainData(domain) {
    try {
      const response = await fetch(`${API_BASE}/domain/${domain}/quick`);
      const data = await response.json();
      
      // Update stats
      document.querySelectorAll(`[data-domain="${domain}"][data-type="age"] .value`)
        .forEach(el => el.textContent = data.age || 'N/A');
      document.querySelectorAll(`[data-domain="${domain}"][data-type="words"] .value`)
        .forEach(el => el.textContent = data.avgWordCount || 'N/A');
      document.querySelectorAll(`[data-domain="${domain}"][data-type="schema"] .value`)
        .forEach(el => el.textContent = data.hasSchema ? '✓' : '✗');
    } catch (e) {
      // Use cached/default data
    }
  }
  
  // Collect SERP data for analysis
  function collectSERPData() {
    const query = new URLSearchParams(window.location.search).get('q');
    const results = [];
    
    document.querySelectorAll('div.g').forEach((result, index) => {
      const link = result.querySelector('a[href^="http"]');
      const titleEl = result.querySelector('h3');
      
      if (link && titleEl) {
        results.push({
          position: index + 1,
          url: link.href,
          domain: new URL(link.href).hostname,
          title: titleEl.textContent
        });
      }
    });
    
    // Send to API for aggregation
    if (results.length > 0) {
      sendSERPData(query, results);
    }
  }
  
  async function sendSERPData(query, results) {
    try {
      await fetch(`${API_BASE}/serp/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          results: results,
          location: navigator.language,
          timestamp: Date.now()
        })
      });
    } catch (e) {
      // Silently fail
    }
  }
  
  // Analyze button click
  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('seo-toolkit-analyze')) {
      const url = e.target.dataset.url;
      e.target.textContent = 'Loading...';
      
      try {
        const response = await fetch(`${API_BASE}/analyze?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        
        e.target.textContent = `Score: ${data.score}`;
        e.target.style.background = data.score >= 70 ? '#1e8e3e' : data.score >= 50 ? '#f9a825' : '#d93025';
      } catch (err) {
        e.target.textContent = 'Error';
      }
    }
  });
  
  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
