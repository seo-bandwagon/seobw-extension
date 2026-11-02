// SEO Bandwagon — the results table on Google (1.12.0)
//
// The Market Samurai-style table asked for on 2026-10-17 and 2026-10-23:
// one row per result where the panel sits, with what Google shows (position,
// type, the search's words in the title, address and description, the date),
// the figures under each result (src/lib/serp-figures.js) and the page's own
// checks once analyzed (src/lib/page-row.js). Cells are marked against the
// search's median, or against the person's own page when one is pinned;
// columns are chosen in settings and sortable; the export carries the same
// columns. Pure: the overlay draws it.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpTable` when loaded as a content script or classic
// <script>, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpTable = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Words that say nothing about what a search is after.
  const STOP = new Set(('a an and are as at be by for from how in is it near of on or the to what when where who why with ' +
    'vs best top me my your').split(' '));

  /** The search's words: lower case, letters and digits, no stop words. */
  function queryTerms(query) {
    const words = String(query || '').toLowerCase().replace(/\+/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const out = [];
    words.forEach((w) => { if (w.length > 1 && !STOP.has(w) && !out.includes(w)) out.push(w); });
    return out;
  }

  /** How many of `terms` `text` holds, as words or inside an address. */
  function termsIn(text, terms, loose) {
    if (!terms.length) return null;
    const t = String(text || '').toLowerCase();
    const words = new Set(t.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    const hit = terms.filter((term) => (loose ? t.includes(term) : words.has(term))).length;
    return { hit, total: terms.length };
  }

  function ageYears(age) {
    const m = /^(\d+)y(?:\s+(\d+)m)?/.exec(String(age || ''));
    return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0) : null;
  }

  function fig(block, field) {
    return (rec) => {
      const b = rec.figures && rec.figures[block];
      const v = b ? b[field] : null;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
  }

  const compact = (n) => (globalThis.SBWSerpFigures ? globalThis.SBWSerpFigures.compact(n) : String(n));

  // `value(rec)` is what sorts and compares (a number or null); `text(rec)`
  // what shows; `better` says which way is good for the marks ('high', or
  // null for no good or bad). `source` names where a figure comes from.
  const COLUMNS = [
    { key: 'pos', label: '#', title: 'Organic position on this page', value: (r) => r.row.position, better: null },
    { key: 'overall', label: 'On page', title: 'Position counting everything on the page (ads, AI Overview, People also ask, maps…)', value: (r) => r.row.pagePosition || null, better: null },
    { key: 'result', label: 'Result', title: 'Title and address', value: () => null, text: (r) => r.row.title || r.row.domain || 'unknown site', better: null, wide: true },
    { key: 'type', label: 'Type', title: 'Web, video, forum, social or PDF', value: () => null, text: (r) => r.row.type || '', better: null },
    { key: 'inTitle', label: 'In title', title: "The search's words in the result's title", value: (r) => ratio(r.words.title), text: (r) => frac(r.words.title), better: 'high' },
    { key: 'inUrl', label: 'In URL', title: "The search's words in the result's address", value: (r) => ratio(r.words.url), text: (r) => frac(r.words.url), better: 'high' },
    { key: 'inDesc', label: 'In description', title: "The search's words in the description Google shows", value: (r) => ratio(r.words.desc), text: (r) => frac(r.words.desc), better: 'high' },
    { key: 'titleLen', label: 'Title', title: "The page's title in characters, and its width in Google's 600 px when analyzed", value: (r) => (r.check && r.check.title ? r.check.title.chars : Array.from(r.row.title || '').length || null), text: (r) => titleText(r), better: null },
    { key: 'date', label: 'Date', title: 'The date Google shows', value: () => null, text: (r) => r.row.date || '', better: null },
    { key: 'pageRD', label: 'Page ref. domains', source: 'DataForSEO', value: fig('page', 'referringDomains'), better: 'high' },
    { key: 'pageBL', label: 'Page backlinks', source: 'DataForSEO', value: fig('page', 'backlinks'), better: 'high' },
    { key: 'pageRank', label: 'Page rank', source: 'DataForSEO', title: 'Page rank, on DataForSEO’s 0 to 100 scale', value: fig('page', 'rank'), better: 'high' },
    { key: 'pageTraffic', label: 'Page traffic', source: 'DataForSEO', title: 'Estimated organic visits a month to the page', value: fig('page', 'etv'), better: 'high' },
    { key: 'pageKW', label: 'Page keywords', source: 'DataForSEO', value: fig('page', 'keywords'), better: 'high' },
    { key: 'siteRank', label: 'Site rank', source: 'DataForSEO', title: 'Site rank, on DataForSEO’s 0 to 100 scale', value: fig('domain', 'rank'), better: 'high' },
    { key: 'siteRD', label: 'Site ref. domains', source: 'DataForSEO', value: fig('domain', 'referringDomains'), better: 'high' },
    { key: 'siteTraffic', label: 'Site traffic', source: 'DataForSEO', title: 'Estimated organic visits a month to the site', value: fig('domain', 'etv'), better: 'high' },
    { key: 'siteKW', label: 'Site keywords', source: 'DataForSEO', value: fig('domain', 'keywords'), better: 'high' },
    { key: 'age', label: 'Domain age', source: 'RDAP', value: (r) => ageYears(r.figures && r.figures.whois && r.figures.whois.age), text: (r) => (r.figures && r.figures.whois && r.figures.whois.age) || '', better: 'high' },
    { key: 'words', label: 'Words', title: "Words on the page, from its HTML", value: (r) => (r.check && typeof r.check.words === 'number' ? r.check.words : null), better: null },
    { key: 'schema', label: 'Schema', title: 'Structured-data types on the page', value: (r) => (r.check ? r.check.schema.length : null), text: (r) => (r.check ? r.check.schema.join(', ') || 'none' : ''), better: null },
    { key: 'checklist', label: 'Checklist', title: "SEO Bandwagon's on-page checklist for the page, from its HTML. Not a ranking factor", value: (r) => (r.check && r.check.checklist ? r.check.checklist.score : (r.figures && r.figures.checklist ? r.figures.checklist.score : null)), better: 'high' }
  ];

  function ratio(w) { return w ? w.hit / w.total : null; }
  function frac(w) { return w ? `${w.hit}/${w.total}` : ''; }
  function titleText(r) {
    if (r.check && r.check.title) return `${r.check.title.chars}${typeof r.check.title.px === 'number' ? ` · ${r.check.title.px}px` : ''}`;
    const n = Array.from(r.row.title || '').length;
    return n ? String(n) : '';
  }

  function columnsChosen(choice) {
    const c = choice || {};
    return COLUMNS.filter((col) => c[col.key] !== false);
  }

  /**
   * One table record per result: `{ key, row, figures, check, words }`.
   * `rows` are the parser's; `figuresOf(key)` and `checkOf(key)` the
   * overlay's maps.
   */
  function records(rows, query, figuresOf, checkOf) {
    const terms = queryTerms(query);
    return (rows || []).map((row) => {
      const key = row._key || row.url;
      const urlText = row.url ? decodeURIComponentSafe(row.url) : '';
      return {
        key,
        row,
        figures: (figuresOf && figuresOf(key)) || null,
        check: (checkOf && checkOf(key)) || null,
        words: {
          title: termsIn(row.title, terms),
          url: urlText ? termsIn(urlText, terms, true) : null,
          desc: termsIn(row.snippet, terms)
        }
      };
    });
  }

  function decodeURIComponentSafe(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function median(values) {
    const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /** The value each column is marked against: the median, or the pinned record's. */
  function baselines(recs, pinned) {
    const out = {};
    COLUMNS.forEach((col) => {
      out[col.key] = pinned ? col.value(pinned) : median(recs.map((r) => col.value(r)));
    });
    return out;
  }

  /** 'above', 'below', 'same', or null when either side is unknown. */
  function mark(value, base) {
    if (typeof value !== 'number' || typeof base !== 'number') return null;
    const eps = Math.max(Math.abs(base) * 0.001, 1e-9);
    if (Math.abs(value - base) <= eps) return 'same';
    return value > base ? 'above' : 'below';
  }

  /** The text a cell shows. */
  function cellText(col, rec) {
    if (col.text) return col.text(rec);
    const v = col.value(rec);
    if (v === null || v === undefined) return '';
    if (col.key === 'pageRank' || col.key === 'siteRank' || col.key === 'pos' || col.key === 'overall' || col.key === 'checklist') return String(Math.round(v));
    return compact(v);
  }

  /** Sorted copy; unknown values last whichever way. */
  function sortRecords(recs, key, dir) {
    const col = COLUMNS.find((c) => c.key === key);
    if (!col) return recs.slice();
    const sign = dir === 'desc' ? -1 : 1;
    const textOf = (r) => String(col.text ? col.text(r) : '').toLowerCase();
    return recs.slice().sort((a, b) => {
      let va = col.value(a);
      let vb = col.value(b);
      if (va === null && col.text) { va = textOf(a) || null; vb = textOf(b) || null; }
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'string' || typeof vb === 'string') return sign * String(va).localeCompare(String(vb));
      return sign * (va - vb);
    });
  }

  const FORMULA_RE = /^[=+\-@\t\r]/;
  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (FORMULA_RE.test(s)) s = "'" + s;
    return /["\r\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function header(col) {
    return col.source ? `${col.label} (${col.source})` : col.label;
  }

  /**
   * The table as a CSV: the search, then the chosen columns in order (the
   * Result column as its title and its URL), numbers as numbers.
   */
  function toCsv(recs, choice, ctx) {
    const cols = columnsChosen(choice);
    const head = ['Query'];
    cols.forEach((c) => { if (c.key === 'result') head.push('Title', 'URL'); else head.push(header(c)); });
    const lines = [head.map(csvCell).join(',')];
    (recs || []).forEach((r) => {
      const cells = [ctx && ctx.query];
      cols.forEach((c) => {
        if (c.key === 'result') { cells.push(r.row.title || '', r.row.url || ''); return; }
        const v = c.value(r);
        cells.push(c.text ? c.text(r) : (v === null ? '' : (Number.isInteger(v) ? v : Math.round(v * 100) / 100)));
      });
      lines.push(cells.map(csvCell).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  return { COLUMNS, STOP, queryTerms, termsIn, ageYears, columnsChosen, records, median, baselines, mark, cellText, sortRecords, toCsv, header };
});
