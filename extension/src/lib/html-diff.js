// SEO Bandwagon — pure HTML-vs-rendered-DOM diff logic
//
// The "Raw vs rendered" comparison (Rendering section) needs to answer one
// question: does this page's content actually exist in the HTML the server
// sent, or only after JavaScript runs? This module owns both halves of that
// comparison and the diff between them:
//
//   summarizeHtml(html, baseUrl, opts) — a light regex parse over the RAW
//     HTML the background worker fetched (src/background/service-worker.js's
//     fetchRawHtml). There is no DOMParser available in a service worker,
//     so this never assumes one; it treats the HTML as text. `opts.truncated`
//     carries forward whether the worker's own body cap cut the fetch short.
//   summarizeDom(analysis)        — the same shape, read off the already-
//     computed content-script analysis (src/content/analyzer.js's
//     analyzePage() result) — the page AFTER JS has run.
//   diffSummaries(raw, dom)       — compares the two summaries field by
//     field and renders a verdict.
//
// No fetch/chrome/DOM dependency here — the worker owns the actual raw-HTML
// fetch (fetchRawHtml message, see service-worker.js) and the popup
// (src/popup/render-check.js) owns turning summarizeDom()'s input into the
// page's already-computed analysis object. This module is pure string/object
// manipulation so it can run in the worker, the popup, or a test.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWHtmlDiff` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWHtmlDiff = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // A raw-HTML fetch's body can be huge; nothing past this is scanned. Named
  // for what String.slice() actually counts — UTF-16 code units, not bytes
  // — to avoid implying byte-parity with the worker's own RAW_HTML_MAX_BYTES
  // (service-worker.js), which caps a Uint8Array stream and is a genuine
  // byte count. The two only ever need to agree approximately, not share
  // code, since one runs on a Response stream and this runs on the
  // resulting string.
  const MAX_HTML_CHARS = 1024 * 1024;

  // A field counts as "differs so much this looks JS-rendered" when the
  // word count grows by more than this fraction from raw HTML to rendered
  // DOM.
  const WORD_GROWTH_THRESHOLD = 0.5;

  // Fields whose content actually matters to a searcher/crawler — if any of
  // these exists ONLY after JS runs, the page reads as JS-rendered
  // regardless of what the other, more cosmetic fields show.
  const CRITICAL_FIELDS = ['title', 'metaDescription', 'h1'];

  function stripComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '');
  }

  // Named HTML entities this module decodes, beyond the numeric forms
  // handled separately below. Deliberately excludes `amp` — see
  // decodeEntities()'s comment on why `&amp;` is handled last, on its own.
  const NAMED_ENTITIES = {
    lt: '<', gt: '>', quot: '"', apos: "'",
    nbsp: '\u00A0', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
    copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
    laquo: '\u00AB', raquo: '\u00BB',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D'
  };

  // One shared entity decoder for every attribute value (getAttr) and every
  // text run (textOf) this module produces — the review's minor 5 was two
  // independently-drifted, incomplete decoders (one in the old textOf, none
  // on attribute values at all). Order matters: named entities and numeric
  // entities are decoded first, `&amp;` LAST, so a double-escaped source
  // like `&amp;lt;` decodes to the literal text `&lt;` (one honest decode
  // pass) rather than continuing on to `<` (a second, wrong pass over
  // output the source never actually meant as a live entity).
  function decodeEntities(str) {
    if (!str) return str;
    let out = String(str);
    out = out.replace(/&(lt|gt|quot|apos|nbsp|mdash|ndash|hellip|copy|reg|trade|laquo|raquo|lsquo|rsquo|ldquo|rdquo);/gi,
      (m, name) => {
        const v = NAMED_ENTITIES[name.toLowerCase()];
        return v !== undefined ? v : m;
      });
    out = out.replace(/&#(\d+);/g, (m, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch (e) { return m; }
    });
    out = out.replace(/&#x([0-9a-f]+);/gi, (m, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return m; }
    });
    out = out.replace(/&amp;/gi, '&');
    return out;
  }

  // Pulls attr="value" / attr='value' / attr=value out of one tag string,
  // case-insensitively and independent of attribute order — same primitive
  // as src/lib/hreflang.js's getAttr (duplicated rather than shared: this
  // module has no dependency on hreflang.js for anything but hreflangCount
  // below, and that call already goes through SBWHreflang's own copy).
  // Every returned value is entity-decoded — an attribute is text content
  // like any other, and `content="Cheap &amp; fast"` must read back as
  // "Cheap & fast", not the literal escaped source.
  function getAttr(tag, name) {
    const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    const m = tag.match(re);
    if (!m) return null;
    const raw = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    return decodeEntities(raw);
  }

  // Strips nested tags, decodes entities, and collapses whitespace — used
  // for both a single heading's inner text and the page's plain-text word
  // count.
  function textOf(html) {
    const stripped = html.replace(/<[^>]*>/g, ' ');
    return decodeEntities(stripped)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countTag(html, tagName) {
    const re = new RegExp('<' + tagName + '(\\s|>|/)', 'gi');
    return (html.match(re) || []).length;
  }

  function headingTexts(html, level, max) {
    const re = new RegExp('<h' + level + '\\b[^>]*>([\\s\\S]*?)<\\/h' + level + '>', 'gi');
    const out = [];
    let m;
    while ((m = re.exec(html)) && out.length < max) {
      const t = textOf(m[1]);
      if (t) out.push(t);
    }
    return out;
  }

  // Word-count scope must match the DOM side's own getMainContent()
  // (lib/dom-extraction.js): prefer the first <main>/<article> block
  // wholesale — same as innerText's own no-further-exclusion behavior for
  // those elements — otherwise take <body> and drop whole header/footer/
  // nav/aside blocks (non-greedy; a tag nested inside its own kind more
  // than once isn't handled, "nested-once is fine" per the brief). The
  // class-based exclusions getMainContent() ALSO applies in that fallback
  // (.sidebar/.navigation/.menu) are not reproducible over raw HTML with
  // regex — not attempted here; a resulting small residual delta is
  // expected and is exactly what the >50% growth trigger in diffSummaries()
  // is for, rather than chasing exact parity here.
  function extractMainRegion(html) {
    const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) return mainMatch[1];
    const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) return articleMatch[1];
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    let region = bodyMatch ? bodyMatch[1] : html;
    region = region
      .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ');
    return region;
  }

  // Symmetric with the DOM side's links.internal.count + links.external.count
  // (lib/dom-extraction.js's extractLinks(), which reads `a[href]` and only
  // counts URLs it can resolve): counts <a> tags whose href resolves,
  // relative to `baseUrl`, to an http(s) URL — mailto:/tel:/javascript: and
  // a bare <a> with no href at all don't count on either side.
  function countHttpLinks(html, baseUrl) {
    const re = /<a\b[^>]*>/gi;
    let m;
    let count = 0;
    while ((m = re.exec(html))) {
      const href = getAttr(m[0], 'href');
      if (!href) continue;
      try {
        const u = new URL(href, baseUrl);
        if (u.protocol === 'http:' || u.protocol === 'https:') count++;
      } catch (e) { /* unresolvable href, skip */ }
    }
    return count;
  }

  // Symmetric with the DOM side's jsonLdBlocks (Array.isArray(meta.schema)
  // ? meta.schema.length : 0 — see summarizeDom below), which is itself
  // built from a try/catch JSON.parse over every ld+json script's
  // textContent (lib/dom-extraction.js's extractMeta). A <script> element's
  // content is HTML's "raw text" — the browser never entity-decodes it — so
  // the captured body is JSON.parse'd as-is, not run through decodeEntities.
  function countValidJsonLd(html) {
    const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    let count = 0;
    while ((m = re.exec(html))) {
      try {
        JSON.parse(m[1].trim());
        count++;
      } catch (e) { /* invalid JSON-LD body, not counted */ }
    }
    return count;
  }

  // Resolves a (possibly relative/protocol-relative) canonical href to an
  // absolute URL. `base` is a <base href> found anywhere in the document,
  // itself resolved against `baseUrl`, when one exists — otherwise
  // `baseUrl` directly. Returns null rather than throwing when resolution
  // fails (an unparsable baseUrl, e.g.) so a bad canonical never takes the
  // whole summary down with it.
  function resolveCanonical(canonicalHref, html, baseUrl) {
    if (!canonicalHref) return null;
    let effectiveBase = baseUrl;
    const baseTagMatch = html.match(/<base\b[^>]*>/i);
    if (baseTagMatch) {
      const baseHref = getAttr(baseTagMatch[0], 'href');
      if (baseHref) {
        try { effectiveBase = new URL(baseHref, baseUrl).href; } catch (e) { /* keep baseUrl */ }
      }
    }
    try {
      return new URL(canonicalHref, effectiveBase).href;
    } catch (e) {
      return null;
    }
  }

  // Regex/light parsing over raw (pre-JS) HTML — no DOMParser in the worker.
  // `html` is capped at MAX_HTML_CHARS before any scanning. `baseUrl` is the
  // page's own URL (after redirects) — passed straight through to
  // SBWHreflang.extractHreflangFromHtml for hreflangCount, same contract
  // that function already has, and used to resolve relative hrefs
  // (canonical, <a>). `opts.truncated` — true when the caller's fetch was
  // cut off by ITS OWN body cap (service-worker.js's readCappedBody) before
  // reaching the end of the response — is carried through to the returned
  // summary and, downstream, keeps diffSummaries() from claiming
  // 'js-rendered' off content that might simply not have arrived yet.
  function summarizeHtml(html, baseUrl, opts) {
    opts = opts || {};
    const sliced = typeof html === 'string' ? html.slice(0, MAX_HTML_CHARS) : '';
    const raw = sliced;
    const clean = stripComments(raw);
    // Scripts/styles never contribute visible text, headings, links or
    // images — stripped whole (not just tag-stripped) before any of those
    // counts run, so inline JS/CSS text can't pollute the word count or get
    // miscounted as an <a>/<img>/<hN> by a stray string inside it. A
    // trailing, unterminated <script>/<style> — the opening tag arrived but
    // its closing tag didn't, because the fetch was truncated mid-block —
    // survives the two paired-block replaces above (they require a closing
    // tag) and is stripped separately: anything still starting with
    // <script/<style at this point has no closing tag in the truncated
    // content, so trimming to end-of-string is safe and only ever removes
    // the cut-off fragment, never real trailing content.
    const withoutScripts = clean
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*$/i, '');

    const titleMatch = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? textOf(titleMatch[1]) : '';

    // `["']?name["']?` (rather than a bare `["']name["']`) matches both
    // `name="description"` and the equally-valid unquoted `name=description`
    // — the lookahead confirms the value actually ends there (a space, a
    // self-closing slash, or the tag's `>`) rather than continuing into a
    // longer attribute value.
    const metaDescMatch = clean.match(/<meta\b[^>]*\bname\s*=\s*["']?description["']?(?=[\s/>])[^>]*>/i);
    const metaDescription = metaDescMatch ? (getAttr(metaDescMatch[0], 'content') || '') : '';

    const canonicalMatch = clean.match(/<link\b[^>]*\brel\s*=\s*["']?canonical["']?(?=[\s/>])[^>]*>/i);
    const canonicalHref = canonicalMatch ? getAttr(canonicalMatch[0], 'href') : null;
    const canonical = canonicalHref ? resolveCanonical(canonicalHref, clean, baseUrl) : null;

    const robotsMatch = clean.match(/<meta\b[^>]*\bname\s*=\s*["']?robots["']?(?=[\s/>])[^>]*>/i);
    const robots = robotsMatch ? getAttr(robotsMatch[0], 'content') : null;

    const headings = {};
    for (let i = 1; i <= 6; i++) headings['h' + i] = countTag(withoutScripts, 'h' + i);

    const h1Texts = headingTexts(clean, 1, 5);

    const linkCount = countHttpLinks(withoutScripts, baseUrl);
    const imgCount = countTag(withoutScripts, 'img');
    const jsonLdBlocks = countValidJsonLd(clean);

    // Word count is scoped to the same "main content" region the DOM side's
    // getMainContent() reads — see extractMainRegion()'s comment — not the
    // whole withoutScripts document, so a page's chrome (nav/header/footer)
    // can't inflate the raw side and produce a false content-growth signal.
    const wordCountApprox = textOf(extractMainRegion(withoutScripts)).split(/\s+/).filter(Boolean).length;

    const hreflangCount = (typeof globalThis !== 'undefined' && globalThis.SBWHreflang)
      ? globalThis.SBWHreflang.extractHreflangFromHtml(raw, baseUrl).length
      : 0;

    return {
      title,
      metaDescription,
      canonical,
      robots,
      headings,
      h1Texts,
      linkCount,
      imgCount,
      jsonLdBlocks,
      wordCountApprox,
      hreflangCount,
      truncated: !!opts.truncated
    };
  }

  // Same shape as summarizeHtml(), derived from the content script's own
  // analysis result (src/content/analyzer.js's analyzePage(), via
  // lib/dom-extraction.js's extractMeta/extractHeadings/extractLinks/
  // extractImages) — the page AFTER JS has run. Field mapping:
  //   meta.title.text / meta.description.text / meta.canonical / meta.robots
  //   headings.h1..h6 (arrays -> counts here, to match summarizeHtml's shape)
  //   links.internal.count + links.external.count
  //   images.total
  //   meta.schema (parsed JSON-LD array) -> jsonLdBlocks count
  //   content.wordCount
  //   hreflang.count (analyzeHreflang()'s own count, not re-derived here)
  function summarizeDom(analysis) {
    const a = analysis || {};
    const meta = a.meta || {};
    const headingsRaw = a.headings || {};
    const links = a.links || {};
    const images = a.images || {};
    const content = a.content || {};
    const hreflang = a.hreflang || {};

    const headings = {};
    for (let i = 1; i <= 6; i++) {
      const key = 'h' + i;
      const v = headingsRaw[key];
      headings[key] = Array.isArray(v) ? v.length : (v || 0);
    }

    return {
      title: (meta.title && meta.title.text) || '',
      metaDescription: (meta.description && meta.description.text) || '',
      canonical: meta.canonical || null,
      robots: meta.robots || null,
      headings,
      h1Texts: (Array.isArray(headingsRaw.h1) ? headingsRaw.h1 : []).slice(0, 5),
      linkCount: ((links.internal && links.internal.count) || 0) + ((links.external && links.external.count) || 0),
      imgCount: images.total || 0,
      jsonLdBlocks: Array.isArray(meta.schema) ? meta.schema.length : 0,
      wordCountApprox: content.wordCount || 0,
      hreflangCount: hreflang.count || 0
    };
  }

  // Field list this diff cares about — the h1..h6 heading COUNTS (not the
  // text arrays; h1Texts is carried on the summary for the popup to show
  // directly next to the verdict, but a diff over free-text arrays would be
  // noisy: two h1 texts differing by one changed word would render as
  // "changed" for the whole array rather than the far more useful "the
  // count is the same". Counts are exact and comparable; text is not.
  const DIFF_FIELDS = [
    { field: 'title', get: s => s.title || '' },
    { field: 'metaDescription', get: s => s.metaDescription || '' },
    { field: 'canonical', get: s => s.canonical || null },
    { field: 'robots', get: s => s.robots || null },
    { field: 'h1', get: s => (s.headings && s.headings.h1) || 0 },
    { field: 'h2', get: s => (s.headings && s.headings.h2) || 0 },
    { field: 'h3', get: s => (s.headings && s.headings.h3) || 0 },
    { field: 'h4', get: s => (s.headings && s.headings.h4) || 0 },
    { field: 'h5', get: s => (s.headings && s.headings.h5) || 0 },
    { field: 'h6', get: s => (s.headings && s.headings.h6) || 0 },
    { field: 'linkCount', get: s => s.linkCount || 0 },
    { field: 'imgCount', get: s => s.imgCount || 0 },
    { field: 'jsonLdBlocks', get: s => s.jsonLdBlocks || 0 },
    { field: 'wordCountApprox', get: s => s.wordCountApprox || 0 },
    { field: 'hreflangCount', get: s => s.hreflangCount || 0 }
  ];

  function isEmptyValue(v) {
    return v === null || v === undefined || v === '' || v === 0;
  }

  function fieldStatus(rawVal, domVal) {
    if (rawVal === domVal) return 'same';
    const rawEmpty = isEmptyValue(rawVal);
    const domEmpty = isEmptyValue(domVal);
    if (rawEmpty && !domEmpty) return 'js-only';
    if (!rawEmpty && domEmpty) return 'raw-only';
    return 'changed';
  }

  // { rows: [{ field, raw, rendered, status }], verdict }. An object
  // (rather than an array carrying an extra `.verdict` property) — matches
  // every other multi-part result in this codebase (SBWHreflang.validateSet
  // returns { entries, issues }, .reciprocity() returns { entries, summary }
  // — see src/lib/hreflang.js) and survives a structured-clone/JSON hop
  // without losing the verdict the way a property bolted onto an array
  // could.
  //
  // verdict:
  //   'js-rendered' — any of title/metaDescription/h1 exists ONLY in the
  //     rendered DOM (status 'js-only'), or the rendered word count grew by
  //     more than 50% over the raw HTML's — either signal alone means a
  //     crawler that doesn't run JS would see meaningfully less than what's
  //     actually on the page. Never returned when the raw fetch was
  //     truncated (see 'partial' below) — a cut-off response can look
  //     exactly like a JS-only field or a word-count jump for the boring
  //     reason that the rest of the content just never arrived, and
  //     'js-rendered' is a specific enough claim that overclaiming it off
  //     partial data would be actively misleading.
  //   'partial'     — the same trigger as 'js-rendered' fired, but the raw
  //     HTML was truncated (raw.truncated), so it can't be told apart from
  //     ordinary truncation. The popup surfaces this distinctly (see
  //     src/popup/render-check.js) rather than silently downgrading it to
  //     'hydrated', which would just as wrongly claim confidence the data
  //     doesn't support.
  //   'static'      — every tracked field matches exactly: what the server
  //     sent is exactly what ends up on screen.
  //   'hydrated'    — something differs (framework markup, script/link
  //     counts, a minor word-count wobble under the 50% line, etc.) but
  //     nothing critical is JS-only and the content growth isn't dramatic —
  //     read as "this page's framework re-renders it client-side, but the
  //     content itself was already there."
  function diffSummaries(raw, dom) {
    const r = raw || {};
    const d = dom || {};
    const truncated = !!r.truncated;

    const rows = DIFF_FIELDS.map(({ field, get }) => {
      const rawVal = get(r);
      const domVal = get(d);
      return { field, raw: rawVal, rendered: domVal, status: fieldStatus(rawVal, domVal) };
    });

    const criticalJsOnly = rows.some(row => CRITICAL_FIELDS.includes(row.field) && row.status === 'js-only');

    const rawWords = r.wordCountApprox || 0;
    const domWords = d.wordCountApprox || 0;
    const wordGrowth = rawWords > 0 ? (domWords - rawWords) / rawWords : (domWords > 0 ? Infinity : 0);
    const wordGrew = wordGrowth > WORD_GROWTH_THRESHOLD;

    let verdict;
    if (criticalJsOnly || wordGrew) {
      verdict = truncated ? 'partial' : 'js-rendered';
    } else if (rows.every(row => row.status === 'same')) {
      verdict = 'static';
    } else {
      verdict = 'hydrated';
    }

    return { rows, verdict, truncated };
  }

  return {
    summarizeHtml,
    summarizeDom,
    diffSummaries
  };
});
