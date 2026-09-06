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

  // Any google.<tld> (and subdomains — accounts.google.com,
  // support.google.com, www.google.co.uk, ...) is an internal Google link,
  // never an organic result. The overlay itself runs on nine Google TLDs
  // (see manifest content_scripts), not just .com, so this generalizes past
  // the ledger's literal "google.com" wording rather than missing internal
  // links on the other eight hosts. Requires a '.' (or start-of-string)
  // immediately before "google" so an unrelated domain like
  // "mygoogle.com" does not false-positive.
  const GOOGLE_HOST_RE = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;

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
    if (GOOGLE_HOST_RE.test(host)) return null;
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  }

  // ============================================
  // Result / PAA extraction
  // ============================================

  function isAd(el) {
    return !!(el && el.closest && el.closest('[data-text-ad], #tads, #bottomads, [aria-label*="Ads" i]'));
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

  // Best-effort snippet: clone the block, strip the link/heading/citation
  // elements that already surface as url/title, and use whatever text is
  // left. Returns undefined (not '') when nothing useful remains, so callers
  // can treat `snippet` as optional per the brief.
  function extractSnippet(block) {
    if (!block || typeof block.cloneNode !== 'function') return undefined;
    const clone = block.cloneNode(true);
    clone.querySelectorAll('a, h3, cite').forEach((n) => n.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text || undefined;
  }

  // DOM-tolerant extraction of organic results from a Google results page
  // root. Candidates are blocks containing an a[href^="http"] with an h3
  // descendant; anything inside an ad container is skipped. Dedupes by URL.
  // Ignores PAA/video/news carousels — see parsePaa() for questions.
  function parseResults(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const rows = [];
    const seenUrls = new Set();
    let position = 0;

    root.querySelectorAll('h3').forEach((h3) => {
      if (isAd(h3)) return;

      let anchor = h3.closest('a[href^="http"]');
      if (!anchor) {
        anchor = h3.querySelector && h3.querySelector('a[href^="http"]');
      }
      let block;
      if (anchor) {
        block = findBlock(anchor);
      } else {
        // h3 and the result link are siblings rather than nested — fall
        // back to the nearest container that also holds a link.
        const container = (h3.closest && h3.closest('div, article, li')) || h3.parentElement;
        anchor = container && container.querySelector && container.querySelector('a[href^="http"]');
        block = container;
      }
      if (!anchor || !block) return;
      if (isAd(anchor) || isAd(block)) return;

      const domain = bareDomain(anchor.href);
      if (!domain) return;
      if (seenUrls.has(anchor.href)) return;
      seenUrls.add(anchor.href);

      position += 1;
      const title = (h3.textContent || '').trim();
      const row = { position, url: anchor.href, domain, title };
      const snippet = extractSnippet(block);
      if (snippet) row.snippet = snippet;
      // Non-enumerable: lets the content script find where to insert the
      // bar (block.insertAdjacentElement/appendChild) without this leaking
      // into resultsToCsv(), clipboard text, or a JSON.stringify/toEqual
      // comparison in tests.
      Object.defineProperty(row, '_el', { value: block, enumerable: false });
      rows.push(row);
    });

    return rows;
  }

  // People-also-ask question blocks: [data-q] carries the literal question
  // text; [jsname][role="button"] falls back to visible text. Dedupes by
  // question text and skips anything inside an ad container.
  function parsePaa(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const out = [];
    const seen = new Set();
    root.querySelectorAll('[data-q], [jsname][role="button"]').forEach((el) => {
      if (isAd(el)) return;
      const q = (el.getAttribute('data-q') || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (q && !seen.has(q)) {
        seen.add(q);
        out.push(q);
      }
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

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    if (FORMULA_PREFIX_RE.test(s)) s = "'" + s;
    if (/["\r\n,]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  const RESULT_CSV_COLUMNS = [
    ['Position', 'position'],
    ['URL', 'url'],
    ['Domain', 'domain'],
    ['Title', 'title']
  ];

  function resultsToCsv(rows) {
    const header = RESULT_CSV_COLUMNS.map((c) => csvCell(c[0])).join(',');
    const lines = [header];
    (rows || []).forEach((row) => {
      lines.push(RESULT_CSV_COLUMNS.map((c) => csvCell(row ? row[c[1]] : '')).join(','));
    });
    return CSV_BOM + lines.join('\r\n') + '\r\n';
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

  // ============================================
  // Search URL builder
  // ============================================

  // Omits empty params. `pws` is a boolean ask — "turn personalization
  // off" — rather than a literal param value: pass `pws: true` to add
  // `pws=0` (matches the toolbar's "Personalization off (pws=0)" checkbox);
  // omit/false leaves Google's default personalization untouched.
  function buildSearchUrl(opts) {
    const o = opts || {};
    const domain = o.domain || 'www.google.com';
    const url = new URL('https://' + domain + '/search');
    if (o.q) url.searchParams.set('q', o.q);
    if (o.gl) url.searchParams.set('gl', o.gl);
    if (o.hl) url.searchParams.set('hl', o.hl);
    if (o.uule) url.searchParams.set('uule', o.uule);
    if (o.pws) url.searchParams.set('pws', '0');
    if (o.num) url.searchParams.set('num', String(o.num));
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

  const PRESET_LOCATIONS = METROS.map(([name, state]) => {
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
    paaToText,
    uule,
    buildSearchUrl,
    PRESET_LOCATIONS
  };
});
