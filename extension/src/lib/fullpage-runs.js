// SEO Bandwagon — full-page proof captures that outlive the popup (#48)
//
// Until 1.7.8 the capture loop, its canvas and the finished image all lived
// in the action popup, which closes on any click away: a 10–20 s capture of a
// long page was lost, and so was a finished proof that hadn't been
// downloaded. Now the worker keeps one capture per tab here, the same way
// src/lib/link-check-runs.js keeps link checks. The popup starts it,
// attaches and detaches as it opens and closes, and shows progress or the
// result. The finished image goes to the proof store (src/lib/proof-store.js);
// its description is mirrored to chrome.storage.session so a reopened popup,
// or a worker Chrome restarted, still finds it. Only Cancel, the result's ✕,
// a new capture on the same tab, or closing the tab ends it.
//
// A capture can't resume after Chrome stops the worker mid-run (the page is
// half scrolled and the canvas is gone): the next attach reports it as
// interrupted, and the page's own watchdog has already put it back.
//
// Everything Chrome-shaped is injected (the capture itself, the proof store,
// storage), so tests drive it with fakes. The worker
// (src/background/service-worker.js) owns the real capture and the ports.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWFullPageRuns = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const STORE_PREFIX = 'proof::';
  const INTERRUPTED = 'The capture stopped when Chrome paused the extension. Try again.';

  function storeKey(tabId) {
    return STORE_PREFIX + tabId;
  }

  function sameUrl(a, b) {
    try {
      const ua = new URL(a);
      const ub = new URL(b);
      ua.hash = '';
      ub.hash = '';
      return ua.href === ub.href;
    } catch (_) {
      return false;
    }
  }

  function createRunner(deps) {
    const {
      capture,     // async ({ tabId, windowId, signal, onProgress, onEncoding }) => captureFullPage's result
      proofs,      // put(key, blob) / get(key) / remove(key), promise-returning
      storage,     // chrome.storage.session-shaped: get(key) / set(obj) / remove(key)
      now = () => Date.now()
    } = deps;

    const runs = new Map(); // tabId -> run

    // What the popup gets: no Blob (it reads that from the proof store by
    // `key`), no controller, no listeners.
    function snapshot(run) {
      return {
        tabId: run.tabId,
        url: run.url,
        status: run.status,           // 'running' | 'done' | 'error'
        phase: run.phase,             // running: 'measuring' | 'capturing' | 'encoding'
        frame: run.frame,
        total: run.total,
        msLeft: run.msLeft,
        result: run.result,           // done: { key, type, bytes, width, height, mode, reason, ... }
        error: run.error,             // error: { code, message }
        downloaded: run.downloaded
      };
    }

    function emit(run, msg) {
      run.listeners.forEach(fn => {
        try { fn(msg); } catch (_) { /* a dead port must not stop the run */ }
      });
    }

    function persist(run) {
      if (runs.get(run.tabId) !== run) return Promise.resolve();
      const rec = Object.assign(snapshot(run), { updatedAt: now() });
      return Promise.resolve(storage.set({ [storeKey(run.tabId)]: rec })).catch(() => {});
    }

    function forget(tabId) {
      return Promise.all([
        Promise.resolve(storage.remove(storeKey(tabId))).catch(() => {}),
        Promise.resolve(proofs.remove(storeKey(tabId))).catch(() => {})
      ]);
    }

    function newRun(tabId, windowId, url) {
      return {
        tabId, windowId, url,
        status: 'running', phase: 'measuring',
        frame: 0, total: 0, msLeft: null,
        result: null, error: null, downloaded: false,
        controller: new AbortController(),
        listeners: new Set()
      };
    }

    function stop(run) {
      if (run.controller) { try { run.controller.abort(); } catch (_) { /* settled */ } }
      if (runs.get(run.tabId) === run) runs.delete(run.tabId);
    }

    async function go(run) {
      persist(run);
      try {
        const shot = await capture({
          tabId: run.tabId,
          windowId: run.windowId,
          signal: run.controller.signal,
          onProgress: (frame, total, msLeft) => {
            if (runs.get(run.tabId) !== run) return;
            Object.assign(run, { phase: 'capturing', frame, total, msLeft });
            emit(run, { type: 'progress', run: snapshot(run) });
            if (frame === 1) persist(run);
          },
          onEncoding: () => {
            if (runs.get(run.tabId) !== run) return;
            Object.assign(run, { phase: 'encoding', msLeft: null });
            emit(run, { type: 'progress', run: snapshot(run) });
          }
        });
        if (runs.get(run.tabId) !== run) return;
        const key = storeKey(run.tabId);
        await proofs.put(key, shot.blob);
        if (runs.get(run.tabId) !== run) {
          // Cancelled or closed while the image was being stored.
          if (!runs.get(run.tabId)) Promise.resolve(proofs.remove(key)).catch(() => {});
          return;
        }
        run.status = 'done';
        run.phase = null;
        run.controller = null;
        run.result = {
          key,
          type: shot.blob.type || 'image/png',
          bytes: shot.blob.size,
          width: shot.width, height: shot.height,
          mode: shot.mode, reason: shot.reason,
          pageHeight: shot.pageHeight, capturedCssHeight: shot.capturedCssHeight,
          truncated: shot.truncated,
          at: now()
        };
        await persist(run);
        emit(run, { type: 'done', run: snapshot(run) });
      } catch (e) {
        if (runs.get(run.tabId) !== run) return;
        if (e && e.code === 'cancelled') {
          runs.delete(run.tabId);
          await forget(run.tabId);
          emit(run, { type: 'cancelled' });
          return;
        }
        run.status = 'error';
        run.phase = null;
        run.controller = null;
        run.error = { code: (e && e.code) || 'capture-failed', message: (e && e.message) || 'Chrome blocked the capture on this page.' };
        await persist(run);
        emit(run, { type: 'error', run: snapshot(run) });
      }
    }

    // A new capture of this tab. A second start for the same page while one
    // is running joins it (a double-click must not restart the scroll).
    async function start({ tabId, windowId, url }, listener) {
      const existing = runs.get(tabId);
      if (existing && existing.status === 'running' && sameUrl(existing.url, url)) {
        if (listener) existing.listeners.add(listener);
        return { state: snapshot(existing) };
      }
      if (existing) stop(existing);
      await forget(tabId);
      const run = newRun(tabId, windowId, url);
      if (listener) run.listeners.add(listener);
      runs.set(tabId, run);
      go(run);
      return { state: snapshot(run) };
    }

    // The popup (re)opened on `url` in `tabId`: what, if anything, is there
    // for this page?
    async function attach({ tabId, url }, listener) {
      let run = runs.get(tabId);
      if (!run) {
        let saved;
        try {
          const got = await storage.get(storeKey(tabId));
          saved = got && got[storeKey(tabId)];
        } catch (_) { saved = null; }
        if (runs.get(tabId)) {
          run = runs.get(tabId); // another attach or a start got here first
        } else if (saved && sameUrl(saved.url, url)) {
          run = Object.assign(newRun(tabId, null, saved.url), {
            status: saved.status, phase: null, controller: null,
            result: saved.result || null, error: saved.error || null,
            downloaded: !!saved.downloaded
          });
          if (run.status === 'running') {
            // Chrome stopped the worker mid-capture; nothing is running now.
            run.status = 'error';
            run.error = { code: 'capture-failed', message: INTERRUPTED };
          }
          runs.set(tabId, run);
          if (saved.status === 'running') persist(run);
        }
      }
      if (!run || !sameUrl(run.url, url)) return { state: null };
      if (listener) run.listeners.add(listener);
      return { state: snapshot(run) };
    }

    function detach(tabId, listener) {
      const run = runs.get(tabId);
      if (run && listener) run.listeners.delete(listener);
    }

    // Cancel while running, or the ✕ on a result or an error: either way
    // nothing is kept for this tab.
    function cancel(tabId) {
      const run = runs.get(tabId);
      if (run) {
        if (run.status === 'running') emit(run, { type: 'cancelled' });
        stop(run);
      }
      return forget(tabId);
    }

    function markDownloaded(tabId) {
      const run = runs.get(tabId);
      if (!run || run.status !== 'done') return Promise.resolve();
      run.downloaded = true;
      return persist(run);
    }

    function tabRemoved(tabId) {
      const run = runs.get(tabId);
      if (run) stop(run);
      return forget(tabId);
    }

    return { start, attach, detach, cancel, markDownloaded, tabRemoved, _runs: runs };
  }

  return { createRunner, storeKey, sameUrl, INTERRUPTED };
});
