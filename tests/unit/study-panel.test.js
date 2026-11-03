// The popup's STUDY tab (src/popup/study-panel.js, 1.13.3): shown only after
// the yes to study sends; lists the day's terms from the worker, opens each in
// a private window, and says in the study's own words (SBWAioStudy.message)
// why it can't. The worker is replaced by deps.askWorker and the tab opener by
// deps.openUrl, so nothing here needs a browser.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  it('asks for the list the worker keeps, not a fresh one, and shows the week and the date (UTC)', async () => {
    const askWorker = await show({ aioStudyToday: READY });
    expect(askWorker.asked).toEqual([{ action: 'aioStudyToday' }]);
    expect(container.querySelector('.study-week').textContent).toBe('Week 3');
    expect(container.querySelector('.study-date').textContent).toBe('2026-11-03 (UTC)');
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

  it('says so when the day has no terms, and then has no Google stopped me', async () => {
    await show({ aioStudyToday: Object.assign({}, READY, { terms: [] }) });
    expect(container.querySelectorAll('.study-term')).toHaveLength(0);
    expect(container.textContent).toContain('No terms for today.');
    expect(buttonLabeled('Google stopped me')).toBeNull();
    expect(buttons()).toHaveLength(0);
  });

  it('keeps Google stopped me for a day whose terms are all sent', async () => {
    await show({ aioStudyToday: Object.assign({}, READY, { terms: [TERMS[2]] }) });
    expect(buttonLabeled('Google stopped me')).not.toBeNull();
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
    // The first drawing took the worker's kept list; only the refusal asked afresh.
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday'))
      .toEqual([{ action: 'aioStudyToday' }, { action: 'aioStudyToday', fresh: true }]);
  });

  it('asks afresh too when the term is not on the list any more', async () => {
    let list = 0;
    const askWorker = await show({
      aioStudyToday: () => (list++ === 0 ? READY : Object.assign({}, READY, { terms: [TERMS[2]] })),
      aioStudyOpen: { ok: false, reason: 'not_on_list' }
    });
    rowFor('best running shoes').querySelector('button').click();
    await vi.waitFor(() => expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday')).toHaveLength(2));
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday')[1]).toEqual({ action: 'aioStudyToday', fresh: true });
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('not_on_list')));
  });

  it('does not ask again for the list after a refusal that says nothing about it', async () => {
    const askWorker = await show({ aioStudyToday: READY, aioStudyOpen: { ok: false, reason: 'incognito_off' } });
    rowFor('best running shoes').querySelector('button').click();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('incognito_off')));
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday')).toHaveLength(1);
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

  it.each([['reconnect', 'Reconnect', 'Connect'], ['no_key', 'Connect', 'Reconnect']])('%s: says so, and %s opens the API keys page', async (state, label, other) => {
    await show({ aioStudyToday: { state } });
    expect(container.textContent).toContain(S.message(state));
    expect(buttonLabeled('Join on seobandwagon.com')).toBeNull();
    expect(buttonLabeled(other)).toBeNull();
    const reconnect = buttonLabeled(label);
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
  // The first click only asks; the second, within five seconds, records the stop.
  const stopTwice = () => {
    buttonLabeled('Google stopped me').click();
    buttonLabeled("Click again to end today's searches").click();
  };

  afterEach(() => { vi.useRealTimers(); });

  it('asks once more first: one click records nothing, and the button says what a second does', async () => {
    const askWorker = await show({ aioStudyToday: READY, aioStudyStop: { state: 'stopped', carried: 2 } });
    buttonLabeled('Google stopped me').click();
    expect(buttonLabeled('Google stopped me')).toBeNull();
    const again = buttonLabeled("Click again to end today's searches");
    expect(again).not.toBeNull();
    expect(again.disabled).toBe(false);
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyStop')).toHaveLength(0);
  });

  it('goes back to Google stopped me after five seconds, and a click after that asks again', async () => {
    vi.useFakeTimers();
    const askWorker = await show({ aioStudyToday: READY, aioStudyStop: { state: 'stopped', carried: 2 } });
    buttonLabeled('Google stopped me').click();
    await vi.advanceTimersByTimeAsync(4999);
    expect(buttonLabeled("Click again to end today's searches")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(buttonLabeled("Click again to end today's searches")).toBeNull();
    expect(buttonLabeled('Google stopped me')).not.toBeNull();
    buttonLabeled('Google stopped me').click();
    expect(buttonLabeled("Click again to end today's searches")).not.toBeNull();
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyStop')).toHaveLength(0);
  });

  it('a second click within the time asks the worker to stop, shows the stopped words, and asks for the list afresh', async () => {
    const askWorker = await show({ aioStudyToday: READY, aioStudyStop: { state: 'stopped', carried: 2 } });
    stopTwice();
    await vi.waitFor(() => expect(askWorker.asked).toContainEqual({ action: 'aioStudyStop' }));
    await vi.waitFor(() => expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday')).toHaveLength(2));
    await vi.waitFor(() => expect(container.querySelectorAll('.study-term')).toHaveLength(3));
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyStop')).toHaveLength(1);
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyToday')[1]).toEqual({ action: 'aioStudyToday', fresh: true });
    expect(container.textContent).toContain(S.message('stopped'));
  });

  it('a click on the confirming button after the time has gone asks again instead of stopping', async () => {
    vi.useFakeTimers();
    const askWorker = await show({ aioStudyToday: READY, aioStudyStop: { state: 'stopped', carried: 2 } });
    const stop = buttonLabeled('Google stopped me');
    stop.click();
    await vi.advanceTimersByTimeAsync(5000);
    stop.click();
    expect(stop.textContent).toBe("Click again to end today's searches");
    expect(askWorker.asked.filter((m) => m.action === 'aioStudyStop')).toHaveLength(0);
  });

  it('shows a failure in the study\'s words, with the button that helps', async () => {
    await show({ aioStudyToday: READY, aioStudyStop: { state: 'reconnect' } });
    stopTwice();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('reconnect')));
    expect(buttonLabeled('Reconnect')).not.toBeNull();
  });

  it('with no answer from the worker, says it couldn\'t', async () => {
    await show({ aioStudyToday: READY, aioStudyStop: undefined });
    stopTwice();
    await vi.waitFor(() => expect(container.textContent).toContain(S.message('error')));
  });
});

describe('the popup\'s STUDY pill', () => {
  // popup.js is a page script, not a module: its tab-switching block is run
  // here over the pills and panels it works on.
  const source = readFileSync(resolve(__dirname, '../../extension/src/popup/popup.js'), 'utf8');
  const start = source.indexOf('/* ---------- tab switching ---------- */');
  const end = source.indexOf('// 1.13.3: the STUDY tab (src/popup/study-panel.js)');
  const block = source.slice(start, end);

  let render;
  beforeEach(() => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    document.body.innerHTML = `
      <div class="switcher"><button class="active" data-tab="seo">SEO</button><button data-tab="citations">Citations</button><button data-tab="study">STUDY</button></div>
      <div class="tab-panel active" id="tab-seo"></div><div class="tab-panel" id="tab-citations"></div>
      <div class="tab-panel" id="tab-study"><div id="study-content"></div></div>`;
    render = vi.fn();
    globalThis.SBWStudyPanel = { render };
    new Function(block)();
  });
  afterEach(() => { globalThis.SBWStudyPanel = Panel; });

  const pill = (tab) => document.querySelector(`.switcher button[data-tab="${tab}"]`);

  it('draws the tab when it is opened, and not again on a click while it is showing', () => {
    pill('study').click();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(document.getElementById('study-content'));
    expect(document.getElementById('tab-study').classList.contains('active')).toBe(true);
    pill('study').click();
    pill('study').click();
    expect(render).toHaveBeenCalledTimes(1);
    expect(pill('study').classList.contains('active')).toBe(true);
    expect(document.getElementById('tab-study').classList.contains('active')).toBe(true);
  });

  it('draws it again when the person comes back from another tab', () => {
    pill('study').click();
    pill('seo').click();
    pill('study').click();
    expect(render).toHaveBeenCalledTimes(2);
  });
});
