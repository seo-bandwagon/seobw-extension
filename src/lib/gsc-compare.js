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
        if (labelCell && parseMetric(labelCell.textContent || '') === null && (labelCell.textContent || '').trim()) score += 1;
        hdr.metrics.forEach((m) => {
          const c = cells[m.curIdx + off];
          const p = cells[m.prevIdx + off];
          const cv = c ? parseMetric(c.textContent || '') : null;
          const pv = p ? parseMetric(p.textContent || '') : null;
          if (cv !== null) score += 1;
          if (pv !== null) score += 1;
          // Decisive signal: inside a run of numeric columns "is a number"
          // cannot tell a one-column shift apart, but GSC's Difference
          // column equals current − previous only under the right alignment.
          if (m.diffIdx !== null && cv !== null && pv !== null) {
            const d = cells[m.diffIdx + off];
            const dv = d ? parseMetric(d.textContent || '') : null;
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

    // fix-1 item 8 (MINOR): a metric object being present on a row is not
    // the same as it carrying real data (both sides can be null dash
    // placeholders), so haveClicks/haveImps are only set true once we see a
    // FINITE value on at least one side -- otherwise an all-dash column
    // would still print a spurious "0 -> 0" total.
    let haveClicks = false;
    let haveImps = false;
    let haveCtr = false;
    let havePos = false;
    let clicksCur = 0, clicksPrev = 0;
    let impsCur = 0, impsPrev = 0;
    // fix-1 item 8: current and previous each get their OWN row count for
    // the plain-average fallback, so a row with only one side present
    // doesn't dilute the other side's average.
    let ctrSumCur = 0, ctrCurCount = 0, ctrSumPrev = 0, ctrPrevCount = 0;
    let posSumCur = 0, posCurCount = 0, posSumPrev = 0, posPrevCount = 0;
    let posWCur = 0, posWPrev = 0, posWeightCur = 0, posWeightPrev = 0;

    rows.forEach((row) => {
      const m = (row && row.metrics) || {};
      if (m.clicks) {
        const curFinite = isNum(m.clicks.cur);
        const prevFinite = isNum(m.clicks.prev);
        if (curFinite || prevFinite) haveClicks = true;
        if (curFinite) clicksCur += m.clicks.cur;
        if (prevFinite) clicksPrev += m.clicks.prev;
      }
      if (m.impressions) {
        const curFinite = isNum(m.impressions.cur);
        const prevFinite = isNum(m.impressions.prev);
        if (curFinite || prevFinite) haveImps = true;
        if (curFinite) impsCur += m.impressions.cur;
        if (prevFinite) impsPrev += m.impressions.prev;
      }
      if (m.ctr) {
        const curFinite = isNum(m.ctr.cur);
        const prevFinite = isNum(m.ctr.prev);
        if (curFinite || prevFinite) haveCtr = true;
        if (curFinite) { ctrSumCur += m.ctr.cur; ctrCurCount++; }
        if (prevFinite) { ctrSumPrev += m.ctr.prev; ctrPrevCount++; }
      }
      if (m.position) {
        const curFinite = isNum(m.position.cur);
        const prevFinite = isNum(m.position.prev);
        if (curFinite || prevFinite) havePos = true;
        const wCur = m.impressions && isNum(m.impressions.cur) ? m.impressions.cur : null;
        const wPrev = m.impressions && isNum(m.impressions.prev) ? m.impressions.prev : null;
        if (curFinite) {
          posSumCur += m.position.cur;
          posCurCount++;
          if (wCur !== null) { posWCur += m.position.cur * wCur; posWeightCur += wCur; }
        }
        if (prevFinite) {
          posSumPrev += m.position.prev;
          posPrevCount++;
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
      const ctrCur = impsCur > 0 ? (clicksCur / impsCur) * 100 : (ctrCurCount > 0 ? ctrSumCur / ctrCurCount : null);
      const ctrPrev = impsPrev > 0 ? (clicksPrev / impsPrev) * 100 : (ctrPrevCount > 0 ? ctrSumPrev / ctrPrevCount : null);
      totals.ctr = buildTotal(ctrCur, ctrPrev, 'ctr');
    } else if (haveCtr) {
      const ctrCur = ctrCurCount > 0 ? ctrSumCur / ctrCurCount : null;
      const ctrPrev = ctrPrevCount > 0 ? ctrSumPrev / ctrPrevCount : null;
      totals.ctr = buildTotal(ctrCur, ctrPrev, 'ctr');
    }

    if (havePos) {
      const posCur = posWeightCur > 0 ? posWCur / posWeightCur : (posCurCount > 0 ? posSumCur / posCurCount : null);
      const posPrev = posWeightPrev > 0 ? posWPrev / posWeightPrev : (posPrevCount > 0 ? posSumPrev / posPrevCount : null);
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
  const SORTED_TABLE_CLASS = 'seo-bw-cmp-sorted-table';
  const HIDDEN_MARK = 'data-seo-bw-hidden';

  // table → { metric, filter }, persisted across rebuilds (fix-1 item 4) so
  // that a table re-render (real data change) doesn't silently reset a
  // user's metric/filter choice back to defaults.
  const TOOL_STATE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  const CARD_KIND_RE = /^\s*(?:total |average )?(clicks|impressions|ctr|position)\b/i;

  // fix-1 item 2 (CRITICAL): the metric word must be at the START of the
  // card's text, not just present anywhere in it -- a chip like "Position
  // filter: between 2 and 10" contains "position" but is not a metric card.
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

  // Removes every node we ever injected for this table: pct-header/pct-cell
  // cells inside it, the tools strip, the summary line, and (fix-1 item 3)
  // our own sorted-copy table -- none of which are guaranteed to be direct
  // siblings of `table` any more once a sorted copy is showing, so (fix-1
  // item 12) tools/summary/sorted are found by attribute on the table's
  // PARENT rather than by sibling-walking. Also (fix-1 item 4) un-hides any
  // row we hid via a filter, marked with `data-seo-bw-hidden` so we never
  // touch a `hidden` GSC set for its own reasons.
  function clearInjected(table) {
    table.querySelectorAll('[' + MARK + ']').forEach((n) => n.remove());
    Array.prototype.forEach.call(table.querySelectorAll('[' + HIDDEN_MARK + ']'), (tr) => {
      tr.removeAttribute(HIDDEN_MARK);
      tr.hidden = false;
    });
    table.hidden = false;
    table.removeAttribute('data-seo-bw-sorted-active');
    const parent = table.parentNode;
    if (!parent) return;
    ['tools', 'summary', 'sorted'].forEach((kind) => {
      const el = parent.querySelector('[' + MARK + '="' + kind + '"]');
      if (el) el.remove();
    });
  }

  // fix-1 item 10 (MINOR): a short/colspan row (e.g. a "no data" message row)
  // has no cell at the anchor index. Previously we just skipped it, leaving
  // that row without a matching cell in our injected column at all; now it
  // still gets an (empty) marked cell so the column stays a real column for
  // every body row.
  function insertPctColumns(table, cols) {
    const headerRow = getHeaderRow(table);
    const bodyRows = getBodyRows(table);
    const anchored = cols.metrics
      .map((m) => ({
        m,
        anchor: m.diffIdx !== null ? m.diffIdx : m.prevIdx,
        // Header row indices can differ from body indices (calibrateToBody);
        // fall back to the body anchor for cols produced without hdr* fields.
        hdrAnchor: m.hdrDiffIdx !== undefined && m.hdrDiffIdx !== null ? m.hdrDiffIdx
          : m.hdrPrevIdx !== undefined ? m.hdrPrevIdx
          : (m.diffIdx !== null ? m.diffIdx : m.prevIdx),
      }))
      .sort((a, b) => b.anchor - a.anchor); // right-to-left so earlier indices stay valid

    anchored.forEach(({ m, anchor, hdrAnchor }) => {
      if (headerRow) {
        const anchorCell = getRowCells(headerRow)[hdrAnchor];
        const th = document.createElement('th');
        th.textContent = '% change';
        th.setAttribute(MARK, 'pct-header');
        if (anchorCell) anchorCell.parentNode.insertBefore(th, anchorCell.nextSibling);
      }
      bodyRows.forEach((tr) => {
        const cells = getRowCells(tr);
        const anchorCell = cells[anchor];
        const td = document.createElement('td');
        td.setAttribute(MARK, 'pct-cell');
        td.setAttribute('data-seo-bw-metric', m.kind);
        if (!anchorCell) {
          td.className = CELL_CLASS + ' flat';
          td.textContent = '';
          tr.appendChild(td);
          return;
        }
        const row = computeRow(tr, cols);
        const m2 = row && row.metrics[m.kind];
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
    const parent = table.parentNode;
    let el = parent.querySelector('[' + MARK + '="summary"]');
    if (!el) {
      el = document.createElement('div');
      el.className = SUMMARY_CLASS;
      el.setAttribute(MARK, 'summary');
      parent.insertBefore(el, table.nextSibling);
    }
    const text = buildSummaryText(totals);
    if (el.textContent !== text) el.textContent = text;
  }

  function makeChip(label, active) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = CHIP_CLASS + (active ? ' active' : '');
    chip.textContent = label;
    return chip;
  }

  // fix-1 item 3 (IMPORTANT): renders OUR OWN read-only table -- built from
  // rowResults, never GSC's nodes -- so a sort can never move a row GSC owns.
  function buildSortedTable(cols, sortedRows) {
    const t = document.createElement('table');
    t.setAttribute(MARK, 'sorted');
    t.className = SORTED_TABLE_CLASS;

    const thead = document.createElement('thead');
    const headTr = document.createElement('tr');
    const thLabel = document.createElement('th');
    thLabel.textContent = 'Label';
    headTr.appendChild(thLabel);
    cols.metrics.forEach((m) => {
      const label = m.kind.charAt(0).toUpperCase() + m.kind.slice(1);
      ['current', 'previous', 'diff', '% change'].forEach((suffix) => {
        const th = document.createElement('th');
        th.textContent = label + ' ' + suffix;
        headTr.appendChild(th);
      });
    });
    thead.appendChild(headTr);
    t.appendChild(thead);

    const tbody = document.createElement('tbody');
    sortedRows.forEach((r) => {
      const tr = document.createElement('tr');
      const labelTd = document.createElement('td');
      labelTd.textContent = r.label;
      tr.appendChild(labelTd);
      cols.metrics.forEach((m) => {
        const rm = (r.metrics && r.metrics[m.kind]) || {};
        const dec = m.kind === 'ctr' || m.kind === 'position' ? 1 : 0;
        const curTd = document.createElement('td');
        curTd.textContent = formatRaw(m.kind, rm.cur);
        tr.appendChild(curTd);
        const prevTd = document.createElement('td');
        prevTd.textContent = formatRaw(m.kind, rm.prev);
        tr.appendChild(prevTd);
        const diffTd = document.createElement('td');
        diffTd.textContent = isNum(rm.delta) ? formatNum(rm.delta, dec) : '—';
        tr.appendChild(diffTd);
        const pctTd = document.createElement('td');
        pctTd.textContent = isNum(rm.pct) ? (rm.pct > 0 ? '+' : '') + formatNum(rm.pct, 1) + '%' : '—';
        pctTd.className = CELL_CLASS;
        tr.appendChild(pctTd);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    return t;
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

    // fix-1 item 4 (IMPORTANT): restore the persisted metric/filter choice
    // for this table, if any, instead of always resetting to defaults.
    const persisted = (TOOL_STATE && TOOL_STATE.get(table)) || {};
    const firstKind = persisted.metric || (cols.metrics[0] && cols.metrics[0].kind);
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
    let activeFilter = persisted.filter || 'all';
    // F5: an active sort survives a GSC re-render just like the filter does.
    let activeSort = persisted.sort || null;
    const chipAll = makeChip('All', activeFilter === 'all');
    const chipDrops = makeChip('Drops ≥ 25%', activeFilter === 'drops');
    const chipGains = makeChip('Gains ≥ 25%', activeFilter === 'gains');
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

    function saveState() {
      if (TOOL_STATE) TOOL_STATE.set(table, { metric: select.value, filter: activeFilter, sort: activeSort });
    }

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
        getBodyRows(table).forEach((tr) => {
          if (tr.hasAttribute(HIDDEN_MARK)) {
            tr.removeAttribute(HIDDEN_MARK);
            tr.hidden = false;
          }
        });
      } else {
        const opts = activeFilter === 'drops' ? { minDrop: 25 } : { minGain: 25 };
        const passing = new Set(filterByPct(allResults, select.value, opts).map((r) => r.label));
        getBodyRows(table).forEach((tr) => {
          const r = computeRow(tr, cols);
          const shouldHide = !(r && passing.has(r.label));
          if (shouldHide) {
            tr.hidden = true;
            tr.setAttribute(HIDDEN_MARK, '1');
          } else if (tr.hasAttribute(HIDDEN_MARK)) {
            tr.removeAttribute(HIDDEN_MARK);
            tr.hidden = false;
          }
        });
      }
      updateSummary();
    }

    function setActiveChip(chip) {
      [chipAll, chipDrops, chipGains].forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    }

    select.addEventListener('change', () => { saveState(); applyFilter(); });
    chipAll.addEventListener('click', () => { activeFilter = 'all'; setActiveChip(chipAll); saveState(); applyFilter(); });
    chipDrops.addEventListener('click', () => { activeFilter = 'drops'; setActiveChip(chipDrops); saveState(); applyFilter(); });
    chipGains.addEventListener('click', () => { activeFilter = 'gains'; setActiveChip(chipGains); saveState(); applyFilter(); });

    // fix-1 item 3 (IMPORTANT): sorting never touches a GSC row. Instead we
    // render our own read-only table copy after the tools strip and hide
    // (never remove) the real GSC table; "Original order" removes the copy
    // and unhides it.
    function showSorted(dir) {
      const results = getBodyRows(table).map((tr) => computeRow(tr, cols)).filter(Boolean);
      const ranked = rankByPct(results, select.value, dir);
      const built = buildSortedTable(cols, ranked);
      const parent = table.parentNode;
      const existing = parent.querySelector('[' + MARK + '="sorted"]');
      if (existing) existing.replaceWith(built); else parent.insertBefore(built, table);
      table.hidden = true;
      table.setAttribute('data-seo-bw-sorted-active', '1');
      activeSort = dir;
      saveState();
    }

    function showOriginal() {
      const parent = table.parentNode;
      const existing = parent.querySelector('[' + MARK + '="sorted"]');
      if (existing) existing.remove();
      table.hidden = false;
      table.removeAttribute('data-seo-bw-sorted-active');
      activeSort = null;
      saveState();
    }

    btnDrop.addEventListener('click', () => showSorted('drop'));
    btnGain.addEventListener('click', () => showSorted('gain'));
    btnOrig.addEventListener('click', showOriginal);
    if (activeSort) showSorted(activeSort);

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
    saveState();
    if (activeFilter !== 'all') applyFilter(); else updateSummary();
    return strip;
  }

  // fix-1 item 1a (CRITICAL): a lightweight fingerprint of everything that
  // would change what we render -- header text, row order, and every mapped
  // cur/prev value. Stored on the table itself so a re-run of apply() with
  // truly unchanged data can bail out before touching the DOM at all.
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
    // fix-1 item 1a (CRITICAL): true no-op when nothing changed -- no
    // clearInjected, no rebuild, zero DOM mutations, so a MutationObserver
    // watching this subtree sees nothing from a second call with the same
    // data.
    if (table.__sbwCmpHash === hash) return;
    table.__sbwCmpHash = hash;

    clearInjected(table);
    insertPctColumns(table, cols);
    insertToolsStrip(table, cols);
  }

  // apply(root) — scans for GSC metric summary tiles and compare-mode
  // Performance tables under `root` (defaults to `document`) and injects
  // badges/cells/tools/summary. Idempotent: safe to call again after GSC
  // re-renders (existing injections are cleared and rebuilt each time a
  // table's data actually changed; unchanged tables/cards are left alone).
  function apply(scopeRoot) {
    const scope = scopeRoot || document;
    if (!scope.querySelectorAll) return;
    // Never treat our own sorted-copy table as a GSC table to re-scan.
    const tables = Array.prototype.slice
      .call(scope.querySelectorAll('table'))
      .filter((t) => t.getAttribute(MARK) !== 'sorted');
    const colsList = tables.map((t) => detectCompareColumns(t));
    // fix-1 item 2: only run the card pass when some table on the page is
    // actually in compare mode.
    if (colsList.some((c) => c !== null)) {
      findMetricCards(scope, true).forEach(applyCardBadge);
    } else {
      // Compare mode ended (single-range report again): a badge left behind
      // would describe numbers that no longer exist on the tile.
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
    '.' + SUMMARY_CLASS + '{margin:8px 0;font:12px/1.5 system-ui,sans-serif;color:#5f6368}' +
    '.' + SORTED_TABLE_CLASS + '{border-collapse:collapse;font:13px/1.4 system-ui,sans-serif}' +
    '.' + SORTED_TABLE_CLASS + ' th,.' + SORTED_TABLE_CLASS + ' td{padding:4px 10px;text-align:left;border-bottom:1px solid #e8eaed}';

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
