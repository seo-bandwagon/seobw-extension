// Unit tests for Search Console compare-mode math (src/lib/gsc-compare.js).
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../src/lib/gsc-compare.js');
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
    expect(cols.metrics).toEqual([{ kind: 'clicks', curIdx: 1, prevIdx: 2, diffIdx: 3 }]);
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
    expect(cols.metrics).toEqual([
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
    expect(cols.metrics).toEqual([{ kind: 'clicks', curIdx: 1, prevIdx: 1, diffIdx: null }]);
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
});

describe('summarize', () => {
  it('sums clicks/impressions and weights CTR and position correctly', () => {
    const rows = [
      {
        label: 'a',
        metrics: {
          clicks: { cur: 100, prev: 80, delta: 20, pct: 25, better: true },
          impressions: { cur: 1000, prev: 800, delta: 200, pct: 25, better: true },
          position: { cur: 5, prev: 6, delta: -1, pct: -16.67, better: true },
        },
      },
      {
        label: 'b',
        metrics: {
          clicks: { cur: 50, prev: 60, delta: -10, pct: -16.67, better: false },
          impressions: { cur: 2000, prev: 2500, delta: -500, pct: -20, better: false },
          position: { cur: 10, prev: 9, delta: 1, pct: 11.11, better: false },
        },
      },
    ];
    const totals = C.summarize(rows);
    expect(totals.count).toBe(2);
    expect(totals.clicks.cur).toBe(150);
    expect(totals.clicks.prev).toBe(140);
    expect(totals.clicks.delta).toBe(10);
    expect(totals.impressions.cur).toBe(3000);
    expect(totals.impressions.prev).toBe(3300);

    // CTR = total clicks / total impressions, both periods.
    expect(totals.ctr.cur).toBeCloseTo((150 / 3000) * 100, 6);
    expect(totals.ctr.prev).toBeCloseTo((140 / 3300) * 100, 6);

    // Position = impressions-weighted average, both periods.
    const expectedPosCur = (5 * 1000 + 10 * 2000) / 3000;
    const expectedPosPrev = (6 * 800 + 9 * 2500) / 3300;
    expect(totals.position.cur).toBeCloseTo(expectedPosCur, 6);
    expect(totals.position.prev).toBeCloseTo(expectedPosPrev, 6);
    // cur (8.33) > prev (8.27) means the average position number rose: worse.
    expect(totals.position.better).toBe(false);
  });

  it('handles an empty row set', () => {
    const totals = C.summarize([]);
    expect(totals.count).toBe(0);
    expect(totals.clicks).toBeUndefined();
  });
});

describe('rankByPct / filterByPct', () => {
  const rows = (kind, values) => values.map((v, i) => ({ label: 'r' + i, metrics: { [kind]: { pct: v } } }));

  it('ranks clicks by raw pct: drop = most negative first, gain = most positive first', () => {
    const set = rows('clicks', [-40, 30, null]);
    expect(C.rankByPct(set, 'clicks', 'drop').map((r) => r.label)).toEqual(['r0', 'r1', 'r2']);
    expect(C.rankByPct(set, 'clicks', 'gain').map((r) => r.label)).toEqual(['r1', 'r0', 'r2']);
  });

  it('inverts direction for position, where a rising number is a drop', () => {
    const set = rows('position', [20, -15]); // r0 got worse (+20%), r1 got better (-15%)
    expect(C.rankByPct(set, 'position', 'drop').map((r) => r.label)).toEqual(['r0', 'r1']);
    expect(C.rankByPct(set, 'position', 'gain').map((r) => r.label)).toEqual(['r1', 'r0']);
  });

  it('does not mutate the input array', () => {
    const set = rows('clicks', [1, 2]);
    const ranked = C.rankByPct(set, 'clicks', 'drop');
    expect(ranked).not.toBe(set);
  });

  it('filters by minDrop/minGain honoring the position inversion', () => {
    const set = rows('clicks', [-40, -10, 30]);
    expect(C.filterByPct(set, 'clicks', { minDrop: 25 }).map((r) => r.label)).toEqual(['r0']);
    expect(C.filterByPct(set, 'clicks', { minGain: 25 }).map((r) => r.label)).toEqual(['r2']);

    const posSet = rows('position', [20, -30]);
    expect(C.filterByPct(posSet, 'position', { minDrop: 15 }).map((r) => r.label)).toEqual(['r0']);
    expect(C.filterByPct(posSet, 'position', { minGain: 15 }).map((r) => r.label)).toEqual(['r1']);
  });
});

describe('toTsv', () => {
  it('emits a header and one row per result, guarding formula-like cells', () => {
    const cols = { labelIdx: 0, metrics: [{ kind: 'clicks', curIdx: 1, prevIdx: 2, diffIdx: 3 }] };
    const rows = [
      { label: '=SUM(A1)', metrics: { clicks: { cur: 1234, prev: 987, delta: 247, pct: 25.03 } } },
      { label: 'plain query', metrics: { clicks: { cur: 500, prev: 1000, delta: -500, pct: -50 } } },
    ];
    const tsv = C.toTsv(rows, cols);
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('Label\tClicks current\tClicks previous\tClicks diff\tClicks % change');
    expect(lines[1].startsWith("'=SUM(A1)")).toBe(true);
    expect(lines[2]).toContain('plain query');
    expect(lines[2]).toContain('-500');
  });

  it('never throws on an empty result set', () => {
    expect(() => C.toTsv([], { labelIdx: 0, metrics: [] })).not.toThrow();
  });
});
