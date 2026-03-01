// Content script - comprehensive SEO data extraction

let counterEl = null; // For character counter

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyze') {
    const analysis = analyzePage();
    sendResponse(analysis);
  } else if (request.action === 'highlight') {
    highlightElement(request.type);
    sendResponse({ success: true });
  }
  return true;
});

function analyzePage() {
  const mainContent = getMainContent();
  const text = cleanText(mainContent);
  const words = getWords(text);
  
  const content = {
    title: document.title,
    wordCount: words.length,
    charCount: text.length,
    sentenceCount: countSentences(text),
    readability: calculateReadability(text, words),
    topWords: getTopWords(words),
    topPhrases: getTopPhrases(words)
  };
  
  const meta = extractMeta();
  const headings = extractHeadings();
  const links = extractLinks();
  const images = extractImages();
  const technical = extractTechnical();
  const techStack = detectTechStack();
  
  // Calculate SEO score
  const seoScore = calculateSEOScore(content, meta, headings, links, images, technical);
  
  return {
    url: window.location.href,
    capturedAt: new Date().toISOString(),
    seoScore,
    content,
    meta,
    headings,
    links,
    images,
    technical,
    techStack
  };
}

// ============ TECH STACK DETECTION ============

function detectTechStack() {
  const tech = [];
  
  // CMS
  if (document.querySelector('meta[name="generator"][content*="WordPress"]') || 
      document.querySelector('link[href*="wp-content"]') ||
      document.querySelector('script[src*="wp-includes"]')) {
    tech.push({ name: 'WordPress', category: 'CMS', icon: '📝' });
  }
  if (window.Shopify || document.querySelector('meta[name="shopify-checkout-api-token"]')) {
    tech.push({ name: 'Shopify', category: 'E-commerce', icon: '🛒' });
  }
  if (document.querySelector('meta[name="generator"][content*="Wix"]') || window.wixBiSession) {
    tech.push({ name: 'Wix', category: 'CMS', icon: '📝' });
  }
  if (document.querySelector('[class*="squarespace"]') || window.Static?.SQUARESPACE_CONTEXT) {
    tech.push({ name: 'Squarespace', category: 'CMS', icon: '📝' });
  }
  if (document.querySelector('[data-wf-page]') || window.Webflow) {
    tech.push({ name: 'Webflow', category: 'CMS', icon: '📝' });
  }
  if (document.querySelector('meta[name="generator"][content*="Drupal"]')) {
    tech.push({ name: 'Drupal', category: 'CMS', icon: '💧' });
  }
  if (document.querySelector('meta[name="generator"][content*="Joomla"]')) {
    tech.push({ name: 'Joomla', category: 'CMS', icon: '📝' });
  }
  
  // Frameworks
  if (document.getElementById('__next') || window.__NEXT_DATA__) {
    tech.push({ name: 'Next.js', category: 'Framework', icon: '⚛️' });
  } else if (document.querySelector('[data-reactroot]') || window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    tech.push({ name: 'React', category: 'Framework', icon: '⚛️' });
  }
  if (window.__VUE__ || document.querySelector('[data-v-]')) {
    tech.push({ name: 'Vue.js', category: 'Framework', icon: '💚' });
  }
  if (window.angular || document.querySelector('[ng-app]')) {
    tech.push({ name: 'Angular', category: 'Framework', icon: '🅰️' });
  }
  if (document.getElementById('___gatsby')) {
    tech.push({ name: 'Gatsby', category: 'Framework', icon: '💜' });
  }
  if (window.__NUXT__) {
    tech.push({ name: 'Nuxt.js', category: 'Framework', icon: '💚' });
  }
  if (document.querySelector('[data-sveltekit-hydrate]') || window.__sveltekit_1) {
    tech.push({ name: 'SvelteKit', category: 'Framework', icon: '🔥' });
  }
  
  // Analytics & Marketing
  if (window.gtag || window.ga || document.querySelector('script[src*="googletagmanager"]')) {
    tech.push({ name: 'Google Analytics', category: 'Analytics', icon: '📊' });
  }
  if (window.fbq) {
    tech.push({ name: 'Facebook Pixel', category: 'Analytics', icon: '📘' });
  }
  if (window.hj || document.querySelector('script[src*="hotjar"]')) {
    tech.push({ name: 'Hotjar', category: 'Analytics', icon: '🔥' });
  }
  if (window.HubSpotConversations || document.querySelector('script[src*="hubspot"]')) {
    tech.push({ name: 'HubSpot', category: 'Marketing', icon: '🟠' });
  }
  if (window.Intercom || document.querySelector('script[src*="intercom"]')) {
    tech.push({ name: 'Intercom', category: 'Support', icon: '💬' });
  }
  if (document.querySelector('script[src*="clarity"]') || window.clarity) {
    tech.push({ name: 'Microsoft Clarity', category: 'Analytics', icon: '🔍' });
  }
  
  // CDN & Performance
  if (document.querySelector('link[href*="cloudflare"]') || document.querySelector('script[src*="cloudflare"]')) {
    tech.push({ name: 'Cloudflare', category: 'CDN', icon: '☁️' });
  }
  
  return tech;
}

// ============ ELEMENT HIGHLIGHTING ============

function highlightElement(type) {
  // Add styles if not present
  if (!document.getElementById('seo-toolkit-styles')) {
    const style = document.createElement('style');
    style.id = 'seo-toolkit-styles';
    style.textContent = `
      .seo-toolkit-highlight { outline: 3px solid !important; outline-offset: 2px !important; }
      .seo-toolkit-highlight-heading { outline-color: #9b59b6 !important; background: rgba(155, 89, 182, 0.1) !important; }
      .seo-toolkit-highlight-link-internal { outline-color: #27ae60 !important; background: rgba(39, 174, 96, 0.1) !important; }
      .seo-toolkit-highlight-link-external { outline-color: #e74c3c !important; background: rgba(231, 76, 60, 0.1) !important; }
      .seo-toolkit-highlight-nofollow { outline-color: #f39c12 !important; background: rgba(243, 156, 18, 0.1) !important; }
      .seo-toolkit-highlight-image-missing-alt { outline-color: #e74c3c !important; background: rgba(231, 76, 60, 0.2) !important; }
      .seo-toolkit-highlight-image-has-alt { outline-color: #27ae60 !important; }
      #seo-toolkit-counter {
        position: absolute;
        background: #333;
        color: #fff;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        z-index: 999999;
        display: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
    `;
    document.head.appendChild(style);
  }
  
  // Remove existing highlights
  document.querySelectorAll('.seo-toolkit-highlight').forEach(el => {
    el.classList.remove('seo-toolkit-highlight', 'seo-toolkit-highlight-heading', 
      'seo-toolkit-highlight-link-internal', 'seo-toolkit-highlight-link-external',
      'seo-toolkit-highlight-nofollow', 'seo-toolkit-highlight-image-missing-alt',
      'seo-toolkit-highlight-image-has-alt');
  });
  
  if (type === 'clear') return;
  
  const currentDomain = window.location.hostname.replace('www.', '');
  
  switch (type) {
    case 'headings':
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
        el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-heading');
      });
      break;
    case 'links-internal':
      document.querySelectorAll('a[href]').forEach(el => {
        try {
          const url = new URL(el.href);
          if (url.hostname.replace('www.', '') === currentDomain) {
            el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-link-internal');
          }
        } catch (e) {}
      });
      break;
    case 'links-external':
      document.querySelectorAll('a[href]').forEach(el => {
        try {
          const url = new URL(el.href);
          if (url.hostname.replace('www.', '') !== currentDomain && url.protocol.startsWith('http')) {
            el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-link-external');
          }
        } catch (e) {}
      });
      break;
    case 'nofollow':
      document.querySelectorAll('a[rel*="nofollow"], a[rel*="ugc"], a[rel*="sponsored"]').forEach(el => {
        el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-nofollow');
      });
      break;
    case 'images-missing-alt':
      document.querySelectorAll('img').forEach(el => {
        const alt = el.getAttribute('alt');
        if (!alt || alt.trim() === '') {
          el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-image-missing-alt');
        }
      });
      break;
    case 'images-all':
      document.querySelectorAll('img').forEach(el => {
        const alt = el.getAttribute('alt');
        if (!alt || alt.trim() === '') {
          el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-image-missing-alt');
        } else {
          el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-image-has-alt');
        }
      });
      break;
  }
}

// ============ CHARACTER COUNTER ============

function showCharCounter(text, selection) {
  if (!counterEl) {
    counterEl = document.createElement('div');
    counterEl.id = 'seo-toolkit-counter';
    document.body.appendChild(counterEl);
  }
  
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, '').length;
  
  counterEl.innerHTML = `
    <strong>${words}</strong> words · 
    <strong>${chars}</strong> chars · 
    <strong>${charsNoSpace}</strong> no spaces
  `;
  
  try {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    counterEl.style.display = 'block';
    counterEl.style.top = (rect.top + window.scrollY - 40) + 'px';
    counterEl.style.left = Math.max(10, rect.left) + 'px';
  } catch (e) {
    hideCharCounter();
  }
}

function hideCharCounter() {
  if (counterEl) {
    counterEl.style.display = 'none';
  }
}

// Show char counter on text selection
document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  if (text.length > 0) {
    showCharCounter(text, selection);
  } else {
    hideCharCounter();
  }
});

document.addEventListener('mousedown', (e) => {
  if (e.target.id !== 'seo-toolkit-counter') {
    hideCharCounter();
  }
});

// ============ SEO SCORE ============

function calculateSEOScore(content, meta, headings, links, images, technical) {
  let score = 100;
  const issues = [];
  
  // Title (15 points)
  if (!meta.title.text) {
    score -= 15;
    issues.push('Missing title');
  } else if (meta.title.length < 30) {
    score -= 8;
    issues.push('Title too short');
  } else if (meta.title.length > 60) {
    score -= 5;
    issues.push('Title too long');
  }
  
  // Meta description (15 points)
  if (!meta.description.text) {
    score -= 15;
    issues.push('Missing meta description');
  } else if (meta.description.length < 120) {
    score -= 8;
    issues.push('Description too short');
  } else if (meta.description.length > 160) {
    score -= 5;
    issues.push('Description too long');
  }
  
  // H1 (10 points)
  if (headings.h1.length === 0) {
    score -= 10;
    issues.push('Missing H1');
  } else if (headings.multipleH1) {
    score -= 5;
    issues.push('Multiple H1 tags');
  }
  
  // Images (10 points)
  if (images.total > 0) {
    const missingAltRatio = images.missingAlt.count / images.total;
    if (missingAltRatio > 0.5) {
      score -= 10;
      issues.push('Many images missing alt');
    } else if (missingAltRatio > 0) {
      score -= 5;
      issues.push('Some images missing alt');
    }
  }
  
  // Canonical (5 points)
  if (!meta.canonical) {
    score -= 5;
    issues.push('No canonical URL');
  }
  
  // Schema (10 points)
  if (meta.schema.length === 0) {
    score -= 10;
    issues.push('No structured data');
  }
  
  // Open Graph (5 points)
  if (!meta.openGraph.title) {
    score -= 5;
    issues.push('Missing Open Graph');
  }
  
  // Content length (10 points)
  if (content.wordCount < 300) {
    score -= 10;
    issues.push('Thin content');
  } else if (content.wordCount < 600) {
    score -= 5;
    issues.push('Light content');
  }
  
  // Internal links (5 points)
  if (links.internal.count < 3) {
    score -= 5;
    issues.push('Few internal links');
  }
  
  // Page size (5 points)
  if (technical.domElements > 2000) {
    score -= 5;
    issues.push('Large DOM');
  }
  
  // Readability (10 points)
  if (content.readability.fleschKincaid > 14) {
    score -= 5;
    issues.push('Hard to read');
  }
  
  return {
    score: Math.max(0, score),
    grade: getGrade(score),
    issues
  };
}

function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ============ META TAGS ============

function extractMeta() {
  const getMeta = (name) => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el ? el.getAttribute('content') : null;
  };
  
  const title = document.title || '';
  const description = getMeta('description') || '';
  const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
  const robots = getMeta('robots') || null;
  
  // Open Graph
  const openGraph = {
    title: getMeta('og:title'),
    description: getMeta('og:description'),
    image: getMeta('og:image'),
    type: getMeta('og:type'),
    url: getMeta('og:url'),
    siteName: getMeta('og:site_name')
  };
  
  // Twitter Card
  const twitter = {
    card: getMeta('twitter:card'),
    title: getMeta('twitter:title'),
    description: getMeta('twitter:description'),
    image: getMeta('twitter:image')
  };
  
  // Schema.org / JSON-LD
  const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
  const schema = [];
  schemaScripts.forEach(script => {
    try {
      schema.push(JSON.parse(script.textContent));
    } catch (e) {
      // Invalid JSON, skip
    }
  });
  
  return {
    title: { text: title, length: title.length },
    description: { text: description, length: description.length },
    canonical,
    robots,
    openGraph,
    twitter,
    schema
  };
}

// ============ HEADINGS ============

function extractHeadings() {
  const headings = {
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    multipleH1: false
  };
  
  for (let i = 1; i <= 6; i++) {
    const els = document.querySelectorAll(`h${i}`);
    els.forEach(el => {
      const text = el.textContent.trim();
      if (text) headings[`h${i}`].push(text);
    });
  }
  
  headings.multipleH1 = headings.h1.length > 1;
  
  return headings;
}

// ============ LINKS ============

function extractLinks() {
  const currentHost = window.location.hostname;
  const links = document.querySelectorAll('a[href]');
  
  const internal = { count: 0, urls: [] };
  const external = { count: 0, urls: [], domains: new Set() };
  const anchors = [];
  let nofollow = 0;
  
  links.forEach(link => {
    const href = link.href;
    const text = link.textContent.trim();
    const rel = link.getAttribute('rel') || '';
    
    if (rel.includes('nofollow')) nofollow++;
    
    try {
      const url = new URL(href);
      
      if (url.hostname === currentHost || url.hostname === 'www.' + currentHost || 'www.' + url.hostname === currentHost) {
        internal.count++;
        if (internal.urls.length < 100) internal.urls.push(href);
      } else if (url.protocol.startsWith('http')) {
        external.count++;
        if (external.urls.length < 100) external.urls.push(href);
        external.domains.add(url.hostname);
      }
      
      if (text && anchors.length < 50) {
        anchors.push({ text: text.slice(0, 100), href: href.slice(0, 200) });
      }
    } catch (e) {
      // Invalid URL, skip
    }
  });
  
  return {
    internal,
    external: {
      count: external.count,
      urls: external.urls,
      domains: Array.from(external.domains)
    },
    anchors,
    nofollow
  };
}

// ============ IMAGES ============

function extractImages() {
  const images = document.querySelectorAll('img');
  const missingAlt = { count: 0, srcs: [] };
  const altTexts = [];
  
  images.forEach(img => {
    const alt = img.getAttribute('alt');
    const src = img.src || img.dataset.src || '';
    
    if (!alt || alt.trim() === '') {
      missingAlt.count++;
      if (missingAlt.srcs.length < 20) missingAlt.srcs.push(src.slice(0, 200));
    } else {
      if (altTexts.length < 50) altTexts.push(alt.slice(0, 200));
    }
  });
  
  return {
    total: images.length,
    missingAlt,
    altTexts
  };
}

// ============ TECHNICAL ============

function extractTechnical() {
  const scripts = document.querySelectorAll('script');
  const stylesheets = document.querySelectorAll('link[rel="stylesheet"], style');
  
  // Performance timing
  let loadTimeMs = null;
  if (window.performance && performance.timing) {
    const timing = performance.timing;
    if (timing.loadEventEnd && timing.navigationStart) {
      loadTimeMs = timing.loadEventEnd - timing.navigationStart;
    }
  }
  
  // URL depth
  const path = window.location.pathname;
  const urlDepth = path.split('/').filter(p => p.length > 0).length;
  
  return {
    domElements: document.getElementsByTagName('*').length,
    scripts: scripts.length,
    stylesheets: stylesheets.length,
    loadTimeMs,
    urlDepth,
    url: {
      protocol: window.location.protocol,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash
    }
  };
}

// ============ CONTENT ANALYSIS HELPERS ============

function getMainContent() {
  const main = document.querySelector('main, article, [role="main"]');
  if (main) return main.innerText;
  
  const body = document.body.cloneNode(true);
  const exclude = ['header', 'footer', 'nav', 'aside', '.sidebar', '.navigation', '.menu', 'script', 'style', 'noscript', 'iframe'];
  exclude.forEach(sel => {
    body.querySelectorAll(sel).forEach(el => el.remove());
  });
  
  return body.innerText;
}

function cleanText(text) {
  return text.replace(/\s+/g, ' ').replace(/[^\w\s.,!?;:'"()-]/g, '').trim();
}

function getWords(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 0);
}

function countSentences(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length || 1;
}

function calculateReadability(text, words) {
  const sentences = countSentences(text);
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  
  const fleschKincaid = words.length > 0 
    ? (0.39 * (words.length / sentences)) + (11.8 * (syllables / words.length)) - 15.59
    : 0;
  
  const fleschEase = words.length > 0
    ? 206.835 - (1.015 * (words.length / sentences)) - (84.6 * (syllables / words.length))
    : 0;
    
  // Reading level labels
  let level = 'College';
  if (fleschKincaid <= 5) level = 'Elementary';
  else if (fleschKincaid <= 8) level = 'Middle School';
  else if (fleschKincaid <= 12) level = 'High School';
  
  return {
    fleschKincaid: Math.max(0, Math.round(fleschKincaid * 10) / 10),
    fleschEase: Math.max(0, Math.min(100, Math.round(fleschEase * 10) / 10)),
    level
  };
}

function countSyllables(word) {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

function getTopWords(words) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
    'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she',
    'him', 'her', 'his', 'i', 'me', 'my', 'what', 'which', 'who', 'whom',
    'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same',
    'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there'
  ]);
  
  const counts = {};
  words.forEach(word => {
    if (word.length > 2 && !stopWords.has(word)) {
      counts[word] = (counts[word] || 0) + 1;
    }
  });
  
  return Object.entries(counts)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

function getTopPhrases(words) {
  const phrases2 = {};
  const phrases3 = {};
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would']);
  
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopWords.has(words[i]) || !stopWords.has(words[i + 1])) {
      const p2 = `${words[i]} ${words[i + 1]}`;
      phrases2[p2] = (phrases2[p2] || 0) + 1;
    }
    if (i < words.length - 2 && (!stopWords.has(words[i]) || !stopWords.has(words[i + 2]))) {
      const p3 = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      phrases3[p3] = (phrases3[p3] || 0) + 1;
    }
  }
  
  const allPhrases = [
    ...Object.entries(phrases2).map(([phrase, count]) => ({ phrase, count })),
    ...Object.entries(phrases3).map(([phrase, count]) => ({ phrase, count }))
  ];
  
  return allPhrases
    .filter(p => p.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}
