// Unit tests for the Search Console row-action injector (src/lib/gsc-inject.js).
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../extension/src/lib/gsc-inject.js');
const G = globalThis.SBWGscInject;

function table(html) {
  document.body.innerHTML = `<table><thead><tr><th>Top queries</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>${html}</tbody></table>`;
  return document.body;
}
const row = (label, clicks = '0', imps = '7', extra = '') =>
  `<tr><td><span title="${label}">${label.slice(0, 12)}…</span>${extra}</td><td>${clicks}</td><td>${imps}</td></tr>`;

describe('SBWGscInject', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('recognises data rows and skips header/checkbox/empty rows', () => {
    const root = table(
      row('roofing seo bradenton') +
      `<tr><td><input type="checkbox"></td><td>1</td><td>2</td></tr>` +
      `<tr><td></td><td>1</td><td>2</td></tr>` +
      `<tr><td>Totals</td><td>text</td><td>more text</td></tr>`,
    );
    const trs = [...root.querySelectorAll('tbody tr')];
    expect(G.isDataRow(trs[0])).toBe(true);
    expect(G.isDataRow(trs[1])).toBe(false);
    expect(G.isDataRow(trs[2])).toBe(false);
    expect(G.isDataRow(trs[3])).toBe(false);
    expect(G.isDataRow(root.querySelector('thead tr'))).toBe(false);
  });

  it('extracts the full query from [title], ignoring action buttons', () => {
    const root = table(row('seo for plumbers las vegas', '0', '6', '<span role="button" title="Copy">c</span>'));
    expect(G.extractQuery(root.querySelector('tbody td'))).toBe('seo for plumbers las vegas');
  });

  it('falls back to visible text when there is no title', () => {
    const root = table(`<tr><td>  dexa   scan reno </td><td>0</td><td>7</td></tr>`);
    expect(G.extractQuery(root.querySelector('tbody td'))).toBe('dexa scan reno');
  });

  it('fallback text ignores Search Console hover-action labels that follow the value', () => {
    const root = table(
      `<tr><td><span>https://iriswellnesscenter.com/community-acupuncture/</span>` +
      `<span class="tip">Copy URL to clipboard</span><span class="tip">Open in new tab</span><span class="tip">Inspect URL</span></td>` +
      `<td>0</td><td>7</td></tr>`,
    );
    expect(G.extractQuery(root.querySelector('tbody td'))).toBe('https://iriswellnesscenter.com/community-acupuncture/');
  });

  it('[title] extraction skips action-label titles when the value itself has no title', () => {
    const root = table(
      `<tr><td><span>dexa scan reno</span><span title="Copy query to clipboard">c</span><span title="Open in new tab">o</span></td><td>0</td><td>7</td></tr>`,
    );
    expect(G.extractQuery(root.querySelector('tbody td'))).toBe('dexa scan reno');
  });

  it('isQueriesView: URL breakdown param decides when present', () => {
    const root = table(row('x'));
    expect(G.isQueriesView({ search: '?resource_id=sc-domain:a.com&breakdown=query' }, root)).toBe(true);
    expect(G.isQueriesView({ search: '?resource_id=sc-domain:a.com&breakdown=page' }, root)).toBe(false);
    expect(G.isQueriesView({ search: '?breakdown=country' }, root)).toBe(false);
    expect(G.isQueriesView({ search: '?breakdown=device' }, root)).toBe(false);
  });

  it('isQueriesView: the breakdown param is read from the hash too, not only the query string', () => {
    const root = table(row('x'));
    expect(G.isQueriesView({ search: '', hash: '#breakdown=query' }, root)).toBe(true);
    expect(G.isQueriesView({ search: '', hash: '#breakdown=page' }, root)).toBe(false);
  });

  it('isQueriesView: the selected tab decides before the table does', () => {
    // A Pages table still showing stale Queries markup: the tab is the truth.
    document.body.innerHTML =
      `<div role="tablist">` +
      `<span role="tab" aria-selected="false">Queries</span>` +
      `<span role="tab" aria-selected="true">Pages</span></div>` +
      `<table><thead><tr><th>Top queries</th><th>Clicks</th></tr></thead><tbody>${row('x')}</tbody></table>`;
    expect(G.isQueriesView({ search: '' }, document.body)).toBe(false);

    document.body.innerHTML =
      `<div role="tablist">` +
      `<span role="tab" aria-selected="true">Queries</span>` +
      `<span role="tab" aria-selected="false">Pages</span></div>` +
      `<table><tbody>${row('x')}</tbody></table>`;
    expect(G.isQueriesView({ search: '' }, document.body)).toBe(true);
  });

  it('isQueriesView: an outer selected tab it does not recognise is abstained on, not guessed', () => {
    // Search Console nests tab groups — "Search results / Discover / News"
    // sits above the dimension tabs, and its selected tab is the first match.
    // Matching neither vocabulary must fall through to the table, not decide.
    document.body.innerHTML =
      `<div role="tablist"><span role="tab" aria-selected="true">Search results</span></div>` +
      `<table><thead><tr><th>Top pages</th><th>Clicks</th></tr></thead><tbody>${row('https://a.com/p')}</tbody></table>`;
    expect(G.isQueriesView({ search: '' }, document.body)).toBe(false);
  });

  it('isQueriesView: the header comes from the table with data rows, not the first table on the page', () => {
    // A summary table above the report would otherwise answer for it.
    document.body.innerHTML =
      `<table><thead><tr><th>Total clicks</th></tr></thead><tbody><tr><td>Totals</td><td>text</td></tr></tbody></table>` +
      `<table><thead><tr><th>Top pages</th><th>Clicks</th></tr></thead><tbody>${row('https://a.com/p')}</tbody></table>`;
    expect(G.isQueriesView({ search: '' }, document.body)).toBe(false);
    expect(G.dataTableHeader(document.body).textContent).toBe('Top pages');
  });

  it('isQueriesView: an unidentifiable report does NOT inject', () => {
    // Changed 2026-09-10. This used to return true ("assume the default tab"),
    // so every moment the tab could not be identified — including the frame
    // between an SPA tab switch and the new table painting — injected icons.
    // That is how they reached the Pages tab.
    document.body.innerHTML = `<table><tbody>${row('x')}</tbody></table>`;
    expect(G.isQueriesView({ search: '' }, document.body)).toBe(false);
    expect(G.isQueriesView({ search: '' }, null)).toBe(false);
    document.body.innerHTML = '';
    expect(G.isQueriesView({ search: '' }, document.body)).toBe(false);
  });

  it('isQueriesView: a real Queries report with a header still injects', () => {
    const root = table(row('x'));
    expect(G.isQueriesView({ search: '?resource_id=sc-domain:a.com' }, root)).toBe(true);
  });

  it('removeAll strips every injected group so a tab switch leaves nothing behind', () => {
    const root = table(row('a b') + row('c d'));
    G.injectAll(root, { open() {}, openPrivate() {} });
    expect(root.querySelectorAll('.' + G.ICON_GROUP).length).toBe(2);
    expect(G.removeAll(root)).toBe(2);
    expect(root.querySelectorAll('.' + G.ICON_GROUP).length).toBe(0);
  });

  it('injects two icons per data row, once, without needing native icons', () => {
    const root = table(row('a b') + row('c d') + `<tr><td><input type="checkbox"></td><td>1</td><td>2</td></tr>`);
    const calls = { open: [], priv: [] };
    const handlers = { open: (q) => calls.open.push(q), openPrivate: (q) => calls.priv.push(q) };
    expect(G.injectAll(root, handlers)).toBe(2);
    expect(G.injectAll(root, handlers)).toBe(0); // idempotent
    const groups = root.querySelectorAll('.' + G.ICON_GROUP);
    expect(groups.length).toBe(2);
    expect(groups[0].querySelectorAll('[role="button"]').length).toBe(2);
    expect(groups[0].querySelector('.' + G.ICON_CLASS + '-search').getAttribute('title')).toBe('Open in Google Search');
    expect(groups[0].querySelector('.' + G.ICON_CLASS + '-private').getAttribute('title')).toMatch(/private window/);
  });

  it('click handlers read the query at click time and stop the row click', () => {
    const root = table(row('houston car accident attorney seo'));
    const calls = { open: [], priv: [] };
    G.injectAll(root, { open: (q) => calls.open.push(q), openPrivate: (q) => calls.priv.push(q) });
    const tr = root.querySelector('tbody tr');
    let rowClicked = 0;
    tr.addEventListener('click', () => rowClicked++);
    root.querySelector('.' + G.ICON_CLASS + '-search').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    root.querySelector('.' + G.ICON_CLASS + '-private').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(calls.open).toEqual(['houston car accident attorney seo']);
    expect(calls.priv).toEqual(['houston car accident attorney seo']);
    expect(rowClicked).toBe(0);
    // React recycles the cell: new query text → new click reads the new text.
    root.querySelector('tbody td [title]').setAttribute('title', 'market 65 columbus ohio');
    root.querySelector('.' + G.ICON_CLASS + '-search').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(calls.open[1]).toBe('market 65 columbus ohio');
  });

  it('re-injects when a re-render removes the group but keeps the cell', () => {
    const root = table(row('a b'));
    const h = { open() {}, openPrivate() {} };
    G.injectAll(root, h);
    root.querySelector('.' + G.ICON_GROUP).remove();
    expect(G.injectAll(root, h)).toBe(1);
  });

  it('keyboard activation works and the search URL encodes the query', () => {
    const root = table(row('seo bandwagon reviews'));
    const calls = [];
    G.injectAll(root, { open: (q) => calls.push(q), openPrivate() {} });
    root.querySelector('.' + G.ICON_CLASS + '-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(calls).toEqual(['seo bandwagon reviews']);
    expect(G.searchUrl('a b & c')).toBe('https://www.google.com/search?q=a%20b%20%26%20c');
  });
});
