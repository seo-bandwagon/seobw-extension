// SEO Bandwagon — pure CSV helper
//
// RFC 4180-shaped CSV generation shared by every export button (link
// checker now; hreflang/redirect/structured-data exports later). No DOM or
// chrome dependency — Blob creation and the download click stay in the
// popup UI module that calls this.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWCsv` when loaded as a classic <script>, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWCsv = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const BOM = '﻿';

  // A leading =, +, -, @, TAB or CR is how Excel/Sheets/LibreOffice decide a
  // cell is a formula — a URL or anchor-text column pulled from a web page
  // can contain any of these (e.g. an anchor literally reading
  // "=HYPERLINK(...)"), and pasting/opening the export would execute it.
  // Prefixing a single quote forces text interpretation without changing
  // what the user sees in the spreadsheet.
  const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

  // Quote a cell per RFC 4180: quote when it contains a double quote, comma,
  // CR or LF, doubling any inner quotes; null/undefined become ''. Numbers
  // (status codes, ms timings) are stringified as-is — formula injection is
  // a string-content risk, and a number can never legitimately need the
  // formula-prefix guard.
  function cell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    let s = String(value);
    if (FORMULA_PREFIX_RE.test(s)) {
      s = "'" + s;
    }
    if (/["\r\n,]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // columns: [{ key, label }]. rows: [{ [key]: value }].
  function toCsv(rows, columns) {
    const header = columns.map(c => cell(c.label)).join(',');
    const lines = [header];
    for (const row of rows) {
      lines.push(columns.map(c => cell(row ? row[c.key] : undefined)).join(','));
    }
    return BOM + lines.join('\r\n') + '\r\n';
  }

  // Hostname-less URLs (file://, chrome://newtab-like blanks, or anything
  // that fails to parse) fall back to 'page' rather than leaking a
  // near-empty or 'unknown' filename.
  // #55: host + date alone collided — two pages on one site, or two exports
  // of one page on the same day, got the same name. The path (slugged, up to
  // 40 chars) and the UTC time now go in too:
  // links-www.example.com-blog-post-2026-09-05-120000.csv
  function csvFilename(prefix, url, date, ext) {
    const d = date || new Date();
    let hostname = 'page';
    let slug = '';
    try {
      const u = new URL(url);
      hostname = u.hostname || 'page';
      if (u.hostname) {
        let path = u.pathname;
        try { path = decodeURIComponent(path); } catch (e) { /* malformed escape: slug it as-is */ }
        slug = path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
      }
    } catch (e) {
      hostname = 'page';
    }
    const iso = d.toISOString();
    const stamp = iso.slice(0, 10) + '-' + iso.slice(11, 19).replace(/:/g, '');
    return `${prefix}-${hostname}${slug ? '-' + slug : ''}-${stamp}.${ext || 'csv'}`;
  }

  return {
    toCsv,
    csvFilename
  };
});
