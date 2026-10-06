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
  // A page whose helper died (a tab left open across an extension update)
  // never answers; without a limit the popup would wait forever.
  const MESSAGE_TIMEOUT_MS = 6000;

  const MESSAGES = {
    'tab-changed': 'You switched tabs, so the capture stopped.',
    'capture-failed': 'Chrome blocked the capture on this page.',
    'canvas-failed': 'This page is too large to stitch into one image in this browser.',
    'cancelled': 'Capture cancelled.',
    'no-response': 'The page stopped responding. Reload it and try again.'
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
      onEncoding = () => {},
      signal = null
    } = opts;

    let injected = false;
    let restored = false;

    function checkCancelled() {
      if (signal && signal.aborted) throw captureError('cancelled');
    }

    // One message to the page, bounded by MESSAGE_TIMEOUT_MS and by Cancel.
    function ask(msg) {
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          fn(value);
        };
        const onAbort = () => finish(reject, captureError('cancelled'));
        const timer = setTimeout(() => finish(reject, captureError('capture-failed', MESSAGES['no-response'])), MESSAGE_TIMEOUT_MS);
        if (signal) {
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener('abort', onAbort);
        }
        Promise.resolve().then(() => send(msg)).then(v => finish(resolve, v), e => finish(reject, e));
      });
    }

    async function restore() {
      if (!injected || restored) return;
      restored = true;
      // Not ask(): a cancel must still put the page back. The helper's
      // watchdog covers a page that never answers.
      try {
        await Promise.race([send({ action: 'fpRestore' }), new Promise(r => setTimeout(r, MESSAGE_TIMEOUT_MS))]);
      } catch (_) { /* the helper's watchdog restores the page */ }
    }

    async function beforeCapture() {
      checkCancelled();
      if ((await getActiveTabId(windowId)) !== tabId) throw captureError('tab-changed');
    }

    async function captureWithRetry() {
      try {
        await beforeCapture();
        return await capture(windowId);
      } catch (e) {
        if (e && e.code) throw e;  // Re-throw tab-changed and cancelled
        if (!RATE_LIMIT_RE.test(String(e && e.message))) throw captureError('capture-failed', e && e.message);
        await sleep(RATE_LIMIT_WAIT_MS);
        try {
          await beforeCapture();
          return await capture(windowId);
        } catch (e2) {
          if (e2 && e2.code) throw e2;  // Re-throw tab-changed and cancelled
          throw captureError('capture-failed', e2 && e2.message);
        }
      }
    }

    try {
      checkCancelled();
      await inject();
      injected = true;

      const metrics = await ask({ action: 'fpPrepare' });
      if (!metrics || !metrics.viewportHeight) throw captureError('capture-failed', 'Could not measure this page.');
      const p = plan(metrics);

      try { await draw.begin(p.width, p.height); } catch (_) { throw captureError('canvas-failed'); }

      let lastShot = -Infinity;
      for (let i = 0; i < p.frames.length; i++) {
        const frame = p.frames[i];
        checkCancelled();
        onProgress(i + 1, p.frames.length);
        const scrollReply = await ask({ action: 'fpScrollTo', y: frame.scrollY });
        if (!scrollReply || typeof scrollReply.scrollY !== 'number') throw captureError('capture-failed', 'The page was reset during capture.');
        if (Math.abs(scrollReply.scrollY - frame.scrollY) > 1) {
          throw captureError('capture-failed', "The page didn't scroll as expected, so a full-page image would repeat itself. Try the visible area instead.");
        }
        // Keep sticky headers in the first frame only. Hide again before each later
        // frame: some headers only turn fixed after a scroll threshold (idempotent).
        if (i >= 1) await ask({ action: 'fpHideFixed' });
        checkCancelled();
        const wait = lastShot + MIN_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        const dataUrl = await captureWithRetry();
        lastShot = now();
        try { await draw.frame(dataUrl, frame); } catch (_) { throw captureError('canvas-failed'); }
      }

      // Cancel during the last frame should not return a result.
      checkCancelled();

      // Give the page back before the (slow) PNG encode.
      await restore();

      onEncoding();
      let blob;
      try { blob = await draw.finish(); } catch (_) { throw captureError('canvas-failed'); }
      // A Cancel pressed while the image was being built wins.
      checkCancelled();

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
        // White underneath, so a rounding seam is white rather than transparent.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
      },
      async frame(dataUrl, f) {
        const img = await loadImage(doc, dataUrl);
        const w = Math.min(img.naturalWidth, canvas.width);
        const h = Math.min(f.srcH, img.naturalHeight - f.srcY);
        if (h > 0) ctx.drawImage(img, 0, f.srcY, w, h, 0, f.destY, w, h);
      },
      finish() {
        return new Promise((resolve, reject) => {
          canvas.toBlob(b => {
            // Free the backing store (it can be ~100 MP) before anything else runs.
            canvas.width = 0;
            canvas.height = 0;
            if (b) resolve(b); else reject(new Error('PNG encode failed'));
          }, 'image/png');
        });
      }
    };
  }

  return { captureFullPage, canvasDrawer, MIN_GAP_MS, MESSAGE_TIMEOUT_MS };
});
