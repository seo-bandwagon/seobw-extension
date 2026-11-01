// SEO Bandwagon — SERP overlay pure logic (Task 6)
//
// Everything in this file is pure DOM-in/data-out or string logic — no
// chrome.* calls, no fetch. The content script (src/overlay/serp-overlay.js)
// is the only caller that touches chrome APIs; it uses this module to parse
// the page, build export text, and construct location-simulator URLs.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerp` when loaded as a classic <script> (declared in
// manifest.json's content_scripts for the Google SERP hosts), and exports
// via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerp = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // ============================================
  // Domains
  // ============================================

  // Any google.<tld>, on any of the nine Google TLDs the overlay runs on
  // (see manifest content_scripts). Requires a '.' (or start-of-string)
  // immediately before "google" so an unrelated domain like "mygoogle.com"
  // does not false-positive.
  const GOOGLE_HOST_RE = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;

  // Google's own properties are organic results like any other site:
  // chromewebstore.google.com, support.google.com, developers.google.com,
  // search.google.com, play.google.com, www.google.com/chrome/… Until 1.7.5
  // every *.google.* host was dropped, which hid the Chrome Web Store
  // listings for extension keywords and moved every later result up (#42).
  // Internal means Google's own navigation, never a result:
  //   - the account, consent, policy, cache and maps hosts, and
  //   - on google.<tld> / www.google.<tld>, the search, redirect, settings
  //     and vertical paths below (and the bare homepage).
  const GOOGLE_INTERNAL_HOST_RE = /^(accounts|consent|myaccount|policies|webcache|maps)\./i;
  const GOOGLE_SEARCH_HOST_RE = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;
  const GOOGLE_INTERNAL_PATH_RE =
    /^\/(search|url|goto|imgres|aclk|setprefs|preferences|webhp|advanced_search|maps|travel|shopping|finance|sorry|intl)?(\/|$)/i;

  function isGoogleInternal(u) {
    const host = u.hostname.toLowerCase();
    if (!GOOGLE_HOST_RE.test(host)) return false;
    if (GOOGLE_INTERNAL_HOST_RE.test(host)) return true;
    return GOOGLE_SEARCH_HOST_RE.test(host) && GOOGLE_INTERNAL_PATH_RE.test(u.pathname);
  }

  function bareDomain(href) {
    let u;
    try {
      u = new URL(String(href));
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    let host = (u.hostname || '').toLowerCase();
    if (!host) return null;
    if (isGoogleInternal(u)) return null;
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  }

  // ============================================
  // Result / PAA extraction
  // ============================================

  // Fix round 1, item 3: added #tadsb (Google's second top-ads container id),
  // the shopping/commercial-unit classes and [data-pla] (product listing
  // ads), and an aria-label*="Sponsored" match alongside the existing
  // "Ads" one — some ad surfaces label themselves "Sponsored" rather than
  // "Ads".
  //
  // #94: the aria-label matches used to be CSS substring matches, so an
  // ancestor labelled "Downloads", "Threads" or "Leads" made every result in
  // it an ad. The selector now only finds candidates; the label must contain
  // "Ads" or "Sponsored" as a whole word (AD_LABEL_RE).
  const AD_CONTAINER_SELECTOR = '[data-text-ad], #tads, #tadsb, #bottomads, ' +
    '.commercial-unit-desktop-top, .commercial-unit-desktop-rhs, ' +
    '.cu-container, [data-pla]';
  const AD_LABEL_CANDIDATES = '[aria-label*="ads" i], [aria-label*="sponsored" i]';
  const AD_LABEL_RE = /\b(ads|sponsored)\b/i;

  function isAd(el) {
    if (!el || !el.closest) return false;
    if (el.closest(AD_CONTAINER_SELECTOR)) return true;
    for (let a = el.closest(AD_LABEL_CANDIDATES); a; a = a.parentElement && a.parentElement.closest(AD_LABEL_CANDIDATES)) {
      if (AD_LABEL_RE.test(a.getAttribute('aria-label') || '')) return true;
    }
    return false;
  }

  // Fix round 1, item 3: a block whose own leading text (first 20 chars,
  // trimmed) reads as a sponsored label — "Sponsored" on its own, or "Ad"
  // immediately followed by a middle-dot/bullet ("Ad ·", "Ad•") — gets no
  // bar even when it isn't inside one of the AD_CONTAINER_SELECTOR
  // containers above (some sponsored-looking organic-shaped blocks carry
  // only the text label, no distinguishing container/class).
  const SPONSORED_LABEL_RE = /^sponsored\b|^ad\s*[·•]/i;

  function hasSponsoredLabel(block) {
    if (!block) return false;
    const lead = (block.textContent || '').trim().slice(0, 20);
    return SPONSORED_LABEL_RE.test(lead);
  }

  // Fix round 1, item 1: containers that hold real h3s but are never an
  // organic web-result list — AI Overview, video/Top-stories carousels, and
  // (again, belt-and-braces with AD_CONTAINER_SELECTOR above) the shopping/
  // commercial units. An h3 whose block sits inside any of these is
  // rejected outright, regardless of ad-ness.
  //
  // 1.9.3: signed in, the AI Overview sits inside #rso as
  // [data-subtree="aimc"], and its "AI Mode reply for …" h3 has no link of
  // its own, so it borrowed the answer's first citation and became a result
  // (tests/fixtures/serp-google-social-profiles.html).
  //
  // 1.10.2: People also ask. An expanded question shows its answer's source
  // as an h3 with a link and a URL line, which passed every other check, so
  // each question opened added a result and moved every later one down.
  // `.related-question-pair` wraps each question; `[data-initq]` and
  // `[jsname="yEVEwb"]` the whole block (both attributes, not obfuscated
  // classes).
  const PAA_CONTAINER_SELECTOR = '.related-question-pair, [data-initq], [jsname="yEVEwb"]';
  const REJECTED_CONTAINER_SELECTOR = [
    '[data-attrid*="Overview" i]',
    '[data-subtree="aimc"]',
    'g-scrolling-carousel',
    '[aria-label*="Top stories" i]',
    '[aria-label*="Videos" i]',
    'g-section-with-header',
    '[data-hveid][role="heading"]',
    '.commercial-unit-desktop-top',
    '.commercial-unit-desktop-rhs',
    '.cu-container',
    '[data-pla]',
    PAA_CONTAINER_SELECTOR
  ].join(', ');

  function isRejectedContainer(el) {
    return !!(el && el.closest && el.closest(REJECTED_CONTAINER_SELECTOR));
  }

  // Climbs from `startEl` looking for the nearest ancestor with more than
  // one child element — a reasonable stand-in for "the whole result block"
  // (title + snippet + citation line) without depending on any particular
  // Google class name, which changes often. Capped at 5 levels so a
  // pathologically flat or deep tree can't run away.
  function findBlock(startEl) {
    let node = startEl;
    for (let i = 0; i < 5 && node && node.parentElement; i++) {
      node = node.parentElement;
      if (node.childElementCount > 1) return node;
    }
    return node;
  }

  // Google puts the description in its own element, a SIBLING of the
  // title/URL block rather than inside it. `findBlock` deliberately stops at
  // the tight block (it is the overlay bar's insertion point), so extraction
  // needs to climb further. Verified against a real saved SERP —
  // tests/fixtures/serp-google-site-query.html.
  //
  // `data-sncf` is an attribute rather than one of Google's obfuscated class
  // names, so it leads; the classes are fallbacks and will rotate.
  const DESCRIPTION_SELECTOR = '[data-sncf], .VwiC3b, .yXK7lf';

  // Text that is chrome, not content: Google's own "About this result"
  // control, and anything this extension injected itself.
  // `script` and `style` matter: textContent walks them, and a real SERP
  // carries inline scripts inside result containers — one row's description
  // came back as "(function(){window.sn={_setImageSrc:function(" without this.
  const NOT_CONTENT_SELECTOR =
    'a, h3, cite, script, style, noscript, template, ' +
    '[role="button"], [aria-label="About this result"], ' +
    '[class^="sbw-"], [class*=" sbw-"]';

  /**
   * The whole result: the nearest ancestor of the block that also holds the
   * description. Stops before swallowing a second result — an ancestor with
   * two <h3> is the results list, not one result.
   */
  function resultContainer(block) {
    let node = block;
    for (let i = 0; i < 6 && node; i++) {
      if (node.querySelector && node.querySelector(DESCRIPTION_SELECTOR)) return node;
      const parent = node.parentElement;
      if (!parent || !parent.querySelectorAll) break;
      if (parent.querySelectorAll('h3').length > 1) break;
      node = parent;
    }
    return block;
  }

  function cleanText(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * The result's own description.
   *
   * Until 2026-09-16 this cloned the tight block and removed `a, h3, cite`,
   * which on a real SERP left the site name and the "About this result"
   * button label — so every exported row read "Philanthropy.org" or
   * "Philanthropy.orgAbout this result" instead of the description, which was
   * sitting untouched in a sibling element.
   */
  function extractSnippet(block) {
    if (!block || typeof block.cloneNode !== 'function') return undefined;
    const container = resultContainer(block);
    const desc = container.querySelector && container.querySelector(DESCRIPTION_SELECTOR);
    if (desc) {
      const clone = desc.cloneNode(true);
      clone.querySelectorAll(NOT_CONTENT_SELECTOR).forEach((n) => n.remove());
      const text = cleanText(clone);
      if (text) return text;
    }
    // No description element: fall back to whatever prose the block holds,
    // with the chrome stripped this time.
    const clone = block.cloneNode(true);
    clone.querySelectorAll(NOT_CONTENT_SELECTOR).forEach((n) => n.remove());
    const text = cleanText(clone);
    return text || undefined;
  }

  // Google prefixes a freshness stamp into the description element itself,
  // separated by an em dash: "Mar 28, 2025 — Discover the 14 best…" or
  // "6 days ago — A nonprofit CRM centralizes…". Both forms are in
  // tests/fixtures/serp-google-commercial-query.html. Splitting it out gives
  // a real date field and stops the snippet opening with a date.
  const DATE_PREFIX_RE = new RegExp(
    '^(' +
      '[A-Z][a-z]{2}\\s+\\d{1,2},\\s+\\d{4}' +            // Mar 28, 2025
      '|\\d+\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago' + // 6 days ago
    ')\\s*\\u2014\\s*'
  );

  /** `{ date, rest }` — `date` is '' when the description carries no stamp. */
  function splitDatePrefix(text) {
    const m = DATE_PREFIX_RE.exec(text || '');
    if (!m) return { date: '', rest: text || '' };
    return { date: m[1], rest: (text || '').slice(m[0].length) };
  }

  /**
   * Everything else Google shows about a result: the site's display name, the
   * URL as rendered, and the breadcrumb trail after it. All additive — a
   * missing one is an empty string, never a reason to drop the row.
   */
  function extractResultDetail(block) {
    const container = resultContainer(block);
    if (!container || !container.querySelector) return {};
    const citeEl = container.querySelector('cite');
    const crumbEl = citeEl && citeEl.querySelector
      ? citeEl.querySelector('[role="text"], .ylgVCe')
      : null;
    const breadcrumb = cleanText(crumbEl);
    let displayUrl = cleanText(citeEl);
    // The breadcrumb renders inside <cite>, so the display URL would repeat it.
    if (breadcrumb && displayUrl.endsWith(breadcrumb)) {
      displayUrl = displayUrl.slice(0, -breadcrumb.length).trim();
    }
    // Star ratings render as an aria-label, which is stable text rather than
    // an obfuscated class: "Rated 5.0 out of 5,".
    let rating = '';
    const rated = container.querySelector('[aria-label^="Rated "]');
    if (rated) {
      const m = /Rated\s+([\d.]+)\s+out of\s+([\d.]+)/i.exec(rated.getAttribute('aria-label') || '');
      if (m) rating = m[1] + '/' + m[2];
    }

    return {
      siteName: cleanText(container.querySelector('.VuuXrf')),
      displayUrl,
      breadcrumb,
      rating
    };
  }

  /**
   * "People also search for" — the query refinements under the results.
   * Page-level, not per-result.
   */
  // Pagination and footer chrome sit in the same containers as the
  // refinements — "Next" was being exported as a related search.
  const PAGINATION_LABEL = /^(next|previous|prev|more results|page \d+|\d+)$/i;

  function parseRelatedSearches(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const out = [];
    const seen = new Set();
    root.querySelectorAll('.b2Rnsc, [data-abe] a, #botstuff a').forEach((el) => {
      if (isAd(el)) return;
      if (el.closest && el.closest('#pnnext, #pnprev, [role="navigation"], table#nav')) return;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      // A refinement is a short phrase, not a sentence or a chrome label.
      if (!t || t.length < 3 || t.length > 90) return;
      if (PAGINATION_LABEL.test(t)) return;
      if (seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase());
      out.push(t);
    });
    return out;
  }

  // Fix round 1, item 1: require the accepted block to actually look like a
  // web result — either it carries a `cite` (the URL breadcrumb line) or it
  // has at least 40 chars of non-heading text (a real snippet). A bare
  // title-only h3 (AI Overview citation chips, chrome buttons that happen to
  // sit near a heading, etc.) doesn't qualify even if it slipped past the
  // container-based rejections above.
  function hasQualifyingContent(block) {
    if (!block) return false;
    if (block.querySelector && block.querySelector('cite')) return true;
    const snippet = extractSnippet(block);
    return !!(snippet && snippet.length >= 40);
  }

  // Fix round 1, item 1: scope the scan to the organic result list itself
  // (#rso, falling back to #search) rather than the whole page/root — AI
  // Overview, carousels and other non-#rso surfaces commonly sit as
  // siblings of #rso under #search or #cnt, not inside it, so this alone
  // already excludes most of them; the REJECTED_CONTAINER_SELECTOR/
  // qualifying-content checks below catch what's left (including cases
  // that DO live inside #search on some layouts). Falls back to `root`
  // itself when neither container exists, so fixtures/tests that scan a
  // bare fragment keep working.
  function organicScanRoot(root) {
    if (root && typeof root.querySelector === 'function') {
      const rso = root.querySelector('#rso');
      if (rso) return rso;
      const search = root.querySelector('#search');
      if (search) return search;
    }
    return root;
  }

  // Google links third-party results through its own redirects on some
  // layouts: `/goto?url=CAES…` (an opaque token, signed-out SERPs since
  // Oct 2026) or `/url?q=<destination>`. Google's own properties keep direct
  // links. All three are result links. Saved real markup:
  // tests/fixtures/serp-google-goto-links.html.
  const RESULT_LINK_SELECTOR = 'a[href^="http"], a[href^="/goto?"], a[href^="/url?"]';
  const REDIRECT_PATH_RE = /^\/(goto|url)$/;

  // The leading `https://host` of a <cite> breadcrumb, e.g.
  // "https://rankmath.com › SEO Basics". A host Google cut short ("…" or
  // "...") is not a host.
  const CITE_ORIGIN_RE = /^(https?:\/\/[^\s/›…]+)(?:\s|›|\/|$)/;

  // Forum and video results often show a site name and "10+ comments · 3
  // years ago" instead of a URL breadcrumb, and signed-out social profiles
  // show "LinkedIn · <name>" over "200+ followers". Without the name these
  // were dropped and every later position moved up (seen 2026-10-21 on
  // "seo bandwagon": LinkedIn, Facebook and Instagram all missing). Only names
  // that map to exactly one site belong here.
  const SITE_NAME_DOMAINS = {
    reddit: 'reddit.com',
    youtube: 'youtube.com',
    quora: 'quora.com',
    linkedin: 'linkedin.com',
    facebook: 'facebook.com',
    instagram: 'instagram.com',
    tiktok: 'tiktok.com',
    pinterest: 'pinterest.com'
  };

  /**
   * Where a result link really goes: `{ url, resolved, key }` or null.
   *
   * `resolved` is false when only the site's origin is known (read from the
   * breadcrumb or the site name), because a `/goto` token can't be decoded
   * on the page. The domain is still right, which is what rank checks need.
   * `key` dedupes results: the destination URL when it's known, otherwise
   * the redirect itself, so two different pages on one site whose origin
   * alone is known are not merged.
   */
  function resolveResultUrl(anchor, block) {
    const href = anchor.getAttribute('href') || '';
    let u;
    try {
      u = new URL(href, 'https://www.google.com');
    } catch (e) {
      return null;
    }
    if (!(GOOGLE_HOST_RE.test(u.hostname) && REDIRECT_PATH_RE.test(u.pathname))) {
      return { url: anchor.href, resolved: true, key: anchor.href };
    }
    const q = u.searchParams.get('q') || u.searchParams.get('url');
    if (q && /^https?:\/\//i.test(q)) return { url: q, resolved: true, key: q };

    const container = resultContainer(block);
    if (!container || !container.querySelector) return null;
    const media = container.querySelector('[data-curl^="http"], [data-surl^="http"]');
    if (media) {
      const url = media.getAttribute('data-curl') || media.getAttribute('data-surl');
      return { url, resolved: true, key: url };
    }
    const m = CITE_ORIGIN_RE.exec(cleanText(container.querySelector('cite')));
    if (m && !/\.\./.test(m[1])) return { url: m[1].toLowerCase() + '/', resolved: false, key: href };

    const name = cleanText(container.querySelector('.VuuXrf')).split('·')[0].trim().toLowerCase();
    if (SITE_NAME_DOMAINS[name]) return { url: 'https://' + SITE_NAME_DOMAINS[name] + '/', resolved: false, key: href };
    return null;
  }

  // Sitelinks (Contact, About Us… under a result) are part of that result,
  // as DataForSEO counts them too. Signed in they link directly, each with
  // an h3 and a snippet, in a table that is a sibling of the result's tight
  // block, so containment alone misses them: seobandwagon.com came back six
  // times on "seo bandwagon" (2026-10-21). Signed out they link through
  // /goto with no breadcrumb and were only dropped because they can't be
  // placed.
  //
  // `data-rpos` is an attribute rather than one of Google's obfuscated class
  // names, and wraps one result with its sitelinks
  // (tests/fixtures/serp-google-social-profiles.html), so it leads. A page
  // without it (tests/fixtures/serp-google-commercial-query.html) falls back
  // to what a sitelink lacks: a URL line and a site name, on the same site as
  // the result just above. A real second result from that site has both.
  const RESULT_UNIT_SELECTOR = '[data-rpos]';

  function isSitelink(block, unit, domain, previous) {
    if (unit || !previous || previous.domain !== domain) return false;
    const detail = extractResultDetail(block);
    return !detail.displayUrl && !detail.siteName;
  }

  // The whole result, for the overlay's bar to go under: the unit that wraps
  // it with its sitelinks, or else the block that also holds the
  // description. Until 1.10.2 the bar went after the tight title block, so it
  // split each result between its title and its description.
  function resultEnd(block, unit) {
    return unit || resultContainer(block);
  }

  // ============================================
  // Position counting everything on the page
  // ============================================
  //
  // The organic position skips everything that isn't a web result. This one
  // counts what a searcher scrolls past to reach the result: each ad above
  // the results, then each block of the results list (AI Overview, People
  // also ask, a map, videos, top stories…), each web result one. It is read
  // from the page's own blocks, not from a list of features, so a feature
  // Google adds still counts; a heading alone (Google's hidden "Search
  // Results" labels) does not.
  const AD_UNIT_SELECTOR = '[data-text-ad], .commercial-unit-desktop-top, .cu-container';
  const NOT_SHOWN_TEXT = 'h1, h2, script, style, noscript, template, [class^="sbw-"], [class*=" sbw-"]';

  function isShown(el) {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    if (el.closest && el.closest('[hidden], [aria-hidden="true"]')) return false;
    return !/display\s*:\s*none/i.test(el.getAttribute('style') || '');
  }

  function showsSomething(el) {
    if (!el || el.nodeType !== 1 || !isShown(el)) return false;
    if (el.matches && el.matches(NOT_SHOWN_TEXT)) return false;
    const clone = el.cloneNode(true);
    clone.querySelectorAll(NOT_SHOWN_TEXT).forEach((n) => n.remove());
    return cleanText(clone).length > 0;
  }

  // The search features a block can hold beside one web result.
  const FEATURE_SELECTOR = [
    '[data-attrid*="Overview" i]',
    '[data-subtree="aimc"]',
    'g-scrolling-carousel',
    '[aria-label*="Top stories" i]',
    '[aria-label*="Videos" i]',
    'g-section-with-header',
    PAA_CONTAINER_SELECTOR
  ].join(', ');

  function topMost(list) {
    const els = Array.from(list);
    return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
  }

  // Sets `pagePosition` on each row. `heads` are the rows' h3s, in the same
  // (page) order. Everything counted is put in page order and numbered:
  // each ad (top or bottom, wherever Google puts it), each web result, and
  // each other block of the results list, or above it inside #search (the
  // AI Overview has been there). Google wraps several results in one block
  // at times (the AI Overview and four results in one, signed in: the
  // social-profiles fixture), so a block holding two or more results is
  // read one level down; a block holding one counts its features too.
  function assignPagePositions(root, scanRoot, rows, heads) {
    const items = heads.map((el, k) => ({ el, row: rows[k] }));
    const ads = root && root.querySelectorAll
      ? topMost(root.querySelectorAll(AD_UNIT_SELECTOR)).filter(isShown)
      : [];
    ads.forEach((el) => items.push({ el }));
    const count = (el, list) => list.filter((x) => el.contains(x)).length;

    function block(el) {
      const results = count(el, heads);
      if (results >= 2) {
        Array.from(el.children).forEach(block);
      } else if (results === 1) {
        topMost(el.querySelectorAll(FEATURE_SELECTOR)).forEach((f) => {
          if (!heads.some((h) => f.contains(h)) && showsSomething(f)) items.push({ el: f });
        });
      } else if (!count(el, ads) && showsSomething(el)) {
        items.push({ el });
      }
    }

    if (scanRoot && scanRoot.children) Array.from(scanRoot.children).forEach(block);
    if (scanRoot && scanRoot.id === 'rso' && scanRoot.closest && scanRoot.closest('#search')) {
      for (let node = scanRoot; node && node.id !== 'search'; node = node.parentElement) {
        for (let s = node.previousElementSibling; s; s = s.previousElementSibling) block(s);
      }
    }

    items.sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1)); // 4: b follows a
    items.forEach((item, i) => { if (item.row) item.row.pagePosition = i + 1; });
  }

  // DOM-tolerant extraction of organic results from a Google results page
  // root. Candidates are blocks containing a result link (direct, or one of
  // Google's redirects — see resolveResultUrl) with an h3
  // descendant; anything inside an ad container, a non-organic surface
  // (AI Overview/carousels/shopping/People also ask), or a
  // sponsored-labelled block is skipped, as is anything nested inside, or
  // sharing a result unit with, an already-accepted result (sitelinks).
  // Dedupes by URL. See parsePaa() for questions.
  //
  // 1.10.2: a result whose Google redirect the parser can't place (no
  // destination, breadcrumb or known site name) keeps its slot as an
  // "unknown site" row (`siteUnknown`, no URL or domain), so every result
  // after it keeps its position. Until then it was dropped and the rest
  // moved up. It must still look like a result: a URL line or a site name
  // (a sitelink has neither).
  function parseResults(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const scanRoot = organicScanRoot(root);
    if (!scanRoot || typeof scanRoot.querySelectorAll !== 'function') return [];

    const rows = [];
    const heads = [];
    const seenUrls = new Set();
    const acceptedBlocks = [];
    const acceptedUnits = new Set();
    let position = 0;

    scanRoot.querySelectorAll('h3').forEach((h3) => {
      if (isAd(h3) || isRejectedContainer(h3)) return;

      let anchor = h3.closest(RESULT_LINK_SELECTOR);
      if (!anchor) {
        anchor = h3.querySelector && h3.querySelector(RESULT_LINK_SELECTOR);
      }
      let block;
      if (anchor) {
        block = findBlock(anchor);
      } else {
        // h3 and the result link are siblings rather than nested — fall
        // back to the nearest container that also holds a link.
        const container = (h3.closest && h3.closest('div, article, li')) || h3.parentElement;
        anchor = container && container.querySelector && container.querySelector(RESULT_LINK_SELECTOR);
        block = container;
      }
      if (!anchor || !block) return;
      if (isAd(anchor) || isAd(block) || isRejectedContainer(anchor) || isRejectedContainer(block)) return;
      if (hasSponsoredLabel(block)) return;

      // Fix round 1, item 2: sitelinks — an already-accepted result's block
      // commonly contains further h3s for its sub-links. Skip anything
      // whose block is a descendant of (or identical to) a block already
      // accepted, rather than relying on URL dedupe alone.
      if (acceptedBlocks.some((accepted) => accepted.contains(block))) return;
      const unit = block.closest(RESULT_UNIT_SELECTOR);
      if (unit && acceptedUnits.has(unit)) return;

      const target = resolveResultUrl(anchor, block);
      // resolveResultUrl returns null only for a Google redirect it can't
      // place. A link it did resolve to Google's own navigation (a search,
      // the maps host) is no result at all.
      const domain = target ? bareDomain(target.url) : '';
      if (target && !domain) return;
      const key = target ? target.key : anchor.getAttribute('href');
      if (!key || seenUrls.has(key)) return;
      if (!hasQualifyingContent(block)) return;
      if (target && isSitelink(block, unit, domain, rows[rows.length - 1])) return;
      if (!target) {
        const shown = extractResultDetail(block);
        if (!shown.displayUrl && !shown.siteName) return;
      }

      seenUrls.add(key);
      acceptedBlocks.push(block);
      if (unit) acceptedUnits.add(unit);

      position += 1;
      const title = (h3.textContent || '').trim();
      const row = { position, url: target ? target.url : '', domain, title };
      if (!target) row.siteUnknown = true;
      else if (!target.resolved) row.urlResolved = false;
      const rawSnippet = extractSnippet(block);
      if (rawSnippet) {
        const split = splitDatePrefix(rawSnippet);
        if (split.date) row.date = split.date;
        if (split.rest) row.snippet = split.rest;
        else row.snippet = rawSnippet;
      }
      const detail = extractResultDetail(block);
      if (detail.siteName) row.siteName = detail.siteName;
      if (detail.displayUrl) row.displayUrl = detail.displayUrl;
      if (detail.breadcrumb) row.breadcrumb = detail.breadcrumb;
      if (detail.rating) row.rating = detail.rating;
      // Non-enumerable: lets the content script find where to insert the
      // bar (block.insertAdjacentElement/appendChild) without this leaking
      // into resultsToCsv(), clipboard text, or a JSON.stringify/toEqual
      // comparison in tests.
      Object.defineProperty(row, '_el', { value: block, enumerable: false });
      // Also non-enumerable: the link as Google rendered it. For a /goto row
      // `url` may be only the site's origin, but Google's redirect still
      // opens the actual page.
      Object.defineProperty(row, '_href', { value: anchor.href, enumerable: false });
      // What tells this result apart from the others on the page (the
      // destination when known, else the link itself), and the element the
      // overlay's bar goes after: below the whole result (1.10.2).
      Object.defineProperty(row, '_key', { value: key, enumerable: false });
      Object.defineProperty(row, '_end', { value: resultEnd(block, unit), enumerable: false });
      rows.push(row);
      heads.push(h3);
    });

    assignPagePositions(root, scanRoot, rows, heads);
    return rows;
  }

  // People-also-ask question blocks: [data-q] carries the literal question
  // text — always trusted, since Google only sets that attribute on real
  // PAA entries. [jsname][role="button"] is a much broader net (it also
  // matches chrome buttons like "Tools", "All filters", "Feedback"), so
  // fix round 1, item 7 requires its visible text to actually look like a
  // question: at least 12 chars AND ending in "?". Dedupes by question text
  // and skips anything inside an ad container.
  function parsePaa(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const out = [];
    const seen = new Set();

    function add(q) {
      if (q && !seen.has(q)) {
        seen.add(q);
        out.push(q);
      }
    }

    // [data-q] is not PAA-only: on a commercial SERP Google also stamps the
    // SEARCH ITSELF with it, so "best crm for nonprofits" was being exported
    // as a People-also-ask question. Require a question, same bar as the
    // broader selector below.
    root.querySelectorAll('[data-q]').forEach((el) => {
      if (isAd(el)) return;
      const q = (el.getAttribute('data-q') || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!q.endsWith('?')) return;
      add(q);
    });

    root.querySelectorAll('[jsname][role="button"]').forEach((el) => {
      if (isAd(el)) return;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 12 && text.endsWith('?')) add(text);
    });

    return out;
  }

  // ============================================
  // Export text
  // ============================================
  //
  // resultsToCsv/paaToText are self-contained rather than delegating to
  // SBWCsv (src/lib/csv.js): this module is loaded as a plain content
  // script on google.com, is required standalone by tests/unit/serp.test.js,
  // and the values it formats (titles, URLs from arbitrary third-party
  // sites) are hostile input just like link-check's — so the same
  // formula-injection guard is reproduced here rather than assumed absent.

  const CSV_BOM = '﻿';
  const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

  // Fix round 1, item 8: the formula-injection guard itself, exported so
  // both this module's own CSV path (csvCell, below) and the content
  // script's TSV export (src/overlay/serp-overlay.js's rowsToTsv) apply the
  // exact same rule — there was previously a second, unguarded formula
  // check living only in the TSV path.
  function guardCell(value) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    if (FORMULA_PREFIX_RE.test(s)) s = "'" + s;
    return s;
  }

  function csvCell(value) {
    const s = guardCell(value);
    if (/["\r\n,]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * What search produced these rows, read straight from the results URL.
   *
   * Every field here is already in `location` — no DOM guessing, so this is
   * safe to build without a captured copy of Google's markup. An export
   * without it is orphaned data: you cannot tell which query, which country
   * or which page a row came from, and two exports on one day collide.
   */
  function searchContext(loc, doc) {
    let params;
    try {
      params = new URLSearchParams((loc && loc.search) || '');
    } catch (e) {
      params = new URLSearchParams();
    }
    const start = parseInt(params.get('start') || '0', 10);
    const ctx = {
      query: params.get('q') || '',
      country: params.get('gl') || '',
      language: params.get('hl') || '',
      location: params.get('uule') || '',
      // The place that location stands for, readable (1.10.2): the Location
      // column holds Google's encoded string.
      place: placeFromUule(params.get('uule')),
      page: Number.isFinite(start) && start > 0 ? Math.floor(start / 10) + 1 : 1,
      // Google's own result offset for this page (`start=`), so a row's
      // position can be read as an approximate overall rank (#45).
      start: Number.isFinite(start) && start > 0 ? start : 0,
      capturedAt: new Date().toISOString(),
      resultStats: '',
      relatedSearches: '',
      paa: ''
    };
    // "About 2,070,000 results (0.18s)" — how deep the whole result set goes,
    // which a ten-row page cannot otherwise tell you.
    const stats = doc && doc.querySelector && doc.querySelector('#result-stats');
    if (stats) ctx.resultStats = (stats.textContent || '').replace(/\s+/g, ' ').trim();
    // Page-level, so it rides in the context rather than on a row. Joined
    // rather than dropped: the whole point is that nothing is thrown away.
    ctx.relatedSearches = doc ? parseRelatedSearches(doc).join(' | ') : '';
    ctx.paa = doc ? parsePaa(doc).join(' | ') : '';
    return ctx;
  }

  // Every column is written on every row so a file is self-describing and
  // several exports concatenate cleanly. `snippet` was extracted by
  // parseResults from the start and silently dropped here until 2026-09-16 —
  // the search result's own description never reached the file.
  const RESULT_CSV_COLUMNS = [
    ['Query', 'query'],
    ['Position', 'position'],
    ['URL', 'url'],
    ['Domain', 'domain'],
    ['Title', 'title'],
    ['Snippet', 'snippet'],
    ['Site name', 'siteName'],
    ['Display URL', 'displayUrl'],
    ['Breadcrumb', 'breadcrumb'],
    ['Date', 'date'],
    ['Rating', 'rating'],
    ['Captured', 'capturedAt'],
    ['Country', 'country'],
    ['Language', 'language'],
    ['Location', 'location'],
    ['Page', 'page'],
    ['Result stats', 'resultStats'],
    ['Related searches', 'relatedSearches'],
    ['People also ask', 'paa'],
    // #45: Google ignores &num=, so depth means paging, and Position restarts
    // at 1 on every page. Appended last so existing column positions don't
    // move. 1.10.2: the organic results counted on the earlier pages a
    // person added (src/lib/serp-collect.js), plus Position. Until then it
    // was Google's offset (`start=`) plus Position, wrong whenever a page
    // held other than 10 organic results; an earlier page that wasn't added
    // still counts as 10, which is why it stays "approx.".
    ['Absolute position (approx.)', 'absolutePosition'],
    // 1.8.0 (#45): the exact overall rank, counted across the pages a person
    // added (src/lib/serp-collect.js), with repeats from earlier pages left
    // out. On page 1 alone it's the position; blank where it can't be known
    // (a later page on its own, or after a page that wasn't added).
    ['Absolute position', 'absoluteExact'],
    ['Collection notes', 'notes'],
    // 1.10.2, appended for the same reason. The overlay bar's tooltip shows
    // the first: the position counting ads and every other block on the page.
    ['Position counting everything', 'pagePosition'],
    // "yes", "site only" (Google's redirect hides the page, only the site is
    // known) or "no" (an unknown site, which keeps its place).
    ['URL known', 'urlKnown'],
    ['Place name', 'place']
  ];

  // Google's page size, for an earlier page nobody added.
  const PAGE_SIZE = 10;

  // A collected row carries its own count (`absoluteApprox`); a single page
  // uses the earlier pages' organic count the overlay looked up
  // (`ctx.earlierOrganic`), or 10 a page when none was added.
  function absolutePosition(row, ctx) {
    if (row && row.absoluteApprox !== undefined) return row.absoluteApprox;
    const pos = Number(row && row.position);
    if (!(Number.isFinite(pos) && pos > 0)) return '';
    const earlier = ctx && typeof ctx.earlierOrganic === 'number' && Number.isFinite(ctx.earlierOrganic)
      ? ctx.earlierOrganic
      : Math.floor((Number(ctx && ctx.start) || 0) / PAGE_SIZE) * PAGE_SIZE;
    return earlier + pos;
  }

  function urlKnown(row) {
    if (!row) return '';
    if (row.siteUnknown) return 'no';
    return row.urlResolved === false ? 'site only' : 'yes';
  }

  function exactPosition(row, ctx) {
    if (row && row.absoluteExact !== undefined) return row.absoluteExact;
    return (Number(ctx && ctx.start) || 0) === 0 && Number(row && row.position) > 0 ? Number(row.position) : '';
  }

  function cellValue(row, ctx, key) {
    if (key === 'absolutePosition') return absolutePosition(row, ctx);
    if (key === 'absoluteExact') return exactPosition(row, ctx);
    if (key === 'urlKnown') return urlKnown(row);
    const value = row && key in row ? row[key] : ctx[key];
    return value === undefined || value === null ? '' : value;
  }

  function resultsToCsv(rows, context) {
    const ctx = context || {};
    const header = RESULT_CSV_COLUMNS.map((c) => csvCell(c[0])).join(',');
    const lines = [header];
    (rows || []).forEach((row) => {
      lines.push(RESULT_CSV_COLUMNS.map((c) => csvCell(cellValue(row, ctx, c[1]))).join(','));
    });
    return CSV_BOM + lines.join('\r\n') + '\r\n';
  }

  // The same columns as a tab-separated block for pasting into a sheet. Cells
  // are formula-guarded and lose tabs and line breaks, which would split them.
  function resultsToTsv(rows, context) {
    const ctx = context || {};
    const clean = (v) => guardCell(v).replace(/[\t\r\n]+/g, ' ').trim();
    const lines = [RESULT_CSV_COLUMNS.map((c) => c[0]).join('\t')];
    (rows || []).forEach((row) => {
      lines.push(RESULT_CSV_COLUMNS.map((c) => clean(cellValue(row, ctx, c[1]))).join('\t'));
    });
    return lines.join('\n');
  }

  function paaToText(questions) {
    return (questions || [])
      .map((q) => String(q || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  // ============================================
  // uule (Google location encoding)
  // ============================================

  const UULE_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // UTF-8-safe base64 with no padding. Buffer is used under Node/Vitest;
  // browsers (the actual content-script runtime) fall back to the
  // btoa(unescape(encodeURIComponent(...))) idiom for non-ASCII safety.
  function base64NoPad(str) {
    let b64;
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(str, 'utf-8').toString('base64');
    } else {
      b64 = btoa(unescape(encodeURIComponent(str)));
    }
    return b64.replace(/=+$/, '');
  }

  function uule(canonicalName) {
    const name = String(canonicalName || '');
    const idx = name.length % 64;
    return 'w+CAIQICI' + UULE_KEY[idx] + base64NoPad(name);
  }

  function fromBase64(b64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf-8');
    return decodeURIComponent(escape(atob(b64)));
  }

  // The canonical name inside a `w+CAIQICI…` uule, the form uule() writes
  // and Google's own location links use; '' for any other form (Google's
  // `a+…` form carries coordinates, not a name) or a string that doesn't
  // decode. The key letter is the name's length, which checks the decode.
  // Read out of a URL, the `+` may arrive as a space.
  function placeFromUule(value) {
    const m = /^w[+ ]CAIQICI(.)(.+)$/.exec(String(value || '').trim());
    if (!m) return '';
    try {
      const b64 = m[2].replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
      const name = fromBase64(b64 + '==='.slice((b64.length + 3) % 4));
      if (!name || /[\u0000-\u001f�]/.test(name)) return '';
      return UULE_KEY[name.length % 64] === m[1] ? name : '';
    } catch (e) {
      return '';
    }
  }

  // ============================================
  // Search URL builder
  // ============================================

  // Omits empty params. `pws` is a boolean-shaped ask — "turn
  // personalization off" — rather than a literal param value: pass
  // `pws: true` to add `pws=0` (matches the toolbar's "Personalization off
  // (pws=0)" checkbox). Fix round 1, item 12: `pws: 0` (the number zero) is
  // also accepted as "off" — a caller reasonably reading the querystring's
  // own `pws=0` value and passing it straight back through would otherwise
  // be silently ignored, since `0` is falsy. Omit/false/anything else
  // leaves Google's default personalization untouched.
  function buildSearchUrl(opts) {
    const o = opts || {};
    const domain = o.domain || 'www.google.com';
    const url = new URL('https://' + domain + '/search');
    if (o.q) url.searchParams.set('q', o.q);
    if (o.gl) url.searchParams.set('gl', o.gl);
    if (o.hl) url.searchParams.set('hl', o.hl);
    if (o.uule) url.searchParams.set('uule', o.uule);
    if (o.pws === true || o.pws === 0 || o.pws === '0') url.searchParams.set('pws', '0');
    // `num` is gone (#45): Google ignores it, so &num=100 still returns 10
    // results (tested 2026-10-13: num=50/100 pages were byte-for-byte the
    // default). Depth means paging with `start`.
    return url.toString();
  }

  // ============================================
  // Preset locations
  // ============================================
  //
  // Bundled from /Users/kylealm/Projects/SEOBW-home/city-data/data/manifest.json
  // (the 54-metro roster, read once — never fetched at runtime). `state` is
  // the 2-letter code manifest.json stores; STATE_NAMES expands it to the
  // full name uule/canonical location names use ("New York,New York,United
  // States", not "New York,NY,United States").

  const STATE_NAMES = {
    AZ: 'Arizona', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', IA: 'Iowa',
    ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', KY: 'Kentucky',
    MA: 'Massachusetts', MD: 'Maryland', MI: 'Michigan', MN: 'Minnesota',
    MO: 'Missouri', NC: 'North Carolina', ND: 'North Dakota', NM: 'New Mexico',
    NV: 'Nevada', NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia',
    WA: 'Washington', WI: 'Wisconsin'
  };

  // manifest.json's "Washington DMV" is a multi-jurisdiction metro label
  // (DC + suburban MD/VA), not a real place name Google's location system
  // recognizes — canonicalize it to "Washington" for the uule/search-url
  // value while keeping the metro name in the human-facing label below.
  const CANONICAL_NAME_OVERRIDES = {
    'Washington DMV': 'Washington'
  };

  // 1.10.2: six roster names that are metro areas, not places in Google's
  // geotargets list (developers.google.com/google-ads/api/data/geotargets,
  // the 2026-10-06 file), so a search with their uule silently used the
  // searcher's own location. Each becomes its principal city, an active City
  // target, in the label as well as the uule, so the menu says where the
  // search really comes from. The other 48 names are in the list as written
  // ("San Francisco Bay Area" is a Region; "St. George" a City).
  const GOOGLE_PLACE_NAMES = {
    'Dallas-Fort Worth': 'Dallas',
    'Fort Myers-Cape Coral': 'Fort Myers',
    'Minneapolis-St. Paul': 'Minneapolis',
    'Raleigh-Durham': 'Raleigh',
    'Sarasota-Bradenton': 'Sarasota',
    'Tampa-St. Petersburg': 'Tampa'
  };

  const METROS = [
    ['Albuquerque', 'NM'],
    ['Atlanta', 'GA'],
    ['Austin', 'TX'],
    ['Baltimore', 'MD'],
    ['Boise', 'ID'],
    ['Boston', 'MA'],
    ['Charleston', 'SC'],
    ['Charlotte', 'NC'],
    ['Chicago', 'IL'],
    ['Cincinnati', 'OH'],
    ['Cleveland', 'OH'],
    ['Columbus', 'OH'],
    ['Dallas-Fort Worth', 'TX'],
    ['Denver', 'CO'],
    ['Des Moines', 'IA'],
    ['Detroit', 'MI'],
    ['Fargo', 'ND'],
    ['Fort Myers-Cape Coral', 'FL'],
    ['Greenville', 'SC'],
    ['Hartford', 'CT'],
    ['Houston', 'TX'],
    ['Indianapolis', 'IN'],
    ['Jacksonville', 'FL'],
    ['Kansas City', 'MO'],
    ['Las Vegas', 'NV'],
    ['Los Angeles', 'CA'],
    ['Louisville', 'KY'],
    ['Miami', 'FL'],
    ['Milwaukee', 'WI'],
    ['Minneapolis-St. Paul', 'MN'],
    ['Nashville', 'TN'],
    ['New York', 'NY'],
    ['Oklahoma City', 'OK'],
    ['Orlando', 'FL'],
    ['Philadelphia', 'PA'],
    ['Phoenix', 'AZ'],
    ['Pittsburgh', 'PA'],
    ['Portland', 'OR'],
    ['Providence', 'RI'],
    ['Raleigh-Durham', 'NC'],
    ['Reno', 'NV'],
    ['Richmond', 'VA'],
    ['Sacramento', 'CA'],
    ['Salt Lake City', 'UT'],
    ['San Antonio', 'TX'],
    ['San Diego', 'CA'],
    ['San Francisco Bay Area', 'CA'],
    ['Sarasota-Bradenton', 'FL'],
    ['Seattle', 'WA'],
    ['St. George', 'UT'],
    ['Tacoma', 'WA'],
    ['Tampa-St. Petersburg', 'FL'],
    ['Tucson', 'AZ'],
    ['Washington DMV', 'DC']
  ];

  const PRESET_LOCATIONS = METROS.map(([metro, state]) => {
    const name = GOOGLE_PLACE_NAMES[metro] || metro;
    const stateName = STATE_NAMES[state] || state;
    const canonicalCity = CANONICAL_NAME_OVERRIDES[name] || name;
    return {
      label: `${name}, ${state}`,
      canonical: `${canonicalCity},${stateName},United States`
    };
  });

  return {
    bareDomain,
    parseResults,
    parsePaa,
    resultsToCsv,
    resultsToTsv,
    searchContext,
    parseRelatedSearches,
    splitDatePrefix,
    paaToText,
    uule,
    buildSearchUrl,
    PRESET_LOCATIONS,
    guardCell,
    absolutePosition,
    placeFromUule,
    FORMULA_PREFIX_RE
  };
});
