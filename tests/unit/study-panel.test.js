// The popup's STUDY tab (src/popup/study-panel.js, 1.13.3): shown only after
// the yes to study sends; lists the day's terms from the worker, opens each in
// a private window, and says in the study's own words (SBWAioStudy.message)
// why it can't. The worker is replaced by deps.askWorker and the tab opener by
// deps.openUrl, so nothing here needs a browser.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Same order as popup.html: sync-state before api, the study's pure module,
// then the panel.
await import('../../extension/src/lib/sync-state.js');
await import('../../extension/src/lib/consent.js');
await import('../../extension/src/lib/api.js');
await import('../../extension/src/lib/options-logic.js');
await import('../../extension/src/lib/site-links.js');
await import('../../extension/src/lib/aio-study.js');
await import('../../extension/src/popup/study-panel.js');

const S = globalThis.SBWAioStudy;
const Panel = globalThis.SBWStudyPanel;

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TERMS = [
  { term_id: 't1', keyword: 'best running shoes', status: 'open' },
  { term_id: 't2', keyword: 'how to tie a tie', status: 'late' },
  { term_id: 't3', keyword: 'what is seo', status: 'sent' }
];
const READY = { state: 'ready', week: 3, date: '2026-11-03', terms: TERMS };

let local;
let container;
let openUrl;

// A worker that answers each action from `answers` (a value, or a function of
// the message), and records what it was asked.
function worker(answers) {
  const asked = [];
  const askWorker = vi.fn(async (msg) => {
    asked.push(msg);
    const answer = answers[msg.action];
    return typeof answer === 'function' ? answer(msg) : answer;
  });
  askWorker.asked = asked;
  return askWorker;
}

async function show(answers) {
  const askWorker = worker(answers);
  await Panel.render(container, { askWorker, openUrl });
  return askWorker;
}

const buttons = () => Array.from(container.querySelectorAll('button'));
const buttonLabeled = (label) => buttons().find((b) => b.textContent === label) || null;
const rowFor = (keyword) => Array.from(container.querySelectorAll('.study-term'))
  .find((r) => r.querySelector('.study-keyword').textContent === keyword);

beforeEach(() => {
  local = {};
  globalThis.chrome = {
    runtime: { id: EXTENSION_ID, getURL: (p) => 'chrome-extension://' + EXTENSION_ID + '/' + p },
    storage: {
      local: { get: vi.fn(async (key) => (key in local ? { [key]: local[key] } : {})) },
      // SBW.getApiSettings: the defaults, so the site is seobandwagon.com.
      sync: { get: vi.fn((defaults, cb) => cb(Object.assign({}, defaults))) }
    },
    tabs: { create: vi.fn() }
  };
  document.body.innerHTML = '';
  container = document.createElement('div');
  container.id = 'study-content';
  document.body.appendChild(container);
  openUrl = vi.fn();
});

afterEach(() => {
  delete globalThis.chrome;
});

describe('SBWStudyPanel namespace', () => {
  it('attaches to globalThis.SBWStudyPanel', () => {
    expect(typeof Panel.shouldShow).toBe('function');
    expect(typeof Panel.render).toBe('function');
  });
});

describe('shouldShow', () => {
  it('is false until the yes to study sends is on file', async () => {
    expect(await Panel.shouldShow()).toBe(false);
  });

  it('is true once the yes is on file', async () => {
    local.sbwConsent = { aioStudy: { acceptedAt: 1700000000000, version: 1 } };
    expect(await Panel.shouldShow()).toBe(true);
  });

  it('is false again when the yes is withdrawn', async () => {
    local.sbwConsent = { aioStudy: { acceptedAt: 1700000000000, version: 1 } };
    expect(await Panel.shouldShow()).toBe(true);
    local.sbwConsent = {};
    expect(await Panel.shouldShow()).toBe(false);
  });
});

describe('a ready day', () => {
  it('asks for a fresh list, and shows the week and the date', async () => {
    const askWorker = await show({ aioStudyToday: READY });
    expect(askWorker.asked[0]).toEqual({ action: 'aioStudyToday', fresh: true });
    expect(container.querySelector('.study-week').textContent).toBe('Week 3');
    expect(container.querySelector('.study-date').textContent).toBe('2026-11-03');
  });

  it('calls week 0 the pilot week', async () => {
    await show({ aioStudyToday: Object.assign({}, READY, { week: 0 }) });
    expect(container.querySelector('.study-week').textContent).toBe('Pilot week');
  });

  it('lists one row per term, in order, each with its keyword and a status word', async () => {
    await show({ aioStudyToday: READY });
    const rows = Array.from(container.querySelectorAll('.study-term'));
    expect(rows.map((r) => r.querySelector('.study-keyword').textContent))
      .toEqual(['best running shoes', 'how to tie a tie', 'what is seo']);
    expect(rows.map((r) => r.querySelector('.study-status').textContent))
      .toEqual(['To do', 'Carried over', 'Sent']);
  });

  it('gives a Search button to the open and the carried-over terms only', async () => {
    await show({ aioStudyToday: READY });
    const searches = buttons().filter((b) => b.textContent === 'Search');
    expect(searches).toHaveLength(2);
    expect(rowFor('best running shoes').querySelector('button')).not.toBeNull();
    expect(rowFor('how to tie a tie').querySelector('button')).not.toBeNull();
    expect(rowFor('what is seo').querySelector('button')).toBeNull();
    expect(Array.from(container.querySelectorAll('.study-status')).filter((s) => s.textContent === 'Sent')).toHaveLength(1);
  });

  it('keeps a Google stopped me button below the list', async () => {
    await show({ aioStudyToday: READY });
    const stop = buttonLabeled('Google stopped me');
    expect(stop).not.toBeNull();
    expect(container.querySelector('.study-terms').compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('shows a keyword as text, never as markup', async () => {
    const keyword = '<img src=x onerror="window.pwned=1"> shoes';
    await show({ aioStudyToday: Object.assign({}, READY, { terms: [{ term_id: 'x', keyword, status: 'open' }] }) });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.study-keyword').textContent).toBe(keyword);
  });

  it('says so when the day has no terms', async () => {
    await show({ aioStudyToday: Object.assign({}, READY, { terms: [] }) });
    expect(container.querySelectorAll('.study-term')).toHaveLength(0);
    expect(container.textContent).toContain('No terms for today.');
  });
});

describe('a Search click', () => {
  it('asks the worker to open that term', async () => {
    const askWorker = await show({ aioStudyToday: READY, aioStudyOpen: { ok: true, tabId: 7 } });
    rowFor('how to tie a tie').querySelector('button').click();
    await vi.waitFor(() => expect(askWorker.asked).toContainEqual({ action: 'aioStudyOpen', termId: 't2' }));
    await vi.waitFor(() => expect(container.textContent).toContain('Opened in a private window.'));
  });

  it('says in the study\'s words why a term can\'t open', async () => {
    await show({ aioStudyToday: READY, aioStudyOpen: { ok: false, reason: 'error' } });
    rowFor('best running shoes').querySelector('button').click();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('error')));
    expect(buttonLabeled("Open SEO Bandwagon's Details page")).toBeNull();
  });

  it('with Incognito off: says how to turn it on, and the Details button opens this extension\'s page', async () => {
    await show({ aioStudyToday: READY, aioStudyOpen: { ok: false, reason: 'incognito_off' } });
    rowFor('best running shoes').querySelector('button').click();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('incognito_off')));
    const details = buttonLabeled("Open SEO Bandwagon's Details page");
    expect(details).not.toBeNull();
    details.click();
    expect(openUrl).toHaveBeenCalledWith('chrome://extensions/?id=' + EXTENSION_ID);
  });

  it('asks for the list again when the term was already sent, and keeps the words', async () => {
    let list = 0;
    const askWorker = await show({
      aioStudyToday: () => (list++ === 0 ? READY : Object.assign({}, READY, {
        terms: TERMS.map((t) => (t.term_id === 't1' ? Object.assign({}, t, { status: 'sent' }) : t))
      })),
      aioStudyOpen: { ok: false, reason: 'already_sent' }
    });
    rowFor('best running shoes').querySelector('button').click();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('already_sent')));
    await vi.waitFor(() => expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday')).toHaveLength(2));
    await vi.waitFor(() => expect(rowFor('best running shoes').querySelector('button')).toBeNull());
    expect(container.textContent).toContain(S.message('already_sent'));
  });

  it('with no answer from the worker, says it couldn\'t', async () => {
    await show({ aioStudyToday: READY, aioStudyOpen: undefined });
    rowFor('best running shoes').querySelector('button').click();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('error')));
  });
});

describe('a day that is not ready', () => {
  it('not enrolled: says so, and Join opens the study page on seobandwagon.com', async () => {
    await show({ aioStudyToday: { state: 'not_enrolled' } });
    expect(container.textContent).toContain(S.message('not_enrolled'));
    expect(container.querySelectorAll('.study-term')).toHaveLength(0);
    const join = buttonLabeled('Join on seobandwagon.com');
    expect(join).not.toBeNull();
    join.click();
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    const url = new URL(openUrl.mock.calls[0][0]);
    expect(url.origin).toBe('https://seobandwagon.com');
    expect(url.pathname).toBe('/dashboard/aio-study');
    expect(url.searchParams.get('utm_campaign')).toBe('popup');
  });

  it.each(['reconnect', 'no_key'])('%s: says so, and Reconnect opens the API keys page', async (state) => {
    await show({ aioStudyToday: { state } });
    expect(container.textContent).toContain(S.message(state));
    expect(buttonLabeled('Join on seobandwagon.com')).toBeNull();
    const reconnect = buttonLabeled('Reconnect');
    expect(reconnect).not.toBeNull();
    reconnect.click();
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    const url = new URL(openUrl.mock.calls[0][0]);
    expect(url.origin).toBe('https://seobandwagon.com');
    expect(url.pathname).toBe('/dashboard/api-keys');
  });

  it.each(['unavailable', 'paused', 'rate_limited'])('%s: says so, with no buttons', async (state) => {
    await show({ aioStudyToday: { state } });
    expect(container.textContent).toContain(S.message(state));
    expect(buttons()).toHaveLength(0);
  });

  it('with no answer from the worker: reads as unavailable', async () => {
    await show({ aioStudyToday: undefined });
    expect(container.textContent).toContain(S.message('unavailable'));
    expect(buttons()).toHaveLength(0);
  });

  it('the yes withdrawn while the popup is open: says so, and Open settings opens the study card', async () => {
    await show({ aioStudyToday: { state: 'not_accepted' } });
    expect(container.textContent).toContain(S.message('not_accepted'));
    const settings = buttonLabeled('Open settings');
    expect(settings).not.toBeNull();
    settings.click();
    expect(openUrl).toHaveBeenCalledWith('chrome-extension://' + EXTENSION_ID + '/src/options/options.html#aio-study');
  });
});

describe('Google stopped me', () => {
  it('asks the worker to stop, shows the stopped words, and lists the day again', async () => {
    const askWorker = await show({ aioStudyToday: READY, aioStudyStop: { state: 'stopped', carried: 2 } });
    buttonLabeled('Google stopped me').click();
    await vi.waitFor(() => expect(askWorker.asked).toContainEqual({ action: 'aioStudyStop' }));
    await vi.waitFor(() => expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday')).toHaveLength(2));
    await vi.waitFor(() => expect(container.querySelectorAll('.study-term')).toHaveLength(3));
    expect(container.textContent).toContain(S.message('stopped'));
  });

  it('shows a failure in the study\'s words, with the button that helps', async () => {
    await show({ aioStudyToday: READY, aioStudyStop: { state: 'reconnect' } });
    buttonLabeled('Google stopped me').click();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('reconnect')));
    expect(buttonLabeled('Reconnect')).not.toBeNull();
  });

  it('with no answer from the worker, says it couldn\'t', async () => {
    await show({ aioStudyToday: READY, aioStudyStop: undefined });
    buttonLabeled('Google stopped me').click();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('error')));
  });
});
