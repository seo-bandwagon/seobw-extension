// SEO Bandwagon — the popup's search-result preview, cut where Google cuts
//
// Google cuts a result's title and description by width on screen, not by
// characters: "WWWW" takes three times the room of "iiii". Until 1.10.4 the
// preview cut at 60 and 155 characters. Now it measures the text in Google's
// desktop fonts (a 20 px title and a 14 px description, both Arial) and cuts
// at about 600 px and 920 px, the widths SEO tools use for Google's desktop
// results; Google moves them now and then, so the popup says "about".
//
// measureText(text, font) comes from a canvas where there is one (the popup);
// without one (tests, a page without canvas) Arial's own character widths
// stand in, with wide characters (CJK, full-width forms) one em.
//
// Pure apart from the optional canvas. Dual-export pattern (see
// src/lib/csv.js): `globalThis.SBWSerpPreview` as a classic <script>,
// CommonJS for Vitest.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpPreview = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const TITLE = { font: '20px Arial', size: 20, maxPx: 600 };
  const DESCRIPTION = { font: '14px Arial', size: 14, maxPx: 920 };
  const ELLIPSIS = ' ...';

  // Arial advance widths, in thousandths of an em (Arial is metric-compatible
  // with Helvetica). Characters not listed: wide ones 1000, others 556.
  const ARIAL = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333,
    '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584,
    '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333, '{': 334,
    '|': 260, '}': 334, '~': 584, '–': 556, '—': 1000, '’': 222, '‘': 222, '“': 333, '”': 333, '…': 1000, '·': 278,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
    n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
    N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611
  };
  const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

  function tableWidth(text, size) {
    let em = 0;
    for (const c of String(text)) {
      if (Object.prototype.hasOwnProperty.call(ARIAL, c)) em += ARIAL[c];
      else if (/[0-9]/.test(c)) em += 556;
      else em += WIDE.test(c) ? 1000 : 556;
    }
    return (em / 1000) * size;
  }

  // OffscreenCanvas only: every page of the extension has it, and jsdom
  // (the tests) has none, so there the table is used without a warning.
  let ctx;
  function canvasMeasure() {
    if (ctx !== undefined) return ctx;
    ctx = null;
    try {
      if (typeof OffscreenCanvas === 'function') ctx = new OffscreenCanvas(1, 1).getContext('2d');
    } catch (e) { ctx = null; }
    return ctx;
  }

  // A measure(text) for one of the two styles: the canvas when there is one.
  function measurer(style, useCanvas) {
    const c = useCanvas === false ? null : canvasMeasure();
    if (c && typeof c.measureText === 'function') {
      return function (text) {
        c.font = style.font;
        return c.measureText(String(text)).width;
      };
    }
    return function (text) { return tableWidth(text, style.size); };
  }

  // The longest start of `text` that fits in `maxPx` with Google's " ..."
  // after it. `{ text, cut, width }`: `cut` is true when anything was left
  // out, `width` the full text's width in px, rounded.
  function fit(text, style, measure) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    const m = measure || measurer(style);
    const width = Math.round(m(s));
    if (width <= style.maxPx) return { text: s, cut: false, width: width };
    const chars = Array.from(s);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (m(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= style.maxPx) lo = mid;
      else hi = mid - 1;
    }
    let head = chars.slice(0, lo).join('');
    // Google cuts at a word where it can.
    const space = head.lastIndexOf(' ');
    if (space > head.length * 0.6) head = head.slice(0, space);
    return { text: head.trimEnd() + ELLIPSIS, cut: true, width: width };
  }

  function title(text, measure) { return fit(text, TITLE, measure); }
  function description(text, measure) { return fit(text, DESCRIPTION, measure); }

  return {
    TITLE: TITLE,
    DESCRIPTION: DESCRIPTION,
    tableWidth: tableWidth,
    measurer: measurer,
    fit: fit,
    title: title,
    description: description
  };
});
