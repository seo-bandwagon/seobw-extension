// Unit tests for link-check runs that outlive the popup (#47):
// src/lib/link-check-runs.js. The probe, permission check and
// chrome.storage.session are fakes; timers are vitest's fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

await import('../../extension/src/lib/link-check.js');
await import('../../extension/src/lib/link-check-runs.js');
const { createRunner, storeKey, PERSIST_EVERY_MS } = globalThis.SBWLinkCheckRuns;

const PAGE = 'https://site.example/page';
const links = (n, host = 'site.example') =>
  Array.from({ length: n }, (_, i) => ({ url: `https://${host}/l${i}`, text: `L${i}`, rel: null, internal: true }));

// chrome.storage.session stand-in, shared across runners to model a worker
// restart (memory gone, session storage kept).
function fakeStorage() {
  const map = new Map();
  return {
    map,
    get: vi.fn(async (k) => (map.has(k) ? { [k]: structuredClone(map.get(k)) } : {})),
    set: vi.fn(async (obj) => { Object.entries(obj).forEach(([k, v]) => map.set(k, structuredClone(v))); }),
    remove: vi.fn(async (k) => { map.delete(k); })
  };
}

// A probe the test answers by hand; tracks what's in flight at once.
function fakeProbe() {
  const pending = new Map();
  const calls = [];
  let inflight = 0;
  let maxInflight = 0;
  const probe = vi.fn((url, controller) => new Promise((resolve) => {
    calls.push(url);
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    const settle = (r) => { if (pending.delete(url)) { inflight -= 1; resolve(r); } };
    pending.set(url, { settle, controller });
    controller.signal.addEventListener('abort', () => settle({ url, status: 0, finalUrl: null, redirected: false, ms: 1, error: 'timeout' }));
  }));
  return {
    probe, calls, pending,
    get maxInflight() { return maxInflight; },
    answer(url, status = 200) { pending.get(url).settle({ url, status, finalUrl: url, redirected: false, ms: 5 }); },
    async answerAll(status = 200) {
      while (pending.size) {
        [...pending.keys()].forEach((u) => this.answer(u, status));
        await flushAsync();
      }
    }
  };
}

const flushAsync = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(over = {}) {
  const storage = over.storage || fakeStorage();
  const p = fakeProbe();
  const runner = createRunner({
    probe: p.probe,
    hasPermission: over.hasPermission || (async () => true),
    storage,
    perHost: over.perHost ?? 4,
    global: over.global ?? 10
  });
  const events = [];
  const listener = (m) => events.push(m);
  return { runner, storage, p, events, listener };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('link-check runs (#47)', () => {
  it('runs to done and keeps the result in session storage', async () => {
    const t = setup();
    const res = await t.runner.start({ tabId: 1, url: PAGE, links: links(3) }, t.listener);
    expect(res.state).toMatchObject({ status: 'running', done: 0, total: 3 });
    await t.p.answerAll();
    expect(t.events.filter((e) => e.type === 'progress').map((e) => e.done)).toEqual([1, 2, 3]);
    expect(t.events.at(-1)).toMatchObject({ type: 'done' });
    expect(t.events.at(-1).results).toHaveLength(3);
    expect(t.storage.map.get(storeKey(1))).toMatchObject({ status: 'done', url: PAGE, total: 3 });
  });

  it('keeps going when the popup closes, and a reopened popup gets the results', async () => {
    const t = setup();
    await t.runner.start({ tabId: 1, url: PAGE, links: links(4) }, t.listener);
    t.runner.detach(1, t.listener); // the popup closed: port disconnected
    await t.p.answerAll();
    expect(t.p.calls).toHaveLength(4);
    expect(t.p.pending.size).toBe(0);
    expect(t.events.some((e) => e.type === 'done')).toBe(false); // nobody listening

    const reopened = [];
    const back = await t.runner.attach({ tabId: 1, url: PAGE }, (m) => reopened.push(m));
    expect(back.state).toMatchObject({ status: 'done', done: 4, total: 4 });
    expect(back.state.results).toHaveLength(4);
  });

  it('a popup reopened mid-run sees the progress so far and the rest as it comes', async () => {
    const t = setup();
    await t.runner.start({ tabId: 1, url: PAGE, links: links(3) }, t.listener);
    t.runner.detach(1, t.listener);
    t.p.answer('https://site.example/l0');
    await flushAsync();

    const reopened = [];
    const back = await t.runner.attach({ tabId: 1, url: PAGE + '#section' }, (m) => reopened.push(m));
    expect(back.state).toMatchObject({ status: 'running', done: 1, total: 3 });
    expect(back.state.results).toBeUndefined();
    await t.p.answerAll();
    expect(reopened.map((m) => m.type)).toEqual(['progress', 'progress', 'done']);
  });

  it('cancel stops the probes, forgets the run and tells the popup', async () => {
    const t = setup();
    await t.runner.start({ tabId: 1, url: PAGE, links: links(3) }, t.listener);
    const controllers = [...t.p.pending.values()].map((x) => x.controller);
    await t.runner.cancel(1);
    expect(controllers.every((c) => c.signal.aborted)).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'cancelled' });
    expect(t.storage.map.has(storeKey(1))).toBe(false);
    await flushAsync();
    expect((await t.runner.attach({ tabId: 1, url: PAGE })).state).toBeNull();
  });

  it('closing the tab ends its run and clears its storage', async () => {
    const t = setup();
    await t.runner.start({ tabId: 1, url: PAGE, links: links(2) }, t.listener);
    const controllers = [...t.p.pending.values()].map((x) => x.controller);
    await t.runner.tabRemoved(1);
    expect(controllers.every((c) => c.signal.aborted)).toBe(true);
    expect(t.storage.map.has(storeKey(1))).toBe(false);
  });

  it('resumes the unchecked links when Chrome stopped the worker mid-run', async () => {
    const storage = fakeStorage();
    const first = setup({ storage });
    await first.runner.start({ tabId: 1, url: PAGE, links: links(4) }, first.listener);
    first.p.answer('https://site.example/l0');
    first.p.answer('https://site.example/l1');
    await flushAsync();
    await vi.advanceTimersByTimeAsync(PERSIST_EVERY_MS); // progress mirrored
    expect(storage.map.get(storeKey(1)).results).toHaveLength(2);

    // worker restarted: a new runner with the same session storage
    const second = setup({ storage });
    const events = [];
    const back = await second.runner.attach({ tabId: 1, url: PAGE }, (m) => events.push(m));
    expect(back).toMatchObject({ resumed: true, state: { status: 'running', done: 2, total: 4 } });
    expect(second.p.calls.sort()).toEqual(['https://site.example/l2', 'https://site.example/l3']);
    await second.p.answerAll();
    expect(events.at(-1).type).toBe('done');
    expect(events.at(-1).results.map((r) => r.url).sort()).toEqual(links(4).map((l) => l.url));
  });

  it('a reopened popup on another page in the same tab starts fresh', async () => {
    const t = setup();
    await t.runner.start({ tabId: 1, url: PAGE, links: links(2) }, t.listener);
    expect((await t.runner.attach({ tabId: 1, url: 'https://site.example/other' })).state).toBeNull();

    const old = [...t.p.pending.values()].map((x) => x.controller);
    await t.runner.start({ tabId: 1, url: 'https://site.example/other', links: links(1, 'other.example') });
    expect(old.every((c) => c.signal.aborted)).toBe(true);
  });

  it('a second start on the same page joins the run instead of restarting it', async () => {
    const t = setup();
    await t.runner.start({ tabId: 1, url: PAGE, links: links(3) }, t.listener);
    const again = await t.runner.start({ tabId: 1, url: PAGE, links: links(3) }, t.listener);
    expect(again.state).toMatchObject({ status: 'running', total: 3 });
    expect(t.p.calls).toHaveLength(3);
  });

  it('records Chrome Web Store links as uncheckable without fetching them (#46)', async () => {
    const t = setup();
    const list = [
      { url: 'https://chromewebstore.google.com/detail/seo-bandwagon/x', text: 'Install', internal: false },
      { url: 'https://site.example/ok', text: 'OK', internal: true }
    ];
    await t.runner.start({ tabId: 1, url: PAGE, links: list }, t.listener);
    await t.p.answerAll();
    await flushAsync();
    expect(t.p.calls).toEqual(['https://site.example/ok']);
    const done = t.events.at(-1);
    expect(done.type).toBe('done');
    const ws = done.results.find((r) => r.url.startsWith('https://chromewebstore'));
    expect(globalThis.SBWLinkCheck.classify(ws)).toBe('uncheckable');
  });

  it('finishes a page whose only links are uncheckable', async () => {
    const t = setup();
    await t.runner.start({ tabId: 1, url: PAGE, links: [{ url: 'https://chromewebstore.google.com/detail/a' }] }, t.listener);
    await flushAsync();
    expect(t.events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('does nothing without the <all_urls> permission', async () => {
    const t = setup({ hasPermission: async () => false });
    expect(await t.runner.start({ tabId: 1, url: PAGE, links: links(2) }, t.listener)).toEqual({ error: 'no_permission' });
    expect(t.p.calls).toHaveLength(0);
    expect(t.storage.set).not.toHaveBeenCalled();
  });

  it('respects the per-host and global limits', async () => {
    const t = setup({ perHost: 4, global: 10 });
    const list = [...links(12, 'a.example'), ...links(12, 'b.example'), ...links(12, 'c.example')];
    await t.runner.start({ tabId: 1, url: PAGE, links: list }, t.listener);
    expect(t.p.pending.size).toBe(10);
    await t.p.answerAll();
    expect(t.p.maxInflight).toBe(10);
    expect(t.p.calls).toHaveLength(36);
  });
});
