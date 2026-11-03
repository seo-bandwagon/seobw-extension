// The worker's side of the AI Overview study (src/lib/aio-study-service.js,
// 1.13.3), over fake dependencies: the study's three calls, the person's
// yes, session storage, windows and the private-window switch. What matters
// most: a term opens in a private window or not at all, and a send comes
// only from the tab that window opened, still on the study's search.

import { describe, it, expect, vi, beforeEach } from 'vitest';

await import('../../extension/src/lib/aio-study.js');
const S = globalThis.SBWAioStudy;
const { create, TODAY_KEY, TABS_KEY } = require('../../extension/src/lib/aio-study-service.js');

const NOW = Date.UTC(2026, 10, 3, 15, 0, 0); // 2026-11-03 15:00 UTC
const DAY = '2026-11-03';

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
const todayBody = (over = {}) => ({ enrolled: true, paused: false, week: 2, date: DAY, terms: TERMS, ...over });

const T1_URL = 'https://www.google.com/search?q=how+does+seo+work&hl=en&gl=us&pws=0';

// chrome.storage.session: get(key) answers { [key]: value }, values are
// copied in and out as the browser's are.
function sessionStorage(data = {}) {
  const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    data,
    get: vi.fn(async (keys) => {
      const list = keys === null ? Object.keys(data) : [].concat(keys);
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, copy(data[k])]));
    }),
    set: vi.fn(async (obj) => { Object.keys(obj).forEach((k) => { data[k] = copy(obj[k]); }); })
  };
}

let api, session, windows, incognitoAllowed, consentOk, clock, deps, svc, nextTabId, nextWindowId, windowAnswer;

function makeDeps() {
  return { api, consentOk, session, windows, incognitoAllowed, now: () => clock.t };
}

beforeEach(() => {
  clock = { t: NOW };
  nextTabId = 41;
  nextWindowId = 7;
  windowAnswer = (opts) => ({ id: nextWindowId, incognito: opts.incognito, tabs: [{ id: nextTabId }] });
  api = {
    today: vi.fn(async () => res(200, todayBody())),
    send: vi.fn(async () => res(201, { ok: true })),
    stop: vi.fn(async () => res(200, { ok: true, carried: 2 }))
  };
  session = sessionStorage();
  windows = {
    create: vi.fn(async (opts) => windowAnswer(opts)),
    remove: vi.fn(async () => {})
  };
  incognitoAllowed = vi.fn(async () => true);
  consentOk = vi.fn(async () => true);
  deps = makeDeps();
  svc = create(deps);
});

// Opens t1 and answers its tab id.
async function openT1() {
  const out = await svc.open('t1');
  expect(out.ok).toBe(true);
  return out.tabId;
}

describe('today', () => {
  it('asks the site, answers the list, and keeps it with its age', async () => {
    const out = await svc.today();
    expect(out).toEqual({ state: 'ready', week: 2, date: DAY, terms: TERMS });
    expect(api.today).toHaveBeenCalledTimes(1);
    expect(session.data[TODAY_KEY]).toEqual({ state: 'ready', week: 2, date: DAY, terms: TERMS, at: NOW });
  });

  it('answers from what it kept within five minutes on the same UTC day', async () => {
    await svc.today();
    clock.t = NOW + 299999;
    expect(await svc.today({ fresh: false })).toEqual({ state: 'ready', week: 2, date: DAY, terms: TERMS });
    expect(api.today).toHaveBeenCalledTimes(1);
  });

  it('asks again when fresh, once five minutes have passed, or when the list is dated yesterday', async () => {
    await svc.today();
    await svc.today({ fresh: true });
    expect(api.today).toHaveBeenCalledTimes(2);

    clock.t = NOW + 300000;
    await svc.today();
    expect(api.today).toHaveBeenCalledTimes(3);

    // Kept at 23:59 UTC, asked for again at 00:01 the next day, well within
    // five minutes of it.
    session = sessionStorage();
    svc = create(Object.assign(makeDeps(), { session }));
    api.today.mockClear();
    clock.t = Date.UTC(2026, 10, 3, 23, 59, 0);
    await svc.today();
    clock.t = Date.UTC(2026, 10, 4, 0, 1, 0);
    api.today.mockResolvedValue(res(200, todayBody({ date: '2026-11-04' })));
    const next = await svc.today();
    expect(api.today).toHaveBeenCalledTimes(2);
    expect(next.date).toBe('2026-11-04');
  });

  it('answers each of the site\'s other states and keeps none of them as a list', async () => {
    api.today.mockResolvedValue(res(200, { enrolled: false, paused: false }));
    expect(await svc.today({ fresh: true })).toEqual({ state: 'not_enrolled' });
    api.today.mockResolvedValue(res(200, { enrolled: true, paused: true }));
    expect(await svc.today({ fresh: true })).toEqual({ state: 'paused' });
    api.today.mockResolvedValue(res(403, { error: 'insufficient_scope' }));
    expect(await svc.today({ fresh: true })).toEqual({ state: 'reconnect' });
    api.today.mockResolvedValue({ ok: false, status: 0, data: null, retryAfter: null, code: 'no_key' });
    expect(await svc.today({ fresh: true })).toEqual({ state: 'no_key' });
    // None of them has a date, so none is ever served as the day's list.
    api.today.mockClear();
    await svc.today();
    expect(api.today).toHaveBeenCalledTimes(1);
  });

  it('reads a failed request as unavailable', async () => {
    api.today.mockRejectedValue(new Error('offline'));
    expect(await svc.today({ fresh: true })).toEqual({ state: 'unavailable' });
  });

  it('without the yes: not_accepted, nothing asked, nothing served from the kept list', async () => {
    await svc.today();
    api.today.mockClear();
    consentOk.mockResolvedValue(false);
    expect(await svc.today()).toEqual({ state: 'not_accepted' });
    expect(await svc.today({ fresh: true })).toEqual({ state: 'not_accepted' });
    expect(api.today).not.toHaveBeenCalled();
  });

  it('a consent check that throws is no', async () => {
    consentOk.mockRejectedValue(new Error('storage gone'));
    expect(await svc.today({ fresh: true })).toEqual({ state: 'not_accepted' });
    expect(api.today).not.toHaveBeenCalled();
  });

  it('copes with the kept list vanishing (Connect or Disconnect clears it)', async () => {
    await svc.today();
    delete session.data[TODAY_KEY];
    await svc.today();
    expect(api.today).toHaveBeenCalledTimes(2);
  });
});

describe('open', () => {
  it('opens a term on the list with exactly { incognito: true, url } and records the tab', async () => {
    const out = await svc.open('t1');
    expect(out).toEqual({ ok: true, tabId: 41 });
    expect(windows.create).toHaveBeenCalledTimes(1);
    expect(windows.create).toHaveBeenCalledWith({
      incognito: true,
      url: 'https://www.google.com/search?q=how+does+seo+work&hl=en&gl=us&pws=0'
    });
    expect(Object.keys(windows.create.mock.calls[0][0]).sort()).toEqual(['incognito', 'url']);
    expect(session.data[TABS_KEY]).toEqual({
      41: { termId: 't1', keyword: 'how does seo work', date: DAY, windowId: 7, openedAt: NOW }
    });
    expect(windows.remove).not.toHaveBeenCalled();
  });

  it('opens a carried-over term too', async () => {
    windowAnswer = (opts) => ({ id: 8, incognito: opts.incognito, tabs: [{ id: 52 }] });
    expect(await svc.open('t3')).toEqual({ ok: true, tabId: 52 });
    expect(windows.create.mock.calls[0][0].url).toContain('q=crm+for+nonprofits');
    expect(session.data[TABS_KEY]['52'].termId).toBe('t3');
  });

  it('asks the site for the list fresh every time', async () => {
    await svc.today();
    api.today.mockClear();
    await svc.open('t1');
    expect(api.today).toHaveBeenCalledTimes(1);
  });

  it('keeps every tab it opened: two terms opened together both have their records', async () => {
    windows.create.mockImplementation(async (opts) => {
      const n = windows.create.mock.calls.length;
      return { id: 10 + n, incognito: opts.incognito, tabs: [{ id: 100 + n }] };
    });
    const both = await Promise.all([svc.open('t1'), svc.open('t3')]);
    expect(both.map((o) => o.ok)).toEqual([true, true]);
    expect(Object.keys(session.data[TABS_KEY]).sort()).toEqual(['101', '102']);
  });

  it('with the extension not allowed in private windows: incognito_off, and no window is created', async () => {
    incognitoAllowed.mockResolvedValue(false);
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'incognito_off' });
    expect(windows.create).not.toHaveBeenCalled();
    expect(session.data[TABS_KEY]).toBeUndefined();
  });

  it('a check of the switch that throws reads as off', async () => {
    incognitoAllowed.mockRejectedValue(new Error('no'));
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'incognito_off' });
    expect(windows.create).not.toHaveBeenCalled();
  });

  it('a create that throws: incognito_off, and no record', async () => {
    windows.create.mockRejectedValue(new Error('Cannot create incognito window'));
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'incognito_off' });
    expect(session.data[TABS_KEY]).toBeUndefined();
  });

  it('a window that is not private is removed: incognito_off, and no record', async () => {
    windowAnswer = () => ({ id: 9, incognito: false, tabs: [{ id: 60 }] });
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'incognito_off' });
    expect(windows.remove).toHaveBeenCalledWith(9);
    expect(session.data[TABS_KEY]).toBeUndefined();
  });

  it('a window that does not say it is private is removed too', async () => {
    windowAnswer = () => ({ id: 9, tabs: [{ id: 60 }] });
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'incognito_off' });
    expect(windows.remove).toHaveBeenCalledWith(9);
    expect(session.data[TABS_KEY]).toBeUndefined();
  });

  it('a private window without a tab is removed, and nothing is recorded', async () => {
    windowAnswer = () => ({ id: 9, incognito: true, tabs: [] });
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'error' });
    expect(windows.remove).toHaveBeenCalledWith(9);
    expect(session.data[TABS_KEY]).toBeUndefined();
  });

  it('a record that cannot be kept closes the window', async () => {
    session.set.mockRejectedValue(new Error('quota'));
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'error' });
    expect(windows.remove).toHaveBeenCalledWith(7);
  });

  it('a window that will not close still gives the refusal', async () => {
    windowAnswer = () => ({ id: 9, incognito: false, tabs: [{ id: 60 }] });
    windows.remove.mockRejectedValue(new Error('gone'));
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'incognito_off' });
  });

  it('refuses without opening anything: a term that is not on the list, one already sent, no yes, no list', async () => {
    expect(await svc.open('nope')).toEqual({ ok: false, reason: 'not_on_list' });
    expect(await svc.open('t2')).toEqual({ ok: false, reason: 'already_sent' });

    consentOk.mockResolvedValue(false);
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'not_accepted' });
    consentOk.mockResolvedValue(true);

    api.today.mockResolvedValue(res(200, { enrolled: true, paused: true }));
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'paused' });
    api.today.mockResolvedValue(res(403, { error: 'not_enrolled' }));
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'not_enrolled' });
    api.today.mockResolvedValue(res(401, { error: 'invalid_key' }));
    expect(await svc.open('t1')).toEqual({ ok: false, reason: 'reconnect' });

    expect(windows.create).not.toHaveBeenCalled();
    expect(session.data[TABS_KEY]).toBeUndefined();
  });

  it('never passes incognito as anything but true, whatever happened', async () => {
    await svc.open('t1');
    incognitoAllowed.mockResolvedValue(false);
    await svc.open('t1');
    incognitoAllowed.mockResolvedValue(true);
    windows.create.mockRejectedValueOnce(new Error('no'));
    await svc.open('t3');
    windowAnswer = () => ({ id: 9, incognito: false, tabs: [{ id: 60 }] });
    await svc.open('t3');
    expect(windows.create.mock.calls.length).toBeGreaterThan(0);
    windows.create.mock.calls.forEach(([opts]) => {
      expect(opts.incognito).toBe(true);
      expect(Object.keys(opts).sort()).toEqual(['incognito', 'url']);
    });
  });
});

describe('tabStatus', () => {
  it('is { study: false } for a tab it did not open, and for storage with no records', async () => {
    expect(await svc.tabStatus(5, T1_URL)).toEqual({ study: false });
    await openT1();
    expect(await svc.tabStatus(5, T1_URL)).toEqual({ study: false });
  });

  it('says what the tab is for, whether the yes is given, the term\'s status and whether the page is the search', async () => {
    const tabId = await openT1();
    expect(await svc.tabStatus(tabId, T1_URL)).toEqual({
      study: true,
      termId: 't1',
      keyword: 'how does seo work',
      accepted: true,
      status: 'open',
      page: { ok: true }
    });
  });

  it('reads the page as changed once the tab has another search or page 2', async () => {
    const tabId = await openT1();
    const other = await svc.tabStatus(tabId, 'https://www.google.com/search?q=how+to+do+seo&hl=en&gl=us&pws=0');
    expect(other.page).toEqual({ ok: false, reason: 'other_search' });
    const two = await svc.tabStatus(tabId, T1_URL + '&start=10');
    expect(two.page).toEqual({ ok: false, reason: 'not_page_one' });
  });

  it('shows a sent term as sent, and a term missing from the list as null', async () => {
    const tabId = await openT1();
    api.today.mockResolvedValue(res(200, todayBody({ terms: [{ term_id: 't1', keyword: 'how does seo work', status: 'sent' }] })));
    await svc.today({ fresh: true });
    expect((await svc.tabStatus(tabId, T1_URL)).status).toBe('sent');
    api.today.mockResolvedValue(res(200, todayBody({ terms: [] })));
    await svc.today({ fresh: true });
    expect((await svc.tabStatus(tabId, T1_URL)).status).toBeNull();
  });

  it('without the yes: accepted false, no status, and the list is not asked for', async () => {
    const tabId = await openT1();
    consentOk.mockResolvedValue(false);
    api.today.mockClear();
    const out = await svc.tabStatus(tabId, T1_URL);
    expect(out).toMatchObject({ study: true, accepted: false, status: null });
    expect(api.today).not.toHaveBeenCalled();
  });

  it('keeps the status null while the list is unavailable', async () => {
    const tabId = await openT1();
    api.today.mockResolvedValue(res(503, { error: 'study_unavailable' }));
    await svc.today({ fresh: true });
    expect((await svc.tabStatus(tabId, T1_URL)).status).toBeNull();
  });
});

describe('send', () => {
  let tabId;
  beforeEach(async () => {
    tabId = await openT1();
    api.today.mockClear();
  });

  it('posts exactly { term_id, csv } and answers sent', async () => {
    const csv = 'Position,URL\n1,https://example.com/\n';
    expect(await svc.send(tabId, T1_URL, 't1', csv)).toEqual({ state: 'sent' });
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith({ term_id: 't1', csv });
    expect(Object.keys(api.send.mock.calls[0][0]).sort()).toEqual(['csv', 'term_id']);
  });

  it('marks the term sent in the kept list, and leaves the list\'s age alone', async () => {
    await svc.today({ fresh: true });
    clock.t = NOW + 60000;
    await svc.send(tabId, T1_URL, 't1', 'a,b\n');
    const kept = session.data[TODAY_KEY];
    expect(kept.terms.map((t) => [t.term_id, t.status])).toEqual([['t1', 'sent'], ['t2', 'sent'], ['t3', 'late']]);
    expect(kept.at).toBe(NOW);
    // And a second send for it is refused before it posts.
    api.send.mockClear();
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'already_sent' });
    expect(api.send).not.toHaveBeenCalled();
  });

  it('a 409 is already_sent, and marks the term sent too', async () => {
    api.send.mockResolvedValue(res(409, { error: 'already_sent' }));
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'already_sent' });
    expect(session.data[TODAY_KEY].terms[0].status).toBe('sent');
  });

  it('answers each of the site\'s refusals and marks nothing sent', async () => {
    const cases = [
      [res(422, { error: 'query_mismatch' }), { state: 'query_mismatch' }],
      [res(422, { error: 'not_assigned' }), { state: 'not_assigned' }],
      [res(422, { error: 'invalid_export' }), { state: 'invalid_export' }],
      [res(413, { error: 'export_too_large' }), { state: 'too_large' }],
      [res(429, { error: 'rate_limited' }, { retryAfter: 30 }), { state: 'rate_limited', retryAfter: 30 }],
      [res(403, { error: 'insufficient_scope' }), { state: 'reconnect' }],
      [res(503, { error: 'study_unavailable' }), { state: 'unavailable' }],
      [{ ok: false, status: 0, data: null, retryAfter: null, code: 'no_key' }, { state: 'no_key' }]
    ];
    for (const [answer, expected] of cases) {
      api.send.mockResolvedValue(answer);
      expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual(expected);
    }
    expect(session.data[TODAY_KEY].terms[0].status).toBe('open');
  });

  it('a request that throws is an error', async () => {
    api.send.mockRejectedValue(new Error('offline'));
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'error' });
  });

  it('no record for the tab: not_study_tab, nothing posted, and the list is not asked for', async () => {
    expect(await svc.send(999, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'not_study_tab' });
    expect(api.send).not.toHaveBeenCalled();
    expect(api.today).not.toHaveBeenCalled();
  });

  it('a record for another term: not_study_tab, nothing posted', async () => {
    expect(await svc.send(tabId, T1_URL, 't3', 'a,b\n')).toEqual({ state: 'not_study_tab' });
    expect(api.send).not.toHaveBeenCalled();
  });

  it('a term already sent: already_sent, nothing posted', async () => {
    api.today.mockResolvedValue(res(200, todayBody({ terms: [{ term_id: 't1', keyword: 'how does seo work', status: 'sent' }] })));
    await svc.today({ fresh: true });
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'already_sent' });
    expect(api.send).not.toHaveBeenCalled();
  });

  it('a term gone from the list: not_on_list, nothing posted', async () => {
    api.today.mockResolvedValue(res(200, todayBody({ terms: [] })));
    await svc.today({ fresh: true });
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'not_on_list' });
    expect(api.send).not.toHaveBeenCalled();
  });

  it('a tab that no longer shows the search gives the page\'s reason, and posts nothing', async () => {
    const cases = [
      ['https://www.google.com/search?q=other+words&hl=en&gl=us&pws=0', 'other_search'],
      [T1_URL + '&start=10', 'not_page_one'],
      ['https://www.google.com/search?q=how+does+seo+work&hl=de&gl=us&pws=0', 'params_changed'],
      ['https://www.google.com/search?q=how+does+seo+work&hl=en&gl=us', 'params_changed'],
      ['https://example.com/', 'not_google'],
      [undefined, 'not_google']
    ];
    for (const [url, reason] of cases) {
      expect(await svc.send(tabId, url, 't1', 'a,b\n')).toEqual({ state: reason });
    }
    expect(api.send).not.toHaveBeenCalled();
  });

  it('takes a differently spelled query on the same search', async () => {
    const url = 'https://www.google.com/search?q=How+does+SEO+work%3F&hl=en&gl=us&pws=0';
    expect(await svc.send(tabId, url, 't1', 'a,b\n')).toEqual({ state: 'sent' });
  });

  it('counts the bytes of the CSV as UTF-8: 0 is empty, 262,145 is too large, 262,144 is posted', async () => {
    expect(await svc.send(tabId, T1_URL, 't1', '')).toEqual({ state: 'empty' });
    expect(await svc.send(tabId, T1_URL, 't1', undefined)).toEqual({ state: 'empty' });
    expect(await svc.send(tabId, T1_URL, 't1', 'a'.repeat(262145))).toEqual({ state: 'too_large' });
    expect(api.send).not.toHaveBeenCalled();

    // Two-byte characters: 131,073 of them are 262,146 bytes in 131,073 characters.
    expect(await svc.send(tabId, T1_URL, 't1', 'é'.repeat(131073))).toEqual({ state: 'too_large' });
    expect(api.send).not.toHaveBeenCalled();

    const exact = 'a'.repeat(262144);
    expect(await svc.send(tabId, T1_URL, 't1', exact)).toEqual({ state: 'sent' });
    expect(api.send).toHaveBeenCalledWith({ term_id: 't1', csv: exact });
  });

  it('without the yes: not_accepted, nothing posted', async () => {
    consentOk.mockResolvedValue(false);
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'not_accepted' });
    expect(api.send).not.toHaveBeenCalled();
  });

  it('with the list unavailable: its state, nothing posted', async () => {
    api.today.mockResolvedValue(res(503, { error: 'study_unavailable' }));
    await svc.today({ fresh: true });
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'unavailable' });
    expect(api.send).not.toHaveBeenCalled();
  });

  it('reads the day\'s list from what it kept, and asks only when that has aged out', async () => {
    await svc.today({ fresh: true });
    api.today.mockClear();
    await svc.send(tabId, T1_URL, 't1', 'a,b\n');
    expect(api.today).not.toHaveBeenCalled();

    session.data[TODAY_KEY] = undefined;
    delete session.data[TODAY_KEY];
    await svc.send(tabId, T1_URL, 't1', 'a,b\n');
    expect(api.today).toHaveBeenCalledTimes(1);
  });
});

describe('a worker that restarts between opening a term and sending it', () => {
  it('a second service over the same session storage sends for the tab the first one opened', async () => {
    const first = create(makeDeps());
    const opened = await first.open('t1');
    expect(opened.ok).toBe(true);

    // The worker is gone; a new one starts over the same chrome.storage.session.
    const second = create(makeDeps());
    api.today.mockClear();
    expect(await second.isStudyTab(opened.tabId)).toBe(true);
    expect(await second.tabStatus(opened.tabId, T1_URL)).toMatchObject({ study: true, termId: 't1', status: 'open', page: { ok: true } });
    expect(await second.send(opened.tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'sent' });
    expect(api.send).toHaveBeenCalledWith({ term_id: 't1', csv: 'a,b\n' });
    // The list came back from storage too.
    expect(api.today).not.toHaveBeenCalled();
  });
});

describe('stop', () => {
  it('without the yes: not_accepted, and nothing is posted', async () => {
    consentOk.mockResolvedValue(false);
    expect(await svc.stop()).toEqual({ state: 'not_accepted' });
    expect(api.stop).not.toHaveBeenCalled();
    expect(api.today).not.toHaveBeenCalled();
  });

  it('with it: posts, answers stopped with how many carried, then asks for the list again', async () => {
    await svc.today();
    api.today.mockClear();
    api.today.mockResolvedValue(res(200, todayBody({ terms: [{ term_id: 't1', keyword: 'how does seo work', status: 'late' }] })));
    expect(await svc.stop()).toEqual({ state: 'stopped', carried: 2 });
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(api.stop).toHaveBeenCalledWith();
    expect(api.today).toHaveBeenCalledTimes(1);
    expect(api.stop.mock.invocationCallOrder[0]).toBeLessThan(api.today.mock.invocationCallOrder[0]);
    expect(session.data[TODAY_KEY].terms).toEqual([{ term_id: 't1', keyword: 'how does seo work', status: 'late' }]);
  });

  it('answers the site\'s refusals', async () => {
    api.stop.mockResolvedValue(res(429, { error: 'rate_limited' }, { retryAfter: 12 }));
    expect(await svc.stop()).toEqual({ state: 'rate_limited', retryAfter: 12 });
    api.stop.mockResolvedValue(res(403, { error: 'not_enrolled' }));
    expect(await svc.stop()).toEqual({ state: 'not_enrolled' });
    api.stop.mockResolvedValue({ ok: false, status: 0, data: null, retryAfter: null, code: 'no_key' });
    expect(await svc.stop()).toEqual({ state: 'no_key' });
    api.stop.mockRejectedValue(new Error('offline'));
    expect(await svc.stop()).toEqual({ state: 'error' });
  });

  it('asks nothing more when the stop did not go through', async () => {
    api.stop.mockResolvedValue(res(503, { error: 'study_unavailable' }));
    expect(await svc.stop()).toEqual({ state: 'unavailable' });
    expect(api.today).not.toHaveBeenCalled();
  });
});

describe('forget and isStudyTab', () => {
  it('a tab the worker opened is a study tab until it closes', async () => {
    const tabId = await openT1();
    expect(await svc.isStudyTab(tabId)).toBe(true);
    expect(await svc.isStudyTab(String(tabId))).toBe(true);
    expect(await svc.isStudyTab(tabId + 1)).toBe(false);

    await svc.forget(tabId);
    expect(await svc.isStudyTab(tabId)).toBe(false);
    expect(await svc.send(tabId, T1_URL, 't1', 'a,b\n')).toEqual({ state: 'not_study_tab' });
  });

  it('forgets one tab and keeps the others', async () => {
    windows.create.mockImplementation(async (opts) => {
      const n = windows.create.mock.calls.length;
      return { id: 10 + n, incognito: opts.incognito, tabs: [{ id: 100 + n }] };
    });
    await svc.open('t1');
    await svc.open('t3');
    await svc.forget(101);
    expect(Object.keys(session.data[TABS_KEY])).toEqual(['102']);
  });

  it('forgetting a tab it never knew writes nothing', async () => {
    await svc.forget(5);
    expect(session.set).not.toHaveBeenCalled();
    await openT1();
    session.set.mockClear();
    await svc.forget(5);
    expect(session.set).not.toHaveBeenCalled();
  });

  it('is no study tab when the records vanish (Connect or Disconnect clears them) or are not an object', async () => {
    const tabId = await openT1();
    delete session.data[TABS_KEY];
    expect(await svc.isStudyTab(tabId)).toBe(false);
    session.data[TABS_KEY] = ['41'];
    expect(await svc.isStudyTab(41)).toBe(false);
    session.data[TABS_KEY] = null;
    expect(await svc.isStudyTab(41)).toBe(false);
    await expect(svc.forget(41)).resolves.toBeUndefined();
  });

  it('does not say a tab is not a study tab when the records cannot be read', async () => {
    session.get.mockRejectedValue(new Error('storage gone'));
    await expect(svc.isStudyTab(41)).rejects.toThrow();
  });
});

describe('the module', () => {
  it('attaches to the global scope and reads the study module when a call is made', async () => {
    expect(globalThis.SBWAioStudyService).toBeDefined();
    expect(globalThis.SBWAioStudyService.create).toBe(create);
    // Created before the study module exists, used after.
    const saved = globalThis.SBWAioStudy;
    delete globalThis.SBWAioStudy;
    try {
      const early = create(makeDeps());
      globalThis.SBWAioStudy = saved;
      expect((await early.today()).state).toBe('ready');
    } finally {
      globalThis.SBWAioStudy = saved;
    }
  });
});
