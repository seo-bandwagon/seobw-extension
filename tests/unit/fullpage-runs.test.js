// Unit tests for full-page proof runs that outlive the popup (#48,
// src/lib/fullpage-runs.js). The capture, the proof store and
// chrome.storage.session are fakes; a capture is a promise the test settles.

import { describe, it, expect, beforeEach } from 'vitest';

await import('../../extension/src/lib/fullpage-runs.js');
const { createRunner, storeKey, INTERRUPTED } = globalThis.SBWFullPageRuns;

const URL_A = 'https://www.yelp.com/biz/acme';
const SHOT = {
  blob: { type: 'image/jpeg', size: 4321 },
  width: 1280, height: 4000, mode: 'fullpage', reason: null,
  pageHeight: 4000, capturedCssHeight: 4000, truncated: false
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(r => setTimeout(r, 0));

function fakes() {
  const session = {};
  const proofs = new Map();
  const captures = [];
  const storage = {
    get: async k => (k in session ? { [k]: session[k] } : {}),
    set: async obj => { Object.assign(session, JSON.parse(JSON.stringify(obj))); },
    remove: async k => { delete session[k]; }
  };
  const store = {
    put: async (k, b) => { proofs.set(k, b); },
    get: async k => proofs.get(k),
    remove: async k => { proofs.delete(k); }
  };
  const capture = opts => {
    const d = deferred();
    opts.signal.addEventListener('abort', () => {
      const e = new Error('Capture cancelled.'); e.code = 'cancelled'; d.reject(e);
    });
    captures.push(Object.assign(d, { opts }));
    return d.promise;
  };
  return { session, proofs, captures, storage, store, capture };
}

let f, runner, events;
const listener = m => events.push(m);

beforeEach(() => {
  f = fakes();
  events = [];
  runner = createRunner({ capture: f.capture, proofs: f.store, storage: f.storage, now: () => 1000 });
});

describe('full-page proof runs (#48)', () => {
  it('runs in the worker, reports progress, stores the image and keeps the result', async () => {
    const { state } = await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    expect(state).toMatchObject({ status: 'running', phase: 'measuring' });
    expect(f.captures).toHaveLength(1);
    expect(f.captures[0].opts).toMatchObject({ tabId: 5, windowId: 2 });

    f.captures[0].opts.onProgress(2, 8, 3300);
    expect(events.at(-1)).toMatchObject({ type: 'progress', run: { phase: 'capturing', frame: 2, total: 8, msLeft: 3300 } });
    f.captures[0].opts.onEncoding();
    expect(events.at(-1).run.phase).toBe('encoding');

    f.captures[0].resolve(SHOT);
    await flush();
    expect(f.proofs.get(storeKey(5))).toBe(SHOT.blob);
    expect(events.at(-1)).toMatchObject({ type: 'done', run: { status: 'done', result: { key: storeKey(5), type: 'image/jpeg', bytes: 4321, width: 1280, height: 4000 } } });
    expect(f.session[storeKey(5)]).toMatchObject({ status: 'done', url: URL_A });
  });

  it('keeps going when the popup detaches, and a reopened popup gets the result', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    runner.detach(5, listener);
    f.captures[0].resolve(SHOT);
    await flush();
    expect(events.filter(e => e.type === 'done')).toHaveLength(0);

    const later = [];
    const { state } = await runner.attach({ tabId: 5, url: URL_A + '#reviews' }, m => later.push(m));
    expect(state).toMatchObject({ status: 'done', result: { key: storeKey(5) } });
  });

  it('finds a finished proof after Chrome restarts the worker', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    f.captures[0].resolve(SHOT);
    await flush();
    const fresh = createRunner({ capture: f.capture, proofs: f.store, storage: f.storage });
    const { state } = await fresh.attach({ tabId: 5, url: URL_A });
    expect(state).toMatchObject({ status: 'done', result: { bytes: 4321 } });
  });

  it('reports a capture the worker lost mid-run as interrupted, not as still running', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    f.captures[0].opts.onProgress(1, 8, 4400);
    await flush();
    const fresh = createRunner({ capture: f.capture, proofs: f.store, storage: f.storage });
    const { state } = await fresh.attach({ tabId: 5, url: URL_A });
    expect(state).toMatchObject({ status: 'error', error: { message: INTERRUPTED } });
  });

  it('has nothing for another page in the same tab', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    expect((await runner.attach({ tabId: 5, url: 'https://www.yelp.com/biz/other' })).state).toBeNull();
    expect((await runner.attach({ tabId: 6, url: URL_A })).state).toBeNull();
  });

  it('joins a running capture of the same page instead of restarting it', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    expect(f.captures).toHaveLength(1);
  });

  it('a new capture replaces the old result and its image', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    f.captures[0].resolve(SHOT);
    await flush();
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    expect(f.captures).toHaveLength(2);
    expect(f.proofs.has(storeKey(5))).toBe(false);
  });

  it('cancel stops the capture and keeps nothing', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    await runner.cancel(5);
    await flush();
    expect(f.captures[0].opts.signal.aborted).toBe(true);
    expect(events.filter(e => e.type === 'cancelled')).toHaveLength(1);
    expect(f.session[storeKey(5)]).toBeUndefined();
    expect((await runner.attach({ tabId: 5, url: URL_A })).state).toBeNull();
  });

  it('dismissing a finished proof removes it and its image', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    f.captures[0].resolve(SHOT);
    await flush();
    await runner.cancel(5);
    expect(f.proofs.has(storeKey(5))).toBe(false);
    expect(f.session[storeKey(5)]).toBeUndefined();
  });

  it('an image that finishes after a cancel is not kept', async () => {
    const slowPut = deferred();
    f.store.put = async (k, b) => { await slowPut.promise; f.proofs.set(k, b); };
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    f.captures[0].resolve(SHOT);
    await flush();
    await runner.cancel(5);
    slowPut.resolve();
    await flush();
    await flush();
    expect(f.proofs.has(storeKey(5))).toBe(false);
  });

  it('reports a failure with its code, and keeps it for the next popup', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    const e = new Error('You switched tabs, so the capture stopped.'); e.code = 'tab-changed';
    f.captures[0].reject(e);
    await flush();
    expect(events.at(-1)).toMatchObject({ type: 'error', run: { status: 'error', error: { code: 'tab-changed', message: e.message } } });
    expect((await runner.attach({ tabId: 5, url: URL_A })).state).toMatchObject({ status: 'error' });
  });

  it('remembers that the proof was downloaded', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    f.captures[0].resolve(SHOT);
    await flush();
    await runner.markDownloaded(5);
    const fresh = createRunner({ capture: f.capture, proofs: f.store, storage: f.storage });
    expect((await fresh.attach({ tabId: 5, url: URL_A })).state.downloaded).toBe(true);
  });

  it('closing the tab stops the capture and removes everything', async () => {
    await runner.start({ tabId: 5, windowId: 2, url: URL_A }, listener);
    await runner.tabRemoved(5);
    expect(f.captures[0].opts.signal.aborted).toBe(true);
    expect(f.session[storeKey(5)]).toBeUndefined();
    expect(runner._runs.size).toBe(0);
  });
});
