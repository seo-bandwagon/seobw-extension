// SEO Bandwagon — pure HTML-vs-rendered-DOM diff logic
//
// The "Raw vs rendered" comparison (Rendering section) needs to answer one
// question: does this page's content actually exist in the HTML the server
// sent, or only after JavaScript runs? This module owns both halves of that
// comparison and the diff between them:
//
//   summarizeHtml(html, baseUrl)  — a light regex parse over the RAW HTML
//     the background worker fetched (src/background/service-worker.js's
//     fetchRawHtml). There is no DOMParser available in a service worker,
//     so this never assumes one; it treats the HTML as text.
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

  // A raw-HTML fetch's body can be huge; nothing past this is scanned. Kept
  // in lockstep with the worker's own fetchRawHtml body cap (see
  // service-worker.js) — the two only ever need to agree, not share code,
  // since one runs on a Response stream and this runs on the resulting
  // string.
  const MAX_HTML_BYTES = 1024 * 1024;

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

  // Pulls attr="value" / attr='value' / attr=value out of one tag string,
  // case-insensitively and independent of attribute order — same primitive
  // as src/lib/hreflang.js's getAttr (duplicated rather than shared: this
  // module has no dependency on hreflang.js for anything but hreflangCount
  // below, and that call already goes through SBWHreflang's own copy).
  function getAttr(tag, name) {
    const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    const m = tag.match(re);
    if (!m) return null;
    return m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
  }

  // Strips nested tags and collapses whitespace — used for both a single
  // heading's inner text and the page's plain-text word count.
  function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
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

  // Regex/light parsing over raw (pre-JS) HTML — no DOMParser in the worker.
  // `html` is capped at 1 MB before any scanning. `baseUrl` is the page's
  // own URL (after redirects) — passed straight through to
  // SBWHreflang.extractHreflangFromHtml for hreflangCount, same contract
  // that function already has.
  function summarizeHtml(html, baseUrl) {
    const raw = typeof html === 'string' ? html.slice(0, MAX_HTML_BYTES) : '';
    const clean = stripComments(raw);
    // Scripts/styles never contribute visible text, headings, links or
    // images — stripped whole (not just tag-stripped) before any of those
    // counts run, so inline JS/CSS text can't pollute the word count or get
    // miscounted as an <a>/<img>/<hN> by a stray string inside it.
    const withoutScripts = clean
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');

    const titleMatch = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? textOf(titleMatch[1]) : '';

    const metaDescMatch = clean.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i);
    const metaDescription = metaDescMatch ? (getAttr(metaDescMatch[0], 'content') || '') : '';

    const canonicalMatch = clean.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i);
    const canonical = canonicalMatch ? getAttr(canonicalMatch[0], 'href') : null;

    const robotsMatch = clean.match(/<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*>/i);
    const robots = robotsMatch ? getAttr(robotsMatch[0], 'content') : null;

    const headings = {};
    for (let i = 1; i <= 6; i++) headings['h' + i] = countTag(withoutScripts, 'h' + i);

    const h1Texts = headingTexts(clean, 1, 5);

    const linkCount = countTag(withoutScripts, 'a');
    const imgCount = countTag(withoutScripts, 'img');
    const jsonLdBlocks = (clean.match(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>/gi) || []).length;

    const wordCountApprox = textOf(withoutScripts).split(/\s+/).filter(Boolean).length;

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
      hreflangCount
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
  //     actually on the page.
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
      verdict = 'js-rendered';
    } else if (rows.every(row => row.status === 'same')) {
      verdict = 'static';
    } else {
      verdict = 'hydrated';
    }

    return { rows, verdict };
  }

  return {
    summarizeHtml,
    summarizeDom,
    diffSummaries
  };
});
