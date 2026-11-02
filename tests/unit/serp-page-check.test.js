// Analyze on Google's fetch (1.12.0, src/lib/serp-page-check.js), with the
// network and the analyzer stubbed: access asked once from the extension's
// window, three pages at a time, robots.txt and llms.txt once a site,
// a page kept for the session, no Google page ever fetched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createSerpPageCheck } = require('../../extension/src/lib/serp-page-check.js');
const robots = require('../../extension/src/lib/robots-ai.js');

function sessionStorage() {
  const data = {};
  return {
    data,
    get: vi.fn(async (keys) => {
      if (keys === null) return Object.assign({}, data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    }),
    set: vi.fn(async (o) => Object.assign(data, o)),
    remove: vi.fn(async (keys) => { [].concat(keys).forEach((k) => delete data[k]); })
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let storage, fetched, notes, access, opened, svc, inFlight, maxInFlight, release;

beforeEach(() => {
  storage = sessionStorage();
  fetched = [];
  notes = [];
  access = true;
  opened = 0;
  inFlight = 0;
  maxInFlight = 0;
  release = [];
  const fetchText = vi.fn(async (url) => {
    fetched.push(url);
    if (url.endsWith('/robots.txt')) return { status: 200, finalUrl: url, headers: { 'content-type': 'text/plain' }, text: 'User-agent: GPTBot\nDisallow: /\n' };
    if (url.endsWith('/llms.txt')) return { status: 404, finalUrl: url, headers: { 'content-type': 'text/html' }, text: '<html>' };
    if (url.includes('/file.pdf')) return { status: 200, finalUrl: url, headers: { 'content-type': 'application/pdf' }, text: '' };
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => release.push(r));
    inFlight -= 1;
    return { status: 200, finalUrl: url, redirected: false, headers: { 'content-type': 'text/html; charset=utf-8' }, text: '<title>T</title>' };
  });
  svc = createSerpPageCheck({
    fetchText,
    analyze: async (html, fetchInfo, site) => ({ url: fetchInfo.url, status: fetchInfo.status, robots: site.robots, llms: site.llms }),
    robots,
    hasAccess: async () => access,
    openAccessPage: async () => { opened += 1; },
    storage,
    notify: (req, msg) => notes.push([req.key, msg.state, msg]),
    now: () => Date.UTC(2026, 10, 2, 10, 0)
  });
});

async function drain() {
  for (let i = 0; i < 20; i++) {
    await flush();
    release.splice(0).forEach((r) => r());
  }
  await flush();
}

const req = (n, host = 'site' + n + '.example') => ({ key: 'k' + n, url: `https://${host}/p${n}` });

describe('Analyze on Google: the fetch', () => {
  it('without all-sites access: asks once from the extension\'s window and fetches nothing', async () => {
    access = false;
    expect(await svc.check([req(1), req(2)])).toEqual({ state: 'needs_access' });
    expect(opened).toBe(1);
    expect(fetched).toEqual([]);
    access = true;
    await svc.accessAnswered(true);
    await drain();
    expect(notes.filter((n) => n[1] === 'done').map((n) => n[0]).sort()).toEqual(['k1', 'k2']);
  });

  it('declined: each waiting row hears so', async () => {
    access = false;
    await svc.check([req(1)]);
    await svc.accessAnswered(false);
    expect(notes).toEqual([['k1', 'declined', { state: 'declined' }]]);
  });

  it('three pages at a time', async () => {
    await svc.check([1, 2, 3, 4, 5, 6, 7].map((n) => req(n)));
    await drain();
    expect(maxInFlight).toBe(3);
    expect(notes.filter((n) => n[1] === 'done')).toHaveLength(7);
  });

  it('reads robots.txt and llms.txt once a site, and passes what they say', async () => {
    await svc.check([req(1, 'same.example'), req(2, 'same.example')]);
    await drain();
    expect(fetched.filter((u) => u.endsWith('/robots.txt'))).toEqual(['https://same.example/robots.txt']);
    const done = notes.find((n) => n[1] === 'done')[2];
    expect(done.row.robots.blocked).toEqual(['GPTBot']);
    expect(done.row.llms.found).toBe(false); // a 404 page, not an llms.txt
  });

  it('a page this session already read is answered without a fetch', async () => {
    await svc.check([req(1)]);
    await drain();
    const before = fetched.length;
    notes = [];
    await svc.check([req(1)]);
    expect(fetched.length).toBe(before);
    expect(notes[0][2]).toMatchObject({ state: 'done', kept: true });
  });

  it('never fetches a Google search or redirect page, and says a PDF is no web page', async () => {
    await svc.check([{ key: 'g', url: 'https://www.google.com/url?q=https://x.example/' }, { key: 'p', url: 'https://x.example/file.pdf' }]);
    await drain();
    expect(fetched.some((u) => /google\.com/.test(u))).toBe(false);
    expect(notes.find((n) => n[0] === 'g')[2]).toMatchObject({ state: 'error', code: 'invalid_url' });
    expect(notes.find((n) => n[0] === 'p' && n[1] === 'error')[2]).toMatchObject({ code: 'not_html', contentType: 'application/pdf' });
  });
});

describe('Analyze never reads a local or private address', () => {
  it.each([
    'http://localhost/admin', 'http://127.0.0.1:8080/', 'http://10.0.0.1/', 'http://172.20.1.1/', 'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://[::ffff:192.168.0.1]/', 'http://2130706433/', 'http://router/', 'http://nas.local/', 'http://db.internal/', 'http://box.home.arpa/'
  ])('%s is refused before any fetch', async (url) => {
    await svc.check([{ key: 'x', url }]);
    await drain();
    expect(fetched).toEqual([]);
    expect(notes[0][2]).toMatchObject({ state: 'error', code: 'invalid_url' });
  });

  it('a page that redirects to a private address is not read, nor that site\'s robots.txt', async () => {
    const local = createSerpPageCheck({
      fetchText: async (url) => { fetched.push(url); return { status: 200, finalUrl: 'http://192.168.1.1/', headers: { 'content-type': 'text/html' }, text: '<title>router</title>' }; },
      analyze: async () => ({}),
      robots,
      hasAccess: async () => true,
      openAccessPage: async () => {},
      storage: sessionStorage(),
      notify: (req, msg) => notes.push([req.key, msg.state, msg])
    });
    await local.check([{ key: 'r', url: 'https://public.example/go' }]);
    await drain();
    expect(fetched).toEqual(['https://public.example/go']);
    expect(notes.find((n) => n[1] === 'error')[2]).toMatchObject({ code: 'blocked_redirect' });
  });

  it('public sites pass', () => {
    expect(svc.isLocalHost('www.example.com')).toBe(false);
    expect(svc.isLocalHost('8.8.8.8')).toBe(false);
    expect(svc.isLocalHost('[2001:4860:4860::8888]')).toBe(false);
  });
});

describe('1.12.0 review fixes', () => {
  it('two tabs analyzing the same page each hear back', async () => {
    await svc.check([{ key: 'same', url: 'https://one.example/p', serpTabId: 1, frameId: 0 }, { key: 'same', url: 'https://one.example/p', serpTabId: 2, frameId: 0 }]);
    await drain();
    const done = notes.filter((n) => n[1] === 'done');
    expect(done).toHaveLength(2);
  });

  it.each([
    'https://www.google.com/?q=x', 'https://www.google.com/webhp?q=x', 'https://www.google.com/maps/search/x',
    'https://books.google.com/books?id=1&dq=emergency+plumber', 'https://www.google.com./search?q=x', 'https://scholar.google.com/scholar?q=x',
    'https://accounts.google.com/signin'
  ])('never fetches the Google page %s', async (url) => {
    await svc.check([{ key: 'g', url }]);
    await drain();
    expect(fetched).toEqual([]);
  });

  it('a Google property\'s own article is a result like any other', () => {
    expect(svc.fetchable('https://support.google.com/webmasters/answer/1')).not.toBeNull();
  });

  it('turns the local-address rule on for the reads and off after', async () => {
    vi.useFakeTimers();
    const guard = vi.fn(async () => {});
    const local = createSerpPageCheck({
      fetchText: async (url) => ({ status: 200, finalUrl: url, headers: { 'content-type': 'text/html' }, text: '' }),
      analyze: async () => ({}), robots, hasAccess: async () => true, openAccessPage: async () => {},
      storage: sessionStorage(), notify: () => {}, guard
    });
    await local.check([{ key: 'a', url: 'https://a.example/' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(guard).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(guard).toHaveBeenLastCalledWith(false);
    vi.useRealTimers();
  });

  it('the rules Chrome enforces refuse exactly what isLocalHost refuses, on one list of addresses', () => {
    const { localBlockRules, isLocalHost } = require('../../extension/src/lib/serp-page-check.js');
    const rules = localBlockRules();
    const blocked = (u) => {
      const host = new URL(u).hostname;
      return rules.some((r) => (r.condition.regexFilter && new RegExp(r.condition.regexFilter).test(u)) ||
        (r.condition.requestDomains && r.condition.requestDomains.some((d) => host === d || host.endsWith('.' + d))));
    };
    const corpus = [
      'http://127.0.0.1/', 'http://127.0.0.1./', 'http://10.1.2.3:8080/x', 'http://0.0.0.0/', 'http://192.168.0.1/', 'http://169.254.169.254/',
      'http://172.16.0.1/', 'http://172.31.255.255/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://100.64.0.1/', 'http://100.127.1.1/',
      'http://100.128.0.1/', 'http://224.0.0.1/', 'http://239.255.255.250/', 'http://255.255.255.255/', 'http://223.255.255.255/',
      'http://8.8.8.8/', 'http://[::1]/', 'http://[fd12::1]/', 'http://[fe80::1]/', 'http://[::ffff:192.168.1.1]/', 'http://[2001:4860::8888]/',
      'http://localhost/', 'http://localhost./', 'http://router/', 'http://router./', 'http://nas.local/', 'http://nas.local./',
      'http://db.internal./', 'http://box.home.arpa./', 'http://a.b.lan/', 'http://x.nip.io/', 'http://x.nip.io./',
      'https://example.com/', 'https://example.com./', 'https://www.google.com/', 'https://localhost.example.com/', 'https://local.example/',
      'https://my-home.com/', 'https://homes.com/', 'https://corp.example.org/'
    ];
    // isLocalHost refuses a few literals Chrome would never ask for in this
    // shape (WHATWG turns 2130706433 into 127.0.0.1 first); everything here
    // is a URL as the browser would request it.
    const mismatches = corpus.filter((u) => blocked(u) !== isLocalHost(new URL(u).hostname));
    expect(mismatches).toEqual([]);
  });

  it('the rules block local addresses on any hop, never a public site', () => {
    const { localBlockRules } = require('../../extension/src/lib/serp-page-check.js');
    const rules = localBlockRules();
    rules.forEach((r) => expect(r.condition.tabIds).toEqual([-1]));
    const blocked = (u) => {
      const host = new URL(u).hostname;
      return rules.some((r) => (r.condition.regexFilter && new RegExp(r.condition.regexFilter).test(u)) ||
        (r.condition.requestDomains && r.condition.requestDomains.some((d) => host === d || host.endsWith('.' + d))));
    };
    ['http://127.0.0.1:3000/x', 'http://192.168.1.1/', 'http://router/', 'http://nas.local/', 'http://[::1]/', 'http://10.2.3.4/', 'http://a.nip.io/', 'http://172.20.0.1/', 'http://100.64.1.1/', 'http://[fd00::1]/']
      .forEach((u) => expect(blocked(u), u).toBe(true));
    ['https://example.com/', 'https://172.32.0.1/', 'https://www.google.com/', 'https://localhost.example.com/', 'https://100.128.0.1/']
      .forEach((u) => expect(blocked(u), u).toBe(false));
  });

  it('reads a page in its own character set', () => {
    const { decode } = require('../../extension/src/lib/serp-page-check.js');
    const bytes = new Uint8Array([0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x22, 0x77, 0x69, 0x6e, 0x64, 0x6f, 0x77, 0x73, 0x2d, 0x31, 0x32, 0x35, 0x31, 0x22, 0x3e, 0xcf, 0xf0, 0xe8]);
    expect(decode(bytes, 'text/html')).toContain('При');
    expect(decode(new TextEncoder().encode('naïve'), 'text/html; charset=utf-8')).toBe('naïve');
  });

  it('reads nothing when the local-address rules can\'t be put in place', async () => {
    const local = createSerpPageCheck({
      fetchText: async (url) => { fetched.push(url); return { status: 200, finalUrl: url, headers: { 'content-type': 'text/html' }, text: '' }; },
      analyze: async () => ({}), robots, hasAccess: async () => true, openAccessPage: async () => {},
      storage: sessionStorage(), notify: (req, msg) => notes.push([req.key, msg.state, msg]),
      guard: async () => { throw new Error('memoryLimitExceeded'); }
    });
    await local.check([{ key: 'a', url: 'https://a.example/' }]);
    await drain();
    expect(fetched).toEqual([]);
    expect(notes).toEqual([['a', 'error', { state: 'error', code: 'unprotected' }]]);
  });
});
