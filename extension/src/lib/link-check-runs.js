// SEO Bandwagon — broken-link checker: runs that outlive the popup (#47)
//
// Until 1.7.6 a check lived exactly as long as the popup's `link-check` port:
// the action popup closes on any click away or tab switch, the port
// disconnects, and the worker aborted the run. Now the worker keeps one run
// per tab here. The popup attaches and detaches as it opens and closes; the
// run goes on, mirrors its progress into chrome.storage.session, and a
// reopened popup picks it up. Only Cancel, a new check on the same tab, or
// closing the tab ends a run. If Chrome stops the worker mid-run, the next
// attach resumes the links that weren't checked yet.
//
// Everything Chrome-shaped is injected (probe, permission check, storage,
// timers), so tests drive it with fakes. The worker
// (src/background/service-worker.js) owns the real fetch and the ports.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWLinkCheckRuns` when loaded via importScripts, and exports
// via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWLinkCheckRuns = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const STORE_PREFIX = 'linkCheck::';
  // Progress is mirrored at most this often. Each write is also a Chrome API
  // call, which keeps the worker from idling out between slow probes.
  const PERSIST_EVERY_MS = 500;

  function storeKey(tabId) {
    return STORE_PREFIX + tabId;
  }

  function createRunner(deps) {
    const {
      probe,                 // async (url, AbortController) => { url, status, finalUrl, redirected, ms, error? }
      hasPermission,         // async () => boolean
      storage,               // chrome.storage.session-shaped: get(key) / set(obj) / remove(key), promise-returning
      linkCheck = globalThis.SBWLinkCheck,
      perHost,
      global,
      setTimer = (fn, ms) => setTimeout(fn, ms),
      clearTimer = (t) => clearTimeout(t),
      now = () => Date.now()
    } = deps;

    const runs = new Map(); // tabId -> run

    function sameUrl(a, b) {
      const na = linkCheck.normalizeUrl(a);
      return !!na && na === linkCheck.normalizeUrl(b);
    }

    function snapshot(run) {
      return {
        tabId: run.tabId,
        url: run.url,
        status: run.status,
        done: run.results.length,
        total: run.total,
        results: run.status === 'done' ? run.results.slice() : undefined
      };
    }

    function emit(run, msg) {
      run.listeners.forEach((fn) => {
        try { fn(msg); } catch (e) { /* a dead port must not stop the run */ }
      });
    }

    function record(run) {
      return {
        tabId: run.tabId,
        url: run.url,
        status: run.status,
        total: run.total,
        links: run.links,
        results: run.results,
        updatedAt: now()
      };
    }

    function flush(run) {
      if (run.persistTimer) { clearTimer(run.persistTimer); run.persistTimer = null; }
      if (runs.get(run.tabId) !== run) return Promise.resolve();
      return Promise.resolve(storage.set({ [storeKey(run.tabId)]: record(run) })).catch(() => {});
    }

    function persistSoon(run) {
      if (run.persistTimer) return;
      run.persistTimer = setTimer(() => { run.persistTimer = null; flush(run); }, PERSIST_EVERY_MS);
    }

    function newRun(tabId, url, links, results) {
      const done = new Set(results.map((r) => r.url));
      return {
        tabId,
        url,
        status: 'running',
        links,
        queue: links.filter((l) => !done.has(l.url)),
        total: links.length,
        results: results.slice(),
        inflightByHost: {},
        controllers: new Set(),
        listeners: new Set(),
        persistTimer: null
      };
    }

    function inflightTotal(run) {
      return Object.values(run.inflightByHost).reduce((a, b) => a + b, 0);
    }

    function pump(run) {
      if (run.status !== 'running') return;
      let next;
      while ((next = linkCheck.pickNext(run.queue, run.inflightByHost, { perHost, global }))) {
        run.queue.splice(run.queue.indexOf(next), 1);
        runOne(run, next);
      }
      if (linkCheck.isComplete(run.results.length, run.total, inflightTotal(run))) {
        run.status = 'done';
        flush(run);
        emit(run, { type: 'done', results: run.results.slice() });
      }
    }

    function finish(run, item, probeResult) {
      if (run.status !== 'running' || runs.get(run.tabId) !== run) return;
      run.results.push(Object.assign({}, item, probeResult));
      emit(run, { type: 'progress', done: run.results.length, total: run.total });
      persistSoon(run);
      pump(run);
    }

    async function runOne(run, item) {
      // #46: hosts Chrome never lets an extension fetch are reported as
      // such, without a request, instead of as a NETWORK failure.
      if (linkCheck.isUncheckable(item.url)) {
        // Asynchronous like a probe, so pump()'s loop isn't re-entered.
        await Promise.resolve();
        finish(run, item, { url: item.url, status: 0, finalUrl: null, redirected: false, ms: 0, error: 'uncheckable' });
        return;
      }
      const host = linkCheck.hostKey(item.url);
      run.inflightByHost[host] = (run.inflightByHost[host] || 0) + 1;
      const controller = new AbortController();
      run.controllers.add(controller);
      let result;
      try {
        result = await probe(item.url, controller);
      } catch (e) {
        result = { url: item.url, status: 0, finalUrl: null, redirected: false, ms: 0, error: 'network' };
      }
      run.controllers.delete(controller);
      run.inflightByHost[host] -= 1;
      if (run.inflightByHost[host] <= 0) delete run.inflightByHost[host];
      finish(run, item, result);
    }

    function stop(run) {
      run.status = 'cancelled';
      run.controllers.forEach((c) => { try { c.abort(); } catch (e) { /* settled */ } });
      run.controllers.clear();
      if (run.persistTimer) { clearTimer(run.persistTimer); run.persistTimer = null; }
      if (runs.get(run.tabId) === run) runs.delete(run.tabId);
    }

    // A new check on this tab. A second start for the same page while one is
    // running joins it (a double-click must not restart the queue).
    async function start({ tabId, url, links }, listener) {
      if (!(await hasPermission())) return { error: 'no_permission' };
      const existing = runs.get(tabId);
      if (existing && existing.status === 'running' && sameUrl(existing.url, url)) {
        if (listener) existing.listeners.add(listener);
        return { state: snapshot(existing) };
      }
      if (existing) stop(existing);
      const planned = linkCheck.planChecks(links || []);
      const run = newRun(tabId, url, planned.queue, []);
      if (listener) run.listeners.add(listener);
      runs.set(tabId, run);
      flush(run);
      pump(run);
      return { state: snapshot(run) };
    }

    // The popup (re)opened on `url` in `tabId`: what, if anything, is there
    // for this page? Resumes a run the worker lost when it was stopped.
    async function attach({ tabId, url }, listener) {
      let run = runs.get(tabId);
      if (!run) {
        let saved;
        try {
          const got = await storage.get(storeKey(tabId));
          saved = got && got[storeKey(tabId)];
        } catch (e) { saved = null; }
        if (saved && sameUrl(saved.url, url) && Array.isArray(saved.links)) {
          if (runs.get(tabId)) {
            run = runs.get(tabId); // another attach got here first
          } else if (saved.status === 'done') {
            run = newRun(tabId, saved.url, saved.links, saved.results || []);
            run.status = 'done';
            run.queue = [];
            runs.set(tabId, run);
          } else if (saved.status === 'running' && (await hasPermission())) {
            run = newRun(tabId, saved.url, saved.links, saved.results || []);
            runs.set(tabId, run);
            if (listener) run.listeners.add(listener);
            pump(run);
            return { state: snapshot(run), resumed: true };
          }
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

    function cancel(tabId) {
      const run = runs.get(tabId);
      if (run) {
        emit(run, { type: 'cancelled' });
        stop(run);
      }
      return Promise.resolve(storage.remove(storeKey(tabId))).catch(() => {});
    }

    function tabRemoved(tabId) {
      const run = runs.get(tabId);
      if (run) stop(run);
      return Promise.resolve(storage.remove(storeKey(tabId))).catch(() => {});
    }

    return { start, attach, detach, cancel, tabRemoved, _runs: runs };
  }

  return { createRunner, storeKey, PERSIST_EVERY_MS };
});
