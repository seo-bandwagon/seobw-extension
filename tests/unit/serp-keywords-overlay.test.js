// jsdom tests for keyword data on Google (1.13.0, src/overlay/serp-keywords.js),
// loaded after the results overlay as the manifest loads them, with the
// worker stubbed: what the strip says signed out, before the yes, with
// keyword data, at the limit, paused, refused (403), offline and for a
// tracked search; that nothing carrying the search reaches the worker
// before a click (on a click, the default) and that a click a page script
// makes (`isTrusted` false) says no yes and adds nothing; the labels beside
// related searches and People also ask; and the exports.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

await import('../../extension/src/lib/serp.js');
await import('../../extension/src/lib/serp-figures.js');
await import('../../extension/src/lib/serp-settings.js');
await import('../../extension/src/lib/serp-table.js');
await import('../../extension/src/lib/serp-keywords.js');
const K = globalThis.SBWSerpKeywords;

const answer = (name) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/keyword-metrics', name + '.json'), 'utf8'));

// The worker's answer to 'serpKeywords', as the service builds it.
function serviceAnswer(name) {
  const data = answer(name);
  const s = K.standing(data);
  return {
    state: 'ok',
    results: K.resultsByKeyword(data),
    tracked: K.trackedOf(data.tracked),
    market: K.marketAnswered(data),
    plan: s.plan,
    allowance: s.allowance,
    lookups: s.lookups,
    notice: K.lookupNotice(s)
  };
}

let sent;
let replies;
let listeners;
let stored;

function installChrome() {
  sent = [];
  listeners = [];
  stored = {};
  replies = {
    serpKeywordsReady: { hasKey: true, accepted: true },
    serpKeywords: serviceAnswer('done'),
    serpKeywordsAccept: { ok: true }
  };
  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        sent.push(msg);
        const r = replies[msg.action];
        setTimeout(() => cb && cb(typeof r === 'function' ? r(msg) : r), 5);
      },
      onMessage: { addListener: (fn) => listeners.push(fn) },
      getURL: (p) => 'chrome-extension://test/' + p
    },
    storage: {
      local: { get: vi.fn(async (k) => ({ [k]: stored[k] })), set: vi.fn(async () => {}) },
      onChanged: { addListener: () => {} }
    }
  };
}

function resultBlock(domain, index) {
  return `
    <div class="g">
      <div>
        <a href="https://${domain}/page-${index}"><h3>Result ${index}</h3></a>
        <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div>
      </div>
    </div>`;
}

// A fresh <body> each time: the scripts of an earlier test observe theirs.
function freshDom(q, domains) {
  window.history.pushState({}, '', '/search?' + q);
  const body = document.createElement('body');
  body.innerHTML = `
    <div id="rcnt"><div id="center_col">
      <div id="search"><div id="rso">${domains.map(resultBlock).join('\n')}
        <div data-q="What is the best free CRM for nonprofits?"></div>
        <div data-q="Is Salesforce free for nonprofits?"></div>
      </div></div>
      <div id="botstuff"><div data-abe="">
        <div class="b2Rnsc"><a href="/search?q=Best+crm+for+nonprofits+reddit">Best crm for nonprofits <b>reddit</b></a></div>
        <div class="b2Rnsc"><a href="/search?q=Salesforce+for+nonprofits">Salesforce for nonprofits</a></div>
      </div></div>
    </div></div>`;
  document.body.replaceWith(body);
}

async function load() {
  await import(/* @vite-ignore */ '../../extension/src/overlay/serp-overlay.js?t=' + Math.random());
  await import(/* @vite-ignore */ '../../extension/src/overlay/serp-keywords.js?t=' + Math.random());
  await vi.advanceTimersByTimeAsync(50);
}

const strip = () => document.querySelector('.sbw-serp-keywords');
// What a person's click on "Show keyword data" does. jsdom's own click() is
// untrusted, as a page script's would be, and sends nothing (tested below).
const ask = () => globalThis.SBWSerpKeywordsView.load();

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
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  return rows;
}
const keywordMessages = () => sent.filter((m) => /^serpKeyword/.test(m.action));
const buttonNamed = (name) => Array.from(strip().querySelectorAll('button')).find((b) => b.textContent === name);

beforeEach(() => {
  vi.useFakeTimers();
  installChrome();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('before anything is asked', () => {
  it('on a click (the default): the strip offers "Show keyword data", and nothing with the search reaches the worker', async () => {
    freshDom('q=best+crm+for+nonprofits&gl=us&hl=en', ['alpha.example', 'beta.example']);
    await load();
    expect(strip()).not.toBeNull();
    expect(buttonNamed('Show keyword data')).toBeTruthy();
    expect(keywordMessages()).toEqual([{ action: 'serpKeywordsReady' }]);
    // Collect keys its session storage by the search, in the worker
    // (1.8.0); nothing else carries it until the click.
    expect(JSON.stringify(sent.filter((m) => m.action !== 'serpCollect'))).not.toMatch(/best crm|nonprofits/i);
  });

  it('sits above the results, and above the panel when the panel is at the top; never before the top ads', async () => {
    stored.serpSettings = { placement: 'top' };
    freshDom('q=crm', ['alpha.example']);
    const ads = document.createElement('div');
    ads.id = 'taw';
    document.querySelector('#search').insertAdjacentElement('beforebegin', ads);
    await load();
    const search = document.querySelector('#search');
    expect(search.previousElementSibling.className).toBe('sbw-serp-tools');
    expect(search.previousElementSibling.previousElementSibling).toBe(strip());
    expect(strip().previousElementSibling).toBe(ads);
  });

  it('signed out of SEO Bandwagon: "Connect free", and nothing sent', async () => {
    replies.serpKeywordsReady = { hasKey: false, accepted: false };
    freshDom('q=crm', ['alpha.example']);
    await load();
    expect(strip().textContent).toContain('Connect free');
    buttonNamed('Connect free').click();
    expect(sent.at(-1)).toEqual({ action: 'serpOpen', page: 'connect' });
    expect(sent.some((m) => m.action === 'serpKeywords')).toBe(false);
    // Position and Analyze still there.
    expect(document.querySelector('.sbw-serp-bar .sbw-serp-pos').textContent).toBe('#1');
  });

  it('no strip for a search with an operator, or with keyword data off in settings', async () => {
    freshDom('q=site%3Aexample.com+crm', ['alpha.example']);
    await load();
    expect(strip()).toBeNull();
    installChrome();
    stored.serpSettings = { keywordsOn: false };
    freshDom('q=crm', ['alpha.example']);
    await load();
    expect(strip()).toBeNull();
    expect(document.querySelector('.sbw-serp-bar')).not.toBeNull();
  });
});

describe('the first-use disclosure', () => {
  it('a click before the yes shows the disclosure and sends nothing; a click a page script makes says no yes', async () => {
    replies.serpKeywordsReady = { hasKey: true, accepted: false };
    freshDom('q=crm', ['alpha.example']);
    await load();
    ask();
    await vi.advanceTimersByTimeAsync(20);
    // Not opened by the person's own click: the yes doesn't take the focus,
    // so a keystroke meant for Google's search box can't land on it.
    expect(document.activeElement).not.toBe(strip().querySelector('[data-role="kw-yes"]'));
    const disclosure = strip().querySelector('[data-role="kw-disclosure"]');
    expect(disclosure.textContent).toContain('Keyword data sends SEO Bandwagon the words of this search');
    expect(disclosure.textContent).toContain('Never a result’s address with them, and never a request to Google');
    // Free counts keyword data by the month, Pro by the day: no "daily".
    expect(disclosure.textContent).toContain('Each search with new keyword data counts against your plan’s allowance.');
    expect(disclosure.textContent).not.toMatch(/daily/);
    // jsdom's click() is untrusted, as a page script's would be.
    strip().querySelector('[data-role="kw-yes"]').click();
    await vi.advanceTimersByTimeAsync(20);
    expect(sent.some((m) => m.action === 'serpKeywordsAccept' || m.action === 'serpKeywords')).toBe(false);
    // "Not now" is a click on our own button that sends nothing; jsdom's
    // click reaches it.
    buttonNamed('Not now').click();
    expect(strip().textContent).toContain('Keyword data is off: it sends this search to SEO Bandwagon.');
  });

  it('a page script\'s click on "Show keyword data", "Turn on keyword data" or "Try again" sends nothing and opens nothing', async () => {
    freshDom('q=crm', ['alpha.example']);
    await load();
    buttonNamed('Show keyword data').click();
    await vi.advanceTimersByTimeAsync(20);
    expect(sent.some((m) => m.action === 'serpKeywords')).toBe(false);
    replies.serpKeywords = { state: 'error', code: 'unavailable', results: {}, tracked: null };
    ask();
    await vi.advanceTimersByTimeAsync(20);
    buttonNamed('Try again').click();
    await vi.advanceTimersByTimeAsync(20);
    expect(sent.filter((m) => m.action === 'serpKeywords')).toHaveLength(1);
  });

  it('after "Not now", a yes given elsewhere sends nothing from this page', async () => {
    replies.serpKeywordsReady = { hasKey: true, accepted: false };
    const changed = [];
    freshDom('q=crm', ['alpha.example']);
    window.chrome.storage.onChanged = { addListener: (fn) => changed.push(fn) };
    await load();
    ask();
    await vi.advanceTimersByTimeAsync(20);
    buttonNamed('Not now').click();
    replies.serpKeywordsReady = { hasKey: true, accepted: true };
    changed.forEach((fn) => fn({ sbwConsent: { newValue: { keywordData: { acceptedAt: 'x', version: 1 } } } }, 'local'));
    await vi.advanceTimersByTimeAsync(50);
    expect(sent.some((m) => m.action === 'serpKeywords')).toBe(false);
    expect(strip().textContent).toContain('Keyword data is off');
  });
});

describe('with keyword data', () => {
  async function shown(q = 'q=best+crm+for+nonprofits&gl=us&hl=en') {
    freshDom(q, ['alpha.example', 'example.org']);
    await load();
    ask();
    await vi.advanceTimersByTimeAsync(30);
  }

  it('one message with the search, its related searches and questions as shown, and the market', async () => {
    await shown();
    const msg = sent.find((m) => m.action === 'serpKeywords');
    expect(msg).toEqual({
      action: 'serpKeywords',
      query: 'best crm for nonprofits',
      related: ['Best crm for nonprofits reddit', 'Salesforce for nonprofits'],
      paa: ['What is the best free CRM for nonprofits?', 'Is Salesforce free for nonprofits?'],
      gl: 'us',
      hl: 'en'
    });
  });

  it('shows the search\'s figures, labeled as DataForSEO\'s, and the allowance', async () => {
    await shown();
    const search = strip().querySelector('[data-role="kw-search"]');
    expect(search.querySelector('[data-kw="volume"]').textContent).toBe('2.9K searches/mo');
    expect(search.querySelector('[data-kw="difficulty"]').textContent).toBe('difficulty 47/100');
    expect(search.querySelector('[data-kw="cpc"]').textContent).toBe('CPC $18.42');
    expect(search.querySelector('[data-kw="competition"]').textContent).toBe('competition High (0.82)');
    expect(search.querySelector('[data-kw="trend"]').textContent).toContain('▲ 30% over 12 months');
    expect(search.querySelector('[data-kw="trend"] svg path').getAttribute('d')).toMatch(/^M0\.0,/);
    expect(strip().querySelector('.sbw-fig-source').textContent).toBe('DataForSEO');
    expect(strip().querySelector('[data-role="kw-allowance"]').textContent).toContain('Free plan: 6 of 10 searches with new keyword data left today (UTC).');
  });

  it('puts each related search\'s and question\'s volume beside it on Google\'s page, and lists them with Add', async () => {
    await shown();
    const badges = Array.from(document.querySelectorAll('.sbw-kw-badge')).map((b) => b.textContent);
    expect(badges.slice().sort()).toEqual(['170/mo', '590/mo', '8.1K/mo', '90/mo']);
    expect(document.querySelector('.b2Rnsc .sbw-kw-badge').textContent).toBe('170/mo');
    expect(document.querySelector('[data-q="Is Salesforce free for nonprofits?"] .sbw-kw-badge').textContent).toBe('590/mo');
    // The parser still reads Google's own words, not our label.
    expect(globalThis.SBWSerp.parseRelatedSearches(document)).toEqual(['Best crm for nonprofits reddit', 'Salesforce for nonprofits']);
    const rows = Array.from(strip().querySelectorAll('[data-role="kw-more"] tbody tr'));
    expect(rows.map((r) => r.getAttribute('data-keyword'))).toEqual(['best crm for nonprofits reddit', 'salesforce for nonprofits', 'what is the best free crm for nonprofits?', 'is salesforce free for nonprofits?']);
    expect(rows[1].textContent).toContain('8.1K');
    expect(rows[1].querySelector('button').textContent).toBe('+ Add');
  });

  it('"Add to my keywords" from a page script\'s click adds nothing', async () => {
    await shown();
    buttonNamed('Add to my keywords').click();
    await vi.advanceTimersByTimeAsync(20);
    expect(sent.some((m) => m.action === 'serpKeywordAdd')).toBe(false);
  });

  it('"Add to my keywords" from a click on a button that outlived the strip (keyword data turned off) adds nothing, even for the person\'s own click', async () => {
    const changed = [];
    const clicks = new Map();
    const realAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, options) {
      if (type === 'click') clicks.set(this, (clicks.get(this) || []).concat(fn));
      return realAdd.call(this, type, fn, options);
    };
    try {
      freshDom('q=best+crm+for+nonprofits&gl=us&hl=en', ['alpha.example', 'example.org']);
      window.chrome.storage.onChanged = { addListener: (fn) => changed.push(fn) };
      await load();
      ask();
      await vi.advanceTimersByTimeAsync(30);
      const add = buttonNamed('Add to my keywords');
      expect(clicks.get(add)).toHaveLength(1);
      changed.forEach((fn) => fn({ serpSettings: { newValue: { keywordsOn: false } } }, 'local'));
      expect(strip()).toBeNull();
      // jsdom's click() is untrusted; a person's click is this event.
      clicks.get(add)[0]({ isTrusted: true, type: 'click', target: add });
      await vi.advanceTimersByTimeAsync(30);
      expect(sent.some((m) => m.action === 'serpKeywordAdd')).toBe(false);
      expect(strip()).toBeNull();
    } finally {
      EventTarget.prototype.addEventListener = realAdd;
    }
  });

  it('the exports carry the keyword data: the results CSV\'s columns, and a keywords CSV', async () => {
    await shown();
    let csv;
    listeners.forEach((fn) => fn({ action: 'serpExport', kind: 'csv' }, {}, (r) => { if (r) csv = r; }));
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    const rows = parseCsv(csv.text);
    const head = rows[0];
    expect(lines[0]).toContain('Search volume a month (DataForSEO)');
    expect(rows[1][head.indexOf('Search volume a month (DataForSEO)')]).toBe('2900');
    expect(rows[1][head.indexOf('People also ask with volume (DataForSEO)')]).toBe('What is the best free CRM for nonprofits? (90) | Is Salesforce free for nonprofits? (590)');
    let kw;
    listeners.forEach((fn) => fn({ action: 'serpExport', kind: 'keywords' }, {}, (r) => { if (r) kw = r; }));
    expect(kw.filename).toMatch(/^serp-keywords-best-crm-for-nonprofits-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(kw.text).toContain('is salesforce free for nonprofits?,Is Salesforce free for nonprofits?,People also ask,590');
  });

  it('the popup reads the state, the plan and the allowance', async () => {
    await shown();
    let status;
    listeners.forEach((fn) => fn({ action: 'serpStatus' }, {}, (r) => { if (r) status = r; }));
    expect(status.keywords).toMatchObject({ on: true, state: 'ok', hasKey: true, accepted: true, plan: 'free', allowance: { limit: 10, remaining: 6 }, search: { volume: 2900 } });
  });
});

describe('limits and refusals: keyword data says so, and nothing else stops', () => {
  async function shownWith(reply) {
    replies.serpKeywords = reply;
    freshDom('q=best+crm+for+nonprofits', ['alpha.example']);
    await load();
    ask();
    await vi.advanceTimersByTimeAsync(30);
  }

  it('the allowance reached: the search\'s cached figures, the notice and the upgrade', async () => {
    await shownWith(serviceAnswer('limit-reached'));
    expect(strip().querySelector('[data-kw="volume"]').textContent).toBe('2.9K searches/mo');
    expect(strip().querySelector('[data-role="kw-allowance"]').textContent).toContain('searches with new keyword data are used');
    buttonNamed('Upgrade for more keyword data').click();
    expect(sent.at(-1)).toEqual({ action: 'serpOpen', page: 'upgrade' });
    expect(document.querySelector('.sbw-serp-bar .sbw-serp-analyze')).not.toBeNull();
  });

  it('paused at the monthly ceiling: says so, no upgrade', async () => {
    await shownWith(serviceAnswer('paused'));
    expect(strip().textContent).toContain('New keyword data is paused for everyone until next month');
    expect(buttonNamed('Upgrade for more keyword data')).toBeUndefined();
  });

  it('a key without the keywords scope (403): Reconnect', async () => {
    await shownWith({ state: 'error', code: 'forbidden', results: {}, tracked: null });
    expect(strip().textContent).toContain('Reconnect to see keyword data');
    buttonNamed('Reconnect').click();
    expect(sent.at(-1)).toEqual({ action: 'serpOpen', page: 'connect' });
  });

  it('offline: says so, offers Try again, and asks again on its own after 30 s, the same request', async () => {
    await shownWith({ state: 'error', code: 'network', results: {}, tracked: null });
    expect(strip().textContent).toContain('Offline: no keyword data until SEO Bandwagon can be reached');
    expect(buttonNamed('Try again')).toBeTruthy();
    // A question People also ask opens meanwhile is not in the retry.
    const q = document.createElement('div');
    q.setAttribute('data-q', 'Is HubSpot free for nonprofits?');
    document.querySelector('#rso').appendChild(q);
    replies.serpKeywords = serviceAnswer('done');
    await vi.advanceTimersByTimeAsync(30_100);
    const asks = sent.filter((m) => m.action === 'serpKeywords');
    expect(asks).toHaveLength(2);
    expect(asks[1].paa).toEqual(asks[0].paa);
    expect(strip().querySelector('[data-kw="volume"]').textContent).toBe('2.9K searches/mo');
  });

  it('a server error (500) is never asked again on its own: it may have counted already', async () => {
    await shownWith({ state: 'error', code: 'error', results: {}, tracked: null });
    expect(strip().textContent).toContain('Keyword data didn’t load');
    await vi.advanceTimersByTimeAsync(200_000);
    expect(sent.filter((m) => m.action === 'serpKeywords')).toHaveLength(1);
  });

  it('a retry pending when the person asks again is dropped, not sent as well', async () => {
    await shownWith({ state: 'error', code: 'unavailable', results: {}, tracked: null });
    replies.serpKeywords = serviceAnswer('limit-reached');
    ask();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(sent.filter((m) => m.action === 'serpKeywords')).toHaveLength(2);
  });

  it('a country DataForSEO has no keyword data for says so', async () => {
    await shownWith(Object.assign(serviceAnswer('unsupported-market'), { results: {} }));
    expect(strip().textContent).toContain('No keyword data for this Google’s country yet.');
    expect(strip().querySelector('[data-role="kw-allowance"]').textContent).toContain('DataForSEO has no keyword data for this Google’s country yet');
  });
});

describe('the tracked search', () => {
  it('the strip and the tracked site\'s bar show its rank history', async () => {
    replies.serpKeywords = serviceAnswer('tracked');
    freshDom('q=best+crm+for+nonprofits', ['alpha.example', 'blog.example.org']);
    await load();
    ask();
    await vi.advanceTimersByTimeAsync(30);
    expect(strip().querySelector('[data-role="kw-tracked"]').textContent).toContain('example.org: #4, ▲ 5 since 2026-10-05');
    const bars = document.querySelectorAll('.sbw-serp-bar');
    expect(bars[0].querySelector('.sbw-kw-tracked')).toBeNull();
    const t = bars[1].querySelector('.sbw-kw-tracked');
    expect(t.textContent).toContain('your tracker #4, ▲ 5 since 2026-10-05');
    expect(t.title).toMatch(/From your own SEO Bandwagon account, not DataForSEO/);
    let csv;
    listeners.forEach((fn) => fn({ action: 'serpExport', kind: 'csv' }, {}, (r) => { if (r) csv = r; }));
    const rows = parseCsv(csv.text);
    const at = rows[0].indexOf('Your rank tracker position');
    expect(rows[2][at]).toBe('4');
    expect(rows[1][at]).toBe('');
  });
});

describe('with the page, by setting', () => {
  it('loads without a click once the person said yes', async () => {
    stored.serpSettings = { keywordsLoad: 'auto' };
    freshDom('q=best+crm+for+nonprofits', ['alpha.example']);
    await load();
    await vi.advanceTimersByTimeAsync(30);
    expect(sent.filter((m) => m.action === 'serpKeywords')).toHaveLength(1);
    expect(strip().querySelector('[data-kw="volume"]').textContent).toBe('2.9K searches/mo');
  });

  it('before the yes, loads nothing and offers the button', async () => {
    stored.serpSettings = { keywordsLoad: 'auto' };
    replies.serpKeywordsReady = { hasKey: true, accepted: false };
    freshDom('q=best+crm+for+nonprofits', ['alpha.example']);
    await load();
    await vi.advanceTimersByTimeAsync(30);
    expect(sent.some((m) => m.action === 'serpKeywords')).toBe(false);
    expect(buttonNamed('Show keyword data')).toBeTruthy();
  });
});
