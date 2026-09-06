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

  // Document-order heading outline: level + text + 1-based order, for the
  // popup's headings CSV export and "Copy outline" button. Unlike the
  // literal h1-h6 arrays above, this also picks up `[role="heading"]`
  // elements with an `aria-level` — a single combined selector list
  // returns each matching element once (no double-count for an hN that
  // also carries role=heading) and already in document order, so no
  // separate sort/merge step is needed. Detailed's "H7" quirk is
  // deliberately not implemented here (H1-H6 is the HTML spec); this
  // outline is the substitute the brief asks for instead.
  function computeHeadingOutline(doc) {
    const nodes = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]');
    const outline = [];
    nodes.forEach(function (el) {
      const text = (el.textContent || '').trim();
      if (!text) return;

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      let level;
      if (/^h[1-6]$/.test(tag)) {
        level = parseInt(tag.slice(1), 10);
      } else {
        // WAI-ARIA: role="heading" with no (or an invalid) aria-level
        // implies level 2. An out-of-range numeric value is clamped into
        // 1-6 rather than trusted verbatim.
        const parsedLevel = parseInt(el.getAttribute('aria-level'), 10);
        if (isNaN(parsedLevel)) {
          level = 2;
        } else {
          level = Math.min(6, Math.max(1, parsedLevel));
        }
      }

      outline.push({ level: level, text: text, order: outline.length + 1 });
    });
    return outline;
  }

  function extractHeadings(doc) {
    doc = doc || document;
    const headings = {
      h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
      multipleH1: false,
      outline: []
    };

    for (let i = 1; i <= 6; i++) {
      const els = doc.querySelectorAll('h' + i);
      els.forEach(function (el) {
        const text = el.textContent.trim();
        if (text) headings['h' + i].push(text);
      });
    }

    headings.multipleH1 = headings.h1.length > 1;
    headings.outline = computeHeadingOutline(doc);
    return headings;
  }

  // Nofollow-family rel cap — mirrors highlightElement('nofollow')'s
  // selector in src/content/analyzer.js (`a[rel*="nofollow"],
  // a[rel*="ugc"], a[rel*="sponsored"]`): the three rel values Google
  // treats as "don't pass this link" hints, counted separately but listed
  // together since the existing Highlight button already treats them as
  // one family.
  const NOFOLLOW_ANCHORS_CAP = 50;
  const LINKS_LIST_CAP = 500;

  function extractLinks(doc, currentLocation) {
    doc = doc || document;
    const loc = currentLocation || (typeof window !== 'undefined' ? window.location : { hostname: '' });
    const currentHost = loc.hostname;
    const links = doc.querySelectorAll('a[href]');

    const internal = { count: 0, urls: [] };
    const external = { count: 0, urls: [], domains: new Set() };
    const anchors = [];
    const list = [];
    const nofollowAnchors = [];
    let nofollow = 0;
    let ugc = 0;
    let sponsored = 0;

    links.forEach(function (link) {
      const href = link.href;
      const text = link.textContent.trim();
      const rel = link.getAttribute('rel') || '';

      // Counted (and captured into nofollowAnchors) regardless of whether
      // the href itself parses — same as the original nofollow-only count
      // did, so a malformed href never hides a real rel attribute.
      const isNofollow = rel.indexOf('nofollow') !== -1;
      const isUgc = rel.indexOf('ugc') !== -1;
      const isSponsored = rel.indexOf('sponsored') !== -1;
      if (isNofollow) nofollow++;
      if (isUgc) ugc++;
      if (isSponsored) sponsored++;
      if ((isNofollow || isUgc || isSponsored) && nofollowAnchors.length < NOFOLLOW_ANCHORS_CAP) {
        nofollowAnchors.push({ url: href, text: text.slice(0, 120), rel: rel });
      }

      try {
        const url = new URL(href);
        // null (not 'internal'/'external') for a non-http(s) scheme
        // (javascript:, mailto:, tel:, ...) that still parses as a URL —
        // `list` (the CSV-export backing field) only carries real web
        // links, same set as what internal.count/external.count cover.
        let type = null;

        if (url.hostname === currentHost ||
            url.hostname === 'www.' + currentHost ||
            'www.' + url.hostname === currentHost) {
          internal.count++;
          type = 'internal';
          if (internal.urls.length < 100) internal.urls.push(href);
        } else if (url.protocol.indexOf('http') === 0) {
          external.count++;
          type = 'external';
          if (external.urls.length < 100) external.urls.push(href);
          external.domains.add(url.hostname);
        }

        if (type && list.length < LINKS_LIST_CAP) {
          list.push({ url: href, anchor: text.slice(0, 150), rel: rel, type: type });
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
      list: list,
      nofollow: nofollow,
      ugc: ugc,
      sponsored: sponsored,
      nofollowAnchors: nofollowAnchors
    };
  }

  const IMAGES_LIST_CAP = 500;

  function extractImages(doc) {
    doc = doc || document;
    const images = doc.querySelectorAll('img');
    const missingAlt = { count: 0, srcs: [] };
    const altTexts = [];
    const list = [];

    images.forEach(function (img) {
      const alt = img.getAttribute('alt');
      const src = img.src || (img.dataset && img.dataset.src) || '';
      const hasAlt = !(!alt || alt.trim() === '');

      if (!hasAlt) {
        missingAlt.count++;
        if (missingAlt.srcs.length < 20) missingAlt.srcs.push(src.slice(0, 200));
      } else {
        if (altTexts.length < 50) altTexts.push(alt.slice(0, 200));
      }

      if (list.length < IMAGES_LIST_CAP) {
        const width = img.getAttribute('width');
        const height = img.getAttribute('height');
        list.push({
          src: src,
          alt: alt || '',
          hasAlt: hasAlt,
          lazy: img.getAttribute('loading') === 'lazy',
          width: width !== null ? width : null,
          height: height !== null ? height : null
        });
      }
    });

    return {
      total: images.length,
      missingAlt: missingAlt,
      altTexts: altTexts,
      list: list
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
