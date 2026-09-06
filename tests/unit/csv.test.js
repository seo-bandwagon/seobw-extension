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
});
