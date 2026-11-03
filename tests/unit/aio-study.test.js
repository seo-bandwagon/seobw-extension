// The AI Overview study's pure part (src/lib/aio-study.js, 1.13.3): the
// search address, the check that a tab still shows it, the gates, how the
// study's three answers read, and the words shown for each outcome.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

await import('../../extension/src/lib/aio-study.js');
const S = globalThis.SBWAioStudy;

// What sbwFetch() answers: { ok, status, data, retryAfter, code }.
const res = (status, data = null, extra = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  data,
  retryAfter: null,
  code: status >= 200 && status < 300 ? 'ok' : 'error',
  ...extra
});

const TERMS = [
  { term_id: 't1', keyword: 'how does seo work', status: 'open' },
  { term_id: 't2', keyword: 'what is a backlink', status: 'sent' },
  { term_id: 't3', keyword: 'crm for nonprofits', status: 'late' }
];
const READY = { state: 'ready', week: 2, date: '2026-11-03', terms: TERMS };

describe('constants', () => {
  it('are the values the site and the panel share', () => {
    expect(S.STUDY_PARAMS).toEqual({ hl: 'en', gl: 'us', pws: '0' });
    expect(S.MAX_CSV_BYTES).toBe(262144);
    expect(S.JOIN_PATH).toBe('/dashboard/aio-study');
    expect(S.CONNECT_PATH).toBe('/dashboard/api-keys');
    expect(S.TODAY_MAX_AGE_MS).toBe(300000);
  });

  it('attaches to the global scope', () => {
    expect(globalThis.SBWAioStudy).toBe(S);
  });

  it('loads where a service worker would: a scope with only URL, URLSearchParams, Date and String', () => {
    const src = readFileSync(path.resolve(__dirname, '../../extension/src/lib/aio-study.js'), 'utf8');
    const scope = { URL, URLSearchParams, Date, String };
    scope.globalThis = scope;
    vm.runInNewContext(src, scope);
    expect(typeof scope.SBWAioStudy.studySearchUrl).toBe('function');
    expect(scope.SBWAioStudy.studySearchUrl('how does seo work'))
      .toBe('https://www.google.com/search?q=how+does+seo+work&hl=en&gl=us&pws=0');
    expect(scope.SBWAioStudy.checkStudyPage(scope.SBWAioStudy.studySearchUrl('a b'), 'a b').ok).toBe(true);
  });
});

describe('studySearchUrl', () => {
  it('is q, hl, gl, pws in that order', () => {
    expect(S.studySearchUrl('how does seo work'))
      .toBe('https://www.google.com/search?q=how+does+seo+work&hl=en&gl=us&pws=0');
  });

  it('encodes what a query can hold', () => {
    const u = new URL(S.studySearchUrl("what's a 50% & more? #1"));
    expect(u.searchParams.get('q')).toBe("what's a 50% & more? #1");
    expect(u.searchParams.get('pws')).toBe('0');
  });
});

describe('queryKey', () => {
  it('folds case, spacing and one trailing question mark', () => {
    expect(S.queryKey('  How Does SEO  Work? ')).toBe('how does seo work');
    expect(S.queryKey('how does seo work')).toBe('how does seo work');
    expect(S.queryKey('why??')).toBe('why?');
    expect(S.queryKey('seo ?')).toBe('seo');
  });

  it('straightens curly single quotes and normalizes to NFKC', () => {
    expect(S.queryKey('what’s seo')).toBe("what's seo");
    expect(S.queryKey('what‘s seo')).toBe("what's seo");
    expect(S.queryKey('ＳＥＯ')).toBe('seo');
  });

  it('reads a missing value as empty', () => {
    expect(S.queryKey(null)).toBe('');
    expect(S.queryKey(undefined)).toBe('');
  });
});

describe('checkStudyPage', () => {
  const kw = 'how does seo work';
  const good = S.studySearchUrl(kw);

  it('is ok for the address it built', () => {
    expect(S.checkStudyPage(good, kw)).toEqual({ ok: true });
  });

  it('is ok when Google spells the query its own way, and start=0 is page one', () => {
    expect(S.checkStudyPage(good.replace('how+does+seo+work', 'How+Does+SEO+Work%3F') + '&start=0', kw)).toEqual({ ok: true });
    expect(S.checkStudyPage(good + '&sca_esv=abc', kw)).toEqual({ ok: true });
  });

  it('not_google: another host, another path, or no address at all', () => {
    expect(S.checkStudyPage(good.replace('www.google.com', 'www.google.co.uk'), kw)).toEqual({ ok: false, reason: 'not_google' });
    expect(S.checkStudyPage(good.replace('www.google.com', 'google.com'), kw)).toEqual({ ok: false, reason: 'not_google' });
    expect(S.checkStudyPage(good.replace('/search', '/maps'), kw)).toEqual({ ok: false, reason: 'not_google' });
    expect(S.checkStudyPage('https://example.com/search?q=how+does+seo+work', kw)).toEqual({ ok: false, reason: 'not_google' });
    expect(S.checkStudyPage('not a url', kw)).toEqual({ ok: false, reason: 'not_google' });
    expect(S.checkStudyPage(undefined, kw)).toEqual({ ok: false, reason: 'not_google' });
  });

  it('other_search: another query, or none', () => {
    expect(S.checkStudyPage(good.replace('how+does+seo+work', 'other'), kw)).toEqual({ ok: false, reason: 'other_search' });
    expect(S.checkStudyPage('https://www.google.com/search?hl=en&gl=us&pws=0', kw)).toEqual({ ok: false, reason: 'other_search' });
  });

  it('not_page_one: start other than 0', () => {
    expect(S.checkStudyPage(good + '&start=10', kw)).toEqual({ ok: false, reason: 'not_page_one' });
  });

  it('params_changed: another Google tab (Images, Videos, News, Web), which adds tbm or udm', () => {
    expect(S.checkStudyPage(good + '&udm=7', kw)).toEqual({ ok: false, reason: 'params_changed' });
    expect(S.checkStudyPage(good + '&udm=2', kw)).toEqual({ ok: false, reason: 'params_changed' });
    expect(S.checkStudyPage(good + '&udm=14', kw)).toEqual({ ok: false, reason: 'params_changed' });
    expect(S.checkStudyPage(good + '&tbm=vid', kw)).toEqual({ ok: false, reason: 'params_changed' });
    expect(S.checkStudyPage(good + '&tbm=nws', kw)).toEqual({ ok: false, reason: 'params_changed' });
    // After the page-one check, so a later page of another tab still says why.
    expect(S.checkStudyPage(good + '&tbm=isch&start=10', kw)).toEqual({ ok: false, reason: 'not_page_one' });
    // The plain study address is still ok.
    expect(S.checkStudyPage(good, kw)).toEqual({ ok: true });
  });

  it('params_changed: one of hl, gl, pws missing or changed', () => {
    expect(S.checkStudyPage(good.replace('&pws=0', ''), kw)).toEqual({ ok: false, reason: 'params_changed' });
    expect(S.checkStudyPage(good.replace('pws=0', 'pws=1'), kw)).toEqual({ ok: false, reason: 'params_changed' });
    expect(S.checkStudyPage(good.replace('hl=en', 'hl=fr'), kw)).toEqual({ ok: false, reason: 'params_changed' });
    expect(S.checkStudyPage(good.replace('&gl=us', ''), kw)).toEqual({ ok: false, reason: 'params_changed' });
  });

  it('names the first thing wrong, in the order host, query, page, parameters', () => {
    const bad = 'https://www.google.co.uk/search?q=other&start=10';
    expect(S.checkStudyPage(bad, kw).reason).toBe('not_google');
    expect(S.checkStudyPage('https://www.google.com/search?q=other&start=10', kw).reason).toBe('other_search');
    expect(S.checkStudyPage('https://www.google.com/search?q=how+does+seo+work&start=10', kw).reason).toBe('not_page_one');
  });
});

describe('utcDate', () => {
  it('is the UTC day, whatever the local zone', () => {
    expect(S.utcDate(Date.UTC(2026, 10, 3, 23, 59, 59))).toBe('2026-11-03');
    expect(S.utcDate(Date.UTC(2026, 10, 4, 0, 0, 0))).toBe('2026-11-04');
    expect(S.utcDate(0)).toBe('1970-01-01');
  });
});

describe('todayState', () => {
  it('no key: no_key', () => {
    expect(S.todayState({ ok: false, status: 0, data: null, retryAfter: null, code: 'no_key' })).toEqual({ state: 'no_key' });
  });

  it('a non-member: not_enrolled', () => {
    expect(S.todayState(res(200, { enrolled: false, week: 1, paused: false, date: '2026-11-03', terms: [] })))
      .toEqual({ state: 'not_enrolled' });
    // Even when the answer also says paused.
    expect(S.todayState(res(200, { enrolled: false, week: 1, paused: true, date: '2026-11-03', terms: [] })))
      .toEqual({ state: 'not_enrolled' });
  });

  it('paused this week: paused', () => {
    expect(S.todayState(res(200, { enrolled: true, week: 1, paused: true, date: '2026-11-03', terms: [] })))
      .toEqual({ state: 'paused' });
  });

  it('a member: ready with the week, the date and the terms', () => {
    expect(S.todayState(res(200, { enrolled: true, week: 2, paused: false, date: '2026-11-03', terms: TERMS })))
      .toEqual(READY);
  });

  it('the pilot week is 0 and an unnumbered week is null', () => {
    expect(S.todayState(res(200, { enrolled: true, week: 0, paused: false, date: '2026-11-03', terms: [] })).week).toBe(0);
    expect(S.todayState(res(200, { enrolled: true, paused: false, date: '2026-11-03', terms: [] })).week).toBeNull();
  });

  it('keeps only terms with a string id, a string keyword and a known status', () => {
    const terms = [
      TERMS[0],
      { term_id: 5, keyword: 'a', status: 'open' },
      { term_id: 't5', keyword: 7, status: 'open' },
      { term_id: 't6', keyword: 'b', status: 'archived' },
      { term_id: 't7', keyword: 'c' },
      null,
      'x',
      { term_id: 't8', keyword: 'd', status: 'late', extra: 1 }
    ];
    expect(S.todayState(res(200, { enrolled: true, week: 1, paused: false, date: '2026-11-03', terms })).terms)
      .toEqual([TERMS[0], { term_id: 't8', keyword: 'd', status: 'late' }]);
  });

  it('a 401, or a 403 for a key without the study: reconnect', () => {
    expect(S.todayState(res(401, { error: 'unauthorized' }))).toEqual({ state: 'reconnect' });
    expect(S.todayState(res(403, { error: 'insufficient_scope', required: 'study' }))).toEqual({ state: 'reconnect' });
  });

  it('any other 403: not_enrolled', () => {
    expect(S.todayState(res(403, { error: 'not_enrolled' }))).toEqual({ state: 'not_enrolled' });
    expect(S.todayState(res(403, null))).toEqual({ state: 'not_enrolled' });
  });

  it('a 429: rate_limited', () => {
    expect(S.todayState(res(429, null, { retryAfter: 30 }))).toMatchObject({ state: 'rate_limited' });
  });

  it('anything else: unavailable', () => {
    expect(S.todayState(res(404, null))).toEqual({ state: 'unavailable' });
    expect(S.todayState(res(503, { error: 'study_unavailable' }))).toEqual({ state: 'unavailable' });
    expect(S.todayState(res(500, null))).toEqual({ state: 'unavailable' });
    expect(S.todayState({ ok: false, status: 0, data: null, retryAfter: null, code: 'network' })).toEqual({ state: 'unavailable' });
    // A 200 without the fields.
    expect(S.todayState(res(200, null))).toEqual({ state: 'unavailable' });
    expect(S.todayState(res(200, {}))).toEqual({ state: 'unavailable' });
    expect(S.todayState(res(200, { enrolled: true, week: 1 }))).toEqual({ state: 'unavailable' });
    expect(S.todayState(res(200, { enrolled: true, date: '2026-11-03', terms: 'x' }))).toEqual({ state: 'unavailable' });
    expect(S.todayState(undefined)).toEqual({ state: 'unavailable' });
  });
});

describe('sendOutcome', () => {
  it('201: sent', () => {
    expect(S.sendOutcome(res(201, { ok: true }))).toEqual({ state: 'sent' });
  });

  it('409: already_sent', () => {
    expect(S.sendOutcome(res(409, { error: 'already_sent' }))).toEqual({ state: 'already_sent' });
  });

  it('422: the code it names, any other is error', () => {
    expect(S.sendOutcome(res(422, { error: 'not_assigned' }))).toEqual({ state: 'not_assigned' });
    expect(S.sendOutcome(res(422, { error: 'query_mismatch' }))).toEqual({ state: 'query_mismatch' });
    expect(S.sendOutcome(res(422, { error: 'invalid_export' }))).toEqual({ state: 'invalid_export' });
    expect(S.sendOutcome(res(422, { error: 'something_new' }))).toEqual({ state: 'error' });
    expect(S.sendOutcome(res(422, null))).toEqual({ state: 'error' });
  });

  it('413: too_large', () => {
    expect(S.sendOutcome(res(413, { error: 'export_too_large' }))).toEqual({ state: 'too_large' });
  });

  it('401, or 403 insufficient_scope: reconnect; any other 403: not_enrolled', () => {
    expect(S.sendOutcome(res(401, null))).toEqual({ state: 'reconnect' });
    expect(S.sendOutcome(res(403, { error: 'insufficient_scope', required: 'study' }))).toEqual({ state: 'reconnect' });
    expect(S.sendOutcome(res(403, { error: 'not_enrolled' }))).toEqual({ state: 'not_enrolled' });
  });

  it('429: rate_limited, with when to come back', () => {
    expect(S.sendOutcome(res(429, null, { retryAfter: 45, code: 'rate_limited' }))).toEqual({ state: 'rate_limited', retryAfter: 45 });
  });

  it('no key: no_key, before any status is read', () => {
    expect(S.sendOutcome({ ok: false, status: 0, data: null, retryAfter: null, code: 'no_key' })).toEqual({ state: 'no_key' });
  });

  it('503, 404 and a failed request: unavailable', () => {
    expect(S.sendOutcome(res(503, { error: 'study_unavailable' }))).toEqual({ state: 'unavailable' });
    expect(S.sendOutcome(res(404, null))).toEqual({ state: 'unavailable' });
    expect(S.sendOutcome(res(0, null, { code: 'network' }))).toEqual({ state: 'unavailable' });
  });

  it('anything else: error', () => {
    expect(S.sendOutcome(res(500, null))).toEqual({ state: 'error' });
    expect(S.sendOutcome(res(400, { error: 'bad' }))).toEqual({ state: 'error' });
    expect(S.sendOutcome(undefined)).toEqual({ state: 'error' });
  });
});

describe('stopOutcome', () => {
  it('200: stopped, with how many terms moved to tomorrow', () => {
    expect(S.stopOutcome(res(200, { ok: true, carried: 4 }))).toEqual({ state: 'stopped', carried: 4 });
    expect(S.stopOutcome(res(200, { ok: true, carried: 0 }))).toEqual({ state: 'stopped', carried: 0 });
  });

  it('a carried that is not a number is 0', () => {
    expect(S.stopOutcome(res(200, { ok: true }))).toEqual({ state: 'stopped', carried: 0 });
    expect(S.stopOutcome(res(200, { ok: true, carried: '3' }))).toEqual({ state: 'stopped', carried: 0 });
    expect(S.stopOutcome(res(200, null))).toEqual({ state: 'stopped', carried: 0 });
  });

  it('no key: no_key, before any status is read', () => {
    expect(S.stopOutcome({ ok: false, status: 0, data: null, retryAfter: null, code: 'no_key' })).toEqual({ state: 'no_key' });
  });

  it('reads 401, 403, 429 and unavailable as a send does', () => {
    expect(S.stopOutcome(res(401, null))).toEqual({ state: 'reconnect' });
    expect(S.stopOutcome(res(403, { error: 'insufficient_scope' }))).toEqual({ state: 'reconnect' });
    expect(S.stopOutcome(res(403, { error: 'not_enrolled' }))).toEqual({ state: 'not_enrolled' });
    expect(S.stopOutcome(res(429, null, { retryAfter: 20, code: 'rate_limited' }))).toEqual({ state: 'rate_limited', retryAfter: 20 });
    expect(S.stopOutcome(res(503, null))).toEqual({ state: 'unavailable' });
    expect(S.stopOutcome(res(404, null))).toEqual({ state: 'unavailable' });
    expect(S.stopOutcome(res(0, null, { code: 'network' }))).toEqual({ state: 'unavailable' });
  });

  it('anything else: error', () => {
    expect(S.stopOutcome(res(409, null))).toEqual({ state: 'error' });
    expect(S.stopOutcome(res(422, { error: 'not_assigned' }))).toEqual({ state: 'error' });
    expect(S.stopOutcome(res(500, null))).toEqual({ state: 'error' });
  });
});

describe('openGate', () => {
  const base = { accepted: true, today: READY, termId: 't1', incognitoAllowed: true };

  it('ok, with the term', () => {
    expect(S.openGate(base)).toEqual({ ok: true, term: TERMS[0] });
    // A late term is still open to search.
    expect(S.openGate({ ...base, termId: 't3' })).toEqual({ ok: true, term: TERMS[2] });
  });

  it('not_accepted comes first', () => {
    expect(S.openGate({ ...base, accepted: false, today: { state: 'no_key' }, incognitoAllowed: false }))
      .toEqual({ ok: false, reason: 'not_accepted' });
  });

  it('then the list is not ready: its state is the reason', () => {
    ['no_key', 'not_enrolled', 'paused', 'reconnect', 'rate_limited', 'unavailable'].forEach((state) => {
      expect(S.openGate({ ...base, today: { state }, termId: 'nope', incognitoAllowed: false }))
        .toEqual({ ok: false, reason: state });
    });
    expect(S.openGate({ ...base, today: undefined })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('then the term is not on the list', () => {
    expect(S.openGate({ ...base, termId: 'nope', incognitoAllowed: false })).toEqual({ ok: false, reason: 'not_on_list' });
  });

  it('then it was already sent', () => {
    expect(S.openGate({ ...base, termId: 't2', incognitoAllowed: false })).toEqual({ ok: false, reason: 'already_sent' });
  });

  it('then private windows are not allowed', () => {
    expect(S.openGate({ ...base, incognitoAllowed: false })).toEqual({ ok: false, reason: 'incognito_off' });
  });
});

describe('sendGate', () => {
  const kw = 'how does seo work';
  const base = {
    accepted: true,
    record: { termId: 't1', keyword: kw },
    today: READY,
    termId: 't1',
    url: S.studySearchUrl(kw),
    csvBytes: 5000
  };

  it('ok', () => {
    expect(S.sendGate(base)).toEqual({ ok: true });
    expect(S.sendGate({ ...base, csvBytes: S.MAX_CSV_BYTES })).toEqual({ ok: true });
  });

  it('not_accepted comes first', () => {
    expect(S.sendGate({ ...base, accepted: false, record: null, csvBytes: 0 })).toEqual({ ok: false, reason: 'not_accepted' });
  });

  it('then the tab is not one the study panel opened for this term', () => {
    expect(S.sendGate({ ...base, record: null, today: { state: 'paused' } })).toEqual({ ok: false, reason: 'not_study_tab' });
    expect(S.sendGate({ ...base, record: undefined })).toEqual({ ok: false, reason: 'not_study_tab' });
    expect(S.sendGate({ ...base, record: { termId: 't9', keyword: kw }, today: { state: 'paused' } }))
      .toEqual({ ok: false, reason: 'not_study_tab' });
  });

  it('then the list is not ready: its state is the reason', () => {
    expect(S.sendGate({ ...base, today: { state: 'paused' }, url: 'https://example.com/' })).toEqual({ ok: false, reason: 'paused' });
    expect(S.sendGate({ ...base, today: { state: 'reconnect' } })).toEqual({ ok: false, reason: 'reconnect' });
    expect(S.sendGate({ ...base, today: undefined })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('then the term is not on the list', () => {
    expect(S.sendGate({ ...base, record: { termId: 'nope', keyword: kw }, termId: 'nope', url: 'https://example.com/' }))
      .toEqual({ ok: false, reason: 'not_on_list' });
  });

  it('then it was already sent', () => {
    expect(S.sendGate({ ...base, record: { termId: 't2', keyword: 'what is a backlink' }, termId: 't2', url: 'https://example.com/' }))
      .toEqual({ ok: false, reason: 'already_sent' });
  });

  it('then the tab no longer shows the search: the page check names why', () => {
    expect(S.sendGate({ ...base, url: base.url.replace('www.google.com', 'www.google.co.uk'), csvBytes: 0 })).toEqual({ ok: false, reason: 'not_google' });
    expect(S.sendGate({ ...base, url: base.url.replace('how+does+seo+work', 'other') })).toEqual({ ok: false, reason: 'other_search' });
    expect(S.sendGate({ ...base, url: base.url + '&start=10' })).toEqual({ ok: false, reason: 'not_page_one' });
    expect(S.sendGate({ ...base, url: base.url.replace('&pws=0', '') })).toEqual({ ok: false, reason: 'params_changed' });
  });

  it('then there is nothing to send', () => {
    expect(S.sendGate({ ...base, csvBytes: 0 })).toEqual({ ok: false, reason: 'empty' });
    expect(S.sendGate({ ...base, csvBytes: undefined })).toEqual({ ok: false, reason: 'empty' });
  });

  it('then it is too large', () => {
    expect(S.sendGate({ ...base, csvBytes: S.MAX_CSV_BYTES + 1 })).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('weekLabel', () => {
  it('0 is the pilot week, n is Week n, none is empty', () => {
    expect(S.weekLabel(0)).toBe('Pilot week');
    expect(S.weekLabel(3)).toBe('Week 3');
    expect(S.weekLabel(null)).toBe('');
    expect(S.weekLabel(undefined)).toBe('');
  });
});

describe('message', () => {
  const CODES = [
    'unavailable', 'no_key', 'reconnect', 'not_enrolled', 'paused', 'rate_limited', 'not_accepted',
    'incognito_off', 'not_study_tab', 'not_on_list', 'not_assigned', 'already_sent', 'other_search',
    'not_page_one', 'params_changed', 'not_google', 'query_mismatch', 'too_large', 'empty',
    'invalid_export', 'error', 'sent', 'stopped'
  ];

  it('has words for every code a gate or an answer can give', () => {
    CODES.forEach((code) => {
      expect(typeof S.message(code)).toBe('string');
      expect(S.message(code).length).toBeGreaterThan(0);
    });
  });

  it('every state and reason the gates and answers produce has words of its own', () => {
    const produced = new Set();
    [
      S.todayState({ code: 'no_key' }), S.todayState(res(200, { enrolled: false })),
      S.todayState(res(200, { enrolled: true, paused: true })), S.todayState(res(401)),
      S.todayState(res(403, { error: 'not_enrolled' })), S.todayState(res(429)), S.todayState(res(503)),
      S.sendOutcome(res(201)), S.sendOutcome(res(409)), S.sendOutcome(res(422, { error: 'not_assigned' })),
      S.sendOutcome(res(422, { error: 'query_mismatch' })), S.sendOutcome(res(422, { error: 'invalid_export' })),
      S.sendOutcome(res(413)), S.sendOutcome(res(500)), S.stopOutcome(res(200, {}))
    ].forEach((o) => produced.add(o.state));
    ['not_accepted', 'not_study_tab', 'not_on_list', 'already_sent', 'incognito_off', 'empty', 'too_large',
      'other_search', 'not_page_one', 'params_changed', 'not_google'].forEach((r) => produced.add(r));
    produced.forEach((code) => {
      if (code === 'ready') return;
      expect(CODES, code).toContain(code);
    });
  });

  it('says it in the words the study uses', () => {
    expect(S.message('unavailable')).toBe("The study isn't available yet. Try again later.");
    expect(S.message('no_key')).toBe('Connect the extension to your seobandwagon.com account to take part.');
    expect(S.message('reconnect')).toBe("Reconnect the extension to your seobandwagon.com account: its key doesn't include the study.");
    expect(S.message('not_enrolled')).toBe('Join the study on seobandwagon.com first.');
    expect(S.message('paused')).toBe('The study is paused this week.');
    expect(S.message('rate_limited')).toBe('Too many sends at once. Wait a minute, then try again.');
    expect(S.message('not_accepted')).toBe("Turn on study sends in the extension's settings first.");
    expect(S.message('incognito_off')).toBe("SEO Bandwagon isn't allowed in private windows, and the study only searches in one. On the extension's Details page, switch on Allow in Incognito, then click the term again.");
    expect(S.message('not_study_tab')).toBe('Only a search opened from the study panel can be sent.');
    expect(S.message('already_sent')).toBe('Already sent today.');
    expect(S.message('too_large')).toBe('This results page is too large to send.');
    expect(S.message('error')).toBe("Couldn't send. Try again.");
    expect(S.message('sent')).toBe('Sent to the study.');
    expect(S.message('stopped')).toBe('Recorded. Stop searching for today; your other terms move to tomorrow.');
  });

  it('codes that share words share them exactly', () => {
    expect(S.message('not_assigned')).toBe(S.message('not_on_list'));
    expect(S.message('not_on_list')).toBe("This term isn't on your list for today.");
    const gone = "This tab no longer shows the study's search. Open the term again from the study panel.";
    ['other_search', 'not_page_one', 'params_changed', 'not_google', 'query_mismatch'].forEach((c) => {
      expect(S.message(c)).toBe(gone);
    });
    const unreadable = "This page's results couldn't be read, so nothing was sent.";
    expect(S.message('empty')).toBe(unreadable);
    expect(S.message('invalid_export')).toBe(unreadable);
  });

  it('an unknown code reads as error, and so does a name Object has', () => {
    expect(S.message('nope')).toBe(S.message('error'));
    expect(S.message(undefined)).toBe(S.message('error'));
    expect(S.message('constructor')).toBe(S.message('error'));
    expect(S.message('toString')).toBe(S.message('error'));
  });

  it('uses no em-dashes', () => {
    CODES.forEach((code) => expect(S.message(code)).not.toContain('\u2014'));
  });
});
