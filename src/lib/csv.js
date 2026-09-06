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

  // Quote a cell per RFC 4180: quote when it contains a double quote, comma,
  // CR or LF, doubling any inner quotes; null/undefined become ''.
  function cell(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
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

  function csvFilename(prefix, url, date) {
    const d = date || new Date();
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      hostname = 'unknown';
    }
    const ymd = d.toISOString().slice(0, 10);
    return `${prefix}-${hostname}-${ymd}.csv`;
  }

  return {
    toCsv,
    csvFilename
  };
});
