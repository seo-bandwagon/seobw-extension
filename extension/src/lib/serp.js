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
  // ancestor labeled "Downloads", "Threads" or "Leads" made every result in
  // it an ad. The selector now only finds candidates; the label must contain
  // "Ads" or "Sponsored" as a whole word (AD_LABEL_RE).
  const AD_CONTAINER_SELECTOR = '[data-text-ad], #tads, #tadsb, #bottomads, ' +
    '.commercial-unit-desktop-top, .commercial-unit-desktop-rhs, ' +
    '.cu-container, [data-pla]';
  // 1.11.0: the labels Google writes in the other languages of the Googles
  // the overlay runs on (German "Anzeigen", French "Annonces", Japanese
  // "広告"…). The containers above are language-independent and catch most
  // ads; the labels are the second net. A word, never part of one: \b knows
  // only ASCII letters, so the edges are "not a letter" in Unicode.
  const AD_WORDS = [
    'ads', 'ad', 'sponsored',
    'anzeigen', 'anzeige', 'gesponsert',
    'annonces', 'annonce', 'sponsorisé', 'sponsorisés',
    'anuncios', 'anuncio', 'patrocinado', 'patrocinados', 'patrocinada',
    'annunci', 'annuncio', 'sponsorizzato', 'sponsorizzati',
    'advertenties', 'advertentie', 'gesponsord',
    'anúncios', 'anúncio',
    'reklamy', 'reklama', 'sponsorowane',
    'annonser', 'annons', 'sponsrad', 'sponsoreret', 'annonse', 'sponset',
    'mainos', 'mainokset', 'sponsoroitu',
    'reklam', 'reklamlar', 'sponsorlu',
    'iklan', 'bersponsor', 'naka-sponsor',
    '広告', 'スポンサー', '광고'
  ];
  const AD_LABEL_CANDIDATES = '[aria-label]';
  const AD_LABEL_RE = new RegExp('(^|[^\\p{L}])(' + AD_WORDS.join('|') + ')($|[^\\p{L}])', 'iu');
  // "Ad" counts only as the whole label: as a word in a longer one ("Why this
  // ad?", "Ad choices") it labels a control, not a container of ads.
  function isAdLabel(label) {
    const text = String(label || '').trim();
    if (!text) return false;
    if (/^ad$/i.test(text)) return true;
    return AD_LABEL_RE.test(text.replace(/(^|[^\p{L}])ad($|[^\p{L}])/giu, '$1$2'));
  }

  function isAd(el) {
    if (!el || !el.closest) return false;
    if (el.closest(AD_CONTAINER_SELECTOR)) return true;
    for (let a = el.closest(AD_LABEL_CANDIDATES); a; a = a.parentElement && a.parentElement.closest(AD_LABEL_CANDIDATES)) {
      if (isAdLabel(a.getAttribute('aria-label'))) return true;
    }
    return false;
  }

  // Fix round 1, item 3: a block whose own leading text (first 20 chars,
  // trimmed) reads as a sponsored label — "Sponsored" on its own, or "Ad"
  // immediately followed by a middle-dot/bullet ("Ad ·", "Ad•") — gets no
  // bar even when it isn't inside one of the AD_CONTAINER_SELECTOR
  // containers above (some sponsored-looking organic-shaped blocks carry
  // only the text label, no distinguishing container/class).
  // 1.11.0: the same two shapes in each Google's language.
  const SPONSORED_WORDS = ['sponsored', 'gesponsert', 'sponsorisé', 'patrocinado', 'patrocinada', 'sponsorizzato',
    'gesponsord', 'sponsorowane', 'sponsrad', 'sponsoreret', 'sponset', 'sponsoroitu', 'sponsorlu', 'bersponsor',
    'naka-sponsor', 'スポンサー'];
  const AD_DOT_WORDS = ['ad', 'anzeige', 'annonce', 'anuncio', 'annuncio', 'advertentie', 'anúncio', 'reklama',
    'annons', 'annonse', 'mainos', 'reklam', 'iklan', '広告', '광고'];
  const SPONSORED_LABEL_RE = new RegExp('^(' + SPONSORED_WORDS.join('|') + ')($|[^\\p{L}])|^(' +
    AD_DOT_WORDS.join('|') + ')\\s*[·•]', 'iu');

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

  // 1.11.0: the same stamp as the other Googles write it, read before the
  // dash (em or en). Each form is a date shape, not "a few words with a
  // digit", so "10 best tools — …", "For 30 years — …" and "1.10.20 —
  // release notes" stay descriptions:
  //   a day, a month by its name or the abbreviation Google prints, a year:
  //     "28. März 2025", "28 mars 2025", "28 de mar. de 2025", "28 mrt
  //     2025" (the month must be one of MONTHS, whole);
  //   all digits, with a real day and month and a four-digit year:
  //     "28.03.2025", "28/03/2025", "2025/03/28", "2025年3月28日";
  //   how long ago: "vor 6 Tagen", "il y a 6 jours", "hace 6 días", "há 6
  //     dias", "för 6 dagar sedan", "6 giorni fa", "6 dagen geleden", "6 dni
  //     temu", "6 päivää sitten", "6 gün önce", "6 日前".
  const MONTHS = new Set((
    // German, French, Spanish, Italian, Dutch, Portuguese
    'januar jan februar feb märz mär april apr mai juni jun juli jul august aug september sept sep oktober okt november nov dezember dez ' +
    'janvier janv février févr mars avril avr juin juillet juil août septembre octobre oct novembre décembre déc ' +
    'enero ene febrero marzo mar abril abr mayo may junio julio agosto ago septiembre set octubre noviembre diciembre dic ' +
    'gennaio gen febbraio aprile maggio mag giugno giu luglio lug settembre ottobre ott dicembre ' +
    'januari februari maart mrt mei augustus december dec ' +
    'janeiro fevereiro fev março abril maio junho julho setembro outubro out novembro dezembro ' +
    // Polish (genitive and short), Swedish, Danish and Norwegian, Finnish, Turkish
    'stycznia sty lutego lut marca kwietnia kwi maja maj czerwca cze lipca lip sierpnia sie września wrz października paź listopada lis grudnia gru ' +
    'augusti marts ' +
    'tammikuuta helmikuuta maaliskuuta huhtikuuta toukokuuta kesäkuuta heinäkuuta elokuuta syyskuuta lokakuuta marraskuuta joulukuuta ' +
    'ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık'
  ).split(' '));
  const DASH = '\\s+[\\u2014\\u2013]\\s+';
  const NAMED_DATE_RE = new RegExp('^(\\d{1,2}\\.?\\s+(?:de\\s+)?(\\p{L}{3,12})\\.?,?\\s+(?:de\\s+)?\\d{4})' + DASH, 'u');
  const NUMERIC_DATE_RE = new RegExp('^((\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})|(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})\\.?|\\d{4}年\\d{1,2}月\\d{1,2}日)' + DASH.replace('\\s+[', '\\s*['), 'u');
  const RELATIVE_DATE_RE = new RegExp('^(' +
    '(?:vor|il y a|hace|há)\\s+\\d+\\s+\\p{L}+' +
    '|(?:för|for)\\s+\\d+\\s+\\p{L}+\\s+(?:sedan|siden)' +
    '|\\d+\\s+\\p{L}+\\s+(?:fa|geleden|temu|sitten|önce|lalu|ago)' +
    '|\\d+\\s*(?:秒|分|時間|日|週間|か月|ヶ月|年)前' +
    ')' + DASH.replace('\\s+[', '\\s*['), 'iu');

  function realDate(m) {
    // dd.mm.yyyy (or dd/mm, mm/dd) or yyyy.mm.dd: a day 1-31 and a month
    // 1-12 one way round, and a year from 1990 on.
    const [a, b, y] = m[2] ? [+m[2], +m[3], +m[4]] : m[5] ? [+m[7], +m[6], +m[5]] : [1, 1, 2000];
    const dayMonth = (a >= 1 && a <= 31 && b >= 1 && b <= 12) || (b >= 1 && b <= 31 && a >= 1 && a <= 12);
    return dayMonth && y >= 1990 && y <= 2100;
  }

  /** `{ date, rest }` — `date` is '' when the description carries no stamp. */
  function splitDatePrefix(text) {
    const s = text || '';
    const numeric = NUMERIC_DATE_RE.exec(s);
    const m = DATE_PREFIX_RE.exec(s) || (numeric && realDate(numeric) ? numeric : null) || RELATIVE_DATE_RE.exec(s);
    if (m) return { date: m[1], rest: s.slice(m[0].length) };
    const named = NAMED_DATE_RE.exec(s);
    if (named && MONTHS.has(named[2].toLowerCase())) {
      return { date: named[1], rest: s.slice(named[0].length) };
    }
    return { date: '', rest: s };
  }

  // A star rating's label, in each Google's language: "Rated 4.5 out of 5,",
  // "Bewertung: 4,5 von 5", "Note : 4,5 sur 5", "Valoración: 4,5 de 5"…
  // '4.5/5', or '' for any other label. The label must lead with a rating
  // word, so "Photo 1 of 5" is not a rating.
  const RATED_WORDS = ['rated', 'rating', 'bewertung', 'bewertet', 'note', 'noté', 'notée', 'valoración', 'valorado',
    'calificación', 'valutazione', 'valutato', 'beoordeling', 'beoordeeld', 'classificação', 'avaliação', 'ocena',
    'oceniono', 'betyg', 'bedømmelse', 'vurdering', 'arvio', 'arvosana', 'puan', 'derecelendirme', 'penilaian', '評価'];
  const RATING_RE = new RegExp('^\\s*(?:' + RATED_WORDS.join('|') + ')\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:out of|of|von|sur|de|su|van|z|av|af|på|/|kautta|üzerinden|dari|中)\\s*(\\d+(?:[.,]\\d+)?)', 'iu');

  function parseRating(label) {
    const m = RATING_RE.exec(String(label || ''));
    if (!m) return '';
    const value = Number(m[1].replace(',', '.'));
    const scale = Number(m[2].replace(',', '.'));
    if (!(scale === 5 || scale === 10) || !(value >= 0 && value <= scale)) return '';
    return m[1].replace(',', '.') + '/' + m[2].replace(',', '.');
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
    // an obfuscated class: "Rated 5.0 out of 5,". 1.11.0: in each Google's
    // language (parseRating).
    let rating = '';
    for (const el of container.querySelectorAll('[aria-label]')) {
      rating = parseRating(el.getAttribute('aria-label'));
      if (rating) break;
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

  // 1.13.0: with the element each was read from, where the keyword strip
  // puts its volume (src/overlay/serp-keywords.js). Our own badges inside
  // are left out of the text.
  function parseRelatedSearchElements(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const out = [];
    const seen = new Set();
    root.querySelectorAll('.b2Rnsc, [data-abe] a, #botstuff a').forEach((el) => {
      if (isAd(el)) return;
      if (el.closest && el.closest('#pnnext, #pnprev, [role="navigation"], table#nav')) return;
      const t = ownText(el);
      // A refinement is a short phrase, not a sentence or a chrome label.
      if (!t || t.length < 3 || t.length > 90) return;
      if (PAGINATION_LABEL.test(t)) return;
      if (seen.has(t.toLowerCase())) return;
      seen.add(t.toLowerCase());
      out.push({ text: t, el });
    });
    return out;
  }

  function parseRelatedSearches(root) {
    return parseRelatedSearchElements(root).map((r) => r.text);
  }

  // An element's text without the extension's own nodes in it.
  function ownText(el) {
    let text = el.textContent || '';
    if (el.querySelectorAll) {
      el.querySelectorAll('[class^="sbw-"], [class*=" sbw-"]').forEach((n) => { text = text.replace(n.textContent || '', ''); });
    }
    return text.replace(/\s+/g, ' ').trim();
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
  // sponsored-labeled block is skipped, as is anything nested inside, or
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
      row.type = resultType(row, resultEnd(block, unit));
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
  // 1.13.0: with the element each question was read from (`[data-q]` or
  // its button), where the keyword strip puts its volume.
  function parsePaaElements(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const out = [];
    const seen = new Set();

    function add(q, el, kind) {
      if (q && !seen.has(q)) {
        seen.add(q);
        out.push({ text: q, el, kind });
      }
    }

    // [data-q] is not PAA-only: on a commercial SERP Google also stamps the
    // SEARCH ITSELF with it, so "best crm for nonprofits" was being exported
    // as a People-also-ask question. Require a question, same bar as the
    // broader selector below.
    root.querySelectorAll('[data-q]').forEach((el) => {
      if (isAd(el)) return;
      const q = (el.getAttribute('data-q') || ownText(el)).replace(/\s+/g, ' ').trim();
      if (!q.endsWith('?')) return;
      add(q, el, 'data-q');
    });

    root.querySelectorAll('[jsname][role="button"]').forEach((el) => {
      if (isAd(el)) return;
      const text = ownText(el);
      if (text.length >= 12 && text.endsWith('?')) add(text, el, 'button');
    });

    return out;
  }

  function parsePaa(root) {
    return parsePaaElements(root).map((q) => q.text);
  }

  // ============================================
  // Result type, search features, AI Overview sources (1.11.0)
  // ============================================

  // What kind of result a row is, for the exports: 'video', 'forum',
  // 'social' (a profile or post), 'pdf' or 'web'. Read from the site and the
  // result's own markup (a video duration, Google's PDF label), never from a
  // request.
  const VIDEO_SITES = new Set(['youtube.com', 'm.youtube.com', 'vimeo.com', 'dailymotion.com', 'tiktok.com']);
  const FORUM_SITES = new Set(['reddit.com', 'old.reddit.com', 'quora.com', 'stackoverflow.com', 'stackexchange.com',
    'superuser.com', 'serverfault.com', 'answers.microsoft.com', 'community.spiceworks.com', 'tripadvisor.com']);
  const SOCIAL_SITES = new Set(['linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
    'pinterest.com', 'threads.net', 'threads.com', 'bsky.app', 'mastodon.social']);
  const DURATION_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

  function siteOf(domain) {
    const d = String(domain || '').toLowerCase();
    const parts = d.split('.');
    return parts.length > 2 && !/^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) ? parts.slice(-2).join('.') : d;
  }

  function resultType(row, el) {
    const domain = String((row && row.domain) || '').toLowerCase();
    const site = siteOf(domain);
    const url = String((row && row.url) || '');
    if (/\.pdf($|[?#])/i.test(url)) return 'pdf';
    if (el && el.querySelector) {
      const tags = Array.from(el.querySelectorAll('span, div')).slice(0, 400);
      if (tags.some((n) => n.childElementCount === 0 && /^\[?PDF\]?$/.test((n.textContent || '').trim()))) return 'pdf';
    }
    if (VIDEO_SITES.has(domain) || VIDEO_SITES.has(site)) return 'video';
    if (el && el.querySelector) {
      if (el.querySelector('[data-vid], video-voyager')) return 'video';
      const leaves = Array.from(el.querySelectorAll('span, div')).slice(0, 400);
      if (leaves.some((n) => n.childElementCount === 0 && DURATION_RE.test((n.textContent || '').trim()))) return 'video';
    }
    if (FORUM_SITES.has(domain) || FORUM_SITES.has(site) || /(^|\.)stackexchange\.com$/.test(domain)) return 'forum';
    if (SOCIAL_SITES.has(domain) || SOCIAL_SITES.has(site)) return 'social';
    return 'web';
  }

  // The blocks Google put on this page besides web results, each found by
  // markup that is not one of Google's rotating class names where one
  // exists. `ads` counts the ad units shown, top and bottom. Read from the
  // page only; the popup shows them and the exports carry them.
  // Where the AI Overview is: the one selector for this list and for the
  // text, state and citation reads further down (1.13.2), so they can't
  // disagree about what an AI Overview is. Defined here because FEATURES
  // reads it as the module loads.
  const AI_OVERVIEW_SELECTOR = '[data-subtree="aimc"], [data-attrid*="Overview" i], [data-mcpr]';
  const FEATURES = [
    ['ai_overview', 'AI Overview', AI_OVERVIEW_SELECTOR],
    ['featured_snippet', 'Featured snippet', 'block-component, .c2xzTb, [data-attrid="wa:/description"], [data-tts="answers"]'],
    ['local_pack', 'Local pack', '#lu_map, [data-local-attribute], a[href*="tbm=lcl"], [data-attrid*="kc:/local" i]'],
    ['people_also_ask', 'People also ask', PAA_CONTAINER_SELECTOR],
    ['ads', 'Ads', '[data-text-ad]'],
    ['shopping', 'Shopping', '[data-pla], .commercial-unit-desktop-top, .commercial-unit-desktop-rhs, .cu-container, product-viewer-group'],
    ['videos', 'Videos', 'video-voyager, [data-vid], [aria-label*="Videos" i], [aria-label="Short videos" i]'],
    ['top_stories', 'Top stories', '[aria-label*="Top stories" i], [data-news-doc-id], [data-news-cluster-id]'],
    ['images', 'Images', '#iur, [data-attrid="images universal"]'],
    ['knowledge_panel', 'Knowledge panel', '.kp-wholepage, #rhs [data-attrid="title"]']
  ];
  // Where results-page blocks live: the results list and what Google puts
  // around it, never the header's tab row (its "Shopping" and "Videos" tabs
  // are on every page).
  const FEATURE_ROOTS = '#search, #rso, #tads, #tadsb, #bottomads, #rhs, #botstuff, #center_col';

  function featureRoots(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    const roots = topMost(doc.querySelectorAll(FEATURE_ROOTS));
    return roots.length ? roots : [doc.body || doc];
  }

  function detectFeatures(doc) {
    const roots = featureRoots(doc);
    const out = [];
    for (const [key, label, selector] of FEATURES) {
      let found = [];
      if (key === 'ai_overview') {
        // 1.13.3, for the AI Overview study: the same boxes the export's text,
        // state and sources read, wherever they sit. Signed out, Google puts
        // the AI Overview in a block outside #search and #center_col, which
        // the roots below don't cover, so `Search features` missed it while
        // `AI Overview state` said "loaded".
        found = aiOverviewBoxes(doc);
      } else {
        roots.forEach((r) => { found = found.concat(Array.from(r.querySelectorAll(selector))); });
        found = topMost(found).filter((el) => !el.closest('[class^="sbw-"], [class*=" sbw-"]') && isShown(el));
      }
      if (key === 'people_also_ask' && !found.length && parsePaa(doc).length) found = [doc];
      if (key === 'ads') found = found.filter((el) => showsSomething(el));
      if (!found.length) continue;
      out.push(key === 'ads' ? { key, label, count: found.length } : { key, label });
    }
    if (parseRelatedSearches(doc).length) out.push({ key: 'related_searches', label: 'Related searches' });
    return out;
  }

  function featureLabels(features) {
    return (features || []).map((f) => (f.count ? `${f.label} (${f.count})` : f.label)).join(' | ');
  }

  // 1.13.2, for the AI Overview inclusion study: what in the AI Overview is
  // not the answer (AI_OVERVIEW_SELECTOR, above, says where it is). This
  // extension's own bar can land inside the box (the signed-in social-profiles
  // fixture has one); it is never read.
  const SBW_OWN_UI_SELECTOR = '[class^="sbw-"], [class*=" sbw-"]';
  // Google's own "not part of the answer" marker (the source cards and the
  // side panel), the source chips (buttons), the headings ("AI Mode reply
  // for …"), and this extension's bar. The inline links stay: the answer's
  // first words can be a link on the brand. `script`, `style`, `noscript` and
  // `template` are code, not words: a live page carries inline scripts inside
  // the overview (the chip images are filled by `_setImageSrc` ones), which
  // textContent would read as text (NOT_CONTENT_SELECTOR does the same).
  const AI_OVERVIEW_NOT_ANSWER = '[data-ignore-copy], button, [role="button"], h1, h2, h3, ' +
    'script, style, noscript, template, ' + SBW_OWN_UI_SELECTOR;
  // Where a block ends: textContent would run "Tools" into the next "Free Tools:".
  const AI_OVERVIEW_BLOCKS = 'div, p, li, ul, ol, br, h4, h5, h6, tr, td, th, [role="heading"]';
  const AI_OVERVIEW_TEXT_MAX = 20000;
  const AI_OVERVIEW_REDIRECT_PATH_RE = /^\/(goto|url)$/;

  // The AI Overview boxes the page shows, outermost only: not this
  // extension's own UI, and shown, so a hidden stale box is no overview here
  // and `Search features` (detectFeatures reads this list) and `AI Overview
  // state` agree. At the box level only: the collapsed half of a real answer
  // is aria-hidden inside the box. 1.13.3: a People also ask answer can hold
  // its own box; it answers that question, not the search, so it is not read
  // (its text, links and sources stay out of the export).
  function aiOverviewBoxes(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    return topMost(doc.querySelectorAll(AI_OVERVIEW_SELECTOR))
      .filter((box) => !box.closest(SBW_OWN_UI_SELECTOR) && !box.closest(PAA_CONTAINER_SELECTOR) && isShown(box));
  }

  // The text directly inside the element, not its children's.
  function directText(el) {
    let text = '';
    el.childNodes.forEach((n) => { if (n.nodeType === 3) text += n.textContent; });
    return text.replace(/\s+/g, ' ').trim();
  }

  function aiOverviewBoxText(box) {
    const doc = box.ownerDocument;
    const space = () => doc.createTextNode(' ');
    const clone = box.cloneNode(true);
    // A removed node leaves a space, not a gap: a chip between two inline
    // spans would otherwise glue "2010." to "Next sentence."
    clone.querySelectorAll(AI_OVERVIEW_NOT_ANSWER).forEach((n) => n.replaceWith(space()));
    // The heading's own words, by exact text: an answer to a definition
    // search can begin "AI Overviews are …".
    clone.querySelectorAll('*').forEach((n) => {
      const own = directText(n);
      if (own === 'AI Overview' || own.startsWith('AI Mode reply for')) n.replaceWith(space());
    });
    // A space on both sides of a block: bare text right before one ("Includes"
    // then a list) would otherwise run into its first words. The whitespace
    // is collapsed after, so a doubled space is harmless.
    clone.querySelectorAll(AI_OVERVIEW_BLOCKS).forEach((n) => { n.before(space()); n.after(space()); });
    return cleanText(clone);
  }

  // The AI Overview's answer as plain text: one string, whitespace collapsed,
  // cut at AI_OVERVIEW_TEXT_MAX, '' when the page has none.
  function aiOverviewText(doc) {
    return aiOverviewBoxes(doc).map((box) => aiOverviewBoxText(box)).filter(Boolean).join(' ').slice(0, AI_OVERVIEW_TEXT_MAX);
  }

  // 'none' (no AI Overview on the page), 'empty' (the box is there and has
  // no text: a placeholder that never loaded) or 'loaded'.
  function aiOverviewState(doc) {
    if (!aiOverviewBoxes(doc).length) return 'none';
    return aiOverviewText(doc) ? 'loaded' : 'empty';
  }

  function isGoogleRedirect(href) {
    if (/^\/(goto|url)\?/.test(href)) return true;
    try {
      const u = new URL(href);
      return GOOGLE_SEARCH_HOST_RE.test(u.hostname) && AI_OVERVIEW_REDIRECT_PATH_RE.test(u.pathname);
    } catch (e) {
      return false; // a relative or malformed href
    }
  }

  // ============================================
  // The AI Overview's sources (1.13.3)
  // ============================================
  //
  // For the AI Overview inclusion study: the pages the overview cites, read
  // where Google puts them. Signed in, they are plain links. Signed out,
  // Google sends every link through an opaque /goto?url= redirect and the
  // pages' real addresses are only in its hidden source records (HTML
  // comments that begin `TgQPHd|`, one beside each source chip); a source
  // whose record holds no address is only a card in the side panel, whose
  // site is all that can be read. Each source says which it was (`read`), so
  // a file never presents a site as a page. All three are read inside
  // aiOverviewBoxes only, so a People also ask answer's sources stay out.
  const AI_SOURCE_TITLE_MAX = 200;
  // Google's own image and asset hosts, and the addresses of a picture,
  // a style sheet or a script: such an address is an asset, not a cited
  // page. (A record also holds a video's thumbnail on ytimg.com and a
  // profile picture on ggpht.com.)
  const AI_ASSET_HOST_RE = /(^|\.)(gstatic|googleusercontent|ytimg|ggpht)\.com$/i;
  const AI_ASSET_PATH_RE = /\.(jpe?g|png|gif|webp|svg|ico|css|js)$/i;

  // The JSON of one hidden source record, or undefined when the comment is no
  // record or its JSON doesn't parse. A record reads `TgQPHd|`, two header
  // fields between pipes (often empty, never JSON) and the JSON after the
  // third pipe. The DOM keeps the HTML entities Google wrote inside the
  // comment (`&quot;` for every quote), so they are decoded here, `&amp;`
  // last so that `&amp;quot;` stays text. The JSON's own escapes (an "=" or
  // "&" in an address is written \u003d or \u0026) are JSON.parse's to decode.
  function aiRecordValue(data) {
    if (typeof data !== 'string' || data.indexOf('TgQPHd|') !== 0) return undefined;
    let at = -1;
    for (let k = 0; k < 3; k++) {
      at = data.indexOf('|', at + 1);
      if (at < 0) return undefined;
    }
    try {
      return JSON.parse(data.slice(at + 1)
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    } catch (e) {
      return undefined;
    }
  }

  // Every value inside a parsed record, parents before children, in the
  // order the record writes them. Walks with a list of its own: a page can
  // nest arrays as deep as JSON.parse accepts.
  function jsonValues(root) {
    const out = [];
    const todo = [root];
    while (todo.length) {
      const v = todo.pop();
      out.push(v);
      const kids = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
      for (let i = kids.length - 1; i >= 0; i--) todo.push(kids[i]);
    }
    return out;
  }

  // The records inside one box: `{ node, values }`, the comment and what its
  // JSON holds.
  function aiOverviewRecords(box) {
    const out = [];
    const walker = box.ownerDocument.createTreeWalker(box, 128); // comments only
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = aiRecordValue(node.data);
      if (value !== undefined) out.push({ node, values: jsonValues(value) });
    }
    return out;
  }

  // `{ url, domain }` when a record string is a cited page: a whole absolute
  // address, not on a Google asset host or ending in a picture, style sheet
  // or script, not Google's own pages, and not a bare origin (a record names
  // the site as well as the page, and the site alone is no page); the
  // fragment is dropped. null otherwise.
  function aiRecordPage(value) {
    if (typeof value !== 'string' || !/^https?:\/\/\S+$/i.test(value)) return null;
    let u;
    try { u = new URL(value); } catch (e) { return null; }
    const domain = bareDomain(u.href);
    if (!domain || AI_ASSET_HOST_RE.test(u.hostname) || AI_ASSET_PATH_RE.test(u.pathname)) return null;
    if (u.pathname === '/' && !u.search) return null;
    u.hash = '';
    return { url: u.href, domain };
  }

  // The site a favicon address stands for (`…/faviconV2?url=<site>&…`), as an
  // origin; '' for anything else, a site that is Google's own included.
  function aiFaviconSite(value) {
    if (typeof value !== 'string' || value.indexOf('faviconV2') < 0) return '';
    try {
      const u = new URL(value);
      if (!/\/faviconV2$/.test(u.pathname)) return '';
      const origin = new URL(u.searchParams.get('url')).origin;
      return bareDomain(origin) ? origin : '';
    } catch (e) {
      return '';
    }
  }

  // The site of a side-panel source card, first found: in the card's image
  // (`src`, then `data-src`; some saved pages lose it), in the card's own
  // records, and in a record elsewhere in the box that lists the card's
  // title first, in an array with the favicon address beside it. '' when
  // none names it.
  function aiCardSite(card, titles, records) {
    for (const img of card.querySelectorAll('img')) {
      for (const attr of ['src', 'data-src']) {
        const site = aiFaviconSite(img.getAttribute(attr));
        if (site) return site;
      }
    }
    for (const rec of records) {
      if (!card.contains(rec.node)) continue;
      for (const v of rec.values) {
        const site = aiFaviconSite(v);
        if (site) return site;
      }
    }
    if (!titles[0]) return '';
    for (const rec of records) {
      for (const v of rec.values) {
        if (!Array.isArray(v) || typeof v[0] !== 'string' || !titles.includes(v[0])) continue;
        for (const next of v) {
          const site = aiFaviconSite(next);
          if (site) return site;
        }
      }
    }
    return '';
  }

  function oneLine(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  // `cards` false stops after the pages themselves (a link or a record).
  function readAiOverviewSources(doc, cards) {
    const boxes = aiOverviewBoxes(doc);
    const out = [];
    const seen = new Map(); // address -> its place in `out`
    const add = (url, domain, title, read) => {
      if (seen.has(url)) {
        // A page named by its record before its link is read from the link
        // (its title), in the place the record gave it.
        const first = out[seen.get(url)];
        if (read === 'link' && first.read === 'record') { first.title = title; first.read = 'link'; }
        return;
      }
      seen.set(url, out.length);
      out.push({ url, domain, title, read });
    };
    const records = boxes.map(aiOverviewRecords);
    // 1. A link to the page itself, and 2. a page named in a hidden record
    // (the record has no title to give): one walk over each box, so they come
    // in the overview's own order, a source chip's link and its record side
    // by side. Elements and comments are visited together, in document order.
    boxes.forEach((box, b) => {
      const recordAt = new Map(records[b].map((rec) => [rec.node, rec]));
      const walker = box.ownerDocument.createTreeWalker(box, 1 | 128); // elements and comments
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === 8) {
          const rec = recordAt.get(node);
          if (!rec) continue;
          rec.values.forEach((v) => {
            const page = aiRecordPage(v);
            if (page) add(page.url, page.domain, '', 'record');
          });
          continue;
        }
        if (!node.matches('a[href^="http"]')) continue;
        const domain = bareDomain(node.href);
        if (!domain || node.closest(SBW_OWN_UI_SELECTOR)) continue;
        let url = node.href;
        try { const u = new URL(node.href); u.hash = ''; url = u.href; } catch (e) { /* keep as is */ }
        add(url, domain, oneLine(node.getAttribute('aria-label') || node.textContent).slice(0, AI_SOURCE_TITLE_MAX), 'link');
      }
    });
    if (!cards) return out;
    // 3. A card in the side panel whose page no link or record names: only
    // its site is known. A card for a site already read above is that
    // source again, so it is dropped; two cards of one site with different
    // titles are two sources.
    const known = new Set(out.map((s) => s.domain));
    const kept = new Set();
    boxes.forEach((box, b) => {
      box.querySelectorAll('[data-ignore-copy] a[aria-label]').forEach((a) => {
        if (a.closest(SBW_OWN_UI_SELECTOR) || !isGoogleRedirect(a.getAttribute('href') || '')) return;
        const card = a.closest('li') || a.parentElement;
        if (!card) return;
        const label = oneLine(a.getAttribute('aria-label'));
        const title = label.slice(0, AI_SOURCE_TITLE_MAX);
        const site = aiCardSite(card, [title, label], records[b]);
        const domain = site && bareDomain(site);
        if (!domain || known.has(domain) || kept.has(domain + '\n' + title)) return;
        kept.add(domain + '\n' + title);
        out.push({ url: site, domain, title, read: 'card site' });
      });
    });
    return out;
  }

  // The sources of the AI Overview, in its order, each once:
  // `{ url, domain, title, read }`, where `read` is 'link' (a link to the
  // page), 'record' (the page's address from Google's hidden record, no
  // title) or 'card site' (the cited page is not known, only its site, and
  // `url` is that site's origin). Google's own links (search, "Show more")
  // are left out.
  function aiOverviewSources(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    return readAiOverviewSources(doc, true);
  }

  // The pages the AI Overview cites, in its order, each once: the sources
  // above without the 'card site' ones, whose page is not known.
  function aiOverviewCitations(doc) {
    if (!doc || !doc.querySelectorAll) return [];
    return readAiOverviewSources(doc, false);
  }

  // How many of the AI Overview's links go through a Google redirect
  // (/goto?url=…, /url?q=…), each link once: the links a 'link' source can't
  // name. A signed-out token is unique to its link, so one source linked
  // twice can count twice. The attribute is read, not `a.href`: a relative
  // href has no base to resolve against in a saved page.
  function aiOverviewRedirectCount(doc) {
    const seen = new Set();
    aiOverviewBoxes(doc).forEach((box) => {
      box.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (isGoogleRedirect(href) && !a.closest(SBW_OWN_UI_SELECTOR)) seen.add(href);
      });
    });
    return seen.size;
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
    // 1.11.0: what else the search shows, and the pages its AI Overview
    // cites, page-level like the two above.
    ctx.features = doc ? featureLabels(detectFeatures(doc)) : '';
    // 1.13.3: every source, with how it was read and its title. A title is
    // free text from anyone's page, so the titles go as one JSON array (the
    // sources' own separator, ` | `, can appear in a title).
    const sources = doc ? aiOverviewSources(doc) : [];
    ctx.aiCitations = sources.map((c) => c.url).join(' | ');
    ctx.aiCitationReads = sources.map((c) => c.read).join(' | ');
    ctx.aiCitationTitles = sources.length ? JSON.stringify(sources.map((c) => c.title)) : '';
    // 1.13.2, for the AI Overview inclusion study, also page-level: whether
    // the page has an overview, what it says, how many of its sources link
    // through a Google redirect, and which version of the extension took the
    // capture. '' and 0 where there is no page to read.
    const aiText = doc ? aiOverviewText(doc) : '';
    // A page has a text exactly when its state is 'loaded' (aiOverviewState
    // reads the text to say so), so only a page without one is read again, to
    // tell 'none' from 'empty': an overview isn't cleaned twice per call.
    ctx.aiState = !doc ? '' : aiText ? 'loaded' : aiOverviewState(doc);
    ctx.aiText = aiText;
    ctx.aiRedirectCitations = doc ? aiOverviewRedirectCount(doc) : 0;
    ctx.extensionVersion = extensionVersion();
    return ctx;
  }

  // The extension's own version, so a file says what wrote it. '' outside an
  // extension, and when a content script has outlived its extension (a
  // reload makes chrome.runtime.getManifest throw "Extension context
  // invalidated").
  function extensionVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
        return String(chrome.runtime.getManifest().version || '');
      }
    } catch (e) { /* the extension was reloaded under this page */ }
    return '';
  }

  // The page-level fields a Collect page keeps with its rows (src/lib/
  // serp-collect.js), so each row of the combined file reads its own page's
  // value: cellValue prefers the row, and a field the page did not keep
  // would fall through to the page the export is run from. A new page-level
  // column goes in this list, not into the overlay.
  const COLLECT_CONTEXT_KEYS = [
    'capturedAt', 'resultStats', 'relatedSearches', 'paa', 'features',
    'aiCitations', 'aiState', 'aiText', 'aiRedirectCitations', 'extensionVersion',
    'aiCitationReads', 'aiCitationTitles'
  ];

  function collectContext(ctx) {
    const out = {};
    COLLECT_CONTEXT_KEYS.forEach((k) => {
      out[k] = ctx && ctx[k] !== undefined && ctx[k] !== null ? ctx[k] : '';
    });
    return out;
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
    ['Place name', 'place'],
    // 1.11.0, appended for the same reason: what kind of result each is, the
    // search's own features and AI Overview sources (page-level, on every
    // row), whether it is one of the user's own sites (Options), and the
    // figures under each result, each named for its source. A figure is
    // blank where it wasn't loaded, and blank is not zero.
    ['Result type', 'type'],
    ['Your site', (row) => (row && row.ownSite ? 'yes' : '')],
    ['Search features', 'features'],
    ['AI Overview citations', 'aiCitations'],
    ['Page referring domains (DataForSEO)', figure('page', 'referringDomains')],
    ['Page backlinks (DataForSEO)', figure('page', 'backlinks')],
    ['Page rank 0-100 (DataForSEO)', figure('page', 'rank')],
    ['Page traffic est. a month (DataForSEO)', figure('page', 'etv')],
    ['Page ranking keywords (DataForSEO)', figure('page', 'keywords')],
    ['Site rank 0-100 (DataForSEO)', figure('domain', 'rank')],
    ['Site referring domains (DataForSEO)', figure('domain', 'referringDomains')],
    ['Site backlinks (DataForSEO)', figure('domain', 'backlinks')],
    ['Site traffic est. a month (DataForSEO)', figure('domain', 'etv')],
    ['Site ranking keywords (DataForSEO)', figure('domain', 'keywords')],
    ['Figures fetched (DataForSEO)', (row) => {
      const f = row && row.figures;
      return (f && ((f.page && f.page.fetchedAt) || (f.domain && f.domain.fetchedAt))) || '';
    }],
    ['Domain age (RDAP)', figure('whois', 'age')],
    ['Registered (RDAP)', figure('whois', 'createdDate')],
    ['Registrar (RDAP)', figure('whois', 'registrar')],
    ['Expires (RDAP)', figure('whois', 'expiresDate')],
    ['Your on-page checklist', figure('checklist', 'score')],
    ['Checklist captured', figure('checklist', 'capturedAt')],
    // 1.13.0, appended for the same reason: the search's keyword data
    // (page-level, on every row; src/lib/serp-keywords.js exportContext),
    // the related searches and People also ask questions with their monthly
    // searches, and where the person's rank tracker last saw this result's
    // site for the search. Blank where not loaded.
    ['Search volume a month (DataForSEO)', 'keywordVolume'],
    ['CPC USD (DataForSEO)', 'keywordCpc'],
    ['Competition (DataForSEO)', 'keywordCompetition'],
    ['Keyword difficulty 0-100 (DataForSEO)', 'keywordDifficulty'],
    ['Search trend 12 months (DataForSEO)', 'keywordTrend'],
    ['Related searches with volume (DataForSEO)', 'relatedVolumes'],
    ['People also ask with volume (DataForSEO)', 'paaVolumes'],
    ['Your rank tracker position', (row) => (row && row.trackedPosition !== undefined && row.trackedPosition !== null ? row.trackedPosition : '')],
    // 1.13.2, appended for the same reason: for the AI Overview inclusion
    // study (page-level, on every row). The state is "none" (no overview on
    // the page), "loaded" or "empty" (a box that held no text); the text is
    // the overview's answer; the count is its links through a Google
    // redirect (each link once), which AI Overview citations can't name; and the
    // version is the extension's that took the capture.
    ['AI Overview state', 'aiState'],
    ['AI Overview text', 'aiText'],
    ['AI Overview citations via Google redirect', 'aiRedirectCitations'],
    ['Extension version', 'extensionVersion'],
    // 1.13.3, appended for the same reason: how each AI Overview citation was
    // read (link, record or card site, in the order of the citations) and
    // each one's title, a JSON array so a title with a comma, quote or " | "
    // stays whole.
    ['AI Overview citations read from', 'aiCitationReads'],
    ['AI Overview citation titles (JSON)', 'aiCitationTitles']
  ];

  // A cell from the figures a row was given (row.figures: the route's answer
  // for that result, src/lib/serp-figures.js), or '' when it has none.
  function figure(block, field) {
    return (row) => {
      const b = row && row.figures && row.figures[block];
      const v = b ? b[field] : null;
      return v === null || v === undefined ? '' : v;
    };
  }

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
    if (typeof key === 'function') return key(row, ctx);
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
    collectContext,
    parseRelatedSearches,
    parseRelatedSearchElements,
    parsePaaElements,
    splitDatePrefix,
    paaToText,
    uule,
    buildSearchUrl,
    PRESET_LOCATIONS,
    guardCell,
    absolutePosition,
    placeFromUule,
    FORMULA_PREFIX_RE,
    parseRating,
    isAdLabel,
    resultType,
    detectFeatures,
    featureLabels,
    aiOverviewCitations,
    aiOverviewSources,
    aiOverviewText,
    aiOverviewState,
    aiOverviewRedirectCount,
    RESULT_CSV_COLUMNS
  };
});
