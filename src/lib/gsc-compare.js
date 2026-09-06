// SEO Bandwagon — Search Console compare-mode math (pure functions, testable)
// + DOM layer that injects % change, direction-aware colouring, sort/filter/
// copy tools and visible-row totals onto a Performance report that is
// comparing two date ranges.
//
// Everything here runs against the page's own DOM and computes from the
// numbers already rendered there. Nothing is sent anywhere, ever.
//
// Section A (pure, unit-tested): parseMetric/metricKind/pctChange/delta/
// isBetter/formatDelta/splitPair/detectCompareColumns/computeRow/summarize/
// rankByPct/filterByPct/toTsv.
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
    // Normalize non-breaking / narrow no-break spaces (locale thousand seps).
    s = s.replace(/[\u00A0\u202F]/g, ' ').trim();
    if (!s) return null;
    if (/^[-\u2010-\u2015]+$/.test(s)) return null; // '-', en/em dash, figure dash, etc.

    // GSC's "less than" placeholder, e.g. "<0.1%" → half the stated threshold.
    const lt = s.match(/<\s*(\d[\d,.\s]*)\s*%/);
    if (lt) {
      const n = parseFloat(lt[1].replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n / 2 : null;
    }

    const m = s.match(/(-?\d[\d,\s]*(?:\.\d+)?)\s*(K|M|B|%)?/i);
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
  function splitPair(text) {
    if (text === null || text === undefined) return null;
    const s = String(text);
    let parts = s.split(/[\n\r]+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) parts = s.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) return null;
    const cur = parseMetric(parts[0]);
    const prev = parseMetric(parts[1]);
    if (cur === null || prev === null) return null;
    return { cur, prev };
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

  function getBodyRows(table) {
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

    const items = headerCells.map((cell, idx) => ({ idx, text: (cell.textContent || '').trim() }));

    let labelIdx = null;
    const metrics = [];
    const pending = {};
    let lastCompleted = null;

    items.forEach((item) => {
      if (/difference/i.test(item.text)) {
        if (lastCompleted && lastCompleted.diffIdx === null) lastCompleted.diffIdx = item.idx;
        return;
      }
      const kind = metricKind(item.text);
      if (!kind) {
        if (labelIdx === null) labelIdx = item.idx;
        return;
      }
      if (pending[kind] === undefined) {
        pending[kind] = item.idx;
      } else {
        const entry = { kind, curIdx: pending[kind], prevIdx: item.idx, diffIdx: null };
        metrics.push(entry);
        lastCompleted = entry;
        delete pending[kind];
      }
    });

    // Fallback: a single header for a kind might be GSC rendering the pair
    // as one combined column. Only trust that if body cells actually carry
    // two numbers — otherwise this is just an ordinary, non-compare table.
    const bodyRows = getBodyRows(table);
    Object.keys(pending).forEach((kind) => {
      const idx = pending[kind];
      const hasPair = bodyRows.some((tr) => {
        const cells = getRowCells(tr);
        return cells[idx] && splitPair(cells[idx].textContent || '') !== null;
      });
      if (hasPair) metrics.push({ kind, curIdx: idx, prevIdx: idx, diffIdx: null });
    });

    if (metrics.length === 0) return null;
    return { labelIdx: labelIdx === null ? 0 : labelIdx, metrics };
  }

  function extractLabel(cell) {
    if (!cell) return '';
    const titled = cell.querySelector && cell.querySelector('[title]');
    if (titled) {
      const t = (titled.getAttribute('title') || '').trim();
      if (t) return t;
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

  function buildTotal(cur, prev, kind) {
    return { cur, prev, delta: delta(cur, prev), pct: pctChange(cur, prev), better: isBetter(kind, cur, prev) };
  }

  // rowResults → totals: clicks/impressions summed, CTR = summed clicks /
  // summed impressions (weighted, both periods), position = impressions-
  // weighted average (both periods) — each with delta/pct/better, plus count.
  // Falls back to a plain average for CTR/position when impressions aren't
  // present in the rows at all (judgment call — see task report).
  function summarize(rowResults) {
    const rows = Array.isArray(rowResults) ? rowResults : [];
    const totals = { count: rows.length };

    let haveClicks = false;
    let haveImps = false;
    let haveCtr = false;
    let havePos = false;
    let clicksCur = 0, clicksPrev = 0;
    let impsCur = 0, impsPrev = 0;
    let ctrSumCur = 0, ctrSumPrev = 0, ctrCount = 0;
    let posSumCur = 0, posSumPrev = 0, posCount = 0;
    let posWCur = 0, posWPrev = 0, posWeightCur = 0, posWeightPrev = 0;

    rows.forEach((row) => {
      const m = (row && row.metrics) || {};
      if (m.clicks) {
        haveClicks = true;
        if (isNum(m.clicks.cur)) clicksCur += m.clicks.cur;
        if (isNum(m.clicks.prev)) clicksPrev += m.clicks.prev;
      }
      if (m.impressions) {
        haveImps = true;
        if (isNum(m.impressions.cur)) impsCur += m.impressions.cur;
        if (isNum(m.impressions.prev)) impsPrev += m.impressions.prev;
      }
      if (m.ctr) {
        haveCtr = true;
        if (isNum(m.ctr.cur)) { ctrSumCur += m.ctr.cur; ctrCount++; }
        if (isNum(m.ctr.prev)) ctrSumPrev += m.ctr.prev;
      }
      if (m.position) {
        havePos = true;
        const wCur = m.impressions && isNum(m.impressions.cur) ? m.impressions.cur : null;
        const wPrev = m.impressions && isNum(m.impressions.prev) ? m.impressions.prev : null;
        if (isNum(m.position.cur)) {
          posSumCur += m.position.cur;
          posCount++;
          if (wCur !== null) { posWCur += m.position.cur * wCur; posWeightCur += wCur; }
        }
        if (isNum(m.position.prev)) {
          posSumPrev += m.position.prev;
          if (wPrev !== null) { posWPrev += m.position.prev * wPrev; posWeightPrev += wPrev; }
        }
      }
    });

    if (haveClicks) totals.clicks = buildTotal(clicksCur, clicksPrev, 'clicks');
    if (haveImps) totals.impressions = buildTotal(impsCur, impsPrev, 'impressions');

    // CTR total prefers the weighted clicks/impressions ratio whenever both
    // are available (correct even when the table has no separate CTR
    // column); only falls back to a plain average of per-row CTR values
    // when clicks/impressions aren't there to weight it (judgment call).
    if (haveClicks && haveImps) {
      const ctrCur = impsCur > 0 ? (clicksCur / impsCur) * 100 : (ctrCount > 0 ? ctrSumCur / ctrCount : null);
      const ctrPrev = impsPrev > 0 ? (clicksPrev / impsPrev) * 100 : (ctrCount > 0 ? ctrSumPrev / ctrCount : null);
      totals.ctr = buildTotal(ctrCur, ctrPrev, 'ctr');
    } else if (haveCtr) {
      const ctrCur = ctrCount > 0 ? ctrSumCur / ctrCount : null;
      const ctrPrev = ctrCount > 0 ? ctrSumPrev / ctrCount : null;
      totals.ctr = buildTotal(ctrCur, ctrPrev, 'ctr');
    }

    if (havePos) {
      const posCur = posWeightCur > 0 ? posWCur / posWeightCur : (posCount > 0 ? posSumCur / posCount : null);
      const posPrev = posWeightPrev > 0 ? posWPrev / posWeightPrev : (posCount > 0 ? posSumPrev / posCount : null);
      totals.position = buildTotal(posCur, posPrev, 'position');
    }

    return totals;
  }

  // For position, a rising number is a decline: invert its pct so "drop"
  // and "gain" mean the same real-world thing across every metric kind.
  function orientedPct(kind, pct) {
    if (!isNum(pct)) return null;
    return kind === 'position' ? -pct : pct;
  }

  function orientedPctFor(row, kind) {
    const m = row && row.metrics && row.metrics[kind];
    return m ? orientedPct(kind, m.pct) : null;
  }

  // Sorted COPY (never mutates), by oriented pct. dir 'drop': biggest
  // declines first. dir 'gain': biggest improvements first. Rows with no
  // pct for this kind sort last regardless of direction.
  function rankByPct(rowResults, kind, dir) {
    const rows = Array.isArray(rowResults) ? rowResults.slice() : [];
    return rows.sort((a, b) => {
      const oa = orientedPctFor(a, kind);
      const ob = orientedPctFor(b, kind);
      if (oa === null && ob === null) return 0;
      if (oa === null) return 1;
      if (ob === null) return -1;
      return dir === 'gain' ? ob - oa : oa - ob;
    });
  }

  // { minDrop?, minGain? } are magnitudes (e.g. 25 for "≥ 25%"), oriented the
  // same way as rankByPct so position's inversion applies here too.
  function filterByPct(rowResults, kind, opts) {
    const { minDrop, minGain } = opts || {};
    const rows = Array.isArray(rowResults) ? rowResults : [];
    if (minDrop == null && minGain == null) return rows.slice();
    return rows.filter((row) => {
      const o = orientedPctFor(row, kind);
      if (o === null) return false;
      if (minDrop != null && o <= -Math.abs(minDrop)) return true;
      if (minGain != null && o >= Math.abs(minGain)) return true;
      return false;
    });
  }

  function tsvGuard(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function plainNum(n, decimals) {
    if (!isNum(n)) return '';
    const factor = Math.pow(10, decimals);
    return String(Math.round(n * factor) / factor);
  }

  // (rowResults, cols) → TSV text: header + one row per result (label, then
  // per-metric current/previous/diff/% change). Cells that would be read as
  // a spreadsheet formula (start with = + - @ \t \r) are quoted.
  function toTsv(rowResults, cols) {
    const rows = Array.isArray(rowResults) ? rowResults : [];
    const metricsOrder = (cols && cols.metrics) || [];
    const header = ['Label'];
    metricsOrder.forEach((m) => {
      const label = m.kind.charAt(0).toUpperCase() + m.kind.slice(1);
      header.push(label + ' current', label + ' previous', label + ' diff', label + ' % change');
    });
    const lines = [header.map(tsvGuard).join('\t')];
    rows.forEach((row) => {
      const cells = [tsvGuard(row.label)];
      metricsOrder.forEach((m) => {
        const rm = (row.metrics && row.metrics[m.kind]) || {};
        const dec = m.kind === 'clicks' || m.kind === 'impressions' ? 0 : 1;
        cells.push(tsvGuard(plainNum(rm.cur, dec)));
        cells.push(tsvGuard(plainNum(rm.prev, dec)));
        cells.push(tsvGuard(plainNum(rm.delta, dec)));
        cells.push(tsvGuard(isNum(rm.pct) ? plainNum(rm.pct, 1) + '%' : ''));
      });
      lines.push(cells.join('\t'));
    });
    return lines.join('\n');
  }

  // ---- Section B: DOM layer -----------------------------------------------

  const MARK = 'data-seo-bw-compare';
  const BADGE_CLASS = 'seo-bw-cmp-badge';
  const CELL_CLASS = 'seo-bw-cmp-cell';
  const TOOLS_CLASS = 'seo-bw-cmp-tools';
  const SUMMARY_CLASS = 'seo-bw-cmp-summary';
  const CHIP_CLASS = 'seo-bw-cmp-chip';

  // tbody element → array of row labels in the order first observed. Reused
  // across apply() calls so our own sort buttons (which reorder the DOM and
  // so retrigger the runner's MutationObserver) don't clobber "true" order.
  const ORIGINAL_ORDER = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function sameLabelSet(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((x) => set.has(x));
  }

  function findKindInText(text) {
    // Leading \b only: card text often concatenates the label straight into
    // its numbers with no whitespace (e.g. "Average position6.2vs8.3"), and
    // digits are word characters, so a trailing \b would never match there.
    const s = text.toLowerCase();
    if (/\bctr/.test(s)) return 'ctr';
    if (/\bclick/.test(s)) return 'clicks';
    if (/\bimpression/.test(s)) return 'impressions';
    if (/\bposition/.test(s)) return 'position';
    return null;
  }

  function extractNumberTokens(text) {
    const re = /<\s*\d[\d,.\s]*%|-?\d[\d,\s]*(?:\.\d+)?\s*(?:K|M|B|%)?/gi;
    const tokens = [];
    let match;
    while ((match = re.exec(text)) !== null) tokens.push(match[0]);
    return tokens;
  }

  function extractNumbers(text) {
    return extractNumberTokens(text)
      .map(parseMetric)
      .filter((n) => n !== null);
  }

  // A GSC metric summary tile is a `[role="button"]` toggle (same structural
  // anchor gsc-inject.js already relies on elsewhere) whose text names a
  // metric and carries the current + previous totals. Deepest-match only, so
  // a wrapping ancestor with the same text isn't double-counted.
  function findMetricCards(scope) {
    const candidates = Array.prototype.slice.call(scope.querySelectorAll('[role="button"]'));
    const qualifies = candidates
      .filter((el) => !el.closest('table'))
      .map((el) => {
        const text = (el.textContent || '').trim();
        if (!text || text.length > 200) return null;
        const kind = findKindInText(text);
        if (!kind) return null;
        const nums = extractNumbers(text);
        if (nums.length < 2) return null;
        return { el, kind, cur: nums[0], prev: nums[1] };
      })
      .filter(Boolean);
    return qualifies.filter((c) => !qualifies.some((other) => other.el !== c.el && c.el.contains(other.el)));
  }

  function applyCardBadge(card) {
    const { el, kind, cur, prev } = card;
    const { text } = formatDelta(kind, cur, prev);
    const better = isBetter(kind, cur, prev);
    const cls = better === null ? 'flat' : better ? 'good' : 'bad';
    let badge = el.querySelector('.' + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute(MARK, 'badge');
      el.appendChild(badge);
    }
    badge.className = BADGE_CLASS + ' ' + cls;
    badge.textContent = text;
    badge.title = 'current → previous: ' + formatRaw(kind, cur) + ' → ' + formatRaw(kind, prev);
  }

  function clearInjected(table) {
    table.querySelectorAll('[' + MARK + ']').forEach((n) => n.remove());
    const prev = table.previousElementSibling;
    if (prev && prev.getAttribute && prev.getAttribute(MARK) === 'tools') prev.remove();
    const next = table.nextElementSibling;
    if (next && next.getAttribute && next.getAttribute(MARK) === 'summary') next.remove();
  }

  function insertPctColumns(table, cols) {
    const headerRow = getHeaderRow(table);
    const bodyRows = getBodyRows(table);
    const anchored = cols.metrics
      .map((m) => ({ m, anchor: m.diffIdx !== null ? m.diffIdx : m.prevIdx }))
      .sort((a, b) => b.anchor - a.anchor); // right-to-left so earlier indices stay valid

    anchored.forEach(({ m, anchor }) => {
      if (headerRow) {
        const anchorCell = getRowCells(headerRow)[anchor];
        const th = document.createElement('th');
        th.textContent = '% change';
        th.setAttribute(MARK, 'pct-header');
        if (anchorCell) anchorCell.parentNode.insertBefore(th, anchorCell.nextSibling);
      }
      bodyRows.forEach((tr) => {
        const cells = getRowCells(tr);
        const anchorCell = cells[anchor];
        if (!anchorCell) return;
        const row = computeRow(tr, cols);
        const m2 = row && row.metrics[m.kind];
        const td = document.createElement('td');
        td.setAttribute(MARK, 'pct-cell');
        td.setAttribute('data-seo-bw-metric', m.kind);
        if (m2 && isNum(m2.cur) && isNum(m2.prev)) {
          const better = isBetter(m.kind, m2.cur, m2.prev);
          td.className = CELL_CLASS + ' ' + (better === null ? 'flat' : better ? 'good' : 'bad');
          td.textContent = formatDelta(m.kind, m2.cur, m2.prev).text;
          td.title = 'current → previous: ' + formatRaw(m.kind, m2.cur) + ' → ' + formatRaw(m.kind, m2.prev);
        } else {
          td.className = CELL_CLASS + ' flat';
          td.textContent = '—';
        }
        anchorCell.parentNode.insertBefore(td, anchorCell.nextSibling);
      });
    });
  }

  function formatTotalText(kind, t) {
    const curStr = formatRaw(kind, t.cur);
    const prevStr = formatRaw(kind, t.prev);
    if (!isNum(t.delta) || t.delta === 0) return curStr + ' → ' + prevStr + ' • 0';
    const better = t.better;
    if (kind === 'position') {
      const arrow = better ? '▼' : '▲';
      return curStr + ' → ' + prevStr + ' ' + arrow + ' ' + formatNum(Math.abs(t.delta), 1) + ' (' + (better ? 'better' : 'worse') + ')';
    }
    const arrow = t.delta > 0 ? '▲' : '▼';
    if (kind === 'ctr') {
      return curStr + ' → ' + prevStr + ' ' + arrow + ' ' + formatNum(Math.abs(t.delta), 1) + ' pp';
    }
    const pctStr = isNum(t.pct) ? ' (' + (t.pct > 0 ? '+' : '') + formatNum(t.pct, 1) + '%)' : '';
    return curStr + ' → ' + prevStr + ' ' + arrow + ' ' + formatNum(Math.abs(t.delta), 0) + pctStr;
  }

  function buildSummaryText(totals) {
    const parts = ['Rows shown: ' + totals.count];
    ['clicks', 'impressions', 'ctr', 'position'].forEach((kind) => {
      if (totals[kind]) {
        const label = kind === 'ctr' ? 'CTR' : kind.charAt(0).toUpperCase() + kind.slice(1);
        parts.push(label + ' ' + formatTotalText(kind, totals[kind]));
      }
    });
    return parts.join(' · ');
  }

  function renderSummary(table, totals) {
    let el = table.nextElementSibling;
    if (!(el && el.getAttribute && el.getAttribute(MARK) === 'summary')) {
      el = document.createElement('div');
      el.className = SUMMARY_CLASS;
      el.setAttribute(MARK, 'summary');
      table.parentNode.insertBefore(el, table.nextSibling);
    }
    el.textContent = buildSummaryText(totals);
  }

  function makeChip(label, active) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = CHIP_CLASS + (active ? ' active' : '');
    chip.textContent = label;
    return chip;
  }

  function insertToolsStrip(table, cols) {
    const strip = document.createElement('div');
    strip.className = TOOLS_CLASS;
    strip.setAttribute(MARK, 'tools');

    const select = document.createElement('select');
    [
      ['clicks', 'Clicks'],
      ['impressions', 'Impressions'],
      ['ctr', 'CTR'],
      ['position', 'Position'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
    const firstKind = cols.metrics[0] && cols.metrics[0].kind;
    if (firstKind) select.value = firstKind;

    const btnDrop = document.createElement('button');
    btnDrop.type = 'button';
    btnDrop.textContent = 'Sort ▼ (biggest drops)';
    const btnGain = document.createElement('button');
    btnGain.type = 'button';
    btnGain.textContent = 'Sort ▲ (biggest gains)';
    const btnOrig = document.createElement('button');
    btnOrig.type = 'button';
    btnOrig.textContent = 'Original order';

    const chipsWrap = document.createElement('span');
    chipsWrap.className = 'seo-bw-cmp-chips';
    const chipAll = makeChip('All', true);
    const chipDrops = makeChip('Drops ≥ 25%');
    const chipGains = makeChip('Gains ≥ 25%');
    chipsWrap.appendChild(chipAll);
    chipsWrap.appendChild(chipDrops);
    chipsWrap.appendChild(chipGains);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy as TSV';

    strip.appendChild(select);
    strip.appendChild(btnDrop);
    strip.appendChild(btnGain);
    strip.appendChild(btnOrig);
    strip.appendChild(chipsWrap);
    strip.appendChild(copyBtn);

    let activeFilter = 'all';

    function visibleRowResults() {
      return getBodyRows(table)
        .filter((tr) => !tr.hidden)
        .map((tr) => computeRow(tr, cols))
        .filter(Boolean);
    }

    function updateSummary() {
      renderSummary(table, summarize(visibleRowResults()));
    }

    function applyFilter() {
      const allResults = getBodyRows(table).map((tr) => computeRow(tr, cols)).filter(Boolean);
      if (activeFilter === 'all') {
        getBodyRows(table).forEach((tr) => { tr.hidden = false; });
      } else {
        const opts = activeFilter === 'drops' ? { minDrop: 25 } : { minGain: 25 };
        const passing = new Set(filterByPct(allResults, select.value, opts).map((r) => r.label));
        getBodyRows(table).forEach((tr) => {
          const r = computeRow(tr, cols);
          tr.hidden = !(r && passing.has(r.label));
        });
      }
      updateSummary();
    }

    function setActiveChip(chip) {
      [chipAll, chipDrops, chipGains].forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    }

    select.addEventListener('change', applyFilter);
    chipAll.addEventListener('click', () => { activeFilter = 'all'; setActiveChip(chipAll); applyFilter(); });
    chipDrops.addEventListener('click', () => { activeFilter = 'drops'; setActiveChip(chipDrops); applyFilter(); });
    chipGains.addEventListener('click', () => { activeFilter = 'gains'; setActiveChip(chipGains); applyFilter(); });

    function reorderRows(orderedLabels) {
      const tbody = table.tBodies[0] || table;
      const byLabel = new Map();
      getBodyRows(table).forEach((tr) => {
        const r = computeRow(tr, cols);
        if (r) byLabel.set(r.label, tr);
      });
      orderedLabels.forEach((label) => {
        const tr = byLabel.get(label);
        if (tr) tbody.appendChild(tr);
      });
    }

    btnDrop.addEventListener('click', () => {
      const results = getBodyRows(table).map((tr) => computeRow(tr, cols)).filter(Boolean);
      reorderRows(rankByPct(results, select.value, 'drop').map((r) => r.label));
    });
    btnGain.addEventListener('click', () => {
      const results = getBodyRows(table).map((tr) => computeRow(tr, cols)).filter(Boolean);
      reorderRows(rankByPct(results, select.value, 'gain').map((r) => r.label));
    });
    btnOrig.addEventListener('click', () => {
      const tbody = table.tBodies[0] || table;
      const order = ORIGINAL_ORDER && ORIGINAL_ORDER.get(tbody);
      if (order) reorderRows(order);
    });

    copyBtn.addEventListener('click', () => {
      const results = visibleRowResults();
      const tsv = toTsv(results, cols);
      const finish = () => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied ' + results.length + ' rows';
        setTimeout(() => { copyBtn.textContent = original; }, 2000);
      };
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        root.navigator.clipboard.writeText(tsv).then(finish, finish);
      }
    });

    table.parentNode.insertBefore(strip, table);
    updateSummary();
    return strip;
  }

  function applyToTable(table) {
    clearInjected(table);
    const cols = detectCompareColumns(table);
    if (!cols) return;

    const tbody = table.tBodies[0] || table;
    const rowResults = getBodyRows(table).map((tr) => computeRow(tr, cols)).filter(Boolean);
    const labels = rowResults.map((r) => r.label);
    if (ORIGINAL_ORDER) {
      const stored = ORIGINAL_ORDER.get(tbody);
      if (!stored || !sameLabelSet(stored, labels)) ORIGINAL_ORDER.set(tbody, labels.slice());
    }

    insertPctColumns(table, cols);
    insertToolsStrip(table, cols);
  }

  // apply(root) — scans for GSC metric summary tiles and compare-mode
  // Performance tables under `root` (defaults to `document`) and injects
  // badges/cells/tools/summary. Idempotent: safe to call again after GSC
  // re-renders (existing injections are cleared and rebuilt each time).
  function apply(scopeRoot) {
    const scope = scopeRoot || document;
    if (!scope.querySelectorAll) return;
    findMetricCards(scope).forEach(applyCardBadge);
    Array.prototype.forEach.call(scope.querySelectorAll('table'), applyToTable);
  }

  const CSS =
    '.' + BADGE_CLASS + '{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;font:600 11px/1.6 system-ui,sans-serif;vertical-align:middle}' +
    '.' + BADGE_CLASS + '.good{background:rgba(10,100,64,.12);color:#0a6440}' +
    '.' + BADGE_CLASS + '.bad{background:rgba(179,39,43,.12);color:#b3272b}' +
    '.' + BADGE_CLASS + '.flat{background:rgba(95,99,104,.12);color:#5f6368}' +
    '.' + CELL_CLASS + '{font:12px/1.4 system-ui,sans-serif;white-space:nowrap}' +
    '.' + CELL_CLASS + '.good{color:#0a6440}' +
    '.' + CELL_CLASS + '.bad{color:#b3272b}' +
    '.' + CELL_CLASS + '.flat{color:#5f6368}' +
    '.' + TOOLS_CLASS + '{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0;font:13px/1.4 system-ui,sans-serif}' +
    '.' + TOOLS_CLASS + ' select,.' + TOOLS_CLASS + ' button{font:inherit;padding:4px 10px;border:1px solid #dadce0;border-radius:4px;background:#fff;cursor:pointer;color:#202124}' +
    '.' + TOOLS_CLASS + ' button:hover{background:rgba(245,55,150,.08)}' +
    '.seo-bw-cmp-chips{display:inline-flex;gap:4px}' +
    '.' + CHIP_CLASS + '{padding:3px 9px;border-radius:12px;border:1px solid #dadce0;background:#fff;cursor:pointer;font-size:12px;color:#202124}' +
    '.' + CHIP_CLASS + '.active{background:#000022;color:#fff;border-color:#000022}' +
    '.' + SUMMARY_CLASS + '{margin:8px 0;font:12px/1.5 system-ui,sans-serif;color:#5f6368}';

  const api = {
    parseMetric,
    metricKind,
    pctChange,
    delta,
    isBetter,
    formatDelta,
    splitPair,
    detectCompareColumns,
    computeRow,
    summarize,
    rankByPct,
    filterByPct,
    toTsv,
    apply,
    CSS,
  };
  root.SBWGscCompare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
