// SEO Bandwagon — full-page proof planner
//
// Pure layout for a scroll-and-stitch screenshot: given the page's height,
// the window size and the device-pixel ratio, where to scroll for each frame
// and which rows of that frame go where on the final canvas. Also the label
// the proof card shows. No chrome/DOM dependency, so it's fully unit-testable.
//
// Units: scrollY, pageHeight and capturedCssHeight are CSS px; width, height,
// srcY, srcH and destY are output (device) px. Every output-px value is
// rounded from a CSS-px boundary once, so frames abut exactly at fractional
// ratios (1.25, 1.5).
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWFullPage` when loaded as a classic <script>, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWFullPage = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Chrome refuses a canvas taller than this.
  const MAX_CANVAS_PX = 32767;
  // Keeps a wide Retina window from allocating a canvas big enough to take the
  // popup down (100M px is ~400 MB of RGBA).
  const MAX_PIXELS = 100000000;

  function planCapture({
    scrollHeight, viewportWidth, viewportHeight, dpr, innerScroll = false,
    maxCanvasPx = MAX_CANVAS_PX, maxPixels = MAX_PIXELS
  }) {
    const ratio = dpr > 0 ? dpr : 1;
    const px = css => Math.round(css * ratio);
    const width = px(viewportWidth);
    const fits = scrollHeight <= viewportHeight + 2;

    if (fits && innerScroll) {
      return {
        mode: 'viewport', reason: 'inner-scroll',
        width, height: px(viewportHeight),
        pageHeight: viewportHeight, capturedCssHeight: viewportHeight, truncated: false,
        frames: [{ scrollY: 0, srcY: 0, srcH: px(viewportHeight), destY: 0 }]
      };
    }

    const pageHeight = fits ? viewportHeight : scrollHeight;
    const capPx = Math.min(maxCanvasPx, Math.floor(maxPixels / width));
    const capturedCssHeight = Math.min(pageHeight, Math.floor(capPx / ratio));
    const frames = [];

    for (let top = 0; top < capturedCssHeight; top += viewportHeight) {
      const bottom = Math.min(top + viewportHeight, capturedCssHeight);
      // The window can't scroll past pageHeight - viewportHeight, so the last
      // frame starts higher and its top rows repeat the previous frame.
      const scrollY = Math.min(top, pageHeight - viewportHeight);
      frames.push({
        scrollY,
        srcY: px(top - scrollY),
        srcH: px(bottom) - px(top),
        destY: px(top)
      });
    }

    return {
      mode: 'fullpage', reason: null,
      width, height: px(capturedCssHeight),
      pageHeight, capturedCssHeight,
      truncated: capturedCssHeight < pageHeight,
      frames
    };
  }

  function round100(n) {
    return Math.round(n / 100) * 100;
  }

  // The proof card's header line. `sizeText` is already formatted
  // (citations-tab.js's fmtBytes).
  function describeProof(r, sizeText) {
    const dims = `${r.width}×${r.height}`;
    if (r.mode === 'viewport') {
      return r.reason === 'inner-scroll'
        ? `VIEWPORT · page scrolls inside a panel · ${dims} · ${sizeText}`
        : `VIEWPORT · ${dims} · ${sizeText}`;
    }
    if (r.truncated) {
      const fmt = n => round100(n).toLocaleString('en-US');
      return `FULL PAGE · first ${fmt(r.capturedCssHeight)} of ${fmt(r.pageHeight)} px · ${sizeText}`;
    }
    return `FULL PAGE · ${dims} · ${sizeText}`;
  }

  return { planCapture, describeProof, MAX_CANVAS_PX, MAX_PIXELS };
});
