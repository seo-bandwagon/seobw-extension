// SEO Bandwagon — the "Google results" settings controls (1.11.0)
//
// One set of controls for the two places that show them: the "Google
// results" section of Options (src/options/options.js) and the popup on a
// Google results page (src/popup/serp-panel.js). Each change is saved at
// once (SBWSerpSettings.save), and the open results page follows it
// (serp-overlay.js listens to storage). The figures' consent card and the
// own-sites list are Options' own, not here: accept buttons live in Options.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpSettingsUI` when loaded as a classic <script>, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpSettingsUI = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const GROUP_NAMES = { page: 'The page', site: 'The site', age: 'The domain', checklist: 'Your own' };

  function h(doc, tag, attrs, ...children) {
    const el = doc.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    children.forEach((c) => { if (c) el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return el;
  }

  function check(doc, id, label, name) {
    const input = h(doc, 'input', { type: 'checkbox', id, 'data-setting': name });
    return h(doc, 'div', { class: 'checkbox-row sr-row' }, input, h(doc, 'label', { for: id, text: label }));
  }

  function radios(doc, name, legend, options, prefix) {
    const group = h(doc, 'div', { class: 'radio-group sr-radios', role: 'radiogroup', 'aria-label': legend });
    options.forEach(([value, label]) => {
      const input = h(doc, 'input', { type: 'radio', name: prefix + name, value, 'data-setting': name });
      group.appendChild(h(doc, 'label', { class: 'radio-row' }, input, ' ' + label));
    });
    return h(doc, 'div', { class: 'sr-field' }, h(doc, 'div', { class: 'sr-legend', text: legend }), group);
  }

  /**
   * Builds the controls into `container` and keeps them in step with what is
   * stored. `opts.idPrefix` keeps ids unique on a page; `opts.compact` folds
   * the figure choices under a disclosure (the popup).
   */
  function render(container, opts) {
    const o = opts || {};
    const doc = container.ownerDocument;
    const S = globalThis.SBWSerpSettings;
    const prefix = o.idPrefix || 'sr';
    container.textContent = '';

    const root = h(doc, 'div', { class: 'sr-settings' });
    root.appendChild(check(doc, prefix + 'Overlay', 'Show SEO Bandwagon on Google’s results pages', 'overlay'));
    root.appendChild(radios(doc, 'placement', 'The panel', [
      ['bottom', 'Below the results'],
      ['top', 'Above the results (they move down to make room)']
    ], prefix));
    root.appendChild(radios(doc, 'look', 'Look', [
      ['google', 'Match Google (light or dark, as Google is)'],
      ['dark', 'Night'],
      ['light', 'Day']
    ], prefix));
    root.appendChild(check(doc, prefix + 'FiguresOn', 'Figures under each result', 'figuresOn'));
    root.appendChild(radios(doc, 'load', 'Figures load', [
      ['auto', 'With the page'],
      ['click', 'When I click Load figures']
    ], prefix));

    const list = h(doc, 'div', { class: 'sr-figures' });
    let lastGroup = null;
    S.FIGURES.forEach((f) => {
      if (f.group !== lastGroup) {
        list.appendChild(h(doc, 'div', { class: 'sr-legend', text: GROUP_NAMES[f.group] }));
        lastGroup = f.group;
      }
      const input = h(doc, 'input', { type: 'checkbox', id: prefix + 'Fig_' + f.key, 'data-figure': f.key });
      list.appendChild(h(doc, 'div', { class: 'checkbox-row sr-row' }, input, h(doc, 'label', { for: prefix + 'Fig_' + f.key, text: f.label })));
    });
    const note = h(doc, 'p', { class: 'sr-note', text: 'Link and traffic figures are DataForSEO’s; rank is on its 0 to 100 scale. Domain age is from RDAP. Your on-page checklist is a checklist, not a ranking factor.' });
    if (o.compact) {
      root.appendChild(h(doc, 'details', { class: 'sr-details' }, h(doc, 'summary', { text: 'Which figures show' }), list, note));
    } else {
      root.appendChild(h(doc, 'div', { class: 'sr-field' }, h(doc, 'div', { class: 'sr-legend sr-legend-main', text: 'Which figures show' }), list, note));
    }

    // 1.12.0: the results table's columns, and what its cells are marked against.
    const T = globalThis.SBWSerpTable;
    if (T) {
      const cols = h(doc, 'div', { class: 'sr-figures' });
      T.COLUMNS.forEach((c) => {
        const id = prefix + 'Col_' + c.key;
        const input = h(doc, 'input', { type: 'checkbox', id, 'data-column': c.key });
        cols.appendChild(h(doc, 'div', { class: 'checkbox-row sr-row' }, input, h(doc, 'label', { for: id, text: T.header(c) })));
      });
      const compare = radios(doc, 'compareTo', 'Table cells are marked against', [
        ['median', 'The middle value of the search’s results'],
        ['pinned', 'Your pinned page, when one is pinned']
      ], prefix);
      if (o.compact) {
        root.appendChild(h(doc, 'details', { class: 'sr-details' }, h(doc, 'summary', { text: 'Results table' }), compare, cols));
      } else {
        root.appendChild(h(doc, 'div', { class: 'sr-field' }, h(doc, 'div', { class: 'sr-legend sr-legend-main', text: 'Results table' }), compare, cols));
      }
    }
    container.appendChild(root);

    function paint(s) {
      root.querySelectorAll('[data-setting]').forEach((input) => {
        const name = input.getAttribute('data-setting');
        if (input.type === 'checkbox') input.checked = !!s[name];
        else input.checked = s[name] === input.value;
      });
      root.querySelectorAll('[data-figure]').forEach((input) => {
        input.checked = !!s.figures[input.getAttribute('data-figure')];
        input.disabled = !s.figuresOn || !s.overlay;
      });
      root.querySelectorAll('[data-column]').forEach((input) => {
        input.checked = s.tableColumns[input.getAttribute('data-column')] !== false;
        input.disabled = !s.overlay;
      });
      root.querySelectorAll('[data-setting]').forEach((input) => {
        const name = input.getAttribute('data-setting');
        if (name !== 'overlay') input.disabled = !s.overlay || (name === 'load' && !s.figuresOn);
      });
    }

    root.addEventListener('change', async (e) => {
      const t = e.target;
      let patch = null;
      if (t.hasAttribute('data-setting')) {
        const name = t.getAttribute('data-setting');
        patch = { [name]: t.type === 'checkbox' ? t.checked : t.value };
      } else if (t.hasAttribute('data-figure')) {
        patch = { figures: { [t.getAttribute('data-figure')]: t.checked } };
      } else if (t.hasAttribute('data-column')) {
        patch = { tableColumns: { [t.getAttribute('data-column')]: t.checked } };
      }
      if (!patch) return;
      paint(await S.save(patch));
      if (typeof o.onChange === 'function') o.onChange(patch);
    });

    S.load().then(paint);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[S.STORAGE_KEY]) paint(S.normalize(changes[S.STORAGE_KEY].newValue));
      });
    } catch (e) { /* preview harness */ }
    return root;
  }

  return { render };
});
