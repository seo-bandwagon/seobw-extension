// DOM-bound extractors pulled out of content.js for testability against JSDOM.
// Each function still touches `document` / `window` globals, but those are
// provided by both the target tab (in production) and JSDOM (in tests), so
// the functions are directly testable without refactor.
//
// Dual-export pattern: attaches to self.SEOBWExtraction when loaded as a
// content script (via chrome.scripting.executeScript); exports via CommonJS
// for Vitest.

(function (factory) {
  var api = factory();
  if (typeof self !== 'undefined') {
    self.SEOBWExtraction = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  function extractMeta(doc) {
    doc = doc || document;
    const getMeta = function (name) {
      const el = doc.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
      return el ? el.getAttribute('content') : null;
    };

    const title = doc.title || '';
    const description = getMeta('description') || '';
    const canonicalEl = doc.querySelector('link[rel="canonical"]');
    const canonical = canonicalEl ? canonicalEl.href : null;
    const robots = getMeta('robots') || null;

    const openGraph = {
      title: getMeta('og:title'),
      description: getMeta('og:description'),
      image: getMeta('og:image'),
      type: getMeta('og:type'),
      url: getMeta('og:url'),
      siteName: getMeta('og:site_name')
    };

    const twitter = {
      card: getMeta('twitter:card'),
      title: getMeta('twitter:title'),
      description: getMeta('twitter:description'),
      image: getMeta('twitter:image')
    };

    const schemaScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    const schema = [];
    schemaScripts.forEach(function (script) {
      try {
        schema.push(JSON.parse(script.textContent));
      } catch (e) {
        // Invalid JSON, skip — score will reflect "no valid schema"
      }
    });

    return {
      title: { text: title, length: title.length },
      description: { text: description, length: description.length },
      canonical: canonical,
      robots: robots,
      openGraph: openGraph,
      twitter: twitter,
      schema: schema
    };
  }

  function extractHeadings(doc) {
    doc = doc || document;
    const headings = {
      h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
      multipleH1: false
    };

    for (let i = 1; i <= 6; i++) {
      const els = doc.querySelectorAll('h' + i);
      els.forEach(function (el) {
        const text = el.textContent.trim();
        if (text) headings['h' + i].push(text);
      });
    }

    headings.multipleH1 = headings.h1.length > 1;
    return headings;
  }

  function extractLinks(doc, currentLocation) {
    doc = doc || document;
    const loc = currentLocation || (typeof window !== 'undefined' ? window.location : { hostname: '' });
    const currentHost = loc.hostname;
    const links = doc.querySelectorAll('a[href]');

    const internal = { count: 0, urls: [] };
    const external = { count: 0, urls: [], domains: new Set() };
    const anchors = [];
    let nofollow = 0;

    links.forEach(function (link) {
      const href = link.href;
      const text = link.textContent.trim();
      const rel = link.getAttribute('rel') || '';

      if (rel.indexOf('nofollow') !== -1) nofollow++;

      try {
        const url = new URL(href);

        if (url.hostname === currentHost ||
            url.hostname === 'www.' + currentHost ||
            'www.' + url.hostname === currentHost) {
          internal.count++;
          if (internal.urls.length < 100) internal.urls.push(href);
        } else if (url.protocol.indexOf('http') === 0) {
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
      internal: internal,
      external: {
        count: external.count,
        urls: external.urls,
        domains: Array.from(external.domains)
      },
      anchors: anchors,
      nofollow: nofollow
    };
  }

  function extractImages(doc) {
    doc = doc || document;
    const images = doc.querySelectorAll('img');
    const missingAlt = { count: 0, srcs: [] };
    const altTexts = [];

    images.forEach(function (img) {
      const alt = img.getAttribute('alt');
      const src = img.src || (img.dataset && img.dataset.src) || '';

      if (!alt || alt.trim() === '') {
        missingAlt.count++;
        if (missingAlt.srcs.length < 20) missingAlt.srcs.push(src.slice(0, 200));
      } else {
        if (altTexts.length < 50) altTexts.push(alt.slice(0, 200));
      }
    });

    return {
      total: images.length,
      missingAlt: missingAlt,
      altTexts: altTexts
    };
  }

  function extractTechnical(doc, win) {
    doc = doc || document;
    win = win || (typeof window !== 'undefined' ? window : {});

    const scripts = doc.querySelectorAll('script');
    const stylesheets = doc.querySelectorAll('link[rel="stylesheet"], style');

    let loadTimeMs = null;
    if (win.performance && win.performance.timing) {
      const timing = win.performance.timing;
      if (timing.loadEventEnd && timing.navigationStart) {
        loadTimeMs = timing.loadEventEnd - timing.navigationStart;
      }
    }

    const path = (win.location && win.location.pathname) || '';
    const urlDepth = path.split('/').filter(function (p) { return p.length > 0; }).length;

    return {
      domElements: doc.getElementsByTagName('*').length,
      scripts: scripts.length,
      stylesheets: stylesheets.length,
      loadTimeMs: loadTimeMs,
      urlDepth: urlDepth,
      url: {
        protocol: (win.location && win.location.protocol) || '',
        pathname: path,
        search: (win.location && win.location.search) || '',
        hash: (win.location && win.location.hash) || ''
      }
    };
  }

  function getMainContent(doc) {
    doc = doc || document;
    const main = doc.querySelector('main, article, [role="main"]');
    if (main) return main.innerText !== undefined ? main.innerText : main.textContent;

    if (!doc.body) return '';
    const body = doc.body.cloneNode(true);
    const exclude = ['header', 'footer', 'nav', 'aside', '.sidebar', '.navigation', '.menu', 'script', 'style', 'noscript', 'iframe'];
    exclude.forEach(function (sel) {
      body.querySelectorAll(sel).forEach(function (el) { el.remove(); });
    });

    return body.innerText !== undefined ? body.innerText : body.textContent;
  }

  return {
    extractMeta: extractMeta,
    extractHeadings: extractHeadings,
    extractLinks: extractLinks,
    extractImages: extractImages,
    extractTechnical: extractTechnical,
    getMainContent: getMainContent
  };
});
