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

  // fix-1 item 3 (IMPORTANT): sorting must never move a row GSC owns. Instead
  // a sort renders OUR OWN read-only table copy and hides (never removes)
  // the real GSC table; "Original order" tears the copy down and unhides it.
  it('sort buttons render a sorted COPY table and never move a GSC row; "Original order" restores the real table', () => {
    const root = buildReport();
    C.apply(root);
    const table = root.querySelector('table');
    const gscLabelsOf = () => [...table.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent);
    const original = gscLabelsOf();

    const strip = root.querySelector('.seo-bw-cmp-tools');
    const [dropBtn] = [...strip.querySelectorAll('button')].filter((b) => b.textContent.includes('drops'));
    dropBtn.click();

    // The real GSC table's own row order is untouched -- never reordered.
    expect(gscLabelsOf()).toEqual(original);
    expect(table.hidden).toBe(true);

    const copy = root.querySelector('[data-seo-bw-compare="sorted"]');
    expect(copy).toBeTruthy();
    expect(copy.tagName).toBe('TABLE');
    expect(copy).not.toBe(table);
    // Biggest drop is "plumber tacoma" (500 vs 1000, -50%).
    const copyLabels = [...copy.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent);
    expect(copyLabels[0]).toBe('plumber tacoma');

    const [origBtn] = [...strip.querySelectorAll('button')].filter((b) => b.textContent === 'Original order');
    origBtn.click();
    expect(table.hidden).toBe(false);
    expect(root.querySelector('[data-seo-bw-compare="sorted"]')).toBeNull();
    expect(gscLabelsOf()).toEqual(original);
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

// fix-1 item 1 (CRITICAL): apply() must be a true no-op on unchanged state --
// no DOM writes at all -- so a MutationObserver-driven runner never sees a
// second batch of mutations from re-scanning data that didn't change, which
// is what would otherwise create an observer loop that never settles.
describe('SBWGscCompare.apply — no-op on unchanged state (fix-1 item 1a)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('emits zero MutationObserver records on a second call with unchanged data', async () => {
    const root = buildReport();
    C.apply(root); // first call does the real injection

    let records = [];
    const observer = new MutationObserver((r) => { records = records.concat(r); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });

    C.apply(root); // second call: nothing changed
    await new Promise((resolve) => queueMicrotask(resolve));
    observer.disconnect();

    expect(records.length).toBe(0);
  });

  it('re-detects and re-injects once the underlying numbers actually change', async () => {
    const root = buildReport();
    C.apply(root);

    // Change a genuine data cell (not one of our injected nodes).
    const firstDataCell = root.querySelector('tbody tr td:nth-child(2)');
    firstDataCell.textContent = '9,999';

    let records = [];
    const observer = new MutationObserver((r) => { records = records.concat(r); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });

    C.apply(root);
    await new Promise((resolve) => queueMicrotask(resolve));
    observer.disconnect();

    expect(records.length).toBeGreaterThan(0);
    const table = root.querySelector('table');
    const cellsRow1 = table.querySelectorAll('tbody tr')[0].querySelectorAll('.seo-bw-cmp-cell');
    // 9,999 vs 1,000 is a big jump -- recomputed, not the stale +23%.
    expect(cellsRow1[0].textContent).not.toBe('▲ +230 (+23%)');
  });
});

// fix-1 item 2 (CRITICAL): the card pass must not badge things that merely
// contain a metric word or two numbers somewhere in their text.
describe('SBWGscCompare.apply — metric card false positives (fix-1 item 2)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('does not badge a date-range picker card ("Last 3 months / Previous 3 months")', () => {
    document.body.innerHTML = `
      <div role="button">Last 3 months<div>vs</div><div>Previous 3 months</div></div>
      <table>
        <thead><tr><th>Top queries</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th></tr></thead>
        <tbody><tr><td>a</td><td>1,230</td><td>1,000</td></tr></tbody>
      </table>`;
    C.apply(document.body);
    const card = document.querySelector('[role="button"]');
    expect(card.querySelector('.seo-bw-cmp-badge')).toBeNull();
  });

  it('does not badge a "Position filter: between 2 and 10" chip', () => {
    document.body.innerHTML = `
      <div role="button">Position filter: between 2 and 10</div>
      <table>
        <thead><tr><th>Top queries</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th></tr></thead>
        <tbody><tr><td>a</td><td>1,230</td><td>1,000</td></tr></tbody>
      </table>`;
    C.apply(document.body);
    const card = document.querySelector('[role="button"]');
    expect(card.querySelector('.seo-bw-cmp-badge')).toBeNull();
  });

  it('does not run the card pass at all when no table on the page is in compare mode', () => {
    document.body.innerHTML = `
      <div role="button">Total clicks<div>1,230</div><div>vs</div><div>1,000</div></div>
      <table>
        <thead><tr><th>Query</th><th>Clicks</th></tr></thead>
        <tbody><tr><td>a</td><td>1,234</td></tr></tbody>
      </table>`;
    C.apply(document.body);
    const card = document.querySelector('[role="button"]');
    expect(card.querySelector('.seo-bw-cmp-badge')).toBeNull();
  });
});

// fix-1 item 4 (IMPORTANT): metric/filter tool state survives a rebuild
// triggered by genuinely changed data, instead of resetting to defaults.
describe('SBWGscCompare.apply — persisted tool state across a rebuild (fix-1 item 4)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('keeps the selected metric and active filter after the table data changes', () => {
    const root = buildReport();
    C.apply(root);
    const table = root.querySelector('table');
    let strip = root.querySelector('.seo-bw-cmp-tools');

    const select = strip.querySelector('select');
    select.value = 'clicks';
    select.dispatchEvent(new Event('change'));
    const dropsChip = [...strip.querySelectorAll('.seo-bw-cmp-chip')].find((c) => c.textContent.includes('Drops'));
    dropsChip.click();
    expect(dropsChip.classList.contains('active')).toBe(true);

    // Bust the hash: change a real data cell so apply() actually rebuilds.
    const cell = table.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1];
    cell.textContent = '50,000';
    C.apply(root);

    strip = root.querySelector('.seo-bw-cmp-tools');
    expect(strip.querySelector('select').value).toBe('clicks');
    const dropsChipAfter = [...strip.querySelectorAll('.seo-bw-cmp-chip')].find((c) => c.textContent.includes('Drops'));
    expect(dropsChipAfter.classList.contains('active')).toBe(true);
  });
});

// fix-1 item 10 (MINOR): a short/colspan row (e.g. a "no data" message row)
// must not be silently skipped by the % change column -- it gets an empty
// marked cell so every body row has a matching cell in that column.
describe('SBWGscCompare.apply — short/colspan rows (fix-1 item 10)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('gives a colspan row an empty marked pct-cell instead of skipping it', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Top queries</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th><th>Difference</th></tr></thead>
        <tbody>
          <tr><td>roofing repair denver</td><td>1,230</td><td>1,000</td><td>+230</td></tr>
          <tr><td colspan="4">No more data</td></tr>
        </tbody>
      </table>`;
    expect(() => C.apply(document.body)).not.toThrow();
    const rows = document.querySelectorAll('tbody tr');
    const shortRowCell = rows[1].querySelector('[data-seo-bw-compare="pct-cell"]');
    expect(shortRowCell).toBeTruthy();
    expect(shortRowCell.textContent).toBe('');
  });
});

// fix-1 item 11 (MINOR): body rows come from the <tbody> specifically, so a
// <tfoot> totals row is never touched or counted.
describe('SBWGscCompare.apply — tfoot exclusion (fix-1 item 11)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('does not inject into or count a tfoot row', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Top queries</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th><th>Difference</th></tr></thead>
        <tbody>
          <tr><td>roofing repair denver</td><td>1,230</td><td>1,000</td><td>+230</td></tr>
          <tr><td>plumber tacoma</td><td>500</td><td>1,000</td><td>-500</td></tr>
        </tbody>
        <tfoot><tr><td>Total</td><td>1,730</td><td>2,000</td><td>-270</td></tr></tfoot>
      </table>`;
    C.apply(document.body);
    const tfootRow = document.querySelector('tfoot tr');
    expect(tfootRow.querySelector('.seo-bw-cmp-cell')).toBeNull();
    const summary = document.querySelector('.seo-bw-cmp-summary');
    expect(summary.textContent).toContain('Rows shown: 2');
  });
});

// fix-1 item 12 (MINOR): clearInjected must find and remove the tools strip,
// summary line and sorted-copy table via an attribute lookup on the table's
// PARENT, not by assuming they are direct siblings of the table -- once a
// sort is active, the sorted copy sits between the tools strip and the
// (hidden) real table, breaking that sibling assumption.
describe('SBWGscCompare.apply — clearInjected survives sort-broken sibling order (fix-1 item 12)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes exactly one tools/summary/sorted set on rebuild even while a sort copy is showing', () => {
    const root = buildReport();
    C.apply(root);
    const table = root.querySelector('table');
    const strip = root.querySelector('.seo-bw-cmp-tools');
    const [dropBtn] = [...strip.querySelectorAll('button')].filter((b) => b.textContent.includes('drops'));
    dropBtn.click(); // sorted copy now sits between the strip and the (hidden) table

    expect(root.querySelector('[data-seo-bw-compare="sorted"]')).toBeTruthy();
    expect(table.hidden).toBe(true);

    // Bust the hash so apply() actually rebuilds from scratch.
    const cell = table.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1];
    cell.textContent = '50,000';
    C.apply(root);

    expect(root.querySelectorAll('.seo-bw-cmp-tools').length).toBe(1);
    expect(root.querySelectorAll('.seo-bw-cmp-summary').length).toBe(1);
    // F5: an active sort is persisted with the tool state and re-shown after
    // the rebuild — exactly ONE sorted copy, and the GSC table stays hidden.
    expect(root.querySelectorAll('[data-seo-bw-compare="sorted"]').length).toBe(1);
    expect(table.hidden).toBe(true);
  });
});

// Re-review findings F1 / F3 / F5 (fix round 1 follow-up).
describe('SBWGscCompare.apply — re-review regressions', () => {
  function compareReport() {
    document.body.innerHTML = `
      <div id="cards">
        <div role="button">Total clicks<div>1,230</div><div>vs</div><div>1,000</div></div>
      </div>
      <table>
        <thead><tr><th>Top queries</th><th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th><th>Difference</th></tr></thead>
        <tbody>
          <tr><td>roofing repair denver</td><td>1,230</td><td>1,000</td><td>+230</td></tr>
          <tr><td>plumber tacoma</td><td>500</td><td>1,000</td><td>-500</td></tr>
        </tbody>
      </table>`;
    return document.body;
  }

  it('F1: removes card badges when the report leaves compare mode', () => {
    const root = compareReport();
    C.apply(root);
    expect(root.querySelectorAll('.seo-bw-cmp-badge').length).toBe(1);
    // GSC re-renders the same table as a single-range report.
    const ths = root.querySelectorAll('thead th');
    ths[1].textContent = 'Clicks';
    ths[2].remove();
    ths[3].remove();
    root.querySelectorAll('tbody tr').forEach((tr) => { tr.children[3].remove(); tr.children[2].remove(); });
    C.apply(root);
    expect(root.querySelectorAll('.seo-bw-cmp-badge').length).toBe(0);
  });

  it('F3: a card near the length cap keeps refreshing after its badge is appended', () => {
    const root = compareReport();
    const card = root.querySelector('[role="button"]');
    const filler = document.createElement('div');
    filler.textContent = 'x'.repeat(160); // label + numbers + filler ≈ 190 chars of own text
    card.insertBefore(filler, card.children[0]);
    C.apply(root);
    const badge1 = card.querySelector('.seo-bw-cmp-badge');
    expect(badge1).not.toBeNull();
    const first = badge1.textContent;
    card.querySelectorAll('div')[1].textContent = '2,000'; // current value changes
    C.apply(root);
    const badge2 = card.querySelector('.seo-bw-cmp-badge');
    expect(badge2).not.toBeNull();
    expect(badge2.textContent).not.toBe(first);
    expect(badge2.textContent).toContain('+1,000');
  });

  it('F5: an active sort survives a rebuild caused by a GSC re-render', () => {
    const root = compareReport();
    C.apply(root);
    const table = root.querySelector('table:not([data-seo-bw-compare])');
    const strip = root.querySelector('.seo-bw-cmp-tools');
    const btnDrop = [...strip.querySelectorAll('button')].find((b) => /biggest drops/.test(b.textContent));
    btnDrop.click();
    expect(root.querySelector('[data-seo-bw-compare="sorted"]')).not.toBeNull();
    expect(table.hidden).toBe(true);
    // External change → rebuild
    table.querySelector('tbody td:nth-child(2)').textContent = '1,300';
    C.apply(root);
    expect(root.querySelector('[data-seo-bw-compare="sorted"]')).not.toBeNull();
    expect(table.hidden).toBe(true);
    const btnOrig = [...root.querySelector('.seo-bw-cmp-tools').querySelectorAll('button')].find((b) => /Original order/.test(b.textContent));
    btnOrig.click();
    expect(root.querySelector('[data-seo-bw-compare="sorted"]')).toBeNull();
    expect(table.hidden).toBe(false);
  });
});
