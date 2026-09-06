// Structured Data panel — popup UI (Task 5)
//
// Owns the STRUCTURED DATA collapsible section, mounted directly after
// Rendering in renderResults() (popup.js) — falling back to Hreflang, then
// Indexability, then Page Meta, the same fallback chain render-check.js
// uses, in case an earlier section didn't render one (e.g. no hreflang
// tags on the page). Link Check — which always appends to the end of
// #content — stays last regardless.
//
// Unlike Link Check/Indexability/Hreflang/Rendering, nothing here fetches
// a third-party URL: extraction and validation are pure DOM/JSON-LD
// parsing done by the content script (src/content/analyzer.js's
// analyzeSchemaValidation(), via SBWSchema.validateAll()) and arrive
// ready-made as data.schemaValidation — this module never re-derives them,
// and there's no optional <all_urls> permission card to gate on.
//
// Also owns the popup-wide "About & credits" footer link (not tab- or
// section-specific — see popup.html's footer markup): clicking it toggles
// a small in-popup panel built from SBWCredits.entries
// (src/lib/credits.js), listing the schema.org (CC BY-SA 3.0) and Google
// Search Central (CC BY 4.0) licenses this section's required/recommended
// tables derive from, plus each type's own source page. Wired
// unconditionally at load time (not inside mount()) since the footer
// exists on every popup load regardless of which analysis section rendered.
//
// Reads shared render helpers off `globalThis.SBWPopup` (esc/section/
// badge/getCurrentTab — classic <script> loads before this file, see
// popup.html) and pure logic off `globalThis.SBWSchema`/`SBWCsv`/
// `SBWCredits`. Follows src/popup/hreflang.js and
// src/popup/render-check.js's mount pattern, minus the permission/gen
// machinery neither of those needs here.

(function () {

  let sectionEl = null;
  let tab = null;
  let pageData = null;

  function popup() {
    return globalThis.SBWPopup || {};
  }

  // Fix round 1, MINOR 9: the identity fallback (x => String(x)) rendered
  // any of & < > " ' straight into the DOM verbatim whenever SBWPopup
  // hadn't loaded — a real escape function, not just a type coercion, so
  // this section is never the one place that skips the "every string
  // reaching the DOM passes through esc" rule.
  function escFallback(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function esc(s) {
    return (popup().esc || escFallback)(s);
  }

  function truncateMiddle(s, max) {
    if (!s) return '';
    if (s.length <= max) return s;
    const half = Math.floor((max - 1) / 2);
    return s.slice(0, half) + '…' + s.slice(s.length - half);
  }

  /* ---------- mount / (re)init ---------- */

  function mount(container, data) {
    if (!container) return;
    if (typeof globalThis.SBWSchema === 'undefined') return;

    const { section, getCurrentTab } = popup();
    if (!section) return;

    pageData = data;
    tab = getCurrentTab ? getCurrentTab() : null;

    const holder = document.createElement('div');
    holder.innerHTML = section('schema', 'STRUCTURED DATA', '<span class="sd-badge-slot"></span>', '<div class="sd-body"></div>');
    sectionEl = holder.firstElementChild;

    // Land directly after Rendering (falling back through Hreflang,
    // Indexability, then Page Meta) — see the module comment.
    const anchor = container.querySelector('[data-section="render"]')
      || container.querySelector('[data-section="hreflang"]')
      || container.querySelector('[data-section="indexability"]')
      || container.querySelector('[data-section="meta"]');
    if (anchor && anchor.parentElement === container) {
      anchor.insertAdjacentElement('afterend', sectionEl);
    } else {
      container.appendChild(sectionEl);
    }

    sectionEl.querySelector('.section-header').addEventListener('click', () => sectionEl.classList.toggle('open'));
    sectionEl.querySelector('.section-content').addEventListener('click', e => e.stopPropagation());

    render();
  }

  /* ---------- render ---------- */

  const EMPTY_SCHEMA_DATA = { items: [], counts: { byType: {}, bySource: {}, withErrors: 0 }, eligible: [] };

  // Fix round 1, MINOR 8: only trust data.schemaValidation when it actually
  // has the { items, counts } shape validateAll() produces — a malformed or
  // partial cached-analysis object should render as "no structured data"
  // rather than throw part-way through renderBody() (e.g. `.filter` on a
  // non-array `items`).
  function schemaData() {
    const sd = pageData && pageData.schemaValidation;
    if (sd && Array.isArray(sd.items) && sd.counts && typeof sd.counts === 'object') return sd;
    return EMPTY_SCHEMA_DATA;
  }

  function render() {
    if (!sectionEl) return;
    const bodyEl = sectionEl.querySelector('.sd-body');
    if (bodyEl) bodyEl.innerHTML = renderBody();
    const badgeSlot = sectionEl.querySelector('.sd-badge-slot');
    if (badgeSlot) badgeSlot.outerHTML = renderBadgeSlot();
    wire();
  }

  function renderBadgeSlot() {
    const { badge } = popup();
    const n = schemaData().counts.withErrors || 0;
    const inner = n > 0 ? badge(`${n} ${n === 1 ? 'ITEM' : 'ITEMS'} WITH ERRORS`, 'b-err') : badge('OK', 'b-ok');
    return `<span class="sd-badge-slot">${inner}</span>`;
  }

  function renderBody() {
    const sd = schemaData();
    const items = sd.items || [];
    const realItems = items.filter(i => !i.error);
    const errorItems = items.filter(i => i.error);

    if (!items.length) {
      return `<div class="sd-empty">No structured data found on this page.</div>`;
    }

    return `
      ${renderSourceChips(sd.counts.bySource)}
      ${renderEligible(sd.eligible)}
      <div class="sd-items">${realItems.map(renderItem).join('')}</div>
      ${errorItems.length ? renderErrors(errorItems) : ''}
      <div class="sd-actions">
        <button type="button" class="sd-export-btn" id="sdExportBtn">Export CSV</button>
      </div>
    `;
  }

  const SOURCE_LABELS = { 'json-ld': 'JSON-LD', microdata: 'Microdata', rdfa: 'RDFa' };

  function renderSourceChips(bySource) {
    const chips = ['json-ld', 'microdata', 'rdfa']
      .map(src => `<span class="sd-chip">${esc(SOURCE_LABELS[src])} <span class="sd-chip-count">${bySource[src] || 0}</span></span>`)
      .join('');
    return `<div class="sd-chips">${chips}</div>`;
  }

  function renderEligible(eligible) {
    if (!eligible || !eligible.length) {
      return `<div class="sd-eligible sd-eligible-none">No rich-result set is complete</div>`;
    }
    return `<div class="sd-eligible">Eligible for: ${eligible.map(esc).join(', ')}</div>`;
  }

  function renderItem(item, idx) {
    const missingRequired = (item.required && item.required.missing) || [];
    const missingRecommended = (item.recommended && item.recommended.missing) || [];
    const problems = item.problems || [];
    return `<div class="sd-item">
      <div class="sd-item-head">
        <span class="badge-mono ${missingRequired.length ? 'b-err' : 'b-ok'}">${esc(item.type || 'Unknown')}</span>
        <span class="sd-source-tag">${esc(SOURCE_LABELS[item.source] || item.source || '')}</span>
        <button type="button" class="sd-copy-btn" data-idx="${idx}">Copy JSON-LD</button>
      </div>
      ${missingRequired.length ? `<div class="sd-chips sd-chips-required">${missingRequired.map(f => `<span class="sd-chip sd-chip-bad">${esc(f)}</span>`).join('')}</div>` : ''}
      ${missingRecommended.length ? `<div class="sd-chips sd-chips-recommended">${missingRecommended.map(f => `<span class="sd-chip sd-chip-muted">${esc(f)}</span>`).join('')}</div>` : ''}
      ${problems.length ? `<ul class="sd-problems">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${item.retiredRichResult ? `<div class="sd-retired-note">Valid markup; Google no longer shows a rich result for this type</div>` : ''}
      ${item.note ? `<div class="sd-retired-note">${esc(item.note)}</div>` : ''}
    </div>`;
  }

  function renderErrors(errorItems) {
    return `<div class="sd-errors">
      <div class="sd-errors-label">Parse errors</div>
      ${errorItems.map(e => `<div class="sd-error-row">
        <span class="sd-source-tag">${esc(SOURCE_LABELS[e.source] || e.source || '')}</span>
        <span class="sd-error-msg">${esc(e.error)}</span>
        <code class="sd-error-snippet">${esc(truncateMiddle(e.snippet || '', 60))}</code>
      </div>`).join('')}
    </div>`;
  }

  /* ---------- wiring ---------- */

  function wire() {
    if (!sectionEl) return;
    sectionEl.querySelector('#sdExportBtn')?.addEventListener('click', onExportClick);
    sectionEl.querySelectorAll('.sd-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => onCopyClick(Number(btn.dataset.idx)));
    });
  }

  function onCopyClick(idx) {
    const realItems = (schemaData().items || []).filter(i => !i.error);
    const item = realItems[idx];
    if (!item) return;
    const text = JSON.stringify(item.properties || {}, null, 2);
    const done = () => popup().setSeoStatus?.('Copied', 'success');
    const fail = () => popup().setSeoStatus?.('Copy failed', 'error');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  const CSV_COLUMNS = [
    { key: 'type', label: 'Type' },
    { key: 'source', label: 'Source' },
    { key: 'missingRequired', label: 'Missing Required' },
    { key: 'missingRecommended', label: 'Missing Recommended' },
    { key: 'problems', label: 'Problems' }
  ];

  function onExportClick() {
    const items = schemaData().items || [];
    const rows = items.map(i => i.error
      ? { type: '', source: i.source || '', missingRequired: '', missingRecommended: '', problems: `Parse error: ${i.error}` }
      : {
        type: i.type || '',
        source: i.source || '',
        missingRequired: ((i.required && i.required.missing) || []).join('; '),
        missingRecommended: ((i.recommended && i.recommended.missing) || []).join('; '),
        problems: (i.problems || []).join('; ')
      });
    const csv = SBWCsv.toCsv(rows, CSV_COLUMNS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SBWCsv.csvFilename('structured-data', (tab && tab.url) || (pageData && pageData.url) || 'https://page.example/');
    a.click();
    // See link-check.js's onExportClick for why the revoke is deferred a tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    popup().setSeoStatus?.('Exported', 'success');
  }

  /* ---------- footer "About & credits" panel ----------
   * Not tied to mount()/pageData — the footer (and #creditsPanel, see
   * popup.html) exists on every popup load, in both tabs, regardless of
   * which analysis section rendered. Wired once, here, at script-load
   * time; this file's <script> tag sits after the footer markup in the
   * DOM so the elements already exist. */

  let creditsBuilt = false;

  function renderCreditsPanel() {
    const entries = (globalThis.SBWCredits && globalThis.SBWCredits.entries) || [];
    const licenses = entries.filter(e => e.section === 'license');
    const types = entries.filter(e => e.section === 'type');
    // Task 7, item F: the "SEO Bandwagon tools" context-menu/popup links —
    // one more entries() section, not a UI rewrite (see credits.js's
    // module comment).
    const tools = entries.filter(e => e.section === 'tool');
    return `
      <div class="credits-head">
        <span class="credits-title">About &amp; credits</span>
        <button type="button" class="credits-close" id="creditsCloseBtn" aria-label="Close">×</button>
      </div>
      <div class="credits-body">
        <p class="credits-copy">The Structured Data section's required/recommended property lists are derived from:</p>
        <ul class="credits-list">
          ${licenses.map(e => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a> — ${esc(e.note || '')}</li>`).join('')}
        </ul>
        <p class="credits-copy">Per-type source pages:</p>
        <ul class="credits-types">
          ${types.map(e => e.url
            ? `<li><span class="credits-type">${esc(e.title)}</span> <a href="${esc(e.url)}" target="_blank" rel="noopener">source</a></li>`
            : `<li><span class="credits-type">${esc(e.title)}</span></li>`).join('')}
        </ul>
        <p class="credits-copy">"Eligible for" checks the same required properties Google's Rich Results Test and Search Console use — named here by name, no logos.</p>
        ${tools.length ? `
        <p class="credits-copy">Tools linked from the SEO Bandwagon menu and popup:</p>
        <ul class="credits-list">
          ${tools.map(e => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a> — ${esc(e.note || '')}</li>`).join('')}
        </ul>` : ''}
      </div>
    `;
  }

  function ensureCreditsPanel() {
    const panel = document.getElementById('creditsPanel');
    if (!panel || creditsBuilt) return panel;
    panel.innerHTML = renderCreditsPanel();
    panel.querySelector('#creditsCloseBtn')?.addEventListener('click', () => { panel.hidden = true; });
    creditsBuilt = true;
    return panel;
  }

  function onCreditsLinkClick() {
    const panel = ensureCreditsPanel();
    if (!panel) return;
    panel.hidden = !panel.hidden;
  }

  document.getElementById('creditsLink')?.addEventListener('click', onCreditsLinkClick);

  globalThis.SBWSchemaUI = { mount };
})();
