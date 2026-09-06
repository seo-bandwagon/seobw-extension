// Content script - comprehensive SEO data extraction

if (window.__seoBandwagonLoaded) { /* already injected */ } else {
window.__seoBandwagonLoaded = true;

// Pure-logic analysis helpers are injected from lib/content-analysis.js
// immediately before this file by chrome.scripting.executeScript. They live
// on self.SEOBWAnalysis; destructure the ones we use so existing call sites
// below reference them by bare name.
const {
  calculateSEOScore,
  getGrade,
  cleanText,
  getWords,
  countSentences,
  countSyllables,
  calculateReadability,
  getTopWords,
  getTopPhrases,
  buildNgramCounts,
  getTopN
} = self.SEOBWAnalysis;

// DOM extractors are similarly injected from lib/dom-extraction.js. Each
// takes optional (doc, win) args so they work in JSDOM tests too; here in
// the content script we let them default to the target tab's document.
const {
  extractMeta,
  extractHeadings,
  extractLinks,
  extractImages,
  extractTechnical,
  getMainContent
} = self.SEOBWExtraction;

let counterEl = null; // For character counter

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyze') {
    analyzePage().then(results => sendResponse(results));
  } else if (request.action === 'highlight') {
    highlightElement(request.type, request);
    sendResponse({ success: true });
  } else if (request.action === 'countSelection') {
    const selection = window.getSelection().toString();
    sendResponse(countText(selection));
  } else if (request.action === 'collectLinks') {
    sendResponse(collectLinks());
  }
  return true;
});

function countText(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const characters = cleaned.length;
  const charactersNoSpaces = cleaned.replace(/\s/g, '').length;
  const words = cleaned ? cleaned.split(/\s+/).length : 0;
  const sentences = cleaned ? (cleaned.match(/[.!?]+(\s|$)/g) || []).length : 0;
  const readingTimeMin = Math.max(1, Math.ceil(words / 238));
  return { characters, charactersNoSpaces, words, sentences, readingTimeMin };
}


async function hashContent(text) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text.trim().replace(/\s+/g, ' '));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}

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
  
  // Generate content hash for change detection
  const contentHash = await hashContent(text);

  return {
    url: window.location.href,
    capturedAt: new Date().toISOString(),
    contentHash,
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

// ============ LINK COLLECTION (broken-link checker, Task 1) ============

// Gathers every a[href] on the page for the popup's link checker to plan a
// check against. self.SBWLinkCheck (lib/link-check.js, injected before this
// file — see popup.js/service-worker.js's executeScript file lists) owns
// normalizeUrl/hostKey so "absolute http(s) only, strip fragment, keep
// query" and "www.-insensitive host" stay defined in exactly one place.
// Returns { links, total }: `links` is capped at 300 (deduped by normalized
// URL, first anchor text/rel wins); `total` is the uncapped deduped count so
// the popup can show "first 300 of M".
function collectLinks() {
  // Defensive: this file can in principle run without lib/link-check.js
  // ahead of it (an injection-order slip, or a re-inject retry that only
  // pushed this file). Without the guard, referencing SBWLinkCheck below
  // throws before sendResponse() runs, and the message channel never
  // closes — the popup's sendToTab() would hang until Chrome's own timeout
  // instead of surfacing a clean error.
  if (typeof SBWLinkCheck === 'undefined') {
    return { links: [], total: 0, error: 'lib_missing' };
  }
  const currentHost = SBWLinkCheck.hostKey(window.location.href);
  const seen = new Map();

  document.querySelectorAll('a[href]').forEach(el => {
    const norm = SBWLinkCheck.normalizeUrl(el.getAttribute('href') ? el.href : null);
    if (!norm || seen.has(norm)) return;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const rel = el.getAttribute('rel');
    const internal = SBWLinkCheck.hostKey(norm) === currentHost;
    seen.set(norm, { url: norm, text, rel, internal });
  });

  const all = Array.from(seen.values());
  return { links: all.slice(0, 300), total: all.length };
}

// ============ ELEMENT HIGHLIGHTING ============

function highlightElement(type, request) {
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
      .seo-toolkit-highlight-broken { outline-color: #e5484d !important; background: rgba(229, 72, 77, 0.15) !important; }
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
      'seo-toolkit-highlight-image-has-alt', 'seo-toolkit-highlight-broken');
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
    case 'broken': {
      // request.urls are normalized (fragment-stripped) URLs from the link
      // checker's results — compare against each anchor's own normalized
      // href so a mid-page #anchor difference doesn't hide a real match.
      const urls = new Set((request && request.urls) || []);
      document.querySelectorAll('a[href]').forEach(el => {
        const norm = typeof SBWLinkCheck !== 'undefined' ? SBWLinkCheck.normalizeUrl(el.href) : el.href.split('#')[0];
        if (norm && urls.has(norm)) {
          el.classList.add('seo-toolkit-highlight', 'seo-toolkit-highlight-broken');
        }
      });
      break;
    }
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

// ============ DOM EXTRACTION ============
// extractMeta, extractHeadings, extractLinks, extractImages, extractTechnical,
// getMainContent all live in lib/dom-extraction.js (JSDOM-testable).
// calculateSEOScore + getGrade live in lib/content-analysis.js.


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

// Task 3: full tag-grammar + reciprocity validation lives in
// self.SBWHreflang (src/lib/hreflang.js, injected before this file — see
// popup.js/service-worker.js/link-check.js's executeScript file lists,
// same pattern as SBWLinkCheck above). This only gathers the raw
// {lang,href} pairs off the DOM and hands them to SBWHreflang.validateSet()
// for code validity, duplicates, shared-URL, relative/protocol warnings,
// x-default and self-reference — then merges the original `href` back onto
// each validated entry (validateSet's own output only carries the resolved
// `url`, not the raw href the page actually wrote).
function analyzeHreflang() {
  const tags = document.querySelectorAll('link[rel="alternate"][hreflang]');
  const raw = [];
  tags.forEach(tag => {
    raw.push({
      lang: tag.getAttribute('hreflang'),
      href: tag.getAttribute('href'),
    });
  });

  // Defensive fallback (see collectLinks() above for the same guard
  // pattern): if lib/hreflang.js somehow isn't injected ahead of this file,
  // fall back to the original light checks rather than throwing.
  if (typeof SBWHreflang === 'undefined') {
    const issues = [];
    if (raw.length > 0) {
      const hasXDefault = raw.some(e => e.lang === 'x-default');
      if (!hasXDefault) issues.push('Missing x-default hreflang');

      const currentUrl = window.location.href;
      const hasSelfRef = raw.some(e => {
        try { return new URL(e.href, window.location.origin).href === currentUrl; } catch { return false; }
      });
      if (!hasSelfRef) issues.push('Missing self-referencing hreflang');
    }
    return { count: raw.length, entries: raw, issues };
  }

  const validated = SBWHreflang.validateSet(raw, window.location.href);
  const entries = validated.entries.map((v, i) => Object.assign({ href: raw[i] && raw[i].href }, v));
  return { count: raw.length, entries, issues: validated.issues };
}

// Task 5: full JSON-LD + microdata + RDFa extraction and required/
// recommended-property validation lives in self.SBWSchema
// (src/lib/structured-data.js, injected before this file — see
// popup.js/service-worker.js/link-check.js's executeScript file lists,
// same pattern as SBWHreflang above). This gathers the raw material off
// the DOM (JSON-LD script text, plus the document itself for the
// microdata/RDFa walks) and hands it to SBWSchema.validateAll() — the key
// name `schemaValidation` is unchanged from the old light version, but the
// value is now that function's { items, counts, eligible } result rather
// than a plain array.
function analyzeSchemaValidation() {
  const scriptTexts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map(s => s.textContent);

  // Defensive fallback (see collectLinks()/analyzeHreflang() above for the
  // same guard pattern): if lib/structured-data.js somehow isn't injected
  // ahead of this file, fall back to a minimal JSON-LD-only, no-validation
  // shape rather than throwing — still keyed the same way so callers don't
  // need to special-case it.
  if (typeof SBWSchema === 'undefined') {
    const items = [];
    scriptTexts.forEach(text => {
      try {
        const data = JSON.parse(text);
        const nodes = data && data['@graph'] || (Array.isArray(data) ? data : [data]);
        nodes.forEach(node => {
          const type = Array.isArray(node['@type']) ? node['@type'][0] : node['@type'];
          if (type) items.push({ type, source: 'json-ld', required: { missing: [], present: [] }, recommended: { missing: [] }, problems: [] });
        });
      } catch (e) { /* skip unparsable block */ }
    });
    return { items, counts: { byType: {}, bySource: {}, withErrors: 0 }, eligible: [] };
  }

  const raw = [].concat(
    SBWSchema.extractJsonLd(scriptTexts),
    SBWSchema.extractMicrodata(document),
    SBWSchema.extractRdfa(document)
  );
  return SBWSchema.validateAll(raw);
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

// buildNgramCounts + getTopN live in lib/content-analysis.js.

} // end __seoBandwagonLoaded guard
