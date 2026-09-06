// Unit tests for Search Console compare-mode math (src/lib/gsc-compare.js).
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../extension/src/lib/gsc-compare.js');
const C = globalThis.SBWGscCompare;

describe('parseMetric', () => {
  it('parses plain integers with thousands separators', () => {
    expect(C.parseMetric('1,234')).toBe(1234);
  });
  it('parses K/M/B suffixes', () => {
    expect(C.parseMetric('1.2K')).toBeCloseTo(1200);
    expect(C.parseMetric('3.4M')).toBeCloseTo(3400000);
    expect(C.parseMetric('2.1B')).toBeCloseTo(2100000000);
  });
  it('parses percentages', () => {
    expect(C.parseMetric('12.5%')).toBeCloseTo(12.5);
  });
  it('parses the "<0.1%" GSC placeholder as half the threshold', () => {
    expect(C.parseMetric('<0.1%')).toBeCloseTo(0.05);
  });
  it('treats dash/empty placeholders as null', () => {
    expect(C.parseMetric('—')).toBeNull();
    expect(C.parseMetric('-')).toBeNull();
    expect(C.parseMetric('')).toBeNull();
    expect(C.parseMetric('   ')).toBeNull();
    expect(C.parseMetric(null)).toBeNull();
    expect(C.parseMetric(undefined)).toBeNull();
  });
  it('tolerates locale thousand-space separators', () => {
    expect(C.parseMetric('1 234')).toBe(1234);
  });
  it('tolerates leading/trailing text', () => {
    expect(C.parseMetric('Clicks: 1,234')).toBe(1234);
    expect(C.parseMetric('1,234 clicks')).toBe(1234);
  });
  it('never throws on garbage input', () => {
    expect(() => C.parseMetric({})).not.toThrow();
    expect(() => C.parseMetric([1, 2, 3])).not.toThrow();
    expect(C.parseMetric('not a number')).toBeNull();
  });

  // fix-1 item 2 (CRITICAL): the K/M/B/% suffix must not swallow the first
  // letter of a following word ("3 months" is not "3 M"). A case-insensitive
  // suffix match with no boundary treated the "m" in "months" as mega.
  it('does not mistake the leading letter of a following word for a suffix', () => {
    expect(C.parseMetric('Last 3 months')).toBe(3);
    expect(C.parseMetric('Previous 3 months')).toBe(3);
    expect(C.parseMetric('2 billion dollars')).toBe(2); // "b" of "billion" is not B
  });

  // fix-1 item 7 (MINOR): the typographic minus sign U+2212, which GSC can
  // render in a Difference column, must parse the same as an ASCII hyphen.
  it('parses the U+2212 minus sign as a negative sign', () => {
    expect(C.parseMetric('−500')).toBe(-500);
    expect(C.parseMetric('−')).toBeNull(); // lone minus is a placeholder, not zero
  });
});

describe('metricKind', () => {
  it('recognises the four metric kinds, case-insensitively', () => {
    expect(C.metricKind('Clicks')).toBe('clicks');
    expect(C.metricKind('total clicks')).toBe('clicks');
    expect(C.metricKind('Impressions')).toBe('impressions');
    expect(C.metricKind('CTR')).toBe('ctr');
    expect(C.metricKind('Average CTR')).toBe('ctr');
    expect(C.metricKind('Position')).toBe('position');
    expect(C.metricKind('Average position')).toBe('position');
  });
  it('tolerates a trailing date range in parentheses', () => {
    expect(C.metricKind('Clicks (Last 3 months)')).toBe('clicks');
    expect(C.metricKind('Impressions (Previous 3 months)')).toBe('impressions');
  });
  it('tolerates a trailing date range with no parentheses', () => {
    expect(C.metricKind('Clicks Last 3 months')).toBe('clicks');
    expect(C.metricKind('Clicks Previous 3 months')).toBe('clicks');
  });
  it('returns null for non-metric headers', () => {
    expect(C.metricKind('Top queries')).toBeNull();
    expect(C.metricKind('Difference')).toBeNull();
    expect(C.metricKind('')).toBeNull();
    expect(C.metricKind(null)).toBeNull();
  });
});

describe('pctChange', () => {
  it('computes standard percent change', () => {
    expect(C.pctChange(1230, 1000)).toBeCloseTo(23);
    expect(C.pctChange(500, 1000)).toBeCloseTo(-50);
  });
  it('is null when prev is 0 and cur is not', () => {
    expect(C.pctChange(5, 0)).toBeNull();
  });
  it('is 0 when both cur and prev are 0', () => {
    expect(C.pctChange(0, 0)).toBe(0);
  });
  it('is null when either side is null', () => {
    expect(C.pctChange(null, 10)).toBeNull();
    expect(C.pctChange(10, null)).toBeNull();
  });
});

describe('delta', () => {
  it('subtracts prev from cur', () => {
    expect(C.delta(1230, 1000)).toBe(230);
    expect(C.delta(500, 1000)).toBe(-500);
  });
  it('propagates null', () => {
    expect(C.delta(null, 1)).toBeNull();
    expect(C.delta(1, null)).toBeNull();
  });
});

describe('isBetter', () => {
  it('treats lower as better for position', () => {
    expect(C.isBetter('position', 6.2, 8.3)).toBe(true);
    expect(C.isBetter('position', 9.7, 8.3)).toBe(false);
  });
  it('treats higher as better for clicks/impressions/ctr', () => {
    expect(C.isBetter('clicks', 1230, 1000)).toBe(true);
    expect(C.isBetter('impressions', 500, 1000)).toBe(false);
    expect(C.isBetter('ctr', 4.8, 4.0)).toBe(true);
  });
  it('is null when values are equal', () => {
    expect(C.isBetter('clicks', 500, 500)).toBeNull();
    expect(C.isBetter('position', 8, 8)).toBeNull();
  });
});

describe('formatDelta', () => {
  it('formats clicks/impressions with an integer delta and a percent', () => {
    const { arrow, text } = C.formatDelta('clicks', 1230, 1000);
    expect(arrow).toBe('▲');
    expect(text).toBe('▲ +230 (+23%)');
  });
  it('formats a decline without a leading plus', () => {
    const { arrow, text } = C.formatDelta('impressions', 500, 1000);
    expect(arrow).toBe('▼');
    expect(text).toContain('-500');
    expect(text).toContain('-50%');
  });
  it('formats CTR deltas in percentage points', () => {
    const { arrow, text } = C.formatDelta('ctr', 4.8, 4.0);
    expect(arrow).toBe('▲');
    expect(text).toBe('▲ +0.8 pp (+20%)');
  });
  it('formats position with better/worse instead of a percent', () => {
    const better = C.formatDelta('position', 6.2, 8.3);
    expect(better.arrow).toBe('▼');
    expect(better.text).toBe('▼ 2.1 (better)');
    const worse = C.formatDelta('position', 9.7, 8.3);
    expect(worse.arrow).toBe('▲');
    expect(worse.text).toBe('▲ 1.4 (worse)');
  });
  it('formats no change as a bullet zero for any kind', () => {
    expect(C.formatDelta('clicks', 500, 500)).toEqual({ arrow: '•', text: '• 0' });
    expect(C.formatDelta('position', 8, 8)).toEqual({ arrow: '•', text: '• 0' });
  });
});

describe('splitPair', () => {
  it('splits a cell with two numbers on a line break', () => {
    expect(C.splitPair('1,234\n987')).toEqual({ cur: 1234, prev: 987 });
  });
  it('splits a cell with two numbers separated by run of whitespace', () => {
    expect(C.splitPair('1,234    987')).toEqual({ cur: 1234, prev: 987 });
  });
  it('returns null when there are not two parsable numbers', () => {
    expect(C.splitPair('1,234')).toBeNull();
    expect(C.splitPair('')).toBeNull();
  });

  // fix-1 item 6 (IMPORTANT): a single value with a parenthesised percentage
  // annotation ("1,234 (5%)") is not a cur/prev pair -- the second "part"
  // carries letters/brackets, not a second bare number.
  it('rejects a part that is a parenthesised percentage annotation', () => {
    expect(C.splitPair('1,234 (5%)')).toBeNull();
  });
  it('rejects parts containing letters', () => {
    expect(C.splitPair('1,234 clicks')).toBeNull();
  });
});

// ---- detectCompareColumns fixtures --------------------------------------
// These fixture tables model GSC's known compare-mode layouts and, per the
// task brief, are the contract for this feature (no live GSC DOM available).

function tableFromHtml(html) {
  document.body.innerHTML = html;
  return document.body.querySelector('table');
}

describe('detectCompareColumns', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('detects a metric pair with an explicit Difference column', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Top queries</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th><th>Difference</th></tr></thead>
        <tbody>
          <tr><td>roofing repair denver</td><td>1,234</td><td>987</td><td>+247</td></tr>
          <tr><td>plumber tacoma</td><td>500</td><td>1,000</td><td>-500</td></tr>
          <tr><td>dexa scan reno</td><td>0</td><td>0</td><td>0</td></tr>
        </tbody>
      </table>`);
    const cols = C.detectCompareColumns(table);
    expect(cols).not.toBeNull();
    expect(cols.labelIdx).toBe(0);
    expect(cols.metrics).toMatchObject([{ kind: 'clicks', curIdx: 1, prevIdx: 2, diffIdx: 3 }]);
  });

  it('detects metric pairs with no Difference column at all', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr>
          <th>Top queries</th>
          <th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th>
          <th>Impressions Last 3 months</th><th>Impressions Previous 3 months</th>
        </tr></thead>
        <tbody>
          <tr><td>a</td><td>2,000</td><td>1,500</td><td>50,000</td><td>60,000</td></tr>
          <tr><td>b</td><td>300</td><td>300</td><td>1,000</td><td>0</td></tr>
        </tbody>
      </table>`);
    const cols = C.detectCompareColumns(table);
    expect(cols).not.toBeNull();
    expect(cols.labelIdx).toBe(0);
    expect(cols.metrics).toMatchObject([
      { kind: 'clicks', curIdx: 1, prevIdx: 2, diffIdx: null },
      { kind: 'impressions', curIdx: 3, prevIdx: 4, diffIdx: null },
    ]);
  });

  it('falls back to a single combined header when body cells carry two numbers', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Query</th><th>Clicks</th></tr></thead>
        <tbody>
          <tr><td>a</td><td>1,234
987</td></tr>
          <tr><td>b</td><td>80
80</td></tr>
        </tbody>
      </table>`);
    const cols = C.detectCompareColumns(table);
    expect(cols).not.toBeNull();
    expect(cols.labelIdx).toBe(0);
    expect(cols.metrics).toMatchObject([{ kind: 'clicks', curIdx: 1, prevIdx: 1, diffIdx: null }]);
  });

  it('returns null for an ordinary, non-compare table', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Query</th><th>Clicks</th><th>Impressions</th></tr></thead>
        <tbody>
          <tr><td>a</td><td>1,234</td><td>9,876</td></tr>
          <tr><td>b</td><td>50</td><td>600</td></tr>
        </tbody>
      </table>`);
    expect(C.detectCompareColumns(table)).toBeNull();
  });

  it('returns null when there is no table', () => {
    expect(C.detectCompareColumns(null)).toBeNull();
  });

  // fix-1 item 5 (IMPORTANT): pairing must key off the word "previous" in the
  // header text, not encounter order -- GSC (or a differently-localised
  // build) may render the previous-period column first.
  it('identifies prevIdx by header text, not position, when headers are reversed', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Top queries</th><th>Clicks Previous 3 months</th><th>Clicks Last 3 months</th></tr></thead>
        <tbody>
          <tr><td>roofing repair denver</td><td>987</td><td>1,234</td></tr>
        </tbody>
      </table>`);
    const cols = C.detectCompareColumns(table);
    expect(cols).not.toBeNull();
    expect(cols.metrics).toMatchObject([{ kind: 'clicks', curIdx: 2, prevIdx: 1, diffIdx: null }]);
  });

  // fix-1 item 6 (IMPORTANT): the single-header/two-numbers fallback must not
  // fire off a value that merely carries a percentage annotation in the same
  // cell -- that is one number with commentary, not a cur/prev pair, and it
  // must hold across a MAJORITY of rows, not just one.
  it('does not treat a value+percentage-annotation column as compare mode', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Query</th><th>Clicks</th></tr></thead>
        <tbody>
          <tr><td>a</td><td>1,234 (5%)</td></tr>
          <tr><td>b</td><td>500 (2%)</td></tr>
          <tr><td>c</td><td>10 (1%)</td></tr>
        </tbody>
      </table>`);
    expect(C.detectCompareColumns(table)).toBeNull();
  });

  it('requires the two-number fallback to hold on a majority of rows', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Query</th><th>Clicks</th></tr></thead>
        <tbody>
          <tr><td>a</td><td>1,234
987</td></tr>
          <tr><td>b</td><td>500</td></tr>
          <tr><td>c</td><td>10</td></tr>
        </tbody>
      </table>`);
    // Only 1 of 3 rows carries a pair -- not a majority, so this is an
    // ordinary table, not compare mode.
    expect(C.detectCompareColumns(table)).toBeNull();
  });
});

describe('computeRow', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads label and per-metric cur/prev/delta/pct/better from a row', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Query</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th><th>Difference</th></tr></thead>
        <tbody><tr><td>roofing repair denver</td><td>1,234</td><td>987</td><td>+247</td></tr></tbody>
      </table>`);
    const cols = C.detectCompareColumns(table);
    const tr = table.querySelector('tbody tr');
    const row = C.computeRow(tr, cols);
    expect(row.label).toBe('roofing repair denver');
    expect(row.metrics.clicks.cur).toBe(1234);
    expect(row.metrics.clicks.prev).toBe(987);
    expect(row.metrics.clicks.delta).toBe(247);
    expect(row.metrics.clicks.pct).toBeCloseTo((247 / 987) * 100, 6);
    expect(row.metrics.clicks.better).toBe(true);
  });

  it('reads cur/prev out of a combined single-header cell via splitPair', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Query</th><th>Clicks</th></tr></thead>
        <tbody><tr><td>a</td><td>1,234
987</td></tr></tbody>
      </table>`);
    const cols = C.detectCompareColumns(table);
    const tr = table.querySelector('tbody tr');
    const row = C.computeRow(tr, cols);
    expect(row.metrics.clicks).toMatchObject({ cur: 1234, prev: 987, delta: 247 });
  });

  // fix-1 item 9 (MINOR): the label's [title] path skipped the whitespace
  // collapse the plain-textContent path already did, so a title with an
  // embedded newline or run of spaces leaked straight into the TSV export.
  it('collapses whitespace in a [title]-sourced label the same as the textContent path', () => {
    const table = tableFromHtml(`
      <table>
        <thead><tr><th>Query</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th></tr></thead>
        <tbody><tr><td><span title="roofing   repair\ndenver">roofing…</span></td><td>1,234</td><td>987</td></tr></tbody>
      </table>`);
    const cols = C.detectCompareColumns(table);
    const tr = table.querySelector('tbody tr');
    const row = C.computeRow(tr, cols);
    expect(row.label).toBe('roofing repair denver');
  });
});
