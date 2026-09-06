// SEO Bandwagon — Search Console compare-mode math (pure functions, testable)
// + DOM layer that injects % change, direction-aware colouring, sort/filter/
// copy tools and visible-row totals onto a Performance report that is
// comparing two date ranges.
//
// Everything here runs against the page's own DOM and computes from the
// numbers already rendered there. Nothing is sent anywhere, ever.
//
// Section A (pure, unit-tested): parseMetric/metricKind/pctChange/delta/
// isBetter/formatDelta/formatPctBadge/splitPair/detectCompareColumns/computeRow.
// Section B (DOM): apply(root) + injection helpers. All DOM nodes this file
// adds carry a `data-seo-bw-compare` attribute so a re-run can find, refresh
// or remove them — every injection here is reversible.
(function (root) {
  'use strict';

  // ---- Section A: pure metric math ---------------------------------------

  // "1,234" / "1.2K" / "3.4M" / "2.1B" / "12.5%" / "<0.1%" / "—" / "-" / "" →
  // number|null. Tolerant of locale thousand-spaces and surrounding text
  // ("Clicks: 1,234", "1,234 clicks"). Never throws.
  function parseMetric(text) {
    if (text === null || text === undefined) return null;
    let s;
    try {
      s = String(text);
    } catch (e) {
      return null;
    }
    // Normalize non-breaking / narrow no-break spaces (locale thousand seps)
    // and the typographic minus sign U+2212 (GSC can render one in a
    // Difference column) to a plain ASCII hyphen (fix-1 item 7).
    s = s.replace(/[\u00A0\u202F]/g, ' ').replace(/\u2212/g, '-').trim();
    if (!s) return null;
    if (/^[-\u2010-\u2015]+$/.test(s)) return null; // '-', en/em dash, figure dash, etc.

    // GSC's "less than" placeholder, e.g. "<0.1%" → half the stated threshold.
    const lt = s.match(/<\s*(\d[\d,.\s]*)\s*%/);
    if (lt) {
      const n = parseFloat(lt[1].replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n / 2 : null;
    }

    // fix-1 item 2 (CRITICAL): the suffix must not be allowed to match the
    // leading letter of a following word -- "3 months" is not "3 M"; the
    // case-insensitive M/mega suffix was matching the "m" of "months".
    // Requiring that no word character or "." immediately follows the
    // suffix rejects that while still matching a genuine "1.2K"/"3.4M".
    const m = s.match(/(-?\d[\d,\s]*(?:\.\d+)?)\s*(K|M|B|%)?(?![\w.])/i);
    if (!m) return null;
    const numStr = m[1].replace(/[,\s]/g, '');
    const n = parseFloat(numStr);
    if (!Number.isFinite(n)) return null;
    const suffix = (m[2] || '').toUpperCase();
    if (suffix === 'K') return n * 1e3;
    if (suffix === 'M') return n * 1e6;
    if (suffix === 'B') return n * 1e9;
    return n; // '%' or no suffix: value is already the number we want
  }

  // Header/card label → 'clicks' | 'impressions' | 'ctr' | 'position' | null.
  // Case-insensitive; tolerant of "Total clicks", "Average CTR", and a
  // trailing date range with or without parentheses ("Clicks (Last 3
  // months)", "Clicks Last 3 months", "Clicks Previous 3 months").
  function metricKind(headerText) {
    if (headerText === null || headerText === undefined) return null;
    let s = String(headerText).toLowerCase().trim();
    if (!s) return null;
    s = s.replace(/\(.*?\)\s*$/, '').trim();
    s = s.replace(/\b(?:last|previous)\b[\s\S]*$/, '').trim();
    if (!s) return null;
    if (/\bctr\b/.test(s)) return 'ctr';
    if (/\bclick/.test(s)) return 'clicks';
    if (/\bimpression/.test(s)) return 'impressions';
    if (/\bposition\b/.test(s)) return 'position';
    return null;
  }

  function isNum(n) {
    return typeof n === 'number' && Number.isFinite(n);
  }

  // number|null → number|null. null when prev is null/0 unless cur is also
  // 0 (0 → 0 is a defined, zero, change — not "undefined").
  function pctChange(cur, prev) {
    if (!isNum(cur) || !isNum(prev)) return null;
    if (prev === 0) return cur === 0 ? 0 : null;
    return ((cur - prev) / prev) * 100;
  }

  function delta(cur, prev) {
    if (!isNum(cur) || !isNum(prev)) return null;
    return cur - prev;
  }

  // Position: lower is better. Everything else: higher is better. Equal → null.
  function isBetter(kind, cur, prev) {
    if (!isNum(cur) || !isNum(prev)) return null;
    if (cur === prev) return null;
    return kind === 'position' ? cur < prev : cur > prev;
  }

  function formatNum(n, maxDecimals) {
    if (!isNum(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
  }

  function formatRaw(kind, value) {
    if (!isNum(value)) return '—';
    if (kind === 'ctr') return formatNum(value, 1) + '%';
    if (kind === 'position') return formatNum(value, 1);
    return formatNum(value, 0);
  }

  // { arrow: '▲'|'▼'|'•', text } — see task brief for the exact per-kind
  // wording (clicks/impressions: "▲ +230 (+23%)"; CTR: "▲ +0.8 pp (+20%)";
  // position: "▼ 2.1 (better)" / "▲ 1.4 (worse)"; no change: "• 0").
  function formatDelta(kind, cur, prev) {
    if (!isNum(cur) || !isNum(prev)) return { arrow: '•', text: '—' };
    const d = delta(cur, prev);
    if (d === 0) return { arrow: '•', text: '• 0' };
    const pct = pctChange(cur, prev);

    if (kind === 'position') {
      const better = isBetter(kind, cur, prev);
      const arrow = better ? '▼' : '▲';
      return { arrow, text: arrow + ' ' + formatNum(Math.abs(d), 1) + ' (' + (better ? 'better' : 'worse') + ')' };
    }

    const arrow = d > 0 ? '▲' : '▼';
    const sign = d > 0 ? '+' : '';
    const pctSign = pct !== null && pct > 0 ? '+' : '';
    const pctText = pct === null ? 'n/a' : pctSign + formatNum(pct, 1) + '%';

    if (kind === 'ctr') {
      return { arrow, text: arrow + ' ' + sign + formatNum(d, 1) + ' pp (' + pctText + ')' };
    }
    return { arrow, text: arrow + ' ' + sign + formatNum(d, 0) + ' (' + pctText + ')' };
  }

  // A metric cell/header that GSC rendered as one column holding both values
  // (e.g. "1,234\n987") → { cur, prev } | null.
  // A "part" must be a bare number (with optional K/M/B/% suffix) -- no
  // letters and no brackets. Rejects a single value with a parenthesised
  // percentage annotation, e.g. "1,234 (5%)", which is one number with
  // commentary, not a cur/prev pair (fix-1 item 6).
  function isPlainNumberPart(s) {
    return !/[A-Za-z()\[\]{}]/.test(s);
  }

  function splitPair(text) {
    if (text === null || text === undefined) return null;
    const s = String(text);
    let parts = s.split(/[\n\r]+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) parts = s.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) return null;
    if (!isPlainNumberPart(parts[0]) || !isPlainNumberPart(parts[1])) return null;
    const cur = parseMetric(parts[0]);
    const prev = parseMetric(parts[1]);
    if (cur === null || prev === null) return null;
    return { cur, prev };
  }

  // Text of a GSC cell with our own inline badges excluded, so a rebuild
  // never parses "444▲ 10%" — the exact way the earlier column-injecting
  // version drifted one column after its first render.
  function cellValue(cell) {
    if (!cell) return '';
    if (!cell.querySelector || !cell.querySelector('[data-seo-bw-compare]')) return (cell.textContent || '').trim();
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('[data-seo-bw-compare]').forEach((n) => n.remove());
    return (clone.textContent || '').trim();
  }

  function getRowCells(tr) {
    return Array.prototype.filter.call(tr.children, (el) => el.tagName === 'TD' || el.tagName === 'TH');
  }

  function getHeaderRow(table) {
    const thead = table.querySelector('thead');
    if (thead) {
      const tr = thead.querySelector('tr');
      if (tr) return tr;
    }
    return table.querySelector('tr');
  }

  function getHeaderCells(table) {
    const headerRow = getHeaderRow(table);
    return headerRow ? getRowCells(headerRow) : [];
  }

  // fix-1 item 11 (MINOR): prefer the actual <tbody> element's rows -- this
  // is what naturally excludes a <tfoot> totals row (table.rows includes
  // every section) -- and only fall back to "everything but the header row"
  // when the table has no <tbody> at all.
  function getBodyRows(table) {
    if (table.tBodies && table.tBodies.length > 0) {
      return Array.prototype.slice.call(table.tBodies[0].rows);
    }
    const headerRow = getHeaderRow(table);
    return Array.prototype.filter.call(table.rows, (tr) => tr !== headerRow);
  }

  // table → null (not compare mode) | { labelIdx, metrics: [{ kind, curIdx,
  // prevIdx, diffIdx|null }] }. See task brief for the header-pairing rules
  // and the single-header/two-numbers fallback (confirmed against body rows
  // via splitPair, so an ordinary single-range table doesn't false-positive).
  function detectCompareColumns(table) {
    if (!table || typeof table.querySelectorAll !== 'function') return null;
    const headerCells = getHeaderCells(table);
    if (!headerCells.length) return null;

    // Live GSC (2026-09-06): headers are two-line (metric name and period in
    // nested divs, so textContent runs them together), deselected metrics
    // keep their columns in the DOM as display:none, and the header row can
    // carry a leading cell the body rows lack. Read header text with the
    // spacing walker, skip hidden cells outright (a hidden pair is a
    // phantom metric), and calibrate header→body indices against the
    // numbers actually present in the body rows (below).
    const items = headerCells
      .map((cell, idx) => ({ idx, text: spacedText(cell), hidden: isHiddenCell(cell) }))
      .filter((it) => !it.hidden);

    let labelIdx = null;
    const metrics = [];
    const pending = {};
    let lastCompleted = null;
    const PREVIOUS_RE = /\bprevious\b/i;

    items.forEach((item) => {
      if (/difference/i.test(item.text)) {
        if (lastCompleted && lastCompleted.diffIdx === null) lastCompleted.diffIdx = item.idx;
        return;
      }
      const kind = metricKind(item.text);
      if (!kind) {
        // An empty header (sort/checkbox column) is never the label column.
        if (labelIdx === null && item.text) labelIdx = item.idx;
        return;
      }
      if (pending[kind] === undefined) {
        pending[kind] = item;
      } else {
        // fix-1 item 5 (IMPORTANT): when exactly one of the pair's headers
        // says "previous", that one is prevIdx regardless of which header
        // came first. Positional order (first seen = cur) is only a
        // fallback for when neither or both headers say "previous".
        const first = pending[kind];
        const second = item;
        const firstIsPrev = PREVIOUS_RE.test(first.text);
        const secondIsPrev = PREVIOUS_RE.test(second.text);
        let curIdx, prevIdx;
        if (firstIsPrev && !secondIsPrev) {
          curIdx = second.idx;
          prevIdx = first.idx;
        } else if (secondIsPrev && !firstIsPrev) {
          curIdx = first.idx;
          prevIdx = second.idx;
        } else {
          curIdx = first.idx;
          prevIdx = second.idx;
        }
        const entry = { kind, curIdx, prevIdx, diffIdx: null };
        metrics.push(entry);
        lastCompleted = entry;
        delete pending[kind];
      }
    });

    // Fallback: a single header for a kind might be GSC rendering the pair
    // as one combined column. Only trust that if a MAJORITY of body rows
    // actually carry two numbers there (fix-1 item 6) — one stray row
    // (or none) is not enough to call an ordinary single-value column
    // compare mode.
    const bodyRows = getBodyRows(table);
    Object.keys(pending).forEach((kind) => {
      const idx = pending[kind].idx;
      const matchCount = bodyRows.filter((tr) => {
        const cells = getRowCells(tr);
        return cells[idx] && splitPair(cells[idx].textContent || '') !== null;
      }).length;
      if (bodyRows.length > 0 && matchCount > bodyRows.length / 2) {
        metrics.push({ kind, curIdx: idx, prevIdx: idx, diffIdx: null });
      }
    });

    if (metrics.length === 0) return null;
    const hdr = { labelIdx: labelIdx === null ? 0 : labelIdx, metrics };
    return calibrateToBody(hdr, bodyRows);
  }

  // A cell GSC has hidden (deselected metric) must not become a metric.
  function isHiddenCell(cell) {
    if (!cell) return true;
    if (cell.hidden) return true;
    if (cell.style && cell.style.display === 'none') return true;
    if (typeof getComputedStyle === 'function' && cell.ownerDocument && cell.ownerDocument.defaultView) {
      try { return cell.ownerDocument.defaultView.getComputedStyle(cell).display === 'none'; } catch (e) { /* jsdom edge */ }
    }
    return false;
  }

  // Header indices and body indices are not guaranteed to line up (the live
  // header row has an extra leading cell). Try small offsets and keep the
  // one under which the most (row, metric) cells parse as numbers and the
  // label cell does not. Header indices are kept alongside (hdr*) so the
  // header "% change" cell is inserted against the header row's own layout.
  function calibrateToBody(hdr, bodyRows) {
    const OFFSETS = [0, -1, 1, -2, 2];
    let best = null;
    OFFSETS.forEach((off) => {
      let score = 0;
      bodyRows.forEach((tr) => {
        const cells = getRowCells(tr);
        const labelCell = cells[hdr.labelIdx + off];
        if (labelCell && parseMetric(cellValue(labelCell)) === null && cellValue(labelCell)) score += 1;
        hdr.metrics.forEach((m) => {
          const c = cells[m.curIdx + off];
          const p = cells[m.prevIdx + off];
          const cv = c ? parseMetric(cellValue(c)) : null;
          const pv = p ? parseMetric(cellValue(p)) : null;
          if (cv !== null) score += 1;
          if (pv !== null) score += 1;
          // Decisive signal: inside a run of numeric columns "is a number"
          // cannot tell a one-column shift apart, but GSC's Difference
          // column equals current − previous only under the right alignment.
          if (m.diffIdx !== null && cv !== null && pv !== null) {
            const d = cells[m.diffIdx + off];
            const dv = d ? parseMetric(cellValue(d)) : null;
            if (dv !== null && Math.abs((cv - pv) - dv) < 0.06) score += 3;
          }
        });
      });
      if (best === null || score > best.score) best = { off, score };
    });
    const off = best ? best.off : 0;
    return {
      labelIdx: hdr.labelIdx + off,
      metrics: hdr.metrics.map((m) => ({
        kind: m.kind,
        curIdx: m.curIdx + off,
        prevIdx: m.prevIdx + off,
        diffIdx: m.diffIdx === null ? null : m.diffIdx + off,
        hdrCurIdx: m.curIdx,
        hdrPrevIdx: m.prevIdx,
        hdrDiffIdx: m.diffIdx,
      })),
    };
  }

  // Google's per-row hover actions ("Copy URL to clipboard", "Open in new
  // tab", "Inspect URL", "Copy query…") sit as plain text inside the label
  // cell after the value; textContent concatenated them into the label.
  const ACTION_LABEL = /^(copy\b|open\b|inspect\b|filter\b|view\b)/i;

  function extractLabel(cell) {
    if (!cell) return '';
    if (cell.querySelectorAll) {
      for (const el of cell.querySelectorAll('[title]')) {
        if (el.closest && el.closest('[role="button"], button, [' + MARK + ']')) continue;
        // fix-1 item 9 (MINOR): collapse whitespace here too -- a [title]
        // with an embedded newline or run of spaces was leaking straight
        // into the label (and from there into the TSV export) uncollapsed.
        const t = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        if (t && !ACTION_LABEL.test(t)) return t;
      }
    }
    // The value is always the FIRST text node in document order.
    if (typeof document !== 'undefined' && document.createTreeWalker) {
      const walker = document.createTreeWalker(cell, 4 /* SHOW_TEXT */, {
        acceptNode: (n) => {
          const parent = n.parentElement;
          return parent && parent.closest && parent.closest('[role="button"], button, [' + MARK + ']') ? 2 : 1;
        },
      });
      let node;
      while ((node = walker.nextNode())) {
        const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      return '';
    }
    return (cell.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // (tr, cols) → { label, metrics: { [kind]: { cur, prev, delta, pct, better } } }
  function computeRow(tr, cols) {
    if (!tr || !cols) return null;
    const cells = getRowCells(tr);
    const label = extractLabel(cells[cols.labelIdx]);
    const metrics = {};
    cols.metrics.forEach((m) => {
      let cur = null;
      let prev = null;
      if (m.curIdx === m.prevIdx) {
        const cell = cells[m.curIdx];
        const pair = cell ? splitPair(cell.textContent || '') : null;
        if (pair) {
          cur = pair.cur;
          prev = pair.prev;
        }
      } else {
        const curCell = cells[m.curIdx];
        const prevCell = cells[m.prevIdx];
        cur = curCell ? parseMetric(curCell.textContent || '') : null;
        prev = prevCell ? parseMetric(prevCell.textContent || '') : null;
      }
      metrics[m.kind] = { cur, prev, delta: delta(cur, prev), pct: pctChange(cur, prev), better: isBetter(m.kind, cur, prev) };
    });
    return { label, metrics };
  }

  // ---- Section B: DOM layer -----------------------------------------------
  //
  // Deliberately minimal (owner ruling 2026-09-06: "we just wanted a little
  // icon and a little number … user experience should be largely the same").
  // Two injections only, both additive and inline:
  //   1. a small badge on each metric summary card ("▲ +230 (+23%)");
  //   2. a small percent badge INSIDE Google's own Difference cell of every
  //      data row ("▲ 10%"), so the table gains no columns, no toolbar, no
  //      sorted copies, no summary line — and, because no cells are ever
  //      added, a re-detection after a re-render can never read one column
  //      off (the defect the column-injecting version had).

  const MARK = 'data-seo-bw-compare';
  const BADGE_CLASS = 'seo-bw-cmp-badge';
  const PCT_CLASS = 'seo-bw-cmp-pct';

  const CARD_KIND_RE = /^\s*(?:total |average )?(clicks|impressions|ctr|position)\b/i;

  function cardKindAtStart(text) {
    const m = CARD_KIND_RE.exec(text);
    return m ? m[1].toLowerCase() : null;
  }

  // Card markup often concatenates the label straight into its numbers with
  // no whitespace between sibling text nodes (e.g. the label div followed
  // directly by a value div renders as "Total clicks1,230" in textContent).
  // Join each text node's trimmed content with a single space so the
  // START-anchored word-boundary check above sees "Total clicks 1,230" (a
  // real boundary after "clicks") instead of "Total clicks1,230" (no
  // boundary between the "s" and the "1", both word characters).
  function spacedText(el) {
    if (typeof document === 'undefined' || !document.createTreeWalker) return (el.textContent || '').trim();
    // Skip text under our own injected nodes (badges) so a card's measured
    // text — and the 200-char qualification guard — never includes them.
    const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, {
      acceptNode: (n) => {
        const parent = n.parentElement;
        return parent && parent.closest && parent.closest('[' + MARK + ']') ? 2 /* FILTER_REJECT */ : 1;
      },
    });
    const parts = [];
    let node = walker.nextNode();
    while (node) {
      const t = (node.textContent || '').trim();
      if (t) parts.push(t);
      node = walker.nextNode();
    }
    return parts.join(' ');
  }

  // fix-1 item 2: normalize the typographic minus sign here too, and add a
  // boundary after the K/M/B/% suffix so it can't swallow the leading
  // letter of a following word (mirrors the parseMetric fix).

  // fix-1 item 2: a qualifying "numeric leaf" is a DOM text node whose whole
  // trimmed content is nothing but a parsable number -- no letters at all.
  // This is what lets us reject a chip like "Position filter: between 2 and
  // 10" (one text node, and it has letters) while still finding the two
  // number leaves inside a real metric card's child elements.
  function isPureNumberLeaf(text) {
    const t = (text || '').trim();
    if (!t) return false;
    if (/[A-Za-z]/.test(t)) return false;
    return parseMetric(t) !== null;
  }

  function collectNumericLeaves(el) {
    const leaves = [];
    if (typeof document === 'undefined' || !document.createTreeWalker) return leaves;
    // Skip text nodes inside anything WE injected (e.g. our own badge span)
    // -- otherwise re-running this on a card that already carries our badge
    // would pick up the badge's own rendered numbers as if they were fresh
    // current/previous values, corrupting the very value it computed from.
    const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, {
      acceptNode(node) {
        if (node.parentElement && node.parentElement.closest('[' + MARK + ']')) return 2; // FILTER_REJECT
        return 1; // FILTER_ACCEPT
      },
    });
    let node = walker.nextNode();
    while (node) {
      const t = (node.textContent || '').trim();
      if (t && isPureNumberLeaf(t)) leaves.push(parseMetric(t));
      node = walker.nextNode();
    }
    return leaves;
  }

  // A GSC metric summary tile is a `[role="button"]` toggle (same structural
  // anchor gsc-inject.js already relies on elsewhere) whose text names a
  // metric AT THE START and whose only numeric leaf text nodes are the
  // current + previous totals (fix-1 item 2). The card pass only runs when
  // some table on the page is already in compare mode, so an ordinary
  // (non-compare) report page never gets badged cards from a coincidental
  // metric-shaped label.
  function findMetricCards(scope, anyCompare) {
    if (!anyCompare) return [];
    const candidates = Array.prototype.slice.call(scope.querySelectorAll('[role="button"]'));
    const qualifies = candidates
      .filter((el) => !el.closest('table'))
      .map((el) => {
        // Measure the card's OWN text (our injected badge excluded): a card
        // near the cap would otherwise qualify once, grow past it after the
        // badge is appended, and freeze at its first value.
        const text = spacedText(el).trim();
        if (!text || text.length > 200) return null;
        const kind = cardKindAtStart(text);
        if (!kind) return null;
        const leaves = collectNumericLeaves(el);
        if (leaves.length < 2) return null;
        const [cur, prev] = leaves.slice(-2);
        return { el, kind, cur, prev };
      })
      .filter(Boolean);
    return qualifies.filter((c) => !qualifies.some((other) => other.el !== c.el && c.el.contains(other.el)));
  }

  // fix-1 item 1a (CRITICAL): skip the DOM write entirely when the badge's
  // text/class would be unchanged -- otherwise every apply() call mutates
  // the badge (even to the same value), which the runner's MutationObserver
  // sees and reacts to, which re-triggers apply(): an observer loop that
  // never settles.
  function applyCardBadge(card) {
    const { el, kind, cur, prev } = card;
    const { text } = formatDelta(kind, cur, prev);
    const better = isBetter(kind, cur, prev);
    const cls = BADGE_CLASS + ' ' + (better === null ? 'flat' : better ? 'good' : 'bad');
    const title = 'current → previous: ' + formatRaw(kind, cur) + ' → ' + formatRaw(kind, prev);
    let badge = el.querySelector('.' + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute(MARK, 'badge');
      el.appendChild(badge);
    }
    if (badge.className !== cls) badge.className = cls;
    if (badge.textContent !== text) badge.textContent = text;
    if (badge.title !== title) badge.title = title;
  }

  // Compact relative change for the row badge: "▲ 10%", "▼ 100%", "▲ new"
  // (previous was 0), "0%" when unchanged. Position is lower-is-better, so
  // the colour comes from isBetter(), not from the arrow's direction.
  function formatPctBadge(kind, cur, prev) {
    if (!isNum(cur) || !isNum(prev)) return null;
    const better = isBetter(kind, cur, prev);
    const tone = better === null ? 'flat' : better ? 'good' : 'bad';
    if (prev === 0) {
      if (cur === 0) return { text: '0%', tone: 'flat' };
      return { text: (cur > prev ? '▲' : '▼') + ' new', tone };
    }
    const pct = pctChange(cur, prev);
    if (!isNum(pct)) return null;
    if (pct === 0) return { text: '0%', tone: 'flat' };
    const arrow = pct > 0 ? '▲' : '▼';
    return { text: arrow + ' ' + formatNum(Math.abs(pct), 1) + '%', tone };
  }

  function clearInjected(table) {
    table.querySelectorAll('[' + MARK + '="pct"]').forEach((n) => n.remove());
  }

  // One inline badge per metric per row, appended INSIDE the row's own
  // Difference cell (or the Previous cell when the table has no Difference
  // column). Rows without that cell (colspan "no data" rows) get nothing.
  function annotateRows(table, cols) {
    getBodyRows(table).forEach((tr) => {
      const cells = getRowCells(tr);
      const row = computeRow(tr, cols);
      if (!row) return;
      cols.metrics.forEach((m) => {
        const anchor = cells[m.diffIdx !== null ? m.diffIdx : m.prevIdx];
        if (!anchor) return;
        const r = row.metrics[m.kind];
        const badge = r ? formatPctBadge(m.kind, r.cur, r.prev) : null;
        if (!badge) return;
        const span = document.createElement('span');
        span.setAttribute(MARK, 'pct');
        span.setAttribute('data-seo-bw-metric', m.kind);
        span.className = PCT_CLASS + ' ' + badge.tone;
        span.textContent = badge.text;
        span.title = 'current → previous: ' + formatRaw(m.kind, r.cur) + ' → ' + formatRaw(m.kind, r.prev);
        anchor.appendChild(span);
      });
    });
  }

  function computeTableHash(table, rowResults) {
    // Exclude cells WE injected (the "% change" header) from the header
    // fingerprint -- otherwise the very first apply() call's own header
    // insertion would change the hash out from under itself, and every
    // subsequent call would see a "changed" header and rebuild forever.
    const headerText = getHeaderCells(table)
      .filter((c) => !c.hasAttribute(MARK))
      .map((c) => (c.textContent || '').trim())
      .join('|');
    const rowsPart = rowResults
      .map((r) => {
        const metricsPart = Object.keys(r.metrics)
          .sort()
          .map((k) => k + ':' + r.metrics[k].cur + ',' + r.metrics[k].prev)
          .join(';');
        return r.label + '=' + metricsPart;
      })
      .join('||');
    return headerText + '##' + rowsPart;
  }

  function applyToTable(table, colsArg) {
    const cols = colsArg !== undefined ? colsArg : detectCompareColumns(table);
    if (!cols) {
      if (table.__sbwCmpHash !== undefined) {
        clearInjected(table);
        delete table.__sbwCmpHash;
      }
      return;
    }
    const rowResults = getBodyRows(table).map((tr) => computeRow(tr, cols)).filter(Boolean);
    const hash = computeTableHash(table, rowResults);
    // True no-op when nothing changed: zero DOM mutations, so the runner's
    // MutationObserver sees nothing from a second call with the same data.
    if (table.__sbwCmpHash === hash) return;
    table.__sbwCmpHash = hash;
    clearInjected(table);
    annotateRows(table, cols);
  }

  // apply(root) — scans for GSC metric summary tiles and compare-mode
  // Performance tables under `root` (defaults to `document`) and injects
  // the two badges. Idempotent: unchanged tables/cards are left alone.
  function apply(scopeRoot) {
    const scope = scopeRoot || document;
    if (!scope.querySelectorAll) return;
    const tables = Array.prototype.slice.call(scope.querySelectorAll('table'));
    const colsList = tables.map((t) => detectCompareColumns(t));
    if (colsList.some((c) => c !== null)) {
      findMetricCards(scope, true).forEach(applyCardBadge);
    } else {
      // Compare mode ended: a badge left behind would describe numbers that
      // no longer exist on the tile.
      Array.prototype.slice
        .call(scope.querySelectorAll('[' + MARK + '="badge"]'))
        .forEach((n) => n.remove());
    }
    tables.forEach((t, i) => applyToTable(t, colsList[i]));
  }

  const CSS =
    '.' + BADGE_CLASS + '{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;font:600 11px/1.6 system-ui,sans-serif;vertical-align:middle}' +
    '.' + BADGE_CLASS + '.good{background:rgba(10,100,64,.12);color:#0a6440}' +
    '.' + BADGE_CLASS + '.bad{background:rgba(179,39,43,.12);color:#b3272b}' +
    '.' + BADGE_CLASS + '.flat{background:rgba(95,99,104,.12);color:#5f6368}' +
    '.' + PCT_CLASS + '{display:inline-block;margin-left:6px;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap;vertical-align:baseline}' +
    '.' + PCT_CLASS + '.good{color:#0a6440}' +
    '.' + PCT_CLASS + '.bad{color:#b3272b}' +
    '.' + PCT_CLASS + '.flat{color:#5f6368}';

  const api = {
    parseMetric,
    metricKind,
    pctChange,
    delta,
    isBetter,
    formatDelta,
    formatPctBadge,
    splitPair,
    detectCompareColumns,
    computeRow,
    apply,
    CSS,
  };
  root.SBWGscCompare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
