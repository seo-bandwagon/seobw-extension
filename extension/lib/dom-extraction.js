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

  // A page with scripts on (the live page) parses <noscript> as text; a
  // parsed Document, which runs none, parses it as elements. Leaving out
  // what sits inside one keeps the two the same (a tracking pixel's
  // <noscript><img> isn't an image missing alt).
  function outsideNoscript(list) {
    return Array.prototype.filter.call(list, function (el) { return !(el.closest && el.closest('noscript')); });
  }

  // A heading's words, or, for a heading that is only an image (a logo H1),
  // its images' alt text, which is what search engines read there.
  function textOrAlt(el) {
    const text = visibleText(el);
    if (text) return { text: text, fromAlt: false };
    const alts = Array.prototype.map.call(el.querySelectorAll('img[alt]'), function (img) {
      return String(img.getAttribute('alt') || '').trim();
    }).filter(Boolean);
    return { text: alts.join(' '), fromAlt: alts.length > 0 };
  }

  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  // <title> elements of the page itself (an inline SVG's <title> is not one).
  function titleElements(doc) {
    return Array.prototype.filter.call(doc.getElementsByTagName('title'), function (el) {
      return (!el.namespaceURI || el.namespaceURI === HTML_NS) && !(el.closest && el.closest('svg'));
    });
  }

  // <meta name="…"> elements, the name matched without case as browsers do.
  function metasNamed(doc, name) {
    return Array.prototype.filter.call(doc.querySelectorAll('meta[name]'), function (el) {
      return String(el.getAttribute('name')).trim().toLowerCase() === name;
    });
  }

  function contentsOf(els) {
    return els.map(function (el) { return String(el.getAttribute('content') || '').trim(); }).filter(Boolean);
  }

  function withoutHash(href) {
    try {
      const u = new URL(href);
      u.hash = '';
      return u.href;
    } catch (e) {
      return null;
    }
  }

  // The robots and googlebot metas, combined as Google combines them.
  // `none` is noindex plus nofollow.
  function robotsFacts(doc) {
    const robots = contentsOf(metasNamed(doc, 'robots'));
    const googlebot = contentsOf(metasNamed(doc, 'googlebot'));
    const says = function (list) {
      return list.join(',').toLowerCase().split(/[\s,]+/).some(function (t) { return t === 'noindex' || t === 'none'; });
    };
    const fromRobots = says(robots);
    const fromGooglebot = says(googlebot);
    return {
      googlebot: googlebot.length ? googlebot.join(', ') : null,
      noindex: fromRobots || fromGooglebot,
      noindexSource: fromRobots ? 'robots' : fromGooglebot ? 'googlebot' : null
    };
  }

  // Top-level structured-data items: JSON-LD blocks that parse, Microdata
  // items (an itemscope with an itemtype that isn't another item's
  // property) and RDFa resources (a typeof outside any other typeof).
  function structuredDataCounts(doc, jsonLd) {
    const microdata = doc.querySelectorAll('[itemscope][itemtype]:not([itemprop])').length;
    const rdfa = Array.prototype.filter.call(doc.querySelectorAll('[typeof]'), function (el) {
      return !(el.parentElement && el.parentElement.closest('[typeof]'));
    }).length;
    return { jsonLd: jsonLd, microdata: microdata, rdfa: rdfa };
  }

  function declaredCharset(doc) {
    const direct = doc.querySelector('meta[charset]');
    if (direct) return String(direct.getAttribute('charset')).trim() || null;
    const httpEquiv = Array.prototype.filter.call(doc.querySelectorAll('meta[http-equiv]'), function (el) {
      return String(el.getAttribute('http-equiv')).toLowerCase() === 'content-type';
    })[0];
    const m = httpEquiv && /charset\s*=\s*["']?([\w-]+)/i.exec(httpEquiv.getAttribute('content') || '');
    return m ? m[1] : null;
  }

  function extractMeta(doc, pageUrl) {
    doc = doc || document;
    const getMeta = function (name) {
      const el = doc.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
      return el ? el.getAttribute('content') : null;
    };

    const title = doc.title || '';
    const descriptions = metasNamed(doc, 'description');
    const description = (descriptions[0] && descriptions[0].getAttribute('content')) || '';
    const canonicalEls = Array.prototype.filter.call(doc.querySelectorAll('link[rel][href]'), function (el) {
      return relTokens(el.getAttribute('rel')).has('canonical');
    });
    const canonical = canonicalEls.length ? canonicalEls[0].href : null;
    const canonicalUrls = [];
    canonicalEls.forEach(function (el) {
      const href = withoutHash(el.href) || el.href;
      if (canonicalUrls.indexOf(href) === -1 && canonicalUrls.length < 5) canonicalUrls.push(href);
    });
    const page = withoutHash(pageUrl || doc.URL || '');
    const canonicalTarget = !canonical || !page ? null
      : (withoutHash(canonical) === page ? 'self' : 'elsewhere');
    const robots = robotsFacts(doc);
    const viewport = contentsOf(metasNamed(doc, 'viewport'))[0] || null;
    const lang = doc.documentElement ? String(doc.documentElement.getAttribute('lang') || '').trim() || null : null;

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

    // displayLength (wide characters counted twice) is added by
    // SEOBWAnalysis.analyzeDocument, which owns the text rules.
    return {
      title: { text: title, length: title.length, count: titleElements(doc).length },
      description: { text: description, length: description.length, count: descriptions.length },
      canonical: canonical,
      canonicalCount: canonicalEls.length,
      canonicalUrls: canonicalUrls,
      canonicalTarget: canonicalTarget,
      // The first robots tag, as before 1.10.4 and as the render check's raw
      // side reads it; noindex reads every robots and googlebot tag.
      robots: getMeta('robots') || null,
      googlebot: robots.googlebot,
      noindex: robots.noindex,
      noindexSource: robots.noindexSource,
      lang: lang,
      viewport: viewport,
      charset: { document: doc.characterSet || null, declared: declaredCharset(doc) },
      openGraph: openGraph,
      twitter: twitter,
      schema: schema,
      structuredData: structuredDataCounts(doc, schema.length)
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

  //
  // 1.10.4: the popup shows this as the full ordered tree. An empty heading
  // stays in it (`empty: true`, text '') instead of being dropped, a heading
  // that is only an image reads its alt (`fromAlt: true`), and `skipped`
  // names the levels a heading jumps over from the one before it (an H2
  // followed by an H4 skips [3]).
  function computeHeadingOutline(doc) {
    const nodes = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]');
    const outline = [];
    nodes.forEach(function (el) {
      if (outline.length >= OUTLINE_CAP) return;

      const read = textOrAlt(el);
      const text = read.text;

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

      const prev = outline.length ? outline[outline.length - 1].level : null;
      const skipped = [];
      if (prev !== null) for (let l = prev + 1; l < level; l++) skipped.push(l);

      const entry = { level: level, text: text, order: outline.length + 1 };
      if (!text) entry.empty = true;
      if (read.fromAlt) entry.fromAlt = true;
      if (skipped.length) entry.skipped = skipped;
      outline.push(entry);
    });
    return outline;
  }

  function extractHeadings(doc) {
    doc = doc || document;
    const headings = {
      h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
      multipleH1: false,
      outline: [],
      empty: 0,
      skips: 0
    };

    for (let i = 1; i <= 6; i++) {
      const els = doc.querySelectorAll('h' + i);
      els.forEach(function (el) {
        const text = textOrAlt(el).text;
        if (text) headings['h' + i].push(text);
      });
    }

    headings.multipleH1 = headings.h1.length > 1;
    headings.outline = computeHeadingOutline(doc);
    headings.outline.forEach(function (h) {
      if (h.empty) headings.empty++;
      if (h.skipped) headings.skips++;
    });
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
    const links = outsideNoscript(doc.querySelectorAll('a[href]'));

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

  // 1.10.4: an empty alt (alt="") is how a page marks an image decorative,
  // and screen readers skip it, so it is not "missing". Only an image with
  // no alt attribute at all is; `decorative` counts the others.
  function extractImages(doc) {
    doc = doc || document;
    const images = outsideNoscript(doc.querySelectorAll('img'));
    const missingAlt = { count: 0, srcs: [] };
    const altTexts = [];
    const list = [];
    let decorativeCount = 0;

    images.forEach(function (img) {
      const alt = img.getAttribute('alt');
      const srcAttr = img.getAttribute('src');
      const dataSrcAttr = img.dataset && img.dataset.src;
      const src = img.src || dataSrcAttr || '';
      const hasAlt = !(!alt || alt.trim() === '');
      const decorative = alt !== null && !hasAlt;

      if (decorative) {
        decorativeCount++;
      } else if (!hasAlt) {
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
          decorative: decorative,
          lazy: img.getAttribute('loading') === 'lazy' || lazyByDataSrc,
          width: width !== null ? width : null,
          height: height !== null ? height : null
        });
      }
    });

    return {
      total: images.length,
      missingAlt: missingAlt,
      decorative: decorativeCount,
      altTexts: altTexts,
      list: list
    };
  }

  // win: the page's window, or `{ location }` for a parsed Document (whose
  // own defaultView is null; falling back to the global window there would
  // read the analyzing page's URL).
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

  // The words the score counts: the page's <main> (or role=main, else its
  // first <article>), unless that region is tiny, as on a page whose <main>
  // holds only a welcome line: fewer than MAIN_MIN_WORDS words while the
  // body (less header, footer, nav and sidebars) has more than twice as
  // many. Then the body. `countWords` is the analyzer's own word counter;
  // without one, words are split on spaces. `scope` says which was read:
  // 'main', 'body' (no main region) or 'body-fallback'.
  const MAIN_MIN_WORDS = 100;
  const CHROME_SELECTORS = ['header', 'footer', 'nav', 'aside', '.sidebar', '.navigation', '.menu', 'script', 'style', 'noscript', 'iframe'];

  function bodyText(doc) {
    if (!doc.body) return '';
    const body = doc.body.cloneNode(true);
    CHROME_SELECTORS.forEach(function (sel) {
      body.querySelectorAll(sel).forEach(function (el) { el.remove(); });
    });
    // A detached clone isn't laid out, so innerText would read it like
    // textContent, joining words across <br> and blocks (#87).
    return visibleText(body);
  }

  function extractMainText(doc, countWords) {
    doc = doc || document;
    const count = countWords || function (t) { return String(t).split(/\s+/).filter(Boolean).length; };
    const main = doc.querySelector('main, [role="main"]') || doc.querySelector('article');
    if (!main) return { text: bodyText(doc), scope: 'body' };

    // Laid out, innerText is right (#87); a parsed Document (no defaultView)
    // and jsdom aren't, so their text is read node by node.
    const laidOut = !!doc.defaultView && typeof main.innerText === 'string';
    const mainText = laidOut ? main.innerText : visibleText(main);
    const mainWords = count(mainText);
    if (mainWords >= MAIN_MIN_WORDS) return { text: mainText, scope: 'main' };
    const body = bodyText(doc);
    return count(body) > 2 * mainWords
      ? { text: body, scope: 'body-fallback' }
      : { text: mainText, scope: 'main' };
  }

  function getMainContent(doc, countWords) {
    return extractMainText(doc, countWords).text;
  }

  // The text the content hash is taken from, exactly as 1.10.3 read and
  // cleaned it: the first main/article/role=main region, ASCII only. The
  // site's report says "content changed" when two captures' hashes differ,
  // so hashing 1.10.4's text would mark every page changed once at the
  // update. Moving the hash to every language needs the report to compare
  // only hashes of one kind first.
  function legacyHashText(doc) {
    doc = doc || document;
    const main = doc.querySelector('main, article, [role="main"]');
    let text;
    if (main) text = (doc.defaultView && typeof main.innerText === 'string') ? main.innerText : visibleText(main);
    else text = bodyText(doc);
    return String(text).replace(/\s+/g, ' ').replace(/[^\w\s.,!?;:'"()-]/g, '').trim();
  }

  // http resources on an https page (moved from src/content/analyzer.js so a
  // parsed Document gets it too).
  function extractMixedContent(doc, pageUrl) {
    doc = doc || document;
    const isHttps = /^https:/i.test(String(pageUrl || doc.URL || ''));
    if (!isHttps) return { isHttps: false, mixedCount: 0, items: [] };

    const items = [];
    outsideNoscript(doc.querySelectorAll('img[src^="http:"]')).forEach(function (el) {
      items.push({ type: 'image', url: el.getAttribute('src').substring(0, 100) });
    });
    outsideNoscript(doc.querySelectorAll('script[src^="http:"]')).forEach(function (el) {
      items.push({ type: 'script', url: el.getAttribute('src').substring(0, 100) });
    });
    outsideNoscript(doc.querySelectorAll('link[rel="stylesheet"][href^="http:"]')).forEach(function (el) {
      items.push({ type: 'stylesheet', url: el.getAttribute('href').substring(0, 100) });
    });
    outsideNoscript(doc.querySelectorAll('iframe[src^="http:"]')).forEach(function (el) {
      items.push({ type: 'iframe', url: el.getAttribute('src').substring(0, 100) });
    });

    return { isHttps: isHttps, mixedCount: items.length, items: items.slice(0, 20) };
  }

  // ============================================
  // Tech stack
  // ============================================

  // Until 1.10.4 the analyzer probed `window.*` from the content script's
  // isolated world, where a page's own globals are always undefined, so the
  // Facebook Pixel, Nuxt and Vue were never found. probeTechGlobals runs in
  // the page's own world (one chrome.scripting.executeScript with
  // world: 'MAIN', from the service worker; no new permission) and returns
  // booleans and counts only. detectTechStack reads them with the DOM, and
  // works from the DOM alone when there are none (a parsed Document).
  //
  // Self-contained: executeScript sends its source, not a closure.
  function probeTechGlobals() {
    var w = window;
    var out = {};
    var names = ['Shopify', 'wixBiSession', 'Webflow', '__NEXT_DATA__', 'next', '__NUXT__', '$nuxt',
      '__VUE__', 'Vue', 'angular', 'ng', 'getAllAngularRootElements', 'fbq', 'hj', 'HubSpotConversations', '_hsq',
      'Intercom', 'clarity', 'gtag', 'ga', 'google_tag_manager', '__cfBeacon', 'jQuery'];
    // An element with a matching id (or a form or image with a matching
    // name) is a property of window too: <a id="next"> is window.next. Only
    // a value that isn't a DOM node or collection counts.
    names.forEach(function (n) {
      try {
        var v = w[n];
        out[n] = typeof v !== 'undefined' && v !== null &&
          !(w.Node && v instanceof w.Node) && !(w.HTMLCollection && v instanceof w.HTMLCollection);
      } catch (e) { out[n] = false; }
    });
    try { out.squarespace = !!(w.Static && w.Static.SQUARESPACE_CONTEXT); } catch (e) { out.squarespace = false; }
    try {
      var keys = w.google_tag_manager ? Object.keys(w.google_tag_manager) : [];
      out.gtmContainers = keys.filter(function (k) { return /^GTM-/.test(k); }).length;
      out.gaTags = keys.filter(function (k) { return /^(G|UA)-/.test(k); }).length;
    } catch (e) { out.gtmContainers = 0; out.gaTags = 0; }
    try { out.sveltekit = Object.keys(w).some(function (k) { return k.indexOf('__sveltekit') === 0; }); } catch (e) { out.sveltekit = false; }
    // A React or Vue app root carries the framework's own properties on its
    // DOM node, which only this world sees.
    out.reactRoot = false;
    out.vueRoot = false;
    try {
      var roots = document.querySelectorAll('body, body > *, body > * > *, #root, #app, #__next, #__nuxt');
      for (var i = 0; i < roots.length && i < 200; i++) {
        var el = roots[i];
        if (el._reactRootContainer || Object.keys(el).some(function (k) { return k.indexOf('__reactContainer$') === 0 || k.indexOf('__reactFiber$') === 0; })) out.reactRoot = true;
        if (el.__vue_app__ || el.__vue__) out.vueRoot = true;
      }
    } catch (e) { /* keep what was found */ }
    return out;
  }

  function hasVueScopedAttribute(doc) {
    const els = doc.body ? doc.body.getElementsByTagName('*') : [];
    for (let i = 0; i < els.length && i < 500; i++) {
      const attrs = els[i].attributes;
      for (let j = 0; j < attrs.length; j++) if (attrs[j].name.indexOf('data-v-') === 0) return true;
    }
    return false;
  }

  function detectTechStack(doc, globals) {
    doc = doc || document;
    const g = globals || {};
    const q = function (sel) { return !!doc.querySelector(sel); };
    const generator = function (name) {
      return metasNamed(doc, 'generator').some(function (el) { return String(el.getAttribute('content') || '').indexOf(name) !== -1; });
    };
    const tech = [];
    const add = function (name, category, icon) { tech.push({ name: name, category: category, icon: icon }); };

    // CMS
    if (generator('WordPress') || q('link[href*="/wp-content/"]') || q('script[src*="/wp-includes/"]') || q('script[src*="/wp-content/"]')) {
      add('WordPress', 'CMS', '📝');
    }
    if (g.Shopify || q('meta[name="shopify-checkout-api-token"]') || q('script[src*="cdn.shopify.com"]') || q('link[href*="cdn.shopify.com"]')) {
      add('Shopify', 'E-commerce', '🛒');
    }
    if (generator('Wix') || g.wixBiSession || q('script[src*="static.parastorage.com"]')) {
      add('Wix', 'CMS', '📝');
    }
    if (g.squarespace || q('script[src*="squarespace.com"]') || q('link[href*="squarespace.com"]')) {
      add('Squarespace', 'CMS', '📝');
    }
    if (q('[data-wf-page]') || g.Webflow) {
      add('Webflow', 'CMS', '📝');
    }
    if (generator('Drupal')) add('Drupal', 'CMS', '💧');
    if (generator('Joomla')) add('Joomla', 'CMS', '📝');

    // Frameworks
    const nuxt = !!(g.__NUXT__ || g.$nuxt || q('#__nuxt') || q('script#__NUXT_DATA__'));
    if (q('#__next') || q('script#__NEXT_DATA__') || q('script[src*="/_next/"]') || g.__NEXT_DATA__ || g.next) {
      add('Next.js', 'Framework', '⚛️');
    } else if (q('[data-reactroot]') || g.reactRoot) {
      add('React', 'Framework', '⚛️');
    }
    if (nuxt) add('Nuxt.js', 'Framework', '💚');
    if (nuxt || g.vueRoot || g.Vue || g.__VUE__ || q('[data-v-app]') || hasVueScopedAttribute(doc)) {
      add('Vue.js', 'Framework', '💚');
    }
    if (q('[ng-version]') || g.getAllAngularRootElements || g.ng) {
      add('Angular', 'Framework', '🅰️');
    } else if (g.angular || q('[ng-app]') || q('[data-ng-app]')) {
      add('AngularJS', 'Framework', '🅰️');
    }
    if (q('#___gatsby')) add('Gatsby', 'Framework', '💜');
    if (g.sveltekit || q('[data-sveltekit-hydrate]') || q('[data-sveltekit-preload-data]')) {
      add('SvelteKit', 'Framework', '🔥');
    }

    // Analytics & Marketing. Tag Manager is a container that loads other
    // tags; it is not Analytics, which is its own tag (gtag.js with a G- or
    // UA- ID, or analytics.js).
    if (g.gtmContainers > 0 || q('script[src*="googletagmanager.com/gtm.js"]') || q('iframe[src*="googletagmanager.com/ns.html"]')) {
      add('Google Tag Manager', 'Tag manager', '🏷️');
    }
    if (g.gaTags > 0 || g.ga || q('script[src*="googletagmanager.com/gtag/js"]') || q('script[src*="google-analytics.com/analytics.js"]') || q('script[src*="google-analytics.com/ga.js"]')) {
      add('Google Analytics', 'Analytics', '📊');
    }
    if (g.fbq || q('script[src*="connect.facebook.net"][src*="fbevents"]')) {
      add('Facebook Pixel', 'Analytics', '📘');
    }
    if (g.hj || q('script[src*="hotjar"]')) add('Hotjar', 'Analytics', '🔥');
    if (g.HubSpotConversations || g._hsq || q('script[src*="hs-scripts.com"]') || q('script[src*="hubspot"]')) {
      add('HubSpot', 'Marketing', '🟠');
    }
    if (g.Intercom || q('script[src*="intercom"]')) add('Intercom', 'Support', '💬');
    if (q('script[src*="clarity.ms"]') || g.clarity) add('Microsoft Clarity', 'Analytics', '🔍');

    // CDN. cdnjs.cloudflare.com serves libraries to any site, so it is not a
    // sign the site is behind Cloudflare; /cdn-cgi/ paths and the Web
    // Analytics beacon are.
    if (q('script[src*="/cdn-cgi/"]') || q('link[href*="/cdn-cgi/"]') || q('a[href*="/cdn-cgi/l/email-protection"]') || q('script[src*="static.cloudflareinsights.com"]') || g.__cfBeacon) {
      add('Cloudflare', 'CDN', '☁️');
    }

    // Libraries
    if (g.jQuery || q('script[src*="jquery"]')) add('jQuery', 'Library', '📦');

    return tech;
  }

  return {
    extractMeta: extractMeta,
    extractHeadings: extractHeadings,
    extractLinks: extractLinks,
    extractImages: extractImages,
    extractTechnical: extractTechnical,
    extractMainText: extractMainText,
    extractMixedContent: extractMixedContent,
    getMainContent: getMainContent,
    legacyHashText: legacyHashText,
    detectTechStack: detectTechStack,
    probeTechGlobals: probeTechGlobals,
    visibleText: visibleText,
    relTokens: relTokens,
    isNofollowFamily: isNofollowFamily,
    OUTLINE_CAP: OUTLINE_CAP,
    LINKS_LIST_CAP: LINKS_LIST_CAP,
    IMAGES_LIST_CAP: IMAGES_LIST_CAP,
    NOFOLLOW_ANCHORS_CAP: NOFOLLOW_ANCHORS_CAP,
    MAIN_MIN_WORDS: MAIN_MIN_WORDS
  };
});
