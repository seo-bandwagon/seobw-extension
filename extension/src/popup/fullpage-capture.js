// SEO Bandwagon — full-page proof capture loop
//
// Scrolls the page one screen at a time through the injected helper
// (src/content/page-scroller.js), captures each screen with
// chrome.tabs.captureVisibleTab, and draws it where
// SBWFullPage.planCapture (src/lib/fullpage-plan.js) says. The page is
// restored on every exit: success, error or cancel.
//
// Every Chrome call and the canvas are passed in, so tests run the loop with
// fakes and a virtual clock. canvasDrawer() is the real canvas the popup uses.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWFullPageCapture = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Chrome allows two captureVisibleTab calls a second.
  const MIN_GAP_MS = 550;
  const RATE_LIMIT_WAIT_MS = 1000;
  const RATE_LIMIT_RE = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/;

  const MESSAGES = {
    'tab-changed': 'You switched tabs, so the capture stopped.',
    'capture-failed': 'Chrome blocked the capture on this page.',
    'canvas-failed': 'This page is too large to stitch into one image in this browser.',
    'cancelled': 'Capture cancelled.'
  };

  function captureError(code, message) {
    const e = new Error(message || MESSAGES[code]);
    e.code = code;
    return e;
  }

  async function captureFullPage(opts) {
    const {
      tabId, windowId, inject, send, capture, getActiveTabId, draw,
      plan = globalThis.SBWFullPage.planCapture,
      now = () => Date.now(),
      sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
      onProgress = () => {},
      signal = null
    } = opts;

    let injected = false;
    let restored = false;

    function checkCancelled() {
      if (signal && signal.aborted) throw captureError('cancelled');
    }

    async function restore() {
      if (!injected || restored) return;
      restored = true;
      try { await send({ action: 'fpRestore' }); } catch (_) { /* the helper's watchdog restores the page */ }
    }

    async function captureWithRetry() {
      try {
        return await capture(windowId);
      } catch (e) {
        if (!RATE_LIMIT_RE.test(String(e && e.message))) throw captureError('capture-failed', e && e.message);
        await sleep(RATE_LIMIT_WAIT_MS);
        try {
          return await capture(windowId);
        } catch (e2) {
          throw captureError('capture-failed', e2 && e2.message);
        }
      }
    }

    try {
      checkCancelled();
      await inject();
      injected = true;

      const metrics = await send({ action: 'fpPrepare' });
      if (!metrics || !metrics.viewportHeight) throw captureError('capture-failed', 'Could not measure this page.');
      const p = plan(metrics);

      try { await draw.begin(p.width, p.height); } catch (_) { throw captureError('canvas-failed'); }

      let lastShot = -Infinity;
      for (let i = 0; i < p.frames.length; i++) {
        const frame = p.frames[i];
        checkCancelled();
        onProgress(i + 1, p.frames.length);
        const scrollReply = await send({ action: 'fpScrollTo', y: frame.scrollY });
        if (!scrollReply || typeof scrollReply.scrollY !== 'number') throw captureError('capture-failed', 'The page was reset during capture.');
        // Keep sticky headers in the first frame only.
        if (i === 1) await send({ action: 'fpHideFixed' });
        checkCancelled();
        // captureVisibleTab shoots whatever tab is active; never stitch in another tab.
        if ((await getActiveTabId(windowId)) !== tabId) throw captureError('tab-changed');
        const wait = lastShot + MIN_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        checkCancelled();
        const dataUrl = await captureWithRetry();
        lastShot = now();
        try { await draw.frame(dataUrl, frame); } catch (_) { throw captureError('canvas-failed'); }
      }

      // Give the page back before the (slow) PNG encode.
      await restore();

      let blob;
      try { blob = await draw.finish(); } catch (_) { throw captureError('canvas-failed'); }

      return {
        blob,
        width: p.width, height: p.height,
        mode: p.mode, reason: p.reason,
        pageHeight: p.pageHeight, capturedCssHeight: p.capturedCssHeight,
        truncated: p.truncated
      };
    } catch (e) {
      throw e && MESSAGES[e.code] ? e : captureError('capture-failed', e && e.message);
    } finally {
      await restore();
    }
  }

  function loadImage(doc, src) {
    return new Promise((resolve, reject) => {
      const img = new doc.defaultView.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('A captured frame did not decode.'));
      img.src = src;
    });
  }

  // The popup's real canvas. begin() throws when Chrome won't allocate the
  // size; drawImage clamps to what the frame actually has (rounding can leave
  // a frame 1px short), and a scrollbar on the right is cropped by width.
  function canvasDrawer(doc) {
    let canvas = null;
    let ctx = null;
    return {
      begin(width, height) {
        canvas = doc.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d');
        if (!ctx || canvas.width !== width || canvas.height !== height) throw new Error('canvas unavailable');
      },
      async frame(dataUrl, f) {
        const img = await loadImage(doc, dataUrl);
        const w = Math.min(img.naturalWidth, canvas.width);
        const h = Math.min(f.srcH, img.naturalHeight - f.srcY);
        if (h > 0) ctx.drawImage(img, 0, f.srcY, w, h, 0, f.destY, w, h);
      },
      finish() {
        return new Promise((resolve, reject) => {
          canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
        });
      }
    };
  }

  return { captureFullPage, canvasDrawer, MIN_GAP_MS };
});
