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

  // #87: an element's words as a reader sees them. textContent joins the
  // text either side of a <br> or between two blocks ("SEO that<br>actually
  // works" read "SEO thatactually works"), and innerText only does better on
  // an element that's laid out, which a detached clone isn't. A <br> and the
  // edges of block elements become spaces; script, style and template text
  // is left out; whitespace is collapsed.
  const BLOCK_TAGS = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|CAPTION|DD|DETAILS|DIALOG|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HGROUP|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|SUMMARY|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL|OPTION)$/;
  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/;

  function visibleText(el) {
    if (!el) return '';
    const parts = [];
    (function walk(node) {
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          parts.push(c.nodeValue);
        } else if (c.nodeType === 1) {
          const tag = c.tagName.toUpperCase();
          if (tag === 'BR') { parts.push(' '); continue; }
          if (SKIP_TAGS.test(tag)) continue;
          const block = BLOCK_TAGS.test(tag);
          if (block) parts.push(' ');
          walk(c);
          if (block) parts.push(' ');
        }
      }
    })(el);
    return parts.join('').replace(/\s+/g, ' ').trim();
  }

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
  //
  // Capped at OUTLINE_CAP entries (fix round 1, item 3) — same reasoning as
  // LINKS_LIST_CAP/IMAGES_LIST_CAP below: a page with thousands of headings
  // shouldn't balloon the in-memory analysis object or the CSV export.
  const OUTLINE_CAP = 500;

  function computeHeadingOutline(doc) {
    const nodes = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]');
    const outline = [];
    nodes.forEach(function (el) {
      if (outline.length >= OUTLINE_CAP) return;

      const text = visibleText(el);
      if (!text) return;

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      // Fix round 1, item 5 (WAI-ARIA precedence): an explicit `aria-level`
      // wins over the tag name whenever it's present — even on a real h1-h6
      // element (`<h2 role="heading" aria-level="3">` is level 3, not 2).
      // Only fall back to the tag name (or, for a non-heading tag, the
      // role=heading default of 2) when `aria-level` is absent or fails to
      // parse as a number.
      const ariaLevelAttr = el.getAttribute('aria-level');
      let level;
      if (ariaLevelAttr !== null) {
        const parsedLevel = parseInt(ariaLevelAttr, 10);
        if (!isNaN(parsedLevel)) {
          level = Math.min(6, Math.max(1, parsedLevel));
        } else if (/^h[1-6]$/.test(tag)) {
          level = parseInt(tag.slice(1), 10);
        } else {
          level = 2; // WAI-ARIA: role="heading" with an unparseable aria-level implies level 2
        }
      } else if (/^h[1-6]$/.test(tag)) {
        level = parseInt(tag.slice(1), 10);
      } else {
        level = 2; // WAI-ARIA: role="heading" with no aria-level implies level 2
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
        const text = visibleText(el);
        if (text) headings['h' + i].push(text);
      });
    }

    headings.multipleH1 = headings.h1.length > 1;
    headings.outline = computeHeadingOutline(doc);
    return headings;
  }

  // Nofollow-family rel — the three rel values Google treats as "don't pass
  // this link" hints, counted separately but listed together since the
  // existing Highlight button already treats them as one family.
  //
  // Fix round 1, item 1: `rel` is a space-separated token list per the HTML
  // spec, not a substring to search — a plain `indexOf('nofollow')` check
  // both under- and over-matches (`rel="NOFOLLOW"` is valid and gets
  // missed by a case-sensitive search; `rel="me nofollowing"` has no
  // `nofollow` token at all but would substring-match). `relTokens()` is
  // exported so src/content/analyzer.js's highlight selector can run the
  // exact same token test — count and highlight can never disagree.
  function relTokens(rel) {
    return new Set(String(rel || '').toLowerCase().split(/\s+/).filter(Boolean));
  }

  function isNofollowFamily(rel) {
    const tokens = relTokens(rel);
    return tokens.has('nofollow') || tokens.has('ugc') || tokens.has('sponsored');
  }

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
      const text = visibleText(link);
      const rel = link.getAttribute('rel') || '';

      // Counted (and captured into nofollowAnchors) regardless of whether
      // the href itself parses — same as the original nofollow-only count
      // did, so a malformed href never hides a real rel attribute.
      const tokens = relTokens(rel);
      const isNofollow = tokens.has('nofollow');
      const isUgc = tokens.has('ugc');
      const isSponsored = tokens.has('sponsored');
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

        // Fix round 1, item 9: the CSV-export `list` is documented as
        // internal/external web links — an `ftp://` (or any other
        // non-http(s)) link on the same host would otherwise ride along on
        // `type === 'internal'` even though it isn't a link a browser would
        // ever navigate as HTTP(S). internal.count/external.count are left
        // as-is (pre-existing behavior, out of this fix's scope).
        if (type && /^https?:$/.test(url.protocol) && list.length < LINKS_LIST_CAP) {
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
      const srcAttr = img.getAttribute('src');
      const dataSrcAttr = img.dataset && img.dataset.src;
      const src = img.src || dataSrcAttr || '';
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
        // Fix round 1, item 10: `loading="lazy"` is the explicit signal,
        // but a `data-src` with no `src` attribute IS lazy loading in
        // practice (the common pattern most lazy-load libraries used
        // before native `loading="lazy"` existed) — flag it the same way.
        const lazyByDataSrc = !!dataSrcAttr && !srcAttr;
        list.push({
          src: src,
          alt: alt || '',
          hasAlt: hasAlt,
          lazy: img.getAttribute('loading') === 'lazy' || lazyByDataSrc,
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
    if (main) return main.innerText !== undefined ? main.innerText : visibleText(main); // laid out: innerText is right (#87)

    if (!doc.body) return '';
    const body = doc.body.cloneNode(true);
    const exclude = ['header', 'footer', 'nav', 'aside', '.sidebar', '.navigation', '.menu', 'script', 'style', 'noscript', 'iframe'];
    exclude.forEach(function (sel) {
      body.querySelectorAll(sel).forEach(function (el) { el.remove(); });
    });

    // A detached clone isn't laid out, so innerText would read it like
    // textContent, joining words across <br> and blocks (#87).
    return visibleText(body);
  }

  return {
    extractMeta: extractMeta,
    extractHeadings: extractHeadings,
    extractLinks: extractLinks,
    extractImages: extractImages,
    extractTechnical: extractTechnical,
    getMainContent: getMainContent,
    visibleText: visibleText,
    relTokens: relTokens,
    isNofollowFamily: isNofollowFamily,
    OUTLINE_CAP: OUTLINE_CAP,
    LINKS_LIST_CAP: LINKS_LIST_CAP,
    IMAGES_LIST_CAP: IMAGES_LIST_CAP,
    NOFOLLOW_ANCHORS_CAP: NOFOLLOW_ANCHORS_CAP
  };
});
