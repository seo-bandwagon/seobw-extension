// SEO Bandwagon — Analyze on a Google results page, in a background tab (1.10.2)
//
// The results overlay's Analyze button, a person's click on one result.
// Until 1.10.2 it opened the result in a foreground tab and then opened the
// popup on whatever tab was active (src/lib/analyze-link.js, still the flow
// for the context menu and the new tab's scan box). Without "access to all
// sites" that ended at "NO ACCESS TO THIS TAB YET", several quick clicks
// analyzed only the last tab, and nothing came back to Google. Now (owner,
// 2026-11-01: "Stay on Google"):
//   - the result opens in a background tab beside the results page
//     (`active: false`), so the person stays on Google;
//   - that tab is analyzed by its ID, with the popup's own analyzer, never
//     whichever tab is active;
//   - the outcome goes back to the results page, which shows the on-page
//     checklist line under that result; "Open report" switches to the tab
//     and opens the popup on the stored analysis;
//   - without the optional all-sites access it asks once, from an extension
//     page that shows the reason (a content script can't call
//     permissions.request), and carries on once it's granted;
//   - a second click on the same result reuses its tab; any other click gets
//     its own tab and its own analysis.
// The analysis is stored, saved and synced exactly as the popup's is, so
// nothing new is sent. 1.12.0 replaces the tab with a row built from the
// page's HTML.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpAnalyze` when loaded via importScripts, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpAnalyze = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Stop waiting for a page that never finishes loading.
  const GIVE_UP_MS = 60 * 1000;
  // The popup reads the active tab as it opens (as analyze-link.js waits).
  const POPUP_DELAY_MS = 300;
  // Session storage: result key -> the tab it was analyzed in, and the clicks
  // waiting for site access. Both outlive the worker going idle.
  const TABS_KEY = 'serpAnalyzeTabs';
  const PENDING_KEY = 'serpAnalyzePending';
  const KEEP_TABS = 50;

  function failure(code, extra) {
    return Object.assign(new Error(code), { code }, extra || {});
  }

  function checklistLine(data) {
    const s = (data && data.seoScore) || {};
    return {
      score: typeof s.score === 'number' ? s.score : null,
      grade: s.grade || '',
      issues: Array.isArray(s.issues) ? s.issues.length : 0
    };
  }

  // deps:
  //   tabs, windows      chrome.tabs / chrome.windows (stubs in tests)
  //   storage            chrome.storage.session
  //   hasAccess()        the optional <all_urls> grant (SBWPerms.hasAllUrls)
  //   openAccessPage()   shows the extension page that asks for it
  //   analyze(tab)       the popup's analyzer run in that tab -> data; throws
  //                      an Error with `problem` ({ title, body }) for a page
  //                      it can't score
  //   onAnalyzed(tab, data)  stores, badges and saves it as the popup does
  //   notify(req, msg)   sends msg to the results page that asked
  //   openPopup(windowId)
  //   isRedirect(url)    a Google redirect the tab passes through
  function createSerpAnalyze(deps) {
    const {
      tabs, windows, storage, hasAccess, openAccessPage, analyze, onAnalyzed,
      notify, openPopup, isRedirect = () => false,
      setTimer = setTimeout, clearTimer = clearTimeout
    } = deps;
    const working = new Set(); // result keys being analyzed now

    async function read(key, fallback) {
      try {
        const got = await storage.get(key);
        return got && got[key] !== undefined ? got[key] : fallback;
      } catch (e) {
        return fallback;
      }
    }

    async function write(key, value) {
      try { await storage.set({ [key]: value }); } catch (e) { /* not kept this time */ }
    }

    function valid(req) {
      return !!(req && typeof req.key === 'string' && req.key &&
        typeof req.url === 'string' && /^https?:\/\//i.test(req.url));
    }

    // The click. -> { ok, state } at once; the outcome arrives through notify.
    async function start(req) {
      if (!valid(req)) return { ok: false, state: 'error', code: 'invalid_url' };
      if (working.has(req.key)) return { ok: true, state: 'working' };
      if (!(await hasAccess())) {
        const pending = (await read(PENDING_KEY, [])).filter((p) => p.key !== req.key);
        pending.push(req);
        await write(PENDING_KEY, pending);
        await openAccessPage();
        return { ok: true, state: 'needs_access' };
      }
      run(req);
      return { ok: true, state: 'working' };
    }

    // The access page's answer, or Chrome's permissions.onAdded.
    async function accessAnswered(granted) {
      const pending = await read(PENDING_KEY, []);
      if (!pending.length) return 0;
      if (granted && !(await hasAccess())) return 0;
      await write(PENDING_KEY, []);
      pending.forEach((req) => {
        if (granted) run(req);
        else notify(req, { state: 'declined' });
      });
      return pending.length;
    }

    async function run(req) {
      if (working.has(req.key)) return;
      working.add(req.key);
      notify(req, { state: 'working' });
      let tabId = null;
      try {
        tabId = await openTab(req);
        const tab = await loaded(tabId);
        const data = await analyze(tab);
        await onAnalyzed(tab, data);
        notify(req, Object.assign({ state: 'done', tabId }, checklistLine(data)));
      } catch (e) {
        const problem = e && e.problem;
        notify(req, {
          state: 'error',
          code: (e && e.code) || (problem ? 'unreadable' : 'failed'),
          title: problem ? problem.title : undefined,
          tabId: e && e.code === 'closed' ? undefined : tabId
        });
      } finally {
        working.delete(req.key);
      }
    }

    // The tab this result was analyzed in before, if it's still open, else a
    // new one in the background, right after the results page.
    async function openTab(req) {
      const known = await read(TABS_KEY, {});
      const previous = known[req.key];
      if (typeof previous === 'number') {
        try {
          await tabs.update(previous, { url: req.url });
          return previous;
        } catch (e) { /* closed since */ }
      }
      const create = { url: req.url, active: false };
      if (typeof req.windowId === 'number') create.windowId = req.windowId;
      if (typeof req.index === 'number') create.index = req.index + 1;
      if (typeof req.serpTabId === 'number') create.openerTabId = req.serpTabId;
      const tab = await tabs.create(create);
      const keys = Object.keys(known).filter((k) => k !== req.key);
      const kept = {};
      keys.slice(-(KEEP_TABS - 1)).forEach((k) => { kept[k] = known[k]; });
      kept[req.key] = tab.id;
      await write(TABS_KEY, kept);
      return tab.id;
    }

    // Resolves with the tab once the page it lands on has loaded (not a
    // Google redirect on the way); rejects 'timeout' or 'closed'.
    function loaded(tabId) {
      return new Promise((resolve, reject) => {
        let finished = false;
        let timer = null;
        const finish = (fn, value) => {
          if (finished) return;
          finished = true;
          tabs.onUpdated.removeListener(onUpdated);
          tabs.onRemoved.removeListener(onRemoved);
          if (timer !== null) clearTimer(timer);
          fn(value);
        };
        // Only a committed web page is the result: not a new tab's blank first
        // page, nor the page a reused tab showed before its navigation commits.
        const ready = (tab) => !!(tab && tab.status === 'complete' && !tab.pendingUrl &&
          /^https?:\/\//i.test(tab.url || '') && !isRedirect(tab.url));
        const onUpdated = (id, info, tab) => {
          if (id === tabId && info.status === 'complete' && ready(tab)) finish(resolve, tab);
        };
        const onRemoved = (id) => { if (id === tabId) finish(reject, failure('closed')); };
        tabs.onUpdated.addListener(onUpdated);
        tabs.onRemoved.addListener(onRemoved);
        timer = setTimer(() => finish(reject, failure('timeout')), GIVE_UP_MS);
        // A page that finished before the listener went on.
        Promise.resolve(tabs.get(tabId)).then(
          (tab) => { if (ready(tab)) finish(resolve, tab); },
          () => finish(reject, failure('closed'))
        );
      });
    }

    // "Open report" and "Open tab": the person's click, so the tab comes to
    // the front, and the popup opens on it with the stored analysis.
    async function open(tabId, { report = true } = {}) {
      if (typeof tabId !== 'number') return { ok: false };
      try {
        const tab = await tabs.update(tabId, { active: true });
        if (tab && typeof tab.windowId === 'number' && windows) {
          await windows.update(tab.windowId, { focused: true });
        }
        if (report) {
          setTimer(() => {
            Promise.resolve().then(() => openPopup(tab && tab.windowId)).catch(() => {});
          }, POPUP_DELAY_MS);
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: 'tab_closed' };
      }
    }

    async function tabRemoved(tabId) {
      const known = await read(TABS_KEY, {});
      const left = {};
      let changed = false;
      Object.keys(known).forEach((k) => {
        if (known[k] === tabId) changed = true;
        else left[k] = known[k];
      });
      if (changed) await write(TABS_KEY, left);
    }

    return { start, accessAnswered, open, tabRemoved };
  }

  return { createSerpAnalyze, checklistLine, GIVE_UP_MS, TABS_KEY, PENDING_KEY };
});
