// SEO Bandwagon — Search Console row actions (pure DOM helpers, testable).
//
// Adds two small action icons to every data row of the Search Console
// Performance table ("Queries", "Pages" tabs): open the row's query in Google
// Search (new tab) and open it in a private/incognito window.
//
// Why this exists as a library: the previous injector only fired when GSC's
// own hover icons were already in the DOM, and GSC renders those lazily on
// hover — so on a freshly loaded report nothing was ever injected. This
// version finds data rows structurally (a <tr> whose first cell holds text and
// whose later cells hold numbers), needs no native icon to anchor on, and is
// exercised by unit tests against a fixture table.
(function (root) {
  'use strict';

  const ICON_GROUP = 'seo-bw-gsc-actions';
  const ICON_CLASS = 'seo-bw-gsc-icon';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function isNumericCell(cell) {
    const t = (cell.textContent || '').trim();
    return t.length > 0 && /^[\d.,%\s-]+$/.test(t);
  }

  // A data row: a <tr> with 2+ <td>, a non-empty first cell that is not a
  // checkbox/expander, and at least one numeric metric cell after it.
  function isDataRow(tr) {
    if (!tr || tr.tagName !== 'TR') return false;
    const cells = tr.querySelectorAll(':scope > td');
    if (cells.length < 2) return false;
    const first = cells[0];
    if (first.querySelector('input[type="checkbox"]')) return false;
    if (!extractQuery(first)) return false;
    for (let i = 1; i < cells.length; i++) if (isNumericCell(cells[i])) return true;
    return false;
  }

  // Prefer a [title] (GSC puts the full, untruncated query/URL there); skip
  // titles that belong to action buttons (native or ours).
  function extractQuery(cell) {
    for (const el of cell.querySelectorAll('[title]')) {
      if (el.closest('[role="button"], .' + ICON_GROUP)) continue;
      const t = (el.getAttribute('title') || '').trim();
      if (t) return t;
    }
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.' + ICON_GROUP + ', [role="button"]').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function searchUrl(query) {
    return 'https://www.google.com/search?q=' + encodeURIComponent(query);
  }

  function svg(paths) {
    const el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', '16');
    el.setAttribute('height', '16');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '2');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('focusable', 'false');
    for (const d of paths) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      el.appendChild(p);
    }
    return el;
  }

  const ICONS = {
    // magnifying glass
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-3.95-3.95'],
    // mask / "private" glyph: glasses + hat brim
    private: ['M3 12h18', 'M7 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M17 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M10 15h4', 'M6 12l1.5-6h9L18 12'],
  };

  function makeButton(kind, label, onActivate) {
    const btn = document.createElement('span');
    btn.className = ICON_CLASS + ' ' + ICON_CLASS + '-' + kind;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.appendChild(svg(ICONS[kind]));
    const trigger = (e) => {
      // Never let GSC treat this as a row click (which filters the report).
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      onActivate();
    };
    btn.addEventListener('click', trigger, true);
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') trigger(e); });
    return btn;
  }

  // Inject (or re-inject after a React re-render wiped the group) into one row.
  // `handlers.open(query)` and `handlers.openPrivate(query)` are called at
  // CLICK time with the row's current text — React recycles cells.
  function injectRow(tr, handlers) {
    const first = tr.querySelector(':scope > td');
    if (!first || first.querySelector('.' + ICON_GROUP)) return false;
    const group = document.createElement('span');
    group.className = ICON_GROUP;
    group.appendChild(makeButton('search', 'Open in Google Search', () => {
      const q = extractQuery(first);
      if (q) handlers.open(q);
    }));
    group.appendChild(makeButton('private', 'Open in Google Search (private window)', () => {
      const q = extractQuery(first);
      if (q) handlers.openPrivate(q);
    }));
    first.appendChild(group);
    return true;
  }

  // Scan a root for data rows and inject; returns the number of rows injected.
  function injectAll(rootEl, handlers) {
    let n = 0;
    rootEl.querySelectorAll('tr').forEach((tr) => {
      if (isDataRow(tr) && injectRow(tr, handlers)) n++;
    });
    return n;
  }

  const CSS =
    '.' + ICON_GROUP + '{display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle;opacity:.45;transition:opacity .15s ease}' +
    'tr:hover .' + ICON_GROUP + ',.' + ICON_GROUP + ':focus-within{opacity:1}' +
    '.' + ICON_CLASS + '{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;cursor:pointer;color:#5f6368}' +
    '.' + ICON_CLASS + ':hover{background:rgba(245,55,150,.12);color:#c2185b}' +
    '.seo-bw-gsc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#000022;color:#f5f5f5;font:13px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,34,.35);max-width:520px}';

  const api = { ICON_GROUP, ICON_CLASS, CSS, isDataRow, isNumericCell, extractQuery, searchUrl, injectRow, injectAll, makeButton };
  root.SBWGscInject = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
