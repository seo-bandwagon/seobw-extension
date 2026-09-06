// DOM-layer tests for Search Console compare-mode injection (section B of
// src/lib/gsc-compare.js): metric card badges, table % change columns, the
// sort/filter/copy tools strip, and the visible-row summary line.
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../src/lib/gsc-compare.js');
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
    // Position went DOWN (8.3 -> 6.2): that is good.
    expect(positionBadge.classList.contains('good')).toBe(true);
    expect(positionBadge.textContent).toContain('better');
  });

  it('is idempotent: re-applying does not duplicate the badge', () => {
    const root = buildReport();
    C.apply(root);
    C.apply(root);
    const cards = root.querySelectorAll('[role="button"]');
    expect(cards[0].querySelectorAll('.seo-bw-cmp-badge').length).toBe(1);
  });
});

describe('SBWGscCompare.apply — table', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('adds a "% change" header and one coloured cell per data row', () => {
    const root = buildReport();
    C.apply(root);
    const table = root.querySelector('table');
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toContain('% change');

    const rows = [...table.querySelectorAll('tbody tr')];
    const cellsRow1 = rows[0].querySelectorAll('.seo-bw-cmp-cell');
    expect(cellsRow1.length).toBe(1);
    expect(cellsRow1[0].classList.contains('good')).toBe(true);
    expect(cellsRow1[0].textContent).toBe('▲ +230 (+23%)');

    const cellsRow2 = rows[1].querySelectorAll('.seo-bw-cmp-cell');
    expect(cellsRow2[0].classList.contains('bad')).toBe(true);

    const cellsRow3 = rows[2].querySelectorAll('.seo-bw-cmp-cell');
    expect(cellsRow3[0].textContent).toBe('• 0');
  });

  it('re-running is idempotent: no duplicate headers or cells', () => {
    const root = buildReport();
    C.apply(root);
    C.apply(root);
    const table = root.querySelector('table');
    expect(table.querySelectorAll('thead tr').length).toBe(1);
    expect([...table.querySelectorAll('thead th')].filter((th) => th.textContent === '% change').length).toBe(1);
    table.querySelectorAll('tbody tr').forEach((tr) => {
      expect(tr.querySelectorAll('.seo-bw-cmp-cell').length).toBe(1);
    });
  });

  it('inserts a tools strip once, immediately before the table', () => {
    const root = buildReport();
    C.apply(root);
    C.apply(root);
    const strips = root.querySelectorAll('.seo-bw-cmp-tools');
    expect(strips.length).toBe(1);
    expect(strips[0].nextElementSibling.tagName).toBe('TABLE');
  });

  it('inserts a summary line after the table with visible-row totals', () => {
    const root = buildReport();
    C.apply(root);
    const table = root.querySelector('table');
    const summary = table.nextElementSibling;
    expect(summary.classList.contains('seo-bw-cmp-summary')).toBe(true);
    expect(summary.textContent).toContain('Rows shown: 3');
    expect(summary.textContent).toContain('Clicks');
  });

  it('does nothing to a non-compare table (no injected nodes)', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Query</th><th>Clicks</th></tr></thead>
        <tbody><tr><td>a</td><td>1,234</td></tr></tbody>
      </table>`;
    C.apply(document.body);
    expect(document.querySelectorAll('[data-seo-bw-compare]').length).toBe(0);
  });
});

describe('SBWGscCompare.apply — tools strip interaction', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('sort buttons reorder rows and "Original order" restores them', () => {
    const root = buildReport();
    C.apply(root);
    const table = root.querySelector('table');
    const labelsOf = () => [...table.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent);
    const original = labelsOf();

    const strip = root.querySelector('.seo-bw-cmp-tools');
    const [dropBtn] = [...strip.querySelectorAll('button')].filter((b) => b.textContent.includes('drops'));
    dropBtn.click();
    // Biggest drop is "plumber tacoma" (500 vs 1000, -50%).
    expect(labelsOf()[0]).toBe('plumber tacoma');
    expect(labelsOf()).not.toEqual(original);

    const [origBtn] = [...strip.querySelectorAll('button')].filter((b) => b.textContent === 'Original order');
    origBtn.click();
    expect(labelsOf()).toEqual(original);
  });

  it('filter chips hide/show rows via the hidden attribute and update the summary', () => {
    const root = buildReport();
    C.apply(root);
    const table = root.querySelector('table');
    const strip = root.querySelector('.seo-bw-cmp-tools');
    const chips = [...strip.querySelectorAll('.seo-bw-cmp-chip')];
    const dropsChip = chips.find((c) => c.textContent.includes('Drops'));
    dropsChip.click();

    const rows = [...table.querySelectorAll('tbody tr')];
    const hiddenCount = rows.filter((tr) => tr.hidden).length;
    expect(hiddenCount).toBeGreaterThan(0);
    rows.forEach((tr) => expect(tr.remove).toBeDefined()); // still in the DOM, never removed

    const summary = table.nextElementSibling;
    expect(summary.textContent).toMatch(/Rows shown: \d/);
    expect(summary.textContent).not.toContain('Rows shown: 3');
  });

  it('"Copy as TSV" writes visible rows to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const root = buildReport();
    C.apply(root);
    const strip = root.querySelector('.seo-bw-cmp-tools');
    const copyBtn = [...strip.querySelectorAll('button')].find((b) => b.textContent === 'Copy as TSV');
    copyBtn.click();

    expect(writeText).toHaveBeenCalledTimes(1);
    const tsv = writeText.mock.calls[0][0];
    expect(tsv.split('\n')[0]).toBe('Label\tClicks current\tClicks previous\tClicks diff\tClicks % change');
    expect(tsv).toContain('roofing repair denver');
  });
});
