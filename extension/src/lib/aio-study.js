// SEO Bandwagon: the AI Overview study's search, gates and answers (1.13.3)
//
// Study mode lets a person who joined the AI Overview inclusion study on
// seobandwagon.com search each of their day's terms on Google, in a private
// window, and send that results page to the study. This module is the pure
// part of it: the address a term is searched at, the check that a tab still
// shows that search, the gates a click and a send pass, how the study's three
// answers read, and the words shown for each outcome. No chrome.*, no fetch,
// no DOM, so the worker (importScripts), the popup (a <script> tag), the
// Google content script and Vitest all load the same file. The three API
// calls are in src/lib/api.js (aioStudyToday, aioStudySend, aioStudyStop).
//
// Where an answer is read (todayState, sendOutcome, stopOutcome), `res` is
// what SBW.sbwFetch() returns: { ok, status, data, retryAfter, code }. The
// site answers an error as JSON { error: '<code>' }, so these read `status`
// and `data.error` themselves rather than sbwFetch's coarser `code`.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWAioStudy` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWAioStudy = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Every study search is the same market and the same page: English, the
  // US, personalization off, so the pages sent can be compared.
  const STUDY_PARAMS = Object.freeze({ hl: 'en', gl: 'us', pws: '0' });
  // The most CSV a send carries (the site answers 413 above it).
  const MAX_CSV_BYTES = 262144;
  // Pages on seobandwagon.com: where a person joins the study, and where
  // they mint the key that includes it.
  const JOIN_PATH = '/dashboard/aio-study';
  const CONNECT_PATH = '/dashboard/api-keys';
  // How long the day's list is kept before it is asked for again.
  const TODAY_MAX_AGE_MS = 300000;

  const TERM_STATUSES = ['open', 'sent', 'late'];

  // ============================================
  // The search
  // ============================================

  // The address a term is searched at: q first, then STUDY_PARAMS in order.
  function studySearchUrl(keyword) {
    const params = new URLSearchParams();
    params.set('q', String(keyword));
    Object.keys(STUDY_PARAMS).forEach(function (name) {
      params.set(name, STUDY_PARAMS[name]);
    });
    return 'https://www.google.com/search?' + params.toString();
  }

  // Two spellings of one query compare equal: Google shows what was typed
  // with its own spacing, case and punctuation. NFKC, curly single quotes
  // straightened, lowercase, whitespace collapsed and trimmed, and one
  // trailing "?" dropped.
  function queryKey(q) {
    let s = String(q === null || q === undefined ? '' : q)
      .normalize('NFKC')
      .replace(/[‘’]/g, "'")
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (s.charAt(s.length - 1) === '?') s = s.slice(0, -1).trim();
    return s;
  }

  // Whether a tab still shows the study's search for `keyword`, page one,
  // with the study's parameters. The first thing wrong is the reason.
  function checkStudyPage(url, keyword) {
    let u;
    try {
      u = new URL(String(url));
    } catch (e) {
      return { ok: false, reason: 'not_google' };
    }
    if (u.hostname !== 'www.google.com' || u.pathname !== '/search') {
      return { ok: false, reason: 'not_google' };
    }
    const q = u.searchParams.get('q');
    if (q === null || queryKey(q) !== queryKey(keyword)) {
      return { ok: false, reason: 'other_search' };
    }
    const start = u.searchParams.get('start');
    if (start !== null && start !== '0') {
      return { ok: false, reason: 'not_page_one' };
    }
    const names = Object.keys(STUDY_PARAMS);
    for (let i = 0; i < names.length; i++) {
      if (u.searchParams.get(names[i]) !== STUDY_PARAMS[names[i]]) {
        return { ok: false, reason: 'params_changed' };
      }
    }
    return { ok: true };
  }

  // The UTC day of `now` (ms), the same day the site's list is for.
  function utcDate(now) {
    return new Date(now).toISOString().slice(0, 10);
  }

  // ============================================
  // The study's answers
  // ============================================

  function errorOf(res) {
    return res && res.data && typeof res.data === 'object' ? res.data.error : undefined;
  }

  // The answers every call reads alike. Returns a state, or null when the
  // status is one this call reads for itself.
  function commonFailure(res) {
    const status = res && res.status;
    if (status === 401) return { state: 'reconnect' };
    if (status === 403) {
      return { state: errorOf(res) === 'insufficient_scope' ? 'reconnect' : 'not_enrolled' };
    }
    if (status === 429) return { state: 'rate_limited', retryAfter: res.retryAfter };
    if (status === 503 || status === 404 || status === 0) return { state: 'unavailable' };
    return null;
  }

  // GET /v1/aio-study/today -> { state, week?, date?, terms? }. `ready`
  // carries the day's list; every other state carries nothing.
  function todayState(res) {
    if (res && res.code === 'no_key') return { state: 'no_key' };
    if (res && res.status === 200 && res.data && typeof res.data === 'object') {
      const data = res.data;
      if (data.enrolled === false) return { state: 'not_enrolled' };
      if (data.enrolled === true && data.paused === true) return { state: 'paused' };
      if (data.enrolled === true && typeof data.date === 'string' && Array.isArray(data.terms)) {
        const terms = data.terms
          .filter(function (t) {
            return t && typeof t.term_id === 'string' && typeof t.keyword === 'string' &&
              TERM_STATUSES.indexOf(t.status) !== -1;
          })
          .map(function (t) {
            return { term_id: t.term_id, keyword: t.keyword, status: t.status };
          });
        return {
          state: 'ready',
          week: typeof data.week === 'number' ? data.week : null,
          date: data.date,
          terms: terms
        };
      }
      return { state: 'unavailable' };
    }
    return commonFailure(res) || { state: 'unavailable' };
  }

  // POST /v1/aio-study/captures -> { state, retryAfter? }.
  function sendOutcome(res) {
    if (res && res.code === 'no_key') return { state: 'no_key' };
    const status = res && res.status;
    if (status === 201) return { state: 'sent' };
    if (status === 409) return { state: 'already_sent' };
    if (status === 422) {
      const code = errorOf(res);
      if (code === 'not_assigned' || code === 'query_mismatch' || code === 'invalid_export') {
        return { state: code };
      }
      return { state: 'error' };
    }
    if (status === 413) return { state: 'too_large' };
    return commonFailure(res) || { state: 'error' };
  }

  // POST /v1/aio-study/stop -> { state, carried?, retryAfter? }. `carried`
  // is how many of the day's other terms move to tomorrow.
  function stopOutcome(res) {
    if (res && res.code === 'no_key') return { state: 'no_key' };
    if (res && res.status === 200) {
      const carried = res.data && res.data.carried;
      return { state: 'stopped', carried: typeof carried === 'number' ? carried : 0 };
    }
    return commonFailure(res) || { state: 'error' };
  }

  // ============================================
  // The gates
  // ============================================

  function findTerm(today, termId) {
    const terms = today && Array.isArray(today.terms) ? today.terms : [];
    for (let i = 0; i < terms.length; i++) {
      if (terms[i] && terms[i].term_id === termId) return terms[i];
    }
    return null;
  }

  // Clicking a term in the study panel: the person said yes to study sends,
  // the day's list is ready with the term on it, not yet sent, and the
  // private window it is searched in is allowed. The first thing wrong is
  // the reason.
  function openGate(input) {
    const accepted = input && input.accepted;
    const today = input && input.today;
    if (!accepted) return { ok: false, reason: 'not_accepted' };
    if (!today || today.state !== 'ready') {
      return { ok: false, reason: (today && today.state) || 'unavailable' };
    }
    const term = findTerm(today, input.termId);
    if (!term) return { ok: false, reason: 'not_on_list' };
    if (term.status === 'sent') return { ok: false, reason: 'already_sent' };
    if (!input.incognitoAllowed) return { ok: false, reason: 'incognito_off' };
    return { ok: true, term: term };
  }

  // Sending a results page: everything openGate checked except the window,
  // and that the tab is the one the panel opened for this term, still on its
  // search, with a page that has something to send and fits. `record` is
  // what the panel kept when it opened the tab: { termId, keyword, ... }.
  function sendGate(input) {
    const accepted = input && input.accepted;
    const record = input && input.record;
    const today = input && input.today;
    if (!accepted) return { ok: false, reason: 'not_accepted' };
    if (!record || record.termId !== input.termId) return { ok: false, reason: 'not_study_tab' };
    if (!today || today.state !== 'ready') {
      return { ok: false, reason: (today && today.state) || 'unavailable' };
    }
    const term = findTerm(today, input.termId);
    if (!term) return { ok: false, reason: 'not_on_list' };
    if (term.status === 'sent') return { ok: false, reason: 'already_sent' };
    const page = checkStudyPage(input.url, record.keyword);
    if (!page.ok) return { ok: false, reason: page.reason };
    const bytes = input.csvBytes;
    if (!(bytes > 0)) return { ok: false, reason: 'empty' };
    if (bytes > MAX_CSV_BYTES) return { ok: false, reason: 'too_large' };
    return { ok: true };
  }

  // ============================================
  // The words
  // ============================================

  // 0 is the pilot week, which the site numbers 0.
  function weekLabel(week) {
    if (typeof week !== 'number' || !isFinite(week)) return '';
    return week === 0 ? 'Pilot week' : 'Week ' + week;
  }

  const SEARCH_GONE = "This tab no longer shows the study's search. Open the term again from the study panel.";
  const NOT_ON_LIST = "This term isn't on your list for today.";
  const UNREADABLE = "This page's results couldn't be read, so nothing was sent.";

  const MESSAGES = {
    unavailable: "The study isn't available yet. Try again later.",
    no_key: 'Connect the extension to your seobandwagon.com account to take part.',
    reconnect: "Reconnect the extension to your seobandwagon.com account: its key doesn't include the study.",
    not_enrolled: 'Join the study on seobandwagon.com first.',
    paused: 'The study is paused this week.',
    rate_limited: 'Too many sends at once. Wait a minute, then try again.',
    not_accepted: "Turn on study sends in the extension's settings first.",
    incognito_off: "SEO Bandwagon isn't allowed in private windows, and the study only searches in one. On the extension's Details page, switch on Allow in Incognito, then click the term again.",
    not_study_tab: 'Only a search opened from the study panel can be sent.',
    not_on_list: NOT_ON_LIST,
    not_assigned: NOT_ON_LIST,
    already_sent: 'Already sent today.',
    other_search: SEARCH_GONE,
    not_page_one: SEARCH_GONE,
    params_changed: SEARCH_GONE,
    not_google: SEARCH_GONE,
    query_mismatch: SEARCH_GONE,
    too_large: 'This results page is too large to send.',
    empty: UNREADABLE,
    invalid_export: UNREADABLE,
    error: "Couldn't send. Try again.",
    sent: 'Sent to the study.',
    stopped: 'Recorded. Stop searching for today; your other terms move to tomorrow.'
  };

  // The words for a state or a reason. An unknown code reads as `error`.
  function message(code) {
    return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code] : MESSAGES.error;
  }

  return {
    STUDY_PARAMS,
    MAX_CSV_BYTES,
    JOIN_PATH,
    CONNECT_PATH,
    TODAY_MAX_AGE_MS,
    studySearchUrl,
    queryKey,
    checkStudyPage,
    utcDate,
    todayState,
    sendOutcome,
    stopOutcome,
    openGate,
    sendGate,
    weekLabel,
    message
  };
});
