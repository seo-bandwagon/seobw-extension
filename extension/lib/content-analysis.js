// Pure-logic analysis helpers extracted from content.js for unit testability.
//
// Dual-export pattern: attaches to `self.SEOBWAnalysis` when running as a
// content script in the target tab (injected via chrome.scripting.executeScript),
// and exports via CommonJS when loaded by Vitest / Node.
//
// content.js destructures from self.SEOBWAnalysis at the top of its closure.
// Tests import via require('../../lib/content-analysis.js').
//
// 1.10.4: this file holds the one list of checks (CHECKS) behind the score,
// the four sub-scores (src/lib/sub-scores.js), the page-checks panel and the
// new tab's next fix, with each issue's points and fix text. The pages that
// show them (popup, panel, new tab) load it as a classic script too.
// analyzeDocument() is the score's whole path on a Document, the live page
// (src/content/analyzer.js) or a parsed one (research/organic-grade, and
// 1.12.0's offscreen analysis), so the two can't drift.

(function (factory) {
  var api = factory();
  if (typeof self !== 'undefined') {
    self.SEOBWAnalysis = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // ============================================
  // Text processing
  // ============================================

  // Until 1.10.4 cleanText kept ASCII only and getWords split what was left
  // on spaces, so a Russian or Japanese page counted 0 words and read "Thin
  // content". Letters, marks and digits of every script count now; symbols
  // and emoji are dropped.
  function cleanText(text) {
    return String(text || '').replace(/[^\p{L}\p{M}\p{N}\p{P}\s]/gu, '').replace(/\s+/g, ' ').trim();
  }

  // A word: letters, marks and digits, joined by an apostrophe, a hyphen or
  // a dot, and digits by a comma ("don't", "e-mail", "U.S", "5.99", "1,000"
  // are one word each, as they were when punctuation was stripped).
  const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-.][\p{L}\p{M}\p{N}]+|(?<=\p{N}),\p{N}+)*/gu;
  // Scripts written without spaces between words: a run of them is split
  // with Intl.Segmenter (Chrome and Node ship it), else one word a character
  // for Han and kana and one word a run for the rest.
  const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
  const HAN_KANA = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u;
  let segmenter;

  function segmentWords(run) {
    if (segmenter === undefined) {
      try { segmenter = new Intl.Segmenter(undefined, { granularity: 'word' }); } catch (e) { segmenter = null; }
    }
    if (segmenter) {
      const out = [];
      for (const s of segmenter.segment(run)) if (s.isWordLike) out.push(s.segment);
      return out;
    }
    if (!HAN_KANA.test(run)) return [run];
    return run.match(/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|[^\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]+/gu) || [run];
  }

  function getWords(text) {
    const out = [];
    (String(text || '').toLowerCase().match(WORD_RE) || []).forEach(function (token) {
      if (UNSPACED.test(token)) segmentWords(token).forEach(function (w) { out.push(w); });
      else out.push(token);
    });
    return out;
  }

  function countSentences(text) {
    const sentences = String(text || '').split(/[.!?。！？؟।]+/).filter(function (s) { return s.trim().length > 0; });
    return sentences.length || 1;
  }

  function countSyllables(word) {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  function calculateReadability(text, words) {
    const sentences = countSentences(text);
    const syllables = words.reduce(function (sum, word) { return sum + countSyllables(word); }, 0);

    const fleschKincaid = words.length > 0
      ? (0.39 * (words.length / sentences)) + (11.8 * (syllables / words.length)) - 15.59
      : 0;

    const fleschEase = words.length > 0
      ? 206.835 - (1.015 * (words.length / sentences)) - (84.6 * (syllables / words.length))
      : 0;

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

  // Flesch-Kincaid counts English syllables, so readability is scored only
  // for an English page. `lang` (the page's own lang attribute) decides when
  // it is there; text that is mostly another script is not English whatever
  // it says. Without one, English is a page whose words are often the
  // commonest English ones.
  const ENGLISH_MARKERS = new Set(['the', 'and', 'of', 'to', 'is', 'that', 'for', 'with', 'was', 'are', 'this', 'you', 'it', 'be', 'on', 'not', 'have', 'from']);

  function detectLanguage(lang, text, words) {
    const code = String(lang || '').trim().toLowerCase().split(/[-_]/)[0] || null;
    const letters = String(text || '').match(/\p{L}/gu) || [];
    const latin = letters.filter(function (c) { return /\p{sc=Latin}/u.test(c); }).length;
    const mostlyLatin = letters.length === 0 || latin / letters.length >= 0.5;
    if (code) return { code: code, source: 'lang', english: code === 'en' && mostlyLatin };
    const list = words || [];
    const markers = list.filter(function (w) { return ENGLISH_MARKERS.has(w); }).length;
    const english = mostlyLatin && list.length >= 20 && markers / list.length >= 0.08;
    return { code: english ? 'en' : null, source: 'text', english: english };
  }

  // Characters Google shows about twice as wide (CJK, Hangul, full-width
  // forms) count two toward a title's or description's length, so a
  // Japanese title isn't "too short" at 25 characters.
  const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

  function displayLength(text) {
    let n = 0;
    for (const c of String(text || '')) n += WIDE.test(c) ? 2 : 1;
    return n;
  }

  // ============================================
  // The checks: score, sub-scores, issues, fixes
  // ============================================

  const NA = null; // the check doesn't apply to this page (or the capture predates it)
  const PASS = '';
  const GROUPS = ['Meta', 'Content', 'Links', 'Tech'];

  const lengthOf = (t) => (typeof t.displayLength === 'number' ? t.displayLength : t.length || 0);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  function structuredDataCount(m) {
    const sd = m.structuredData;
    if (sd) return (sd.jsonLd || 0) + (sd.microdata || 0) + (sd.rdfa || 0);
    return Array.isArray(m.schema) ? m.schema.length : 0;
  }

  // A capture from before 1.10.4 has `meta.robots` but no `noindex`.
  function noindexOf(m) {
    if (typeof m.noindex === 'boolean') return m.noindex;
    const tokens = String(m.robots || '').toLowerCase().split(/[\s,]+/);
    return tokens.indexOf('noindex') !== -1 || tokens.indexOf('none') !== -1;
  }

  function urlProtocol(url) {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : null;
  }

  // The one list. Each check: `id`, the sub-score `group` it counts in, the
  // `label` rows show, its `points`, `outcomes` (issue label -> points lost)
  // and `test(data)`, which returns NA, PASS or one outcome's label. The
  // points add up to 100, so the score is 100 minus the points lost. Order
  // is the order issues are listed in.
  const CHECKS = [
    {
      id: 'indexable', group: 'Tech', label: 'Indexable', points: 15,
      outcomes: { 'Set to noindex': 15 },
      test: (d) => (d.meta ? (noindexOf(d.meta) ? 'Set to noindex' : PASS) : NA),
      note: (d) => (noindexOf(d.meta) ? 'noindex (' + (d.meta.noindexSource || 'robots') + ' meta)' : 'Yes')
    },
    {
      id: 'title', group: 'Meta', label: 'Title', points: 12,
      outcomes: { 'Missing title': 12, 'Title too short': 6, 'Title too long': 4 },
      test: (d) => {
        const t = d.meta && d.meta.title;
        if (!t) return NA;
        if (!t.text) return 'Missing title';
        if (lengthOf(t) < 30) return 'Title too short';
        if (lengthOf(t) > 60) return 'Title too long';
        return PASS;
      },
      note: (d) => lengthOf(d.meta.title) + ' / 60'
    },
    {
      id: 'description', group: 'Meta', label: 'Description', points: 8,
      outcomes: { 'Missing meta description': 8, 'Description too short': 4, 'Description too long': 2 },
      test: (d) => {
        const t = d.meta && d.meta.description;
        if (!t) return NA;
        if (!t.text) return 'Missing meta description';
        if (lengthOf(t) < 120) return 'Description too short';
        if (lengthOf(t) > 160) return 'Description too long';
        return PASS;
      },
      note: (d) => lengthOf(d.meta.description) + ' / 160'
    },
    {
      id: 'h1', group: 'Content', label: 'H1', points: 8,
      outcomes: { 'Missing H1': 8, 'Multiple H1 tags': 4 },
      test: (d) => {
        const h1 = d.headings && d.headings.h1;
        if (!Array.isArray(h1)) return NA;
        if (h1.length === 0) return 'Missing H1';
        return h1.length > 1 ? 'Multiple H1 tags' : PASS;
      },
      note: (d) => d.headings.h1.length + ' on page'
    },
    {
      id: 'https', group: 'Tech', label: 'HTTPS', points: 5,
      outcomes: { 'Not served over HTTPS': 5 },
      test: (d) => {
        const p = urlProtocol(d.url);
        if (p !== 'http' && p !== 'https') return NA;
        return p === 'https' ? PASS : 'Not served over HTTPS';
      },
      note: (d) => (urlProtocol(d.url) === 'https' ? 'Yes' : 'http')
    },
    {
      id: 'canonical', group: 'Meta', label: 'Canonical', points: 5,
      outcomes: { 'No canonical URL': 5, 'Conflicting canonical tags': 5 },
      test: (d) => {
        if (!d.meta) return NA;
        if (!d.meta.canonical) return 'No canonical URL';
        return (d.meta.canonicalUrls || []).length > 1 ? 'Conflicting canonical tags' : PASS;
      },
      note: (d) => {
        const m = d.meta;
        if (!m.canonical) return 'Missing';
        if ((m.canonicalUrls || []).length > 1) return m.canonicalUrls.length + ' different URLs';
        if (m.canonicalTarget === 'self') return 'Points to itself';
        if (m.canonicalTarget === 'elsewhere') return 'Points elsewhere';
        return 'Set';
      }
    },
    {
      id: 'words', group: 'Content', label: 'Words', points: 10,
      outcomes: { 'Thin content': 10, 'Light content': 5 },
      test: (d) => {
        const n = d.content && num(d.content.wordCount);
        if (n === null || n === undefined) return NA;
        if (n < 300) return 'Thin content';
        return n < 600 ? 'Light content' : PASS;
      },
      note: (d) => d.content.wordCount.toLocaleString()
    },
    {
      id: 'imageAlt', group: 'Links', label: 'Images without alt', points: 6,
      outcomes: { 'Many images missing alt': 6, 'Some images missing alt': 3 },
      test: (d) => {
        const img = d.images;
        if (!img || !img.total) return NA;
        const missing = (img.missingAlt && img.missingAlt.count) || 0;
        if (missing / img.total > 0.5) return 'Many images missing alt';
        return missing > 0 ? 'Some images missing alt' : PASS;
      },
      note: (d) => ((d.images.missingAlt && d.images.missingAlt.count) || 0) + ' of ' + d.images.total
    },
    {
      id: 'internalLinks', group: 'Links', label: 'Internal links', points: 5,
      outcomes: { 'Few internal links': 5 },
      test: (d) => {
        const n = d.links && d.links.internal && num(d.links.internal.count);
        if (n === null || n === undefined) return NA;
        return n < 3 ? 'Few internal links' : PASS;
      },
      note: (d) => String(d.links.internal.count)
    },
    {
      id: 'structuredData', group: 'Meta', label: 'Structured data', points: 5,
      outcomes: { 'No structured data': 5 },
      test: (d) => (d.meta ? (structuredDataCount(d.meta) > 0 ? PASS : 'No structured data') : NA),
      note: (d) => {
        const sd = d.meta.structuredData;
        if (!sd) return plural(structuredDataCount(d.meta), 'block');
        const parts = [];
        if (sd.jsonLd) parts.push(sd.jsonLd + ' JSON-LD');
        if (sd.microdata) parts.push(sd.microdata + ' Microdata');
        if (sd.rdfa) parts.push(sd.rdfa + ' RDFa');
        return parts.length ? parts.join(' · ') : 'None';
      }
    },
    {
      id: 'viewport', group: 'Tech', label: 'Viewport', points: 4,
      outcomes: { 'Missing viewport': 4 },
      test: (d) => (d.meta && d.meta.viewport !== undefined ? (d.meta.viewport ? PASS : 'Missing viewport') : NA),
      note: (d) => d.meta.viewport || 'Missing'
    },
    {
      id: 'readability', group: 'Content', label: 'Reading level', points: 4,
      outcomes: { 'Hard to read': 4 },
      test: (d) => {
        const r = d.content && d.content.readability;
        if (!r || num(r.fleschKincaid) === null) return NA;
        return r.fleschKincaid > 14 ? 'Hard to read' : PASS;
      },
      note: (d) => d.content.readability.level
    },
    {
      id: 'mixedContent', group: 'Tech', label: 'Mixed content', points: 3,
      outcomes: { 'Mixed content': 3 },
      test: (d) => {
        const mc = d.mixedContent;
        if (!mc || urlProtocol(d.url) !== 'https') return NA;
        return (mc.mixedCount || 0) > 0 ? 'Mixed content' : PASS;
      },
      note: (d) => plural(d.mixedContent.mixedCount || 0, 'http resource')
    },
    {
      id: 'lang', group: 'Content', label: 'Language', points: 2,
      outcomes: { 'No language declared': 2 },
      test: (d) => (d.meta && d.meta.lang !== undefined ? (d.meta.lang ? PASS : 'No language declared') : NA),
      note: (d) => d.meta.lang || 'Missing'
    },
    {
      id: 'duplicates', group: 'Meta', label: 'Duplicate tags', points: 2,
      outcomes: { 'Duplicate tags': 2 },
      test: (d) => {
        const m = d.meta;
        if (!m || !m.title || typeof m.title.count !== 'number') return NA;
        return duplicateTags(m).length ? 'Duplicate tags' : PASS;
      },
      note: (d) => duplicateTags(d.meta).join(', ') || 'None'
    },
    {
      id: 'openGraph', group: 'Meta', label: 'Open Graph', points: 2,
      outcomes: { 'Missing Open Graph': 2 },
      test: (d) => (d.meta ? (d.meta.openGraph && d.meta.openGraph.title ? PASS : 'Missing Open Graph') : NA),
      note: (d) => (d.meta.openGraph && d.meta.openGraph.title ? 'Set' : 'Missing')
    },
    {
      id: 'domSize', group: 'Tech', label: 'DOM nodes', points: 2,
      outcomes: { 'Large DOM': 2 },
      test: (d) => {
        const n = d.technical && num(d.technical.domElements);
        if (n === null || n === undefined) return NA;
        return n > 2000 ? 'Large DOM' : PASS;
      },
      note: (d) => d.technical.domElements.toLocaleString()
    },
    {
      id: 'charset', group: 'Tech', label: 'Charset', points: 2,
      outcomes: { 'Not UTF-8': 2 },
      test: (d) => {
        const c = d.meta && d.meta.charset;
        if (!c) return NA;
        return isUtf8(c.document) && (!c.declared || isUtf8(c.declared)) ? PASS : 'Not UTF-8';
      },
      note: (d) => {
        const c = d.meta.charset;
        if (c.declared && !isUtf8(c.declared)) return c.declared + ' (declared)';
        return c.document || 'Unknown';
      }
    }
  ];

  function isUtf8(label) {
    return /^utf-?8$/i.test(String(label || '').trim());
  }

  function duplicateTags(m) {
    const out = [];
    if ((m.title && m.title.count) > 1) out.push(m.title.count + ' title tags');
    if ((m.description && m.description.count) > 1) out.push(m.description.count + ' meta descriptions');
    if ((m.canonicalCount || 0) > 1) out.push(m.canonicalCount + ' canonical tags');
    return out;
  }

  // What each issue means and what to do, built from the page's own numbers.
  // `tool` is a link the new tab offers (src/lib/sbw-data.js).
  const ISSUES = {
    'Set to noindex': { title: 'Set to noindex', body: (d) => `The ${d.meta.noindexSource || 'robots'} meta tag says noindex, so search engines leave this page out. Remove it if the page should be found.`, tool: 'gsc' },
    'Missing title': { title: 'No title tag', body: () => 'This page has no title. It is the first line of every search result.', tool: 'gsc' },
    'Title too short': { title: 'Title too short', body: (d) => `${charactersOf(d.meta.title)}. Aim for 30 to 60.`, tool: 'gsc' },
    'Title too long': { title: 'Title too long', body: (d) => `${charactersOf(d.meta.title)}. Search results cut off near 60.`, tool: 'gsc' },
    'Missing meta description': { title: 'No meta description', body: () => 'Google writes its own snippet when you leave this out.', tool: 'gsc' },
    'Description too short': { title: 'Description too short', body: (d) => `${charactersOf(d.meta.description)}. Aim for 120 to 160.`, tool: 'gsc' },
    'Description too long': { title: 'Description too long', body: (d) => `${charactersOf(d.meta.description)}. Snippets cut off near 160.`, tool: 'gsc' },
    'Missing H1': { title: 'No H1 heading', body: () => 'Nothing on the page states what it is about at heading level.', tool: null },
    'Multiple H1 tags': { title: 'More than one H1', body: (d) => `${d.headings.h1.length} H1 headings on the page. Use one.`, tool: null },
    'Not served over HTTPS': { title: 'Not served over HTTPS', body: () => 'Browsers mark http pages "Not secure". Serve the page over https and redirect http to it.', tool: null },
    'No canonical URL': { title: 'No canonical tag', body: () => 'Nothing tells Google which URL is the original.', tool: 'gsc' },
    'Conflicting canonical tags': { title: 'Canonical tags disagree', body: (d) => `${(d.meta.canonicalUrls || []).length} canonical tags name different URLs, so Google may ignore them all. Keep one.`, tool: 'gsc' },
    'Thin content': { title: 'Thin content', body: (d) => `${(d.content.wordCount || 0).toLocaleString()} words on the page.`, tool: null },
    'Light content': { title: 'Light content', body: (d) => `${(d.content.wordCount || 0).toLocaleString()} words on the page.`, tool: null },
    'Many images missing alt': { title: 'Images without alt text', body: (d) => altBody(d), tool: null },
    'Some images missing alt': { title: 'Images without alt text', body: (d) => altBody(d), tool: null },
    'Few internal links': { title: 'Few internal links', body: (d) => `${d.links.internal.count} internal links point from this page to the rest of the site.`, tool: null },
    'No structured data': { title: 'No structured data', body: () => 'No JSON-LD, Microdata or RDFa found, so no rich result is possible.', tool: 'rich-results' },
    'Missing viewport': { title: 'No viewport tag', body: () => 'Phones show the desktop layout zoomed out. Add <meta name="viewport" content="width=device-width, initial-scale=1">.', tool: null },
    'Hard to read': { title: 'Hard to read', body: (d) => `Reading level ${d.content.readability.level}, grade ${d.content.readability.fleschKincaid}.`, tool: null },
    'Mixed content': { title: 'Mixed content', body: (d) => `${plural(d.mixedContent.mixedCount, 'resource')} loaded over http on an https page. Browsers block or warn about them.`, tool: null },
    'No language declared': { title: 'No page language', body: () => 'The html tag has no lang attribute. Add one, such as lang="en", so browsers, screen readers and translation know the language.', tool: null },
    'Duplicate tags': { title: 'Tags repeated in the head', body: (d) => `${duplicateTags(d.meta).join(', ')}. Keep one of each: Google picks one, and it may not be yours.`, tool: null },
    'Missing Open Graph': { title: 'No Open Graph tags', body: () => 'Shared links fall back to whatever the platform can guess.', tool: null },
    'Large DOM': { title: 'Large DOM', body: (d) => `${(d.technical.domElements || 0).toLocaleString()} nodes. Heavy pages render slowly.`, tool: 'pagespeed' },
    'Not UTF-8': { title: 'Not UTF-8', body: (d) => `The page's encoding is ${(d.meta.charset.declared && !isUtf8(d.meta.charset.declared)) ? d.meta.charset.declared : d.meta.charset.document}. Use UTF-8 and declare it with <meta charset="utf-8">.`, tool: null }
  };

  function charactersOf(t) {
    const n = t.length || 0;
    const wide = lengthOf(t);
    return plural(n, 'character') + (wide !== n ? ` (${wide} counting each wide character as two)` : '');
  }

  function altBody(d) {
    const img = d.images;
    const decorative = img.decorative ? ` ${plural(img.decorative, 'more has', 'more have')} alt="" and count as decorative.` : '';
    return `${img.missingAlt.count} of ${img.total} images have no alt attribute.${decorative}`;
  }

  const POINTS = {};
  const CHECK_OF_ISSUE = {};
  CHECKS.forEach(function (c) {
    Object.keys(c.outcomes).forEach(function (label) {
      POINTS[label] = c.outcomes[label];
      CHECK_OF_ISSUE[label] = c.id;
    });
  });

  // Every check against one analysis: `checks` in list order, each with its
  // status ('pass' | 'warn' | 'fail' | 'na'), the points it lost and its
  // issue; the score is 100 minus the points lost. Never throws: a check
  // whose facts are missing is 'na'.
  function evaluateChecks(data) {
    const d = data || {};
    const checks = CHECKS.map(function (c) {
      let outcome = NA;
      try { outcome = c.test(d); } catch (e) { outcome = NA; }
      let note = null;
      if (outcome !== NA) { try { note = c.note(d); } catch (e) { note = null; } }
      const lost = outcome ? c.outcomes[outcome] : 0;
      const status = outcome === NA ? 'na' : !outcome ? 'pass' : lost >= c.points ? 'fail' : 'warn';
      return { id: c.id, group: c.group, label: c.label, points: c.points, lost: lost, status: status, issue: outcome || null, note: note };
    });
    const lostTotal = checks.reduce(function (n, c) { return n + c.lost; }, 0);
    const score = Math.max(0, 100 - lostTotal);
    return {
      score: score,
      grade: getGrade(score),
      issues: checks.filter(function (c) { return c.issue; }).map(function (c) { return c.issue; }),
      checks: checks
    };
  }

  // The four sub-scores from the same checks: `v` is the points a group kept
  // out of the points of its checks that apply, `passed`/`of` count those
  // checks (a check passes when it loses nothing).
  function groupChecks(checks) {
    return GROUPS.map(function (k) {
      const own = (checks || []).filter(function (c) { return c.group === k && c.status !== 'na'; });
      const points = own.reduce(function (n, c) { return n + c.points; }, 0);
      const kept = own.reduce(function (n, c) { return n + c.points - c.lost; }, 0);
      return {
        k: k,
        passed: own.filter(function (c) { return c.status === 'pass'; }).length,
        of: own.length,
        points: points,
        kept: kept,
        v: points ? Math.round((kept / points) * 100) : 0
      };
    });
  }

  // `{ title, body, tool, points }` for an issue label, or null.
  function fixFor(issue, data) {
    const spec = Object.prototype.hasOwnProperty.call(ISSUES, issue) ? ISSUES[issue] : null;
    if (!spec) return null;
    let body = '';
    try { body = spec.body(data || {}); } catch (e) { body = ''; }
    return { title: spec.title, body: body, tool: spec.tool, points: POINTS[issue] || 0 };
  }

  function getGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  // The pre-1.10.4 signature, kept for callers that have the parts.
  // `page` carries `url` and `mixedContent`. Returns { score, grade, issues }.
  function calculateSEOScore(content, meta, headings, links, images, technical, page) {
    const p = page || {};
    const r = evaluateChecks({ url: p.url, mixedContent: p.mixedContent, content, meta, headings, links, images, technical });
    return { score: r.score, grade: r.grade, issues: r.issues };
  }

  // ============================================
  // The score's whole path on a Document
  // ============================================

  // doc: the live page or a parsed Document. win: its window, or null for a
  // parsed one. pageUrl: the page's address, for a parsed Document whose own
  // URL is the parser's (DOMParser's is the analyzing page's); else doc.URL.
  // (Its links resolve against its <base>, so give it one.) extraction:
  // SEOBWExtraction (lib/dom-extraction.js). Returns the analysis fields the
  // score reads plus `seoScore`, and the cleaned text the content hash is
  // taken from.
  function analyzeDocument(doc, win, extraction, pageUrl) {
    const ex = extraction;
    const url = pageUrl || doc.URL || (win && win.location && win.location.href) || '';
    let loc = !pageUrl && win && win.location;
    if (!loc) { try { loc = new URL(url); } catch (e) { loc = { hostname: '', href: url }; } }

    const region = ex.extractMainText(doc, function (t) { return getWords(cleanText(t)).length; });
    const text = cleanText(region.text);
    const words = getWords(text);
    const language = detectLanguage(doc.documentElement && doc.documentElement.getAttribute('lang'), text, words);

    const content = {
      title: doc.title,
      wordCount: words.length,
      charCount: text.length,
      sentenceCount: countSentences(text),
      scope: region.scope,
      language: language,
      readability: language.english ? calculateReadability(text, words) : null,
      topWords: getTopWords(words),
      topPhrases: getTopPhrases(words)
    };

    const data = {
      url: url,
      content: content,
      meta: ex.extractMeta(doc, url),
      headings: ex.extractHeadings(doc),
      links: ex.extractLinks(doc, loc),
      images: ex.extractImages(doc),
      technical: ex.extractTechnical(doc, win || { location: loc }),
      mixedContent: ex.extractMixedContent(doc, url)
    };
    data.meta.title.displayLength = displayLength(data.meta.title.text);
    data.meta.description.displayLength = displayLength(data.meta.description.text);
    const r = evaluateChecks(data);
    data.seoScore = { score: r.score, grade: r.grade, issues: r.issues };
    return { data: data, text: text };
  }

  // ============================================
  // Core Web Vitals, to the spec (web.dev/articles/vitals)
  // ============================================

  // LCP: the last largest-contentful-paint entry before the page was first
  // hidden, from activation. Chrome reports none for a page loaded in a
  // background tab, and an entry after the page was hidden is not LCP.
  function lcpFrom(entries, firstHidden, activationStart) {
    const valid = (entries || []).filter(function (e) { return e.startTime < firstHidden; });
    if (!valid.length) return null;
    return Math.max(0, Math.round(valid[valid.length - 1].startTime - (activationStart || 0)));
  }

  // CLS: the largest session window of layout shifts without recent input,
  // a window ending at a 1-second gap or after 5 seconds.
  function clsFrom(entries) {
    let max = 0;
    let current = 0;
    let first = null;
    let last = null;
    (entries || []).filter(function (e) { return !e.hadRecentInput; })
      .sort(function (a, b) { return a.startTime - b.startTime; })
      .forEach(function (e) {
        if (first !== null && e.startTime - last < 1000 && e.startTime - first < 5000) {
          current += e.value;
        } else {
          current = e.value;
          first = e.startTime;
        }
        last = e.startTime;
        if (current > max) max = current;
      });
    return Math.round(max * 10000) / 10000;
  }

  // INP: the longest interaction, ignoring one in every 50 (the 98th
  // percentile), where an interaction is the event entries sharing an
  // interactionId. Null when the visit had no interaction.
  function inpFrom(entries) {
    const byId = {};
    (entries || []).forEach(function (e) {
      if (!e.interactionId) return;
      byId[e.interactionId] = Math.max(byId[e.interactionId] || 0, e.duration || 0);
    });
    const durations = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return b - a; });
    if (!durations.length) return { inp: null, interactions: 0 };
    const at = Math.min(durations.length - 1, Math.floor(durations.length / 50));
    return { inp: Math.round(durations[at]), interactions: durations.length };
  }

  // The first time the page was hidden: the first 'hidden' visibility-state
  // entry, else 0 if it is hidden now with no paint (a background tab),
  // else never. A prerendered page is hidden until it is activated; that
  // doesn't count (as web-vitals has it), so entries at or before
  // activationStart are left out.
  function firstHiddenFrom(visibilityEntries, hiddenNow, painted, activationStart) {
    const act = activationStart || 0;
    const hidden = (visibilityEntries || []).filter(function (e) {
      return e.name === 'hidden' && !(act > 0 && e.startTime <= act);
    }).map(function (e) { return e.startTime; });
    if (hidden.length) return Math.min.apply(null, hidden);
    if (visibilityEntries && visibilityEntries.length) return Infinity;
    return hiddenNow && !painted ? 0 : Infinity;
  }

  // ============================================
  // Top words / phrases / n-grams
  // ============================================

  const DEFAULT_STOP_WORDS = new Set([
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

  function getTopWords(words) {
    const counts = {};
    words.forEach(function (word) {
      // A Han or kana word is often one character; elsewhere, three letters.
      const long = word.length > 2 || (word.length > 1 && UNSPACED.test(word));
      if (long && !DEFAULT_STOP_WORDS.has(word)) {
        counts[word] = (counts[word] || 0) + 1;
      }
    });

    return Object.entries(counts)
      .map(function (entry) { return { word: entry[0], count: entry[1] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 30);
  }

  function getTopPhrases(words) {
    const phrases2 = {};
    const phrases3 = {};
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would']);

    for (let i = 0; i < words.length - 1; i++) {
      if (!stopWords.has(words[i]) || !stopWords.has(words[i + 1])) {
        const p2 = words[i] + ' ' + words[i + 1];
        phrases2[p2] = (phrases2[p2] || 0) + 1;
      }
      if (i < words.length - 2 && (!stopWords.has(words[i]) || !stopWords.has(words[i + 2]))) {
        const p3 = words[i] + ' ' + words[i + 1] + ' ' + words[i + 2];
        phrases3[p3] = (phrases3[p3] || 0) + 1;
      }
    }

    const allPhrases = [].concat(
      Object.entries(phrases2).map(function (entry) { return { phrase: entry[0], count: entry[1] }; }),
      Object.entries(phrases3).map(function (entry) { return { phrase: entry[0], count: entry[1] }; })
    );

    return allPhrases
      .filter(function (p) { return p.count > 1; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 30);
  }

  function buildNgramCounts(words, n, stopWords) {
    const counts = {};
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i + n).join(' ');
      if (n > 1 && stopWords) {
        const parts = gram.split(' ');
        if (parts.every(function (w) { return stopWords.has(w); })) continue;
      }
      counts[gram] = (counts[gram] || 0) + 1;
    }
    return counts;
  }

  function getTopN(counts, n) {
    return Object.entries(counts)
      .filter(function (entry) { return entry[1] >= 2; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, n)
      .map(function (entry) { return { phrase: entry[0], count: entry[1] }; });
  }

  return {
    CHECKS: CHECKS,
    ISSUES: ISSUES,
    POINTS: POINTS,
    CHECK_OF_ISSUE: CHECK_OF_ISSUE,
    GROUPS: GROUPS,
    evaluateChecks: evaluateChecks,
    groupChecks: groupChecks,
    fixFor: fixFor,
    calculateSEOScore: calculateSEOScore,
    analyzeDocument: analyzeDocument,
    getGrade: getGrade,
    cleanText: cleanText,
    getWords: getWords,
    countSentences: countSentences,
    countSyllables: countSyllables,
    calculateReadability: calculateReadability,
    detectLanguage: detectLanguage,
    displayLength: displayLength,
    lcpFrom: lcpFrom,
    clsFrom: clsFrom,
    inpFrom: inpFrom,
    firstHiddenFrom: firstHiddenFrom,
    getTopWords: getTopWords,
    getTopPhrases: getTopPhrases,
    buildNgramCounts: buildNgramCounts,
    getTopN: getTopN,
    DEFAULT_STOP_WORDS: DEFAULT_STOP_WORDS
  };
});
