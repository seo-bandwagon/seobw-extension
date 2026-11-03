// jsdom tests for study mode on the Google results page (1.13.3, the AI
// Overview inclusion study): src/overlay/serp-overlay.js asks the worker once
// at load whether the study opened this tab ('aioStudyTab'); in a study tab
// the panel gets "Send to study" and "Google stopped me", and nothing asks
// for figures or keyword data. The page is the saved signed-out Google
// results page for `how does seo work`; the worker is stubbed.
//
// jsdom's own click() is untrusted (`isTrusted` false), as a page script's
// would be. A person's click is stood in for by calling the click listeners
// the overlay registered with a trusted event (userClick, below); the
// offline E2E (tests/e2e/serp-study.spec.mjs) clicks for real.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

await import('../../extension/src/lib/serp.js');
await import('../../extension/src/lib/serp-figures.js');
await import('../../extension/src/lib/serp-settings.js');
await import('../../extension/src/lib/serp-table.js');
await import('../../extension/src/lib/aio-study.js');
await import('../../extension/src/lib/serp-keywords.js');
const study = globalThis.SBWAioStudy;

const FIXTURE = readFileSync(resolve(__dirname, '../fixtures/serp-google-aio-signed-out.html'), 'utf8');
// The saved page is slow in jsdom, and the machine may be loaded.
const SLOW = 120000;

const STUDY = Object.freeze({
  study: true,
  termId: 'soft-howwhy-01',
  keyword: 'how does seo work',
  accepted: true,
  status: 'open',
  page: { ok: true }
});

let sent;
let replies;
let listeners;
let clickListeners;
let realAddEventListener;

function installChrome() {
  sent = [];
  listeners = [];
  replies = {};
  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        sent.push(msg);
        const r = replies[msg.action];
        setTimeout(() => cb && cb(typeof r === 'function' ? r(msg) : r), 10);
      },
      onMessage: { addListener: (fn) => listeners.push(fn) },
      getURL: (p) => 'chrome-extension://test/' + p
    },
    storage: {
      session: {
        get: vi.fn(() => { throw new Error('Access to storage is not allowed from this context.'); }),
        set: vi.fn(() => { throw new Error('Access to storage is not allowed from this context.'); })
      }
    }
  };
}

function useSettings(settings) {
  window.chrome.storage.local = { get: vi.fn(async () => ({ serpSettings: settings })), set: vi.fn(async () => {}) };
}

async function load(html, opts) {
  const o = opts || {};
  window.history.pushState({}, '', '/search?q=how+does+seo+work&hl=en&gl=us&pws=0');
  const body = document.createElement('body');
  body.innerHTML = html;
  document.body.replaceWith(body);
  await import(/* @vite-ignore */ '../../extension/src/overlay/serp-overlay.js?t=' + Math.random());
  if (o.keywords) await import(/* @vite-ignore */ '../../extension/src/overlay/serp-keywords.js?t=' + Math.random());
  await vi.advanceTimersByTimeAsync(o.wait === undefined ? 200 : o.wait);
}

// A small results page: ten-ish results, no AI Overview, unless one is given.
function results(extra) {
  const block = (domain, i) => `<div class="g"><div><a href="https://${domain}/page-${i}"><h3>Result ${i}</h3></a>
    <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div></div></div>`;
  return `<div id="rcnt"><div id="center_col">${extra || ''}<div id="search"><div id="rso">${block('alpha.example', 0)}${block('beta.example', 1)}</div></div></div></div>`;
}

const emptyBox = '<div data-subtree="aimc"></div>';

const sentActions = (action) => sent.filter((m) => m.action === action);
const panel = () => document.querySelector('.sbw-serp-tools');
const groupNames = () => Array.from(document.querySelectorAll('.sbw-serp-tools .sbw-group')).map((g) => g.getAttribute('data-group'));
const role = (name) => document.querySelector(`[data-role="${name}"]`);
const studyText = (name) => role(name).textContent;

// What a person's click does: the overlay's click listeners called with a
// trusted event. A disabled button takes no click.
function userClick(button) {
  expect(button).toBeTruthy();
  if (button.disabled) return;
  const fns = clickListeners.get(button) || [];
  expect(fns.length).toBeGreaterThan(0);
  fns.forEach((fn) => fn({ isTrusted: true, type: 'click', button: 0, target: button, preventDefault() {}, stopPropagation() {} }));
}

// A CSV as rows of cells, quotes and all.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r') { /* with the \n */ } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

beforeEach(() => {
  vi.useFakeTimers();
  installChrome();
  clickListeners = new Map();
  realAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    if (type === 'click') {
      const list = clickListeners.get(this) || [];
      list.push(fn);
      clickListeners.set(this, list);
    }
    return realAddEventListener.call(this, type, fn, options);
  };
  delete globalThis.SBWSerpStudy;
});

afterEach(() => {
  EventTarget.prototype.addEventListener = realAddEventListener;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('an ordinary tab', () => {
  it('draws its bars at once and asks for figures only after the worker says it is not a study tab', async () => {
    await load(results(), { wait: 0 });
    expect(sentActions('aioStudyTab')).toEqual([{ action: 'aioStudyTab' }]);
    expect(document.querySelectorAll('.sbw-serp-bar')).toHaveLength(2);
    expect(sentActions('serpFigures')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(sentActions('serpFigures')).toHaveLength(1);
    expect(groupNames()).not.toContain('study');
    expect(globalThis.SBWSerpStudy.ready).toBeInstanceOf(Promise);
    await expect(globalThis.SBWSerpStudy.ready).resolves.toEqual({ study: false });
  });

  it.each([
    ['says so', { study: false }],
    ['says nothing of the kind', { termId: 'soft-howwhy-01' }],
    ['does not answer', undefined]
  ])('reads a worker that %s as an ordinary tab', async (_name, reply) => {
    replies.aioStudyTab = reply;
    await load(results());
    expect(sentActions('serpFigures')).toHaveLength(1);
    expect(groupNames()).not.toContain('study');
    await expect(globalThis.SBWSerpStudy.ready).resolves.toEqual({ study: false });
  });

  it('keeps a panel left folded, folded', async () => {
    useSettings({ collapsed: true });
    await load(results());
    expect(panel().getAttribute('data-collapsed')).toBe('true');
  });

  it('keeps the popup\'s Load figures until the worker has answered, then loads them', async () => {
    useSettings({ load: 'click' });
    await load(results(), { wait: 1 });
    listeners.forEach((fn) => fn({ action: 'serpLoadFigures' }, {}, () => {}));
    expect(sentActions('serpFigures')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(sentActions('serpFigures')).toHaveLength(1);
  });

  it('asks for keyword data\'s state only after the worker has answered', async () => {
    replies.serpKeywordsReady = { hasKey: true, accepted: true };
    await load(results(), { keywords: true, wait: 1 });
    expect(sentActions('serpKeywordsReady')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(sentActions('serpKeywordsReady')).toHaveLength(1);
    expect(document.querySelector('.sbw-serp-keywords')).not.toBeNull();
  });

  it('shows the figures line "Figures are off in a study search." if only the worker knows it is one', async () => {
    replies.serpFigures = { state: 'study_tab' };
    await load(results());
    expect(role('figures-line').textContent).toBe('Figures are off in a study search.');
    expect(document.querySelectorAll('.sbw-serp-bar [data-role="figures"]')).toHaveLength(2);
    document.querySelectorAll('.sbw-serp-bar [data-role="figures"]').forEach((f) => expect(f.textContent).toBe(''));
    expect(groupNames()).not.toContain('study');
  });
});

describe('a study tab', () => {
  beforeEach(() => { replies.aioStudyTab = STUDY; });

  it('is a study tab even when the answer is malformed: nothing asked, nothing to send', async () => {
    replies.aioStudyTab = { study: true };
    await load(results());
    expect(sentActions('serpFigures')).toHaveLength(0);
    expect(role('study-send').disabled).toBe(true);
    expect(studyText('study-status')).toBe(study.message('not_study_tab'));
  });

  it('opens the panel, even if it was left folded in another tab', async () => {
    useSettings({ collapsed: true });
    await load(results());
    expect(panel().getAttribute('data-collapsed')).toBe('false');
    expect(role('body').hidden).toBe(false);
    userClick(document.querySelector('[data-role="toggle"]'));
    expect(panel().getAttribute('data-collapsed')).toBe('true');
  });

  it('asks for no figures and no keyword data, and its bars stay', async () => {
    useSettings({ keywordsLoad: 'auto' });
    replies.serpKeywordsReady = { hasKey: true, accepted: true };
    await load(FIXTURE, { keywords: true, wait: 200 });
    expect(document.querySelectorAll('.sbw-serp-bar').length).toBeGreaterThan(5);
    expect(sentActions('aioStudyTab')).toHaveLength(1);
    ['serpFigures', 'serpKeywords', 'serpKeywordsReady', 'serpKeywordAdd'].forEach((a) => expect(sentActions(a)).toHaveLength(0));
    expect(document.querySelector('.sbw-serp-keywords')).toBeNull();
    expect(document.querySelector('.sbw-kw-badge')).toBeNull();
    await expect(globalThis.SBWSerpStudy.ready).resolves.toEqual(STUDY);
    // The popup's Load figures and Load keywords, and a click on the strip's own entry, ask for nothing either.
    listeners.forEach((fn) => fn({ action: 'serpLoadFigures' }, {}, () => {}));
    listeners.forEach((fn) => fn({ action: 'serpLoadKeywords' }, {}, () => {}));
    globalThis.SBWSerpKeywordsView.load();
    await vi.advanceTimersByTimeAsync(100);
    ['serpFigures', 'serpKeywords', 'serpKeywordsReady', 'serpKeywordAdd'].forEach((a) => expect(sentActions(a)).toHaveLength(0));
    expect(document.querySelector('.sbw-serp-keywords')).toBeNull();
  }, SLOW);

  it('says figures are off, on the line and on the bars, and the sources button asks for none', async () => {
    await load(FIXTURE);
    expect(role('figures-line').textContent).toBe('Figures are off in a study search.');
    document.querySelectorAll('.sbw-serp-bar [data-role="figures"]').forEach((f) => expect(f.textContent).toBe(''));
    const sources = Array.from(document.querySelectorAll('[data-group="sources"] button')).find((b) => b.textContent === 'Load figures for sources');
    userClick(sources);
    await vi.advanceTimersByTimeAsync(100);
    expect(sentActions('serpFigures')).toHaveLength(0);
  }, SLOW);

  it('adds the AI Overview study group first in the panel, with the term, the AI Overview and the two buttons', async () => {
    await load(FIXTURE);
    expect(groupNames()[0]).toBe('study');
    const g = document.querySelector('[data-group="study"]');
    expect(g.querySelector('.sbw-group-title').textContent).toBe('AI Overview study');
    expect(studyText('study-term')).toBe('Term: how does seo work');
    expect(studyText('study-ai')).toBe('AI Overview: loaded');
    const sendBtn = role('study-send');
    expect(sendBtn.tagName).toBe('BUTTON');
    expect(sendBtn.textContent).toBe('Send to study');
    expect(sendBtn.disabled).toBe(false);
    expect(role('study-stop').textContent).toBe('Google stopped me');
    expect(role('study-stop').disabled).toBe(false);
    expect(role('study-status').getAttribute('role')).toBe('status');
    expect(studyText('study-status')).toBe('');
  }, SLOW);

  it('sends nothing on a click a page script made, to send or to stop', async () => {
    await load(FIXTURE);
    role('study-send').click();
    role('study-stop').click();
    await vi.advanceTimersByTimeAsync(100);
    expect(sentActions('aioStudySend')).toHaveLength(0);
    expect(sentActions('aioStudyStop')).toHaveLength(0);
    expect(studyText('study-status')).toBe('');
    expect(role('study-send').disabled).toBe(false);
  }, SLOW);

  it.each([
    ['sent today', { status: 'sent' }, 'Already sent today.'],
    ['a late term', { status: 'late' }, ''],
    ['not on the list', { status: null }, "This term isn't on your list for today."],
    ['study sends not turned on', { accepted: false }, "Turn on study sends in the extension's settings first."],
    ['another search in the tab', { page: { ok: false, reason: 'other_search' } }, "This tab no longer shows the study's search. Open the term again from the study panel."],
    ['page two', { page: { ok: false, reason: 'not_page_one' } }, "This tab no longer shows the study's search. Open the term again from the study panel."],
    ['a page with no reason', { page: { ok: false } }, "Couldn't send. Try again."]
  ])('%s: the send button is %s', async (name, change, words) => {
    replies.aioStudyTab = Object.assign({}, STUDY, change);
    await load(results());
    expect(role('study-send').disabled).toBe(words !== '');
    expect(studyText('study-status')).toBe(words);
    if (words) {
      userClick(role('study-send'));
      expect(sentActions('aioStudySend')).toHaveLength(0);
    }
  });

  it('says the AI Overview has not loaded yet when its box is empty, and still lets the page be sent', async () => {
    await load(results(emptyBox));
    expect(studyText('study-ai')).toBe("AI Overview: hasn't loaded yet. Wait for it, or send the page as it is.");
    expect(role('study-send').disabled).toBe(false);
    userClick(role('study-send'));
    expect(sentActions('aioStudySend')).toHaveLength(1);
    expect(parseCsv(sentActions('aioStudySend')[0].csv)[1][parseCsv(sentActions('aioStudySend')[0].csv)[0].indexOf('AI Overview state')]).toBe('empty');
  });

  it('says there is no AI Overview on a page without one, and lets it be sent', async () => {
    await load(results());
    expect(studyText('study-ai')).toBe('AI Overview: none on this page');
    expect(role('study-send').disabled).toBe(false);
  });

  it('follows the AI Overview as it loads after the results', async () => {
    await load(results(emptyBox));
    expect(studyText('study-ai')).toMatch(/^AI Overview: hasn't loaded yet/);
    document.querySelector('[data-subtree="aimc"]').innerHTML = '<div>SEO is the practice of improving a website so it shows up in search results.</div>';
    await vi.advanceTimersByTimeAsync(700);
    expect(studyText('study-ai')).toBe('AI Overview: loaded');
  });

  it('keeps Send to study off when no result was read, and says so', async () => {
    await load('<div id="search"><div id="rso"><h3>A heading with no result around it</h3></div></div>');
    expect(role('study-send')).not.toBeNull();
    expect(role('study-send').disabled).toBe(true);
    expect(studyText('study-status')).toBe(study.message('empty'));
  });

  describe('Send to study', () => {
    it('posts this page\'s export alone, with no figures, no keyword data and no marks, and says it was sent', async () => {
      useSettings({ ownSites: ['alpha.example'] });
      replies.aioStudySend = { state: 'sent' };
      await load(FIXTURE);
      const bars = document.querySelectorAll('.sbw-serp-bar').length;
      userClick(role('study-send'));
      expect(role('study-send').disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(50);
      const posts = sentActions('aioStudySend');
      expect(posts).toHaveLength(1);
      expect(Object.keys(posts[0]).sort()).toEqual(['action', 'csv', 'termId']);
      expect(posts[0].termId).toBe('soft-howwhy-01');

      const [header, ...rows] = parseCsv(posts[0].csv);
      const at = (row, name) => row[header.indexOf(name)];
      expect(rows.filter((r) => r.length === header.length)).toHaveLength(rows.length);
      expect(rows).toHaveLength(bars);
      rows.forEach((row) => {
        expect(at(row, 'Query')).toBe('how does seo work');
        expect(at(row, 'Your site')).toBe('');
        expect(at(row, 'AI Overview state')).toBe('loaded');
        header.forEach((name, i) => {
          if (/\((DataForSEO|RDAP)\)$/.test(name) || name === 'Your rank tracker position' || name === 'Your on-page checklist' || name === 'Checklist captured') {
            expect(row[i], name).toBe('');
          }
        });
      });
      expect(at(rows[0], 'Search features')).toContain('AI Overview');
      expect(at(rows[0], 'AI Overview citations')).toContain('https://digitalmarketinginstitute.com/blog/what-is-seo');
      expect(at(rows[0], 'AI Overview citations read from').startsWith('link | record')).toBe(true);

      expect(studyText('study-status')).toBe('Sent to the study.');
      expect(role('study-send').textContent).toBe('Sent');
      expect(role('study-send').disabled).toBe(true);
      userClick(role('study-send'));
      await vi.advanceTimersByTimeAsync(50);
      expect(sentActions('aioStudySend')).toHaveLength(1);
      ['serpFigures', 'serpKeywords'].forEach((a) => expect(sentActions(a)).toHaveLength(0));
    }, SLOW);

    it('reads "already sent" from the study as a send that is done', async () => {
      replies.aioStudySend = { state: 'already_sent' };
      await load(results());
      userClick(role('study-send'));
      await vi.advanceTimersByTimeAsync(50);
      expect(studyText('study-status')).toBe('Already sent today.');
      expect(role('study-send').textContent).toBe('Sent');
      expect(role('study-send').disabled).toBe(true);
    });

    it.each([
      ['a rate limit', { state: 'rate_limited', retryAfter: 30 }, 'rate_limited'],
      ['a search that moved on', { state: 'other_search' }, 'other_search'],
      ['a page too large', { state: 'too_large' }, 'too_large'],
      ['no reply', undefined, 'error']
    ])('after %s, says why and lets the person try again', async (_name, reply, code) => {
      replies.aioStudySend = reply;
      await load(results());
      userClick(role('study-send'));
      await vi.advanceTimersByTimeAsync(50);
      expect(studyText('study-status')).toBe(study.message(code));
      expect(role('study-send').textContent).toBe('Send to study');
      expect(role('study-send').disabled).toBe(false);
      replies.aioStudySend = { state: 'sent' };
      userClick(role('study-send'));
      await vi.advanceTimersByTimeAsync(50);
      expect(sentActions('aioStudySend')).toHaveLength(2);
      expect(studyText('study-status')).toBe('Sent to the study.');
    });

    it('does not post twice while the first send is on its way', async () => {
      replies.aioStudySend = { state: 'sent' };
      await load(results());
      userClick(role('study-send'));
      userClick(role('study-send'));
      userClick(role('study-stop'));
      await vi.advanceTimersByTimeAsync(50);
      expect(sentActions('aioStudySend')).toHaveLength(1);
      expect(sentActions('aioStudyStop')).toHaveLength(0);
    });

    it('keeps its state when the panel is turned off and on again in Settings', async () => {
      replies.aioStudySend = { state: 'sent' };
      let changed;
      window.chrome.storage.onChanged = { addListener: (fn) => { changed = fn; } };
      await load(results());
      userClick(role('study-send'));
      await vi.advanceTimersByTimeAsync(50);
      expect(role('study-send').textContent).toBe('Sent');
      changed({ serpSettings: { newValue: { overlay: false } } }, 'local');
      expect(panel()).toBeNull();
      changed({ serpSettings: { newValue: { overlay: true } } }, 'local');
      await vi.advanceTimersByTimeAsync(100);
      expect(groupNames()[0]).toBe('study');
      expect(role('study-send').textContent).toBe('Sent');
      expect(role('study-send').disabled).toBe(true);
      expect(studyText('study-status')).toBe('Sent to the study.');
      expect(sentActions('serpFigures')).toHaveLength(0);
    });
  });

  describe('Google stopped me', () => {
    it('records it once and says what happens to the day\'s other terms', async () => {
      replies.aioStudyStop = { state: 'stopped', carried: 2 };
      await load(results());
      userClick(role('study-stop'));
      expect(role('study-stop').disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(50);
      expect(sentActions('aioStudyStop')).toEqual([{ action: 'aioStudyStop' }]);
      expect(studyText('study-status')).toBe(study.message('stopped'));
      expect(role('study-stop').disabled).toBe(true);
      userClick(role('study-stop'));
      await vi.advanceTimersByTimeAsync(50);
      expect(sentActions('aioStudyStop')).toHaveLength(1);
      expect(sentActions('aioStudySend')).toHaveLength(0);
    });

    it('says why, and can be tried again, when the study could not record it', async () => {
      replies.aioStudyStop = { state: 'rate_limited' };
      await load(results());
      userClick(role('study-stop'));
      await vi.advanceTimersByTimeAsync(50);
      expect(studyText('study-status')).toBe(study.message('rate_limited'));
      expect(role('study-stop').disabled).toBe(false);
    });
  });
});
