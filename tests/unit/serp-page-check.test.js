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
