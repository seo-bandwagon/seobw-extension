// Analyze on a Google results page, in a background tab (1.10.2,
// src/lib/serp-analyze.js). chrome.tabs, chrome.windows and session storage
// are stubs; the analyzer is a function that answers per tab.

import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../extension/src/lib/serp-analyze.js');
const A = globalThis.SBWSerpAnalyze;

function event() {
  const fns = new Set();
  return {
    addListener: (fn) => fns.add(fn),
    removeListener: (fn) => fns.delete(fn),
    fire: (...args) => [...fns].forEach((fn) => fn(...args)),
    size: () => fns.size
  };
}

let tabs, windows, storage, notes, analyzed, access, accessAsked, popups, analyze, nextId;

function harness() {
  nextId = 100;
  const open = new Map();
  tabs = {
    onUpdated: event(),
    onRemoved: event(),
    create: vi.fn(async (props) => { const tab = { id: nextId++, status: 'loading', ...props }; open.set(tab.id, tab); return tab; }),
    update: vi.fn(async (id, props) => {
      if (!open.has(id)) throw new Error('No tab with id: ' + id);
      Object.assign(open.get(id), props, props.url ? { status: 'loading' } : {});
      return { ...open.get(id), windowId: 1 };
    }),
    get: vi.fn(async (id) => { if (!open.has(id)) throw new Error('No tab'); return { ...open.get(id) }; }),
    load(id, url) {
      const tab = open.get(id);
      Object.assign(tab, { status: 'complete', url });
      tabs.onUpdated.fire(id, { status: 'complete' }, { ...tab });
    },
    close(id) { open.delete(id); tabs.onRemoved.fire(id, {}); }
  };
  windows = { update: vi.fn(async () => ({})) };
  const data = {};
  storage = {
    get: vi.fn(async (k) => (k in data ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {})),
    set: vi.fn(async (o) => { Object.entries(o).forEach(([k, v]) => { data[k] = JSON.parse(JSON.stringify(v)); }); })
  };
  notes = [];
  analyzed = [];
  popups = [];
  access = true;
  accessAsked = 0;
  analyze = vi.fn(async (tab) => ({ url: tab.url, seoScore: { score: 82, grade: 'B', issues: ['Missing H1', 'Title too long'] } }));
  return A.createSerpAnalyze({
    tabs,
    windows,
    storage,
    hasAccess: async () => access,
    openAccessPage: async () => { accessAsked += 1; },
    analyze: (tab) => analyze(tab),
    onAnalyzed: async (tab, d) => { analyzed.push([tab.id, d.url]); },
    notify: (req, msg) => notes.push({ key: req.key, ...msg }),
    openPopup: (windowId) => { popups.push(windowId); return Promise.resolve(); },
    isRedirect: (url) => /^https:\/\/www\.google\.com\/goto/.test(url),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t)
  });
}

const req = (n, extra) => Object.assign({ key: `https://site${n}.example/`, url: `https://site${n}.example/`, serpTabId: 7, frameId: 0, windowId: 1, index: 3 }, extra);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { vi.useRealTimers(); });

describe('Analyze from a results page opens a background tab and analyzes it by its ID', () => {
  it('opens the result beside the results page without taking focus', async () => {
    const s = harness();
    expect(await s.start(req(1))).toEqual({ ok: true, state: 'working' });
    await flush();
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://site1.example/', active: false, windowId: 1, index: 4, openerTabId: 7 });
  });

  it('analyzes that tab once its page has loaded, and reports the checklist back', async () => {
    const s = harness();
    await s.start(req(1));
    await flush();
    expect(analyze).not.toHaveBeenCalled();
    tabs.load(100, 'https://site1.example/');
    await flush(); await flush();
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ id: 100 }));
    expect(analyzed).toEqual([[100, 'https://site1.example/']]);
    expect(notes.at(-1)).toEqual({ key: 'https://site1.example/', state: 'done', tabId: 100, score: 82, grade: 'B', issues: 2 });
  });

  it('waits past a Google redirect for the page it lands on', async () => {
    const s = harness();
    await s.start(req(1, { url: 'https://www.google.com/goto?url=CAESabc', key: '/goto?url=CAESabc' }));
    await flush();
    tabs.load(100, 'https://www.google.com/goto?url=CAESabc');
    await flush();
    expect(analyze).not.toHaveBeenCalled();
    tabs.load(100, 'https://landed.example/page');
    await flush(); await flush();
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ id: 100, url: 'https://landed.example/page' }));
  });

  // A tab still on its blank first page, its navigation pending, is not the
  // result's page.
  it('does not take a new tab\'s blank first page for the result', async () => {
    const s = harness();
    const create = tabs.create;
    tabs.create = vi.fn(async (props) => Object.assign(await create(props), { status: 'complete', url: 'about:blank' }));
    tabs.get = vi.fn(async (id) => ({ id, status: 'complete', url: 'about:blank', pendingUrl: 'https://site1.example/' }));
    await s.start(req(1));
    await flush(); await flush();
    expect(analyze).not.toHaveBeenCalled();
    tabs.load(100, 'https://site1.example/');
    await flush(); await flush();
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ id: 100, url: 'https://site1.example/' }));
  });

  it('gives several quick clicks a tab and an analysis each', async () => {
    const s = harness();
    await Promise.all([s.start(req(1)), s.start(req(2)), s.start(req(3))]);
    await flush();
    expect(tabs.create).toHaveBeenCalledTimes(3);
    tabs.load(102, 'https://site3.example/');
    tabs.load(100, 'https://site1.example/');
    tabs.load(101, 'https://site2.example/');
    await flush(); await flush();
    expect(analyzed.map(([id]) => id).sort()).toEqual([100, 101, 102]);
    expect(notes.filter((n) => n.state === 'done').map((n) => [n.key, n.tabId]).sort()).toEqual([
      ['https://site1.example/', 100], ['https://site2.example/', 101], ['https://site3.example/', 102]]);
  });

  it('reuses the tab on a second click on the same result', async () => {
    const s = harness();
    await s.start(req(1));
    await flush();
    tabs.load(100, 'https://site1.example/');
    await flush(); await flush();
    await s.start(req(1));
    await flush();
    expect(tabs.create).toHaveBeenCalledTimes(1);
    expect(tabs.update).toHaveBeenCalledWith(100, { url: 'https://site1.example/' });
    tabs.load(100, 'https://site1.example/');
    await flush(); await flush();
    expect(analyzed).toEqual([[100, 'https://site1.example/'], [100, 'https://site1.example/']]);
  });

  it('opens a new tab when the old one was closed', async () => {
    const s = harness();
    await s.start(req(1));
    await flush();
    tabs.load(100, 'https://site1.example/');
    await flush(); await flush();
    tabs.close(100);
    await s.tabRemoved(100);
    await s.start(req(1));
    await flush();
    expect(tabs.create).toHaveBeenCalledTimes(2);
  });

  it('ignores a second click while the first is still working', async () => {
    const s = harness();
    await s.start(req(1));
    expect(await s.start(req(1))).toEqual({ ok: true, state: 'working' });
    await flush();
    expect(tabs.create).toHaveBeenCalledTimes(1);
  });

  it('says why when the page can\'t be analyzed, and when the tab closes first', async () => {
    const s = harness();
    analyze = vi.fn(async () => { throw Object.assign(new Error('PDF'), { problem: { title: 'PDF FILE', body: '…' } }); });
    await s.start(req(1));
    await flush();
    tabs.load(100, 'https://site1.example/doc.pdf');
    await flush(); await flush();
    expect(notes.at(-1)).toMatchObject({ state: 'error', code: 'unreadable', title: 'PDF FILE', tabId: 100 });

    await s.start(req(2));
    await flush();
    tabs.close(101);
    await flush();
    expect(notes.at(-1)).toMatchObject({ key: 'https://site2.example/', state: 'error', code: 'closed', tabId: undefined });
  });

  it('gives up on a page that never loads', async () => {
    vi.useFakeTimers();
    const s = harness();
    await s.start(req(1));
    await vi.advanceTimersByTimeAsync(A.GIVE_UP_MS + 10);
    expect(notes.at(-1)).toMatchObject({ state: 'error', code: 'timeout', tabId: 100 });
    expect(tabs.onUpdated.size()).toBe(0);
    vi.useRealTimers();
  });

  it('refuses anything but an http(s) link', async () => {
    const s = harness();
    expect(await s.start(req(1, { url: 'javascript:alert(1)' }))).toMatchObject({ ok: false, code: 'invalid_url' });
    expect(tabs.create).not.toHaveBeenCalled();
  });
});

describe('site access is asked once, from an extension page', () => {
  it('opens the access page instead of a tab, and carries on once it is granted', async () => {
    const s = harness();
    access = false;
    expect(await s.start(req(1))).toEqual({ ok: true, state: 'needs_access' });
    expect(await s.start(req(2))).toEqual({ ok: true, state: 'needs_access' });
    expect(accessAsked).toBe(2); // the worker focuses the one window it opened
    expect(tabs.create).not.toHaveBeenCalled();

    access = true;
    expect(await s.accessAnswered(true)).toBe(2);
    await flush();
    expect(tabs.create).toHaveBeenCalledTimes(2);
    // A second answer (permissions.onAdded after the page's own) runs nothing twice.
    expect(await s.accessAnswered(true)).toBe(0);
    await flush();
    expect(tabs.create).toHaveBeenCalledTimes(2);
  });

  it('tells the results page when access was not given', async () => {
    const s = harness();
    access = false;
    await s.start(req(1));
    expect(await s.accessAnswered(false)).toBe(1);
    expect(notes).toEqual([{ key: 'https://site1.example/', state: 'declined' }]);
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('waits on when an unrelated permission is added', async () => {
    const s = harness();
    access = false;
    await s.start(req(1));
    expect(await s.accessAnswered(true)).toBe(0); // still no all-sites access
    access = true;
    expect(await s.accessAnswered(true)).toBe(1);
  });
});

describe('Open report', () => {
  it('brings the tab to the front and opens the popup on it', async () => {
    vi.useFakeTimers();
    const s = harness();
    await s.start(req(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(await s.open(100)).toEqual({ ok: true });
    expect(tabs.update).toHaveBeenLastCalledWith(100, { active: true });
    expect(windows.update).toHaveBeenCalledWith(1, { focused: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(popups).toEqual([1]);
    vi.useRealTimers();
  });

  it('Open tab switches without the popup, and a closed tab says so', async () => {
    vi.useFakeTimers();
    const s = harness();
    await s.start(req(1));
    await vi.advanceTimersByTimeAsync(0);
    await s.open(100, { report: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(popups).toEqual([]);
    expect(await s.open(999)).toEqual({ ok: false, error: 'tab_closed' });
    vi.useRealTimers();
  });
});

describe('checklistLine', () => {
  it('reads the score, grade and issue count, and nothing else', () => {
    expect(A.checklistLine({ seoScore: { score: 64, grade: 'D', issues: ['a', 'b', 'c'] }, title: 'x' })).toEqual({ score: 64, grade: 'D', issues: 3 });
    expect(A.checklistLine({})).toEqual({ score: null, grade: '', issues: 0 });
  });
});
