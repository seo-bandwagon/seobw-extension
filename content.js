// Content script - comprehensive SEO data extraction

if (window.__seoBandwagonLoaded) { /* already injected */ } else {
window.__seoBandwagonLoaded = true;

let counterEl = null; // For character counter

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyze') {
    analyzePage().then(results => sendResponse(results));
  } else if (request.action === 'highlight') {
    highlightElement(request.type);
    sendResponse({ success: true });
  }
  return true;
});

async function analyzePage() {
  const webVitalsPromise = analyzeWebVitals();
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
    techStack,
    // Advanced analyzers (v1.1.0)
    webVitals: await webVitalsPromise,
    performance: analyzePerformance(),
    textToHtml: analyzeTextToHtml(),
    aboveFold: analyzeAboveFold(),
    hreflang: analyzeHreflang(),
    schemaValidation: analyzeSchemaValidation(),
    lazyImages: analyzeLazyImages(),
    mixedContent: analyzeMixedContent(),
    iframes: analyzeIframes(),
    socialCards: analyzeSocialCards(),
    faviconAndFeeds: analyzeFaviconAndFeeds(),
    mediaTypes: analyzeMediaTypes(),
    keywordDensity: analyzeKeywordDensity(),
    tocNavigation: analyzeTocNavigation(),
    ngrams: analyzeNgrams()
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


// ============================================
// Advanced Analyzers (ported from v0.3.0)
// ============================================

function analyzeWebVitals() {
  return new Promise((resolve) => {
    const vitals = { lcp: null, cls: null, inp: null, fcp: null, ttfb: null };
    let clsValue = 0;
    let inpValue = 0;
    let resolved = false;

    function finish() {
      if (resolved) return;
      resolved = true;
      vitals.cls = +clsValue.toFixed(4);
      vitals.inp = inpValue || null;
      resolve(vitals);
    }

    // TTFB
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        vitals.ttfb = Math.round(nav.responseStart - nav.requestStart);
      }
    } catch (e) {}

    // FCP
    try {
      const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
      if (fcpEntry) {
        vitals.fcp = Math.round(fcpEntry.startTime);
      }
    } catch (e) {}

    // LCP
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          const last = entries[entries.length - 1];
          vitals.lcp = Math.round(last.startTime);
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}

    // CLS
    try {
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}

    // INP (interaction to next paint)
    try {
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = entry.duration || 0;
          if (duration > inpValue) {
            inpValue = duration;
          }
        }
      });
      inpObserver.observe({ type: 'event', buffered: true });
    } catch (e) {}

    // Resolve after 2 seconds to capture buffered entries
    setTimeout(finish, 2000);
  });
}

function analyzePerformance() {
  const results = {
    loadTime: null,
    domContentLoaded: null,
    domSize: 0,
    resourceCounts: { scripts: 0, stylesheets: 0, fonts: 0, images: 0, total: 0 },
    totalTransferSize: 0,
  };

  // Load timing
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
      results.loadTime = Math.round(nav.loadEventEnd - nav.startTime);
      results.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
    }
  } catch (e) {}

  // DOM size
  results.domSize = document.querySelectorAll('*').length;

  // Resource counts
  try {
    const resources = performance.getEntriesByType('resource');
    results.resourceCounts.total = resources.length;
    for (const r of resources) {
      const type = r.initiatorType;
      if (type === 'script') results.resourceCounts.scripts++;
      else if (type === 'link' || type === 'css') results.resourceCounts.stylesheets++;
      else if (type === 'img') results.resourceCounts.images++;
      else if (r.name.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)) results.resourceCounts.fonts++;

      if (r.transferSize) results.totalTransferSize += r.transferSize;
    }
  } catch (e) {}

  return results;
}

function analyzeTextToHtml() {
  const htmlSize = document.documentElement.outerHTML.length;
  const bodyClone = document.body.cloneNode(true);
  bodyClone.querySelectorAll('script, style, noscript, svg, [hidden], [aria-hidden="true"]').forEach(el => el.remove());
  const textSize = (bodyClone.textContent || '').replace(/\s+/g, ' ').trim().length;
  const ratio = htmlSize > 0 ? +(textSize / htmlSize * 100).toFixed(1) : 0;

  return {
    textSize,
    htmlSize,
    ratio,
    status: ratio >= 25 ? 'good' : ratio >= 10 ? 'fair' : 'poor',
  };
}

function analyzeAboveFold() {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  let textElements = 0;
  let totalElements = 0;
  let textLength = 0;
  let imageCount = 0;
  let ctaCount = 0;

  const allElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, a, button, img, input, textarea');
  allElements.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top < viewportHeight && rect.bottom > 0 && rect.left < viewportWidth && rect.right > 0) {
      totalElements++;
      const tag = el.tagName.toLowerCase();
      if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span'].includes(tag)) {
        textElements++;
        textLength += (el.textContent || '').trim().length;
      }
      if (tag === 'img') imageCount++;
      if (tag === 'button' || tag === 'input' || (tag === 'a' && el.classList.length > 0)) ctaCount++;
    }
  });

  return {
    viewportHeight,
    viewportWidth,
    totalElements,
    textElements,
    textLength,
    imageCount,
    ctaCount,
  };
}

function analyzeHreflang() {
  const tags = document.querySelectorAll('link[rel="alternate"][hreflang]');
  const entries = [];
  tags.forEach(tag => {
    entries.push({
      lang: tag.getAttribute('hreflang'),
      href: tag.getAttribute('href'),
    });
  });

  const issues = [];
  if (entries.length > 0) {
    const hasXDefault = entries.some(e => e.lang === 'x-default');
    if (!hasXDefault) issues.push('Missing x-default hreflang');

    const currentUrl = window.location.href;
    const hasSelfRef = entries.some(e => {
      try { return new URL(e.href, window.location.origin).href === currentUrl; } catch { return false; }
    });
    if (!hasSelfRef) issues.push('Missing self-referencing hreflang');
  }

  return { count: entries.length, entries, issues };
}

function analyzeSchemaValidation() {
  const results = [];
  const requiredFields = {
    'Article': ['headline', 'author', 'datePublished', 'image'],
    'Product': ['name', 'image', 'offers'],
    'LocalBusiness': ['name', 'address', 'telephone'],
    'Organization': ['name', 'url', 'logo'],
    'Person': ['name'],
    'BreadcrumbList': ['itemListElement'],
    'FAQPage': ['mainEntity'],
    'HowTo': ['name', 'step'],
    'Recipe': ['name', 'recipeIngredient', 'recipeInstructions'],
    'Event': ['name', 'startDate', 'location'],
    'VideoObject': ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    'Review': ['itemReviewed', 'reviewRating', 'author'],
    'WebSite': ['name', 'url'],
    'WebPage': ['name'],
  };

  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  scripts.forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      const items = data['@graph'] || (Array.isArray(data) ? data : [data]);
      items.forEach(item => {
        const type = Array.isArray(item['@type']) ? item['@type'][0] : item['@type'];
        if (!type) return;
        const required = requiredFields[type] || [];
        const missing = required.filter(f => !item[f] && !item[f.toLowerCase()]);
        results.push({
          type,
          valid: missing.length === 0,
          missingFields: missing,
          fieldCount: Object.keys(item).filter(k => !k.startsWith('@')).length,
        });
      });
    } catch (e) {}
  });

  return results;
}

function analyzeLazyImages() {
  const images = document.querySelectorAll('img');
  let lazy = 0, eager = 0, noAttr = 0, dataSrc = 0;

  images.forEach(img => {
    const loading = img.getAttribute('loading');
    if (loading === 'lazy') lazy++;
    else if (loading === 'eager') eager++;
    else noAttr++;

    if (img.dataset.src || img.dataset.lazySrc || img.dataset.original) dataSrc++;
  });

  return {
    total: images.length,
    lazy,
    eager,
    noAttribute: noAttr,
    dataSrcPattern: dataSrc,
  };
}

function analyzeMixedContent() {
  const isHttps = window.location.protocol === 'https:';
  if (!isHttps) return { isHttps: false, mixedCount: 0, items: [] };

  const items = [];
  // Check images
  document.querySelectorAll('img[src^="http:"]').forEach(el => {
    items.push({ type: 'image', url: el.getAttribute('src').substring(0, 100) });
  });
  // Check scripts
  document.querySelectorAll('script[src^="http:"]').forEach(el => {
    items.push({ type: 'script', url: el.getAttribute('src').substring(0, 100) });
  });
  // Check stylesheets
  document.querySelectorAll('link[rel="stylesheet"][href^="http:"]').forEach(el => {
    items.push({ type: 'stylesheet', url: el.getAttribute('href').substring(0, 100) });
  });
  // Check iframes
  document.querySelectorAll('iframe[src^="http:"]').forEach(el => {
    items.push({ type: 'iframe', url: el.getAttribute('src').substring(0, 100) });
  });

  return { isHttps, mixedCount: items.length, items: items.slice(0, 20) };
}

function analyzeIframes() {
  const iframes = document.querySelectorAll('iframe');
  const items = [];

  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src') || '';
    let type = 'unknown';
    if (src.includes('youtube.com') || src.includes('youtu.be')) type = 'youtube';
    else if (src.includes('vimeo.com')) type = 'vimeo';
    else if (src.includes('maps.google') || src.includes('google.com/maps')) type = 'google-maps';
    else if (src.includes('facebook.com')) type = 'facebook';
    else if (src.includes('twitter.com') || src.includes('x.com')) type = 'twitter';
    else if (src.includes('instagram.com')) type = 'instagram';
    else if (src) type = 'external';

    items.push({
      type,
      src: src.substring(0, 150),
      width: iframe.getAttribute('width') || iframe.style.width || 'auto',
      height: iframe.getAttribute('height') || iframe.style.height || 'auto',
      loading: iframe.getAttribute('loading') || 'none',
      title: (iframe.getAttribute('title') || '').substring(0, 60),
    });
  });

  return { count: iframes.length, items: items.slice(0, 20) };
}

function analyzeSocialCards() {
  const og = {};
  const twitter = {};
  const ogIssues = [];
  const twitterIssues = [];

  // Collect all OG tags
  document.querySelectorAll('meta[property^="og:"]').forEach(el => {
    const prop = el.getAttribute('property').replace('og:', '');
    og[prop] = el.getAttribute('content') || '';
  });

  // Collect all Twitter tags
  document.querySelectorAll('meta[name^="twitter:"]').forEach(el => {
    const name = el.getAttribute('name').replace('twitter:', '');
    twitter[name] = el.getAttribute('content') || '';
  });

  // Validate OG
  const ogRequired = ['title', 'description', 'image', 'url', 'type'];
  ogRequired.forEach(field => {
    if (!og[field]) ogIssues.push(`Missing og:${field}`);
  });
  if (og.title && og.title.length > 95) ogIssues.push('og:title too long (>95 chars)');
  if (og.description && og.description.length > 200) ogIssues.push('og:description too long (>200 chars)');

  // Validate Twitter
  if (!twitter.card) twitterIssues.push('Missing twitter:card');
  if (!twitter.title && !og.title) twitterIssues.push('Missing twitter:title (no OG fallback)');
  if (!twitter.description && !og.description) twitterIssues.push('Missing twitter:description (no OG fallback)');
  if (!twitter.image && !og.image) twitterIssues.push('Missing twitter:image (no OG fallback)');

  return {
    og: { tags: og, tagCount: Object.keys(og).length, issues: ogIssues },
    twitter: { tags: twitter, tagCount: Object.keys(twitter).length, issues: twitterIssues },
  };
}

function analyzeFaviconAndFeeds() {
  // Favicons
  const favicons = [];
  document.querySelectorAll('link[rel*="icon"]').forEach(el => {
    favicons.push({
      rel: el.getAttribute('rel'),
      href: el.getAttribute('href'),
      sizes: el.getAttribute('sizes') || null,
      type: el.getAttribute('type') || null,
    });
  });

  // RSS/Atom feeds
  const feeds = [];
  document.querySelectorAll('link[type="application/rss+xml"], link[type="application/atom+xml"]').forEach(el => {
    feeds.push({
      type: el.getAttribute('type').includes('rss') ? 'rss' : 'atom',
      title: el.getAttribute('title') || '',
      href: el.getAttribute('href'),
    });
  });

  return {
    favicon: { count: favicons.length, items: favicons, hasFavicon: favicons.length > 0 },
    feeds: { count: feeds.length, items: feeds },
  };
}

function analyzeMediaTypes() {
  const videos = [];
  const audio = [];
  const pdfs = [];

  // Video elements
  document.querySelectorAll('video').forEach(el => {
    videos.push({ type: 'native', src: (el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '').substring(0, 100) });
  });

  // Video embeds (iframes already captured, just count types here)
  document.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.getAttribute('src') || '';
    if (src.includes('youtube.com') || src.includes('youtu.be')) videos.push({ type: 'youtube', src: src.substring(0, 100) });
    else if (src.includes('vimeo.com')) videos.push({ type: 'vimeo', src: src.substring(0, 100) });
    else if (src.includes('wistia.')) videos.push({ type: 'wistia', src: src.substring(0, 100) });
  });

  // Audio elements
  document.querySelectorAll('audio').forEach(el => {
    audio.push({ src: (el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '').substring(0, 100) });
  });

  // PDF links
  document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"]').forEach(el => {
    pdfs.push({ href: el.getAttribute('href').substring(0, 100), text: (el.textContent || '').trim().substring(0, 60) });
  });

  return {
    videos: { count: videos.length, items: videos.slice(0, 10) },
    audio: { count: audio.length, items: audio.slice(0, 10) },
    pdfs: { count: pdfs.length, items: pdfs.slice(0, 10) },
  };
}

function analyzeKeywordDensity() {
  const title = document.title || '';
  const h1 = document.querySelector('h1');
  const h1Text = h1 ? h1.textContent.trim() : '';

  const bodyClone = document.body.cloneNode(true);
  bodyClone.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
  const bodyText = (bodyClone.textContent || '').toLowerCase();
  const bodyWords = bodyText.match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
  const totalWords = bodyWords.length;

  if (totalWords === 0) return { titleTerms: [], h1Terms: [], totalWords: 0 };

  const stopWords = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','is','it','this','that','are','was','be','have','do','not','from','as','i','you','we','they','he','she','your','my','our','their']);

  function getTermDensity(text) {
    const words = text.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
    const meaningful = words.filter(w => !stopWords.has(w) && w.length > 2);
    return meaningful.map(term => {
      const count = bodyWords.filter(w => w === term).length;
      return { term, count, density: +(count / totalWords * 100).toFixed(2) };
    }).filter(t => t.count > 0);
  }

  return {
    titleTerms: getTermDensity(title),
    h1Terms: getTermDensity(h1Text),
    totalWords,
  };
}

function analyzeTocNavigation() {
  // Check for elements with IDs that are linked to from the same page
  const anchors = document.querySelectorAll('a[href^="#"]');
  const jumpLinks = [];

  anchors.forEach(a => {
    const href = a.getAttribute('href');
    if (href === '#' || href === '#top') return;
    const targetId = href.substring(1);
    const target = document.getElementById(targetId);
    if (target) {
      jumpLinks.push({
        text: (a.textContent || '').trim().substring(0, 60),
        targetTag: target.tagName.toLowerCase(),
        targetId,
      });
    }
  });

  // Check for nav/toc containers
  const hasTocElement = !!(
    document.querySelector('[class*="toc"]') ||
    document.querySelector('[class*="table-of-contents"]') ||
    document.querySelector('[id*="toc"]') ||
    document.querySelector('nav[aria-label*="content"]')
  );

  return {
    hasToc: hasTocElement || jumpLinks.length >= 3,
    jumpLinkCount: jumpLinks.length,
    jumpLinks: jumpLinks.slice(0, 15),
  };
}

function analyzeNgrams() {
  const bodyClone = document.body.cloneNode(true);
  bodyClone.querySelectorAll('script, style, noscript, svg, [hidden], [aria-hidden="true"]').forEach(el => el.remove());
  const text = (bodyClone.textContent || '').toLowerCase();

  // Tokenize: letters, numbers, hyphens within words
  const words = text.match(/[a-z0-9](?:[a-z0-9'-]*[a-z0-9])?/g) || [];

  const stopWords = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','it','its','this','that','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may',
    'might','shall','can','not','no','nor','so','if','then','than','too','very',
    'just','about','above','after','again','all','also','am','as','because',
    'before','between','both','each','few','get','got','he','her','here','him',
    'his','how','i','into','me','more','most','my','new','now','of','only',
    'other','our','out','over','own','re','same','she','some','such','there',
    'they','their','them','these','those','through','under','up','us','we',
    'what','when','where','which','while','who','whom','why','you','your',
    'able','across','already','always','among','any','around','away','back',
    'become','been','below','come','down','during','even','every','find',
    'first','go','going','good','great','help','here','high','however',
    'into','keep','know','last','let','like','long','look','made','make',
    'many','much','must','need','next','off','often','old','once','one',
    'only','part','per','put','said','say','see','seem','set','show',
    'since','still','take','tell','thing','think','time','two','use',
    'want','way','well','work','year'
  ]);

  // Filter out stop words for n-gram analysis
  const filtered = words.filter(w => !stopWords.has(w) && w.length > 1);

  // Build n-grams (1, 2, 3)
  const unigrams = buildNgramCounts(filtered, 1);
  const bigrams = buildNgramCounts(words.filter(w => w.length > 1), 2, stopWords); // use all words but filter results
  const trigrams = buildNgramCounts(words.filter(w => w.length > 1), 3, stopWords);

  return {
    unigrams: getTopN(unigrams, 15),
    bigrams: getTopN(bigrams, 10),
    trigrams: getTopN(trigrams, 10),
    totalWords: words.length,
    uniqueWords: new Set(words).size
  };
}

function buildNgramCounts(words, n, stopWords) {
  const counts = {};
  for (let i = 0; i <= words.length - n; i++) {
    const gram = words.slice(i, i + n).join(' ');
    // For bigrams/trigrams: skip if ALL words are stop words
    if (n > 1 && stopWords) {
      const parts = gram.split(' ');
      if (parts.every(w => stopWords.has(w))) continue;
    }
    counts[gram] = (counts[gram] || 0) + 1;
  }
  return counts;
}

function getTopN(counts, n) {
  return Object.entries(counts)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([phrase, count]) => ({ phrase, count }));
}

} // end __seoBandwagonLoaded guard
