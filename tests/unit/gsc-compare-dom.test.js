// DOM-layer tests for Search Console compare-mode injection (section B of
// src/lib/gsc-compare.js). The surface is deliberately minimal (owner ruling
// 2026-09-06): a badge on each metric card and a small percent badge INSIDE
// Google's own Difference cell per row. No columns, toolbar, sorted copies,
// filters, TSV or summary line.
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../extension/src/lib/gsc-compare.js');
const C = globalThis.SBWGscCompare;

function buildReport() {
  document.body.innerHTML = `
    <div id="cards">
      <div role="button">Total clicks<div>1,230</div><div>vs</div><div>1,000</div></div>
      <div role="button">Average position<div>6.2</div><div>vs</div><div>8.3</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Top queries</th>
        <th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th><th>Difference</th>
      </tr></thead>
      <tbody>
        <tr><td>roofing repair denver</td><td>1,230</td><td>1,000</td><td>+230</td></tr>
        <tr><td>plumber tacoma</td><td>500</td><td>1,000</td><td>-500</td></tr>
        <tr><td>dexa scan reno</td><td>500</td><td>500</td><td>0</td></tr>
      </tbody>
    </table>`;
  return document.body;
}

// Live Search Console layout reconstructed from the 2026-09-06 reports:
// extra leading header cell, three columns per metric with two-line headers,
// deselected Clicks columns kept as display:none, hover-action labels as
// plain text inside the label cell.
function buildLiveReport() {
  const h = (metric, period, hidden) =>
    `<th${hidden ? ' style="display:none"' : ''}><div><div>${metric}</div><div>${period}</div></div></th>`;
  const label = (text) =>
    `<td><span>${text}</span><span class="tip">Copy URL to clipboard</span><span class="tip">Open in new tab</span><span class="tip">Inspect URL</span></td>`;
  const cells = (arr, hiddenFrom, hiddenTo) =>
    arr.map((v, i) => `<td${i >= hiddenFrom && i < hiddenTo ? ' style="display:none"' : ''}>${v}</td>`).join('');
  document.body.innerHTML = `
    <table>
      <thead><tr>
        <th></th>
        <th><div>Top queries</div></th>
        ${h('Clicks', 'Last 7 days', true)}${h('Clicks', 'Previous 7 days', true)}${h('Clicks', 'Difference', true)}
        ${h('Impressions', 'Last 7 days')}${h('Impressions', 'Previous 7 days')}${h('Impressions', 'Difference')}
        ${h('CTR', 'Last 7 days')}${h('CTR', 'Previous 7 days')}${h('CTR', 'Difference')}
        ${h('Position', 'Last 7 days')}${h('Position', 'Previous 7 days')}${h('Position', 'Difference')}
      </tr></thead>
      <tbody>
        <tr>${label('seo bandwagon')}${cells(['0','0','0', '11','10','1', '45.5%','50%','-4.5%', '1','1','0'], 0, 3)}</tr>
        <tr>${label('rank tracker google')}${cells(['0','0','0', '446','0','446', '0%','0%','0%', '51','0','51'], 0, 3)}</tr>
      </tbody>
    </table>`;
  return document.body;
}

// The 2026-09-06 05:30 report: all four metrics visible, the Impressions
// Difference header carrying a sort arrow. Impressions 470 vs 26 (+444).
function buildVisibleClicksReport() {
  const h = (metric, period) => `<th><div><div>${metric}</div><div>${period}</div></div></th>`;
  document.body.innerHTML = `
    <table>
      <thead><tr>
        <th><div>Top queries</div></th>
        ${h('Clicks', 'Last 7 days')}${h('Clicks', 'Previous 7 days')}${h('Clicks', 'Difference')}
        ${h('Impressions', 'Last 7 days')}${h('Impressions', 'Previous 7 days')}<th><div><div>↓ Impressions</div><div>Difference</div></div></th>
        ${h('CTR', 'Last 7 days')}${h('CTR', 'Previous 7 days')}${h('CTR', 'Difference')}
      </tr></thead>
      <tbody>
        <tr><td><span>rank tracker google</span></td><td>0</td><td>0</td><td>0</td><td>470</td><td>26</td><td>444</td><td>0%</td><td>0%</td><td>0%</td></tr>
        <tr><td><span>google rank tracker</span></td><td>0</td><td>0</td><td>0</td><td>390</td><td>19</td><td>371</td><td>0%</td><td>0%</td><td>0%</td></tr>
      </tbody>
    </table>`;
  return document.body;
}

const pct = (tr, kind) => tr.querySelector(`[data-seo-bw-metric="${kind}"]`);

describe('SBWGscCompare.apply — metric cards', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('badges a good (higher-is-better) card and a good (lower-is-better) position card', () => {
    const root = buildReport();
    C.apply(root);
    const cards = root.querySelectorAll('[role="button"]');
    const clicksBadge = cards[0].querySelector('.seo-bw-cmp-badge');
    const positionBadge = cards[1].querySelector('.seo-bw-cmp-badge');
    expect(clicksBadge.classList.contains('good')).toBe(true);
    expect(clicksBadge.textContent).toBe('▲ +230 (+23%)');
    expect(positionBadge.classList.contains('good')).toBe(true);
    expect(positionBadge.textContent).toContain('better');
  });

  it('is idempotent: re-applying does not duplicate the badge', () => {
    const root = buildReport();
    C.apply(root);
    C.apply(root);
    expect(root.querySelectorAll('[role="button"]')[0].querySelectorAll('.seo-bw-cmp-badge').length).toBe(1);
  });

  it('removes card badges when the report leaves compare mode', () => {
    const root = buildReport();
    C.apply(root);
    expect(root.querySelectorAll('.seo-bw-cmp-badge').length).toBe(2);
    const ths = root.querySelectorAll('thead th');
    ths[1].textContent = 'Clicks';
    ths[2].remove();
    ths[3].remove();
    root.querySelectorAll('tbody tr').forEach((tr) => { tr.children[3].remove(); tr.children[2].remove(); });
    C.apply(root);
    expect(root.querySelectorAll('.seo-bw-cmp-badge').length).toBe(0);
    expect(root.querySelectorAll('.seo-bw-cmp-pct').length).toBe(0);
  });
});

describe('SBWGscCompare.apply — row badges live inside Google\'s own cells', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('adds no header cells, no body cells, no toolbar, no summary, no copy table', () => {
    const root = buildReport();
    const table = root.querySelector('table');
    const thBefore = table.querySelectorAll('th').length;
    const tdBefore = table.querySelectorAll('td').length;
    C.apply(root);
    expect(table.querySelectorAll('th').length).toBe(thBefore);
    expect(table.querySelectorAll('td').length).toBe(tdBefore);
    expect(root.querySelectorAll('table').length).toBe(1);
    expect(root.querySelector('.seo-bw-cmp-tools, .seo-bw-cmp-summary, [data-seo-bw-compare="sorted"], button, select')).toBeNull();
    expect(root.textContent).not.toContain('% change');
    expect(root.textContent).not.toContain('Rows shown');
  });

  it('puts one compact percent badge inside each row\'s Difference cell', () => {
    const root = buildReport();
    C.apply(root);
    const rows = root.querySelectorAll('tbody tr');
    const b0 = pct(rows[0], 'clicks');
    expect(b0.parentElement).toBe(rows[0].children[3]); // the Difference cell
    expect(b0.textContent).toBe('▲ 23%');
    expect(b0.classList.contains('good')).toBe(true);
    expect(pct(rows[1], 'clicks').textContent).toBe('▼ 50%');
    expect(pct(rows[1], 'clicks').classList.contains('bad')).toBe(true);
    expect(pct(rows[2], 'clicks').textContent).toBe('0%');
    expect(pct(rows[2], 'clicks').classList.contains('flat')).toBe(true);
  });

  it('re-running is idempotent: exactly one badge per row', () => {
    const root = buildReport();
    C.apply(root);
    C.apply(root);
    root.querySelectorAll('tbody tr').forEach((tr) => expect(tr.querySelectorAll('.seo-bw-cmp-pct').length).toBe(1));
  });

  it('does nothing to a non-compare table', () => {
    document.body.innerHTML = `<table><thead><tr><th>Top queries</th><th>Clicks</th></tr></thead><tbody><tr><td>a</td><td>10</td></tr></tbody></table>`;
    C.apply(document.body);
    expect(document.querySelectorAll('[data-seo-bw-compare]').length).toBe(0);
  });

  it('skips a colspan "no data" row without throwing', () => {
    const root = buildReport();
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">No data</td>';
    root.querySelector('tbody').appendChild(tr);
    C.apply(root);
    expect(tr.querySelectorAll('.seo-bw-cmp-pct').length).toBe(0);
    expect(root.querySelectorAll('.seo-bw-cmp-pct').length).toBe(3);
  });

  it('does not badge a tfoot totals row', () => {
    const root = buildReport();
    const tfoot = document.createElement('tfoot');
    tfoot.innerHTML = '<tr><td>Total</td><td>2,230</td><td>2,500</td><td>-270</td></tr>';
    root.querySelector('table').appendChild(tfoot);
    C.apply(root);
    expect(tfoot.querySelectorAll('.seo-bw-cmp-pct').length).toBe(0);
  });
});

describe('SBWGscCompare.apply — no-op on unchanged state', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('emits zero MutationObserver records on a second call with unchanged data', async () => {
    const root = buildReport();
    C.apply(root);
    let records = [];
    const observer = new MutationObserver((r) => { records = records.concat(r); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    C.apply(root);
    await new Promise((resolve) => queueMicrotask(resolve));
    observer.disconnect();
    expect(records.length).toBe(0);
  });

  it('re-computes correctly after a data change, with its own badges already in the cells', async () => {
    const root = buildReport();
    C.apply(root);
    root.querySelector('tbody tr td:nth-child(2)').textContent = '2,000'; // 2,000 vs 1,000
    C.apply(root);
    const b = pct(root.querySelector('tbody tr'), 'clicks');
    expect(root.querySelector('tbody tr').querySelectorAll('.seo-bw-cmp-pct').length).toBe(1);
    expect(b.textContent).toBe('▲ 100%');
  });
});

describe('SBWGscCompare.apply — metric card false positives', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('does not badge a date-range picker card ("Last 3 months / Previous 3 months")', () => {
    document.body.innerHTML = `
      <div role="button">Date: Last 3 months<div>vs</div><div>Previous 3 months</div></div>
      <table><thead><tr><th>Top queries</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th></tr></thead>
      <tbody><tr><td>q</td><td>10</td><td>5</td></tr></tbody></table>`;
    C.apply(document.body);
    expect(document.querySelectorAll('.seo-bw-cmp-badge').length).toBe(0);
  });

  it('does not run the card pass at all when no table on the page is in compare mode', () => {
    document.body.innerHTML = `
      <div role="button">Total clicks<div>1,230</div><div>vs</div><div>1,000</div></div>
      <table><thead><tr><th>Top queries</th><th>Clicks</th></tr></thead><tbody><tr><td>q</td><td>10</td></tr></tbody></table>`;
    C.apply(document.body);
    expect(document.querySelectorAll('.seo-bw-cmp-badge').length).toBe(0);
  });
});

describe('SBWGscCompare — live Search Console layouts', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('pairs Last with Previous under an extra leading header cell, ignoring hidden Clicks', () => {
    const root = buildLiveReport();
    const cols = C.detectCompareColumns(root.querySelector('table'));
    expect(cols.metrics.map((m) => m.kind).sort()).toEqual(['ctr', 'impressions', 'position']);
    const row = C.computeRow(root.querySelector('tbody tr'), cols);
    expect(row.metrics.impressions.cur).toBe(11);
    expect(row.metrics.impressions.prev).toBe(10);
    expect(row.label).toBe('seo bandwagon');
  });

  it('renders impressions 10 → 11 as "▲ 10%" and 0 → 446 as "▲ new", never -100%', () => {
    const root = buildLiveReport();
    C.apply(root);
    const rows = root.querySelectorAll('tbody tr');
    const b0 = pct(rows[0], 'impressions');
    expect(b0.textContent).toBe('▲ 10%');
    expect(b0.classList.contains('good')).toBe(true);
    // Inside the Impressions Difference cell (body index 6 after the label)
    expect(b0.parentElement).toBe(rows[0].children[6]);
    const b1 = pct(rows[1], 'impressions');
    expect(b1.textContent).toBe('▲ new');
    expect(b1.classList.contains('bad')).toBe(false);
    expect(pct(rows[0], 'ctr').textContent).toBe('▼ 9%');
  });

  it('05:30 report: all metrics visible, sort arrow in a header — 470 vs 26 is a rise, not "▼ -418 (-94.1%)"', () => {
    const root = buildVisibleClicksReport();
    C.apply(root);
    const rows = root.querySelectorAll('tbody tr');
    const b = pct(rows[0], 'impressions');
    expect(b.parentElement).toBe(rows[0].children[6]);
    expect(b.textContent).toBe('▲ 1,707.7%');
    expect(b.classList.contains('good')).toBe(true);
    expect(pct(rows[1], 'impressions').textContent).toBe('▲ 1,952.6%');
    expect(pct(rows[0], 'clicks').textContent).toBe('0%');
  });

  it('a re-render that changes numbers keeps every metric aligned (no one-column drift)', () => {
    const root = buildVisibleClicksReport();
    C.apply(root);
    const tr = root.querySelector('tbody tr');
    tr.children[4].textContent = '520'; // impressions cur 470 → 520, prev 26
    tr.children[6].textContent = '494';
    C.apply(root);
    expect(pct(tr, 'impressions').textContent).toBe('▲ 1,900%');
    expect(tr.querySelectorAll('.seo-bw-cmp-pct').length).toBe(3);
  });
});
