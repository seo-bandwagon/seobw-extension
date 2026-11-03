// SEO Bandwagon: the worker's side of the AI Overview study (1.13.3)
//
// The popup's STUDY tab and the Google results page can't call
// seobandwagon.com or open a window themselves, so they ask the worker
// ('aioStudyToday', 'aioStudyOpen', 'aioStudyTab', 'aioStudySend',
// 'aioStudyStop'), which asks this. The rules, in order:
//   1. nothing leaves the browser without the person's yes (the consent
//      module's flow `aioStudy`, a button in Options) and a key;
//   2. a term opens in a private window or not at all. The window is
//      created with `incognito: true` and nothing else is ever passed; if
//      the extension isn't allowed in private windows, or the window that
//      comes back isn't private, nothing is recorded and the person is told
//      how to switch on "Allow in Incognito";
//   3. the tab that window opens is the study tab. Its record is kept in
//      chrome.storage.session (`aioStudyTabs`, by tab id), so a worker that
//      restarts between opening a term and sending it still knows it;
//   4. a send comes only from a study tab, for the term it was opened for,
//      while that tab still shows the study's search (src/lib/aio-study.js
//      sendGate), and posts nothing otherwise.
// The day's list is kept in the same storage (`aioStudyToday`) for five
// minutes. Both keys are cleared when a key is connected or disconnected
// (ACCOUNT_SESSION_KEYS in src/lib/api.js), so a read here treats either as
// gone.
//
// The study module (SBWAioStudy) is read when a call is made, not when this
// file loads, so the order of the worker's importScripts doesn't matter.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWAioStudyService` when loaded via importScripts, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWAioStudyService = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const TODAY_KEY = 'aioStudyToday';
  const TABS_KEY = 'aioStudyTabs';

  /**
   * deps:
   *   api               { today(), send({ term_id, csv }), stop() }, each
   *                     → Promise<sbwFetch result> (SBW.aioStudyToday, ...)
   *   consentOk()       → Promise<boolean> the person's yes
   *                     (SBWConsent.check('aioStudy'))
   *   session           chrome.storage.session ({ get(key), set(obj) })
   *   windows           { create(opts) → Promise<Window>, remove(id) }
   *   incognitoAllowed() → Promise<boolean>
   *                     (chrome.extension.isAllowedIncognitoAccess)
   *   now()             → ms
   *   study             optional SBWAioStudy; the global when omitted
   */
  function create(deps) {
    const now = deps.now || (() => Date.now());

    function study() {
      return deps.study || globalThis.SBWAioStudy;
    }

    // Writes to the two session keys are read, change, write. They run one
    // at a time, so two terms opened together both keep their records.
    let queue = Promise.resolve();
    function exclusive(task) {
      const run = queue.then(() => task());
      queue = run.then(() => {}, () => {});
      return run;
    }

    // An answer that throws reads as no answer at all.
    async function call(fn) {
      try {
        return await fn();
      } catch (e) {
        return null;
      }
    }

    // Anything but a plain yes is a no.
    async function yes() {
      try {
        return (await deps.consentOk()) === true;
      } catch (e) {
        return false;
      }
    }

    async function allowed() {
      try {
        return (await deps.incognitoAllowed()) === true;
      } catch (e) {
        return false;
      }
    }

    // The tab records, { "<tab id>": { termId, keyword, date, windowId,
    // openedAt } }. Storage that can't be read throws: a caller that can't
    // tell whether a tab is a study tab must not treat it as one that isn't.
    async function readTabs() {
      const got = await deps.session.get(TABS_KEY);
      const tabs = got && got[TABS_KEY];
      return tabs && typeof tabs === 'object' && !Array.isArray(tabs) ? tabs : {};
    }

    async function readCachedToday() {
      try {
        const got = await deps.session.get(TODAY_KEY);
        const cached = got && got[TODAY_KEY];
        return cached && typeof cached === 'object' ? cached : null;
      } catch (e) {
        return null;
      }
    }

    function withoutAt(cached) {
      const state = Object.assign({}, cached);
      delete state.at;
      return state;
    }

    async function writeToday(state) {
      const entry = Object.assign({}, state, { at: now() });
      try {
        await exclusive(() => deps.session.set({ [TODAY_KEY]: entry }));
      } catch (e) { /* session storage full or gone: the answer still stands */ }
    }

    function termOf(today, termId) {
      const terms = today && today.state === 'ready' && Array.isArray(today.terms) ? today.terms : [];
      for (let i = 0; i < terms.length; i++) {
        if (terms[i] && terms[i].term_id === termId) return terms[i];
      }
      return null;
    }

    /**
     * The day's list, { state: 'ready', week, date, terms } or another state
     * ('no_key', 'not_enrolled', 'paused', 'reconnect', 'rate_limited',
     * 'unavailable', or 'not_accepted' without the yes: nothing is read or
     * asked). Kept five minutes, for the same UTC day; `fresh` asks again.
     */
    async function today(opts) {
      const S = study();
      if (!(await yes())) return { state: 'not_accepted' };
      const t = now();
      if (!(opts && opts.fresh)) {
        const cached = await readCachedToday();
        if (cached && cached.state === 'ready' && cached.date === S.utcDate(t) &&
          typeof cached.at === 'number' && t - cached.at >= 0 && t - cached.at < S.TODAY_MAX_AGE_MS) {
          return withoutAt(cached);
        }
      }
      const state = S.todayState(await call(() => deps.api.today()));
      await writeToday(state);
      return state;
    }

    /**
     * A click on a term. { ok: true, tabId } once the term is open in a
     * private window and recorded, else { ok: false, reason } and no tab
     * (`reason` is a code SBWAioStudy.message knows).
     */
    async function open(termId) {
      const S = study();
      const incognitoAllowed = await allowed();
      const accepted = await yes();
      const list = await today({ fresh: true });
      const gate = S.openGate({ accepted, today: list, termId, incognitoAllowed });
      if (!gate.ok) return { ok: false, reason: gate.reason };
      const term = gate.term;

      // Only ever a private window: `incognito` is true or the call isn't
      // made, and the answer is checked too.
      let win;
      try {
        win = await deps.windows.create({ incognito: true, url: S.studySearchUrl(term.keyword) });
      } catch (e) {
        return { ok: false, reason: 'incognito_off' };
      }
      async function closeWindow() {
        try {
          if (win && win.id !== undefined) await deps.windows.remove(win.id);
        } catch (e) { /* already gone */ }
      }
      if (!win || win.incognito !== true) {
        await closeWindow();
        return { ok: false, reason: 'incognito_off' };
      }
      const tab = Array.isArray(win.tabs) ? win.tabs[0] : null;
      if (!tab || typeof tab.id !== 'number') {
        await closeWindow();
        return { ok: false, reason: 'error' };
      }

      const record = { termId: term.term_id, keyword: term.keyword, date: list.date, windowId: win.id, openedAt: now() };
      try {
        await exclusive(async () => {
          const tabs = Object.assign({}, await readTabs());
          tabs[String(tab.id)] = record;
          await deps.session.set({ [TABS_KEY]: tabs });
        });
      } catch (e) {
        // A tab the worker can't vouch for later would only be refused at the
        // send, so it isn't left open.
        await closeWindow();
        return { ok: false, reason: 'error' };
      }
      return { ok: true, tabId: tab.id };
    }

    /**
     * What the results page needs to know about its own tab:
     * { study: false }, or { study: true, termId, keyword, accepted, status,
     * page } (`status` the term's on today's list, `open`, `sent` or `late`,
     * or null; `page` the check that the tab still shows the study's search).
     */
    async function tabStatus(tabId, url) {
      const S = study();
      const record = (await readTabs())[String(tabId)];
      if (!record) return { study: false };
      const accepted = await yes();
      const list = accepted ? await today() : null;
      const term = termOf(list, record.termId);
      return {
        study: true,
        termId: record.termId,
        keyword: record.keyword,
        accepted,
        status: term ? term.status : null,
        page: S.checkStudyPage(url, record.keyword)
      };
    }

    /**
     * Sends a results page for `termId` from tab `tabId` at `url`. Answers
     * { state, retryAfter? }: 'sent', 'already_sent', a refusal's reason
     * ('not_study_tab', 'other_search', 'empty', ...) with nothing posted, or
     * the site's answer. Posts exactly { term_id, csv }.
     */
    async function send(tabId, url, termId, csv) {
      const S = study();
      const accepted = await yes();
      const record = (await readTabs())[String(tabId)] || null;
      // The day's list is only read for a tab the gate would go on to check.
      const list = accepted && record && record.termId === termId ? await today() : null;
      const bytes = typeof csv === 'string' ? new TextEncoder().encode(csv).length : 0;
      const gate = S.sendGate({ accepted, record, today: list, termId, url, csvBytes: bytes });
      if (!gate.ok) return { state: gate.reason };

      const outcome = S.sendOutcome(await call(() => deps.api.send({ term_id: termId, csv })));
      if (outcome.state === 'sent' || outcome.state === 'already_sent') await markSent(termId);
      return outcome;
    }

    // The kept list shows the term as sent without asking again; the list's
    // age is left as it was.
    async function markSent(termId) {
      try {
        await exclusive(async () => {
          const got = await deps.session.get(TODAY_KEY);
          const cached = got && got[TODAY_KEY];
          if (!cached || cached.state !== 'ready' || !Array.isArray(cached.terms)) return;
          const terms = cached.terms.map((t) => (t && t.term_id === termId ? Object.assign({}, t, { status: 'sent' }) : t));
          await deps.session.set({ [TODAY_KEY]: Object.assign({}, cached, { terms }) });
        });
      } catch (e) { /* the next list asked for says it */ }
    }

    /**
     * "Google stopped me". Answers { state: 'stopped', carried } once the
     * site has the rest of the day's terms, or its reason; the list is asked
     * for again after a stop.
     */
    async function stop() {
      const S = study();
      if (!(await yes())) return { state: 'not_accepted' };
      const outcome = S.stopOutcome(await call(() => deps.api.stop()));
      if (outcome.state === 'stopped') await today({ fresh: true });
      return outcome;
    }

    /** A tab closed. */
    async function forget(tabId) {
      await exclusive(async () => {
        const tabs = await readTabs();
        const id = String(tabId);
        if (!Object.prototype.hasOwnProperty.call(tabs, id)) return;
        const rest = Object.assign({}, tabs);
        delete rest[id];
        await deps.session.set({ [TABS_KEY]: rest });
      });
    }

    /** Whether the worker opened this tab for a term. */
    async function isStudyTab(tabId) {
      return Object.prototype.hasOwnProperty.call(await readTabs(), String(tabId));
    }

    return { today, open, tabStatus, send, stop, forget, isStudyTab };
  }

  return { create, TODAY_KEY, TABS_KEY };
});
