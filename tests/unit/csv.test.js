// Unit tests for the pure CSV helper (src/lib/csv.js).
// Covers: header row from column labels, RFC 4180 quoting, CRLF line
// endings, null/undefined -> empty cell, UTF-8 BOM prefix, and filename
// building from a URL's hostname + date.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWCsv` rather than an ESM default export.
await import('../../src/lib/csv.js');
const SBWCsv = globalThis.SBWCsv;

describe('SBWCsv namespace', () => {
  it('attaches to globalThis.SBWCsv', () => {
    expect(SBWCsv).toBeTruthy();
    expect(typeof SBWCsv.toCsv).toBe('function');
    expect(typeof SBWCsv.csvFilename).toBe('function');
  });
});

const BOM = '﻿';

describe('toCsv', () => {
  const columns = [
    { key: 'url', label: 'URL' },
    { key: 'status', label: 'Status' }
  ];

  it('prefixes a UTF-8 BOM', () => {
    const csv = SBWCsv.toCsv([], columns);
    expect(csv.startsWith(BOM)).toBe(true);
  });

  it('writes the header row from column labels', () => {
    const csv = SBWCsv.toCsv([], columns);
    expect(csv).toBe(BOM + 'URL,Status\r\n');
  });

  it('writes one row per data object, in column order', () => {
    const rows = [
      { url: 'https://a.example/', status: 200 },
      { url: 'https://b.example/', status: 404 }
    ];
    const csv = SBWCsv.toCsv(rows, columns);
    expect(csv).toBe(BOM + 'URL,Status\r\n' + 'https://a.example/,200\r\n' + 'https://b.example/,404\r\n');
  });

  it('uses CRLF line endings throughout', () => {
    const csv = SBWCsv.toCsv([{ url: 'x', status: 1 }], columns);
    expect(csv.split('\r\n').length).toBeGreaterThan(1);
    expect(csv.includes('\n') && !csv.includes('\r\n')).toBe(false);
    // every bare \n is preceded by \r
    expect(csv.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('maps null/undefined cells to empty strings', () => {
    const csv = SBWCsv.toCsv([{ url: null, status: undefined }], columns);
    expect(csv).toBe(BOM + 'URL,Status\r\n' + ',\r\n');
  });

  it('quotes a cell containing a comma', () => {
    const csv = SBWCsv.toCsv([{ url: 'a,b', status: 'ok' }], columns);
    expect(csv).toContain('"a,b",ok');
  });

  it('quotes a cell containing a double quote and doubles the inner quote', () => {
    const csv = SBWCsv.toCsv([{ url: 'say "hi"', status: 'ok' }], columns);
    expect(csv).toContain('"say ""hi""",ok');
  });

  it('quotes a cell containing a CR or LF', () => {
    const withLf = SBWCsv.toCsv([{ url: 'line1\nline2', status: 'ok' }], columns);
    expect(withLf).toContain('"line1\nline2",ok');

    const withCr = SBWCsv.toCsv([{ url: 'line1\rline2', status: 'ok' }], columns);
    expect(withCr).toContain('"line1\rline2",ok');
  });

  it('does not quote a plain cell', () => {
    const csv = SBWCsv.toCsv([{ url: 'plain', status: 'ok' }], columns);
    expect(csv).toContain('plain,ok');
    expect(csv).not.toContain('"plain"');
  });

  it('handles an empty rows array (header only)', () => {
    const csv = SBWCsv.toCsv([], columns);
    expect(csv).toBe(BOM + 'URL,Status\r\n');
  });
});

// Formula-injection guard (task-1-fix-1-brief item 2): a string cell
// starting with =, +, -, @, TAB or CR is how Excel/Sheets/LibreOffice
// recognize a formula. An anchor-text or URL column pulled from a web page
// can contain any of these; prefixing a leading single quote forces text
// interpretation instead of execution.
describe('toCsv — formula injection guard', () => {
  const cols = [{ key: 'anchor', label: 'Anchor Text' }, { key: 'status', label: 'Status' }];

  it('prefixes a cell starting with = with a single quote', () => {
    const csv = SBWCsv.toCsv([{ anchor: '=HYPERLINK("https://evil.example","click")', status: 200 }], cols);
    expect(csv).toContain('"\'=HYPERLINK(""https://evil.example"",""click"")",200');
  });

  it('prefixes a cell starting with +', () => {
    const csv = SBWCsv.toCsv([{ anchor: '+1', status: 200 }], cols);
    expect(csv).toContain("'+1,200");
  });

  it('prefixes a cell starting with -', () => {
    const csv = SBWCsv.toCsv([{ anchor: '-x', status: 200 }], cols);
    expect(csv).toContain("'-x,200");
  });

  it('prefixes a cell starting with @', () => {
    const csv = SBWCsv.toCsv([{ anchor: '@cmd', status: 200 }], cols);
    expect(csv).toContain("'@cmd,200");
  });

  it('prefixes a cell starting with a leading TAB', () => {
    const csv = SBWCsv.toCsv([{ anchor: '\tsneaky', status: 200 }], cols);
    expect(csv).toContain("'\tsneaky,200");
  });

  it('leaves a numeric status cell untouched even if it were negative', () => {
    const csv = SBWCsv.toCsv([{ anchor: 'Home', status: -1 }], cols);
    expect(csv).toContain('Home,-1');
    expect(csv).not.toContain("'-1");
  });

  it('does not prefix a plain cell that merely contains one of the trigger characters mid-string', () => {
    const csv = SBWCsv.toCsv([{ anchor: 'a-b+c=d', status: 200 }], cols);
    expect(csv).toContain('a-b+c=d,200');
  });
});

describe('csvFilename', () => {
  it('builds prefix-hostname-date.csv', () => {
    const d = new Date('2026-09-05T12:00:00Z');
    const name = SBWCsv.csvFilename('links', 'https://www.example.com/page', d);
    expect(name).toBe('links-www.example.com-2026-09-05.csv');
  });

  it('defaults the date to now when omitted', () => {
    const name = SBWCsv.csvFilename('links', 'https://example.com/');
    expect(name).toMatch(/^links-example\.com-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('falls back to "page" for a file:// URL (empty hostname)', () => {
    const d = new Date('2026-09-05T12:00:00Z');
    const name = SBWCsv.csvFilename('links', 'file:///Users/dana/report.html', d);
    expect(name).toBe('links-page-2026-09-05.csv');
  });

  it('falls back to "page" when the URL fails to parse', () => {
    const d = new Date('2026-09-05T12:00:00Z');
    const name = SBWCsv.csvFilename('links', 'not a url at all', d);
    expect(name).toBe('links-page-2026-09-05.csv');
  });
});
