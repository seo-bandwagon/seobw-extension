// Unit tests for the full-page capture loop (src/popup/fullpage-capture.js).
// Every Chrome call and the canvas are fakes, and time is a virtual clock, so
// the tests check order, spacing, retries and cleanup without a browser.

import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/fullpage-plan.js');
await import('../../extension/src/popup/fullpage-capture.js');
const { captureFullPage, MIN_GAP_MS } = globalThis.SBWFullPageCapture;

const METRICS = { scrollHeight: 2000, viewportWidth: 1280, viewportHeight: 720, dpr: 1, innerScroll: false };
const RATE_LIMIT = 'This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.';

function harness(over = {}) {
  let t = 0;
  const log = [];
  const sleeps = [];
  const deps = {
    tabId: 7,
    windowId: 3,
    inject: async () => { log.push('inject'); },
    send: async msg => {
      log.push(msg.action === 'fpScrollTo' ? `fpScrollTo:${msg.y}` : msg.action);
      if (msg.action === 'fpPrepare') return METRICS;
      if (msg.action === 'fpScrollTo') return { scrollY: msg.y };
      if (msg.action === 'fpHideFixed') return { hidden: 1 };
      return { ok: true };
    },
    capture: async () => { log.push('capture'); t += 100; return 'data:image/png;base64,AAAA'; },
    getActiveTabId: async () => 7,
    draw: {
      begin: async (w, h) => { log.push(`begin:${w}x${h}`); },
      frame: async (_url, f) => { log.push(`draw:${f.destY}`); },
      finish: async () => { log.push('finish'); return { size: 1234 }; }
    },
    now: () => t,
    sleep: async ms => { sleeps.push(ms); t += ms; },
    onProgress: (n, total) => log.push(`progress:${n}/${total}`)
  };
  return { deps: { ...deps, ...over }, log, sleeps, tick: ms => { t += ms; } };
}

describe('captureFullPage', () => {
  it('scrolls, hides fixed elements before every frame from the second, captures, draws and restores in order', async () => {
    const h = harness();
    const result = await captureFullPage(h.deps);
    expect(h.log).toEqual([
      'inject', 'fpPrepare', 'begin:1280x2000',
      'progress:1/3', 'fpScrollTo:0', 'capture', 'draw:0',
      'progress:2/3', 'fpScrollTo:720', 'fpHideFixed', 'capture', 'draw:720',
      'progress:3/3', 'fpScrollTo:1280', 'fpHideFixed', 'capture', 'draw:1440',
      'fpRestore', 'finish'
    ]);
    expect(result).toMatchObject({
      blob: { size: 1234 }, width: 1280, height: 2000, mode: 'fullpage', reason: null,
      pageHeight: 2000, capturedCssHeight: 2000, truncated: false
    });
  });

  it(`spaces captures at least ${MIN_GAP_MS} ms apart`, async () => {
    const h = harness();
    await captureFullPage(h.deps);
    expect(MIN_GAP_MS).toBe(550);
    expect(h.sleeps).toEqual([550, 550]);
  });

  it('counts time spent scrolling toward the gap', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async msg => { if (msg.action === 'fpScrollTo') h.tick(300); return send(msg); };
    await captureFullPage(h.deps);
    expect(h.sleeps).toEqual([250, 250]);
  });

  it('waits a second and retries once when Chrome reports the capture rate limit', async () => {
    const h = harness();
    let calls = 0;
    const capture = h.deps.capture;
    h.deps.capture = async w => { calls++; if (calls === 1) throw new Error(RATE_LIMIT); return capture(w); };
    await captureFullPage(h.deps);
    expect(h.sleeps).toContain(1000);
    expect(calls).toBe(4);
  });

  it('gives up after a second rate-limit error and still restores the page', async () => {
    const h = harness({ capture: async () => { throw new Error(RATE_LIMIT); } });
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed' });
    expect(h.log).toContain('fpRestore');
  });

  it('does not retry other capture errors', async () => {
    let calls = 0;
    const h = harness({ capture: async () => { calls++; throw new Error('Cannot access contents of url "chrome://newtab/".'); } });
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({
      code: 'capture-failed', message: 'Cannot access contents of url "chrome://newtab/".'
    });
    expect(calls).toBe(1);
  });

  it('stops when the user switches tabs', async () => {
    const ids = [7, 9];
    const h = harness({ getActiveTabId: async () => ids.shift() });
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'tab-changed' });
    expect(h.log).toContain('fpRestore');
    expect(h.log).not.toContain('finish');
    expect(h.log.filter(e => e === 'capture')).toHaveLength(1);
  });

  it('cancels between frames and restores the page', async () => {
    const controller = new AbortController();
    const h = harness({ signal: controller.signal });
    h.deps.onProgress = n => { if (n === 2) controller.abort(); };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'cancelled' });
    expect(h.log).toContain('fpRestore');
    expect(h.log.filter(e => e === 'capture')).toHaveLength(1);
  });

  it('reports canvas-failed when the canvas cannot be created, without capturing', async () => {
    const h = harness();
    h.deps.draw = { ...h.deps.draw, begin: async () => { throw new Error('too big'); } };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'canvas-failed' });
    expect(h.log).not.toContain('capture');
    expect(h.log).toContain('fpRestore');
  });

  it('reports canvas-failed when the PNG cannot be encoded, after the page is restored', async () => {
    const h = harness();
    h.deps.draw = { ...h.deps.draw, finish: async () => { throw new Error('toBlob null'); } };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'canvas-failed' });
    expect(h.log.indexOf('fpRestore')).toBeGreaterThan(h.log.lastIndexOf('capture'));
  });

  it('takes one frame and no hide on an inner-scroll page', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async msg => msg.action === 'fpPrepare'
      ? (h.log.push('fpPrepare'), { scrollHeight: 720, viewportWidth: 1280, viewportHeight: 720, dpr: 1, innerScroll: true })
      : send(msg);
    const result = await captureFullPage(h.deps);
    expect(result).toMatchObject({ mode: 'viewport', reason: 'inner-scroll', height: 720 });
    expect(h.log).not.toContain('fpHideFixed');
    expect(h.log.filter(e => e === 'capture')).toHaveLength(1);
  });

  it('fails clearly when the helper does not answer, and still sends fpRestore', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async msg => (msg.action === 'fpPrepare' ? (h.log.push('fpPrepare'), undefined) : send(msg));
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed', message: 'Could not measure this page.' });
    expect(h.log).toContain('fpRestore');
  });

  it('wraps a messaging failure as capture-failed', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async msg => {
      if (msg.action === 'fpScrollTo') throw new Error('Could not establish connection. Receiving end does not exist.');
      return send(msg);
    };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed' });
  });

  it('does not send fpRestore when injection itself failed', async () => {
    const h = harness({ inject: async () => { throw new Error('Cannot access a chrome:// URL'); } });
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed' });
    expect(h.log).not.toContain('fpRestore');
  });

  it('stops when the page helper refuses a scroll because the page was reset', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async msg => {
      if (msg.action === 'fpScrollTo' && msg.y === 720) { h.log.push('fpScrollTo:720'); return { error: 'not-prepared' }; }
      return send(msg);
    };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed', message: 'The page was reset during capture.' });
    expect(h.log.filter(e => e === 'capture')).toHaveLength(1);
    expect(h.log).toContain('fpRestore');
  });

  it('stops with an honest error when the page never scrolls, instead of repeating the top screen', async () => {
    const h = harness();
    const send = h.deps.send;
    h.deps.send = async msg => (msg.action === 'fpScrollTo' ? (h.log.push(`fpScrollTo:${msg.y}`), { scrollY: 0 }) : send(msg));
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({
      code: 'capture-failed',
      message: "The page didn't scroll as expected, so a full-page image would repeat itself. Try the visible area instead."
    });
    expect(h.log.filter(e => e === 'capture')).toHaveLength(1);
    expect(h.log).toContain('fpRestore');
    expect(h.log).not.toContain('finish');
  });

  it('checks the active tab after the spacing wait, right before capturing', async () => {
    const h = harness();
    let active = 7;
    h.deps.getActiveTabId = async () => active;
    const origSleep = h.deps.sleep;
    h.deps.sleep = async ms => { await origSleep(ms); active = 9; };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'tab-changed' });
    expect(h.log.filter(e => e === 'capture')).toHaveLength(1);
  });

  it('checks the active tab again before the rate-limit retry', async () => {
    const h = harness();
    let active = 7;
    h.deps.getActiveTabId = async () => active;
    let calls = 0;
    const capture = h.deps.capture;
    h.deps.capture = async w => {
      calls++;
      if (calls === 1) throw new Error(RATE_LIMIT);
      return capture(w);
    };
    const origSleep = h.deps.sleep;
    h.deps.sleep = async ms => { await origSleep(ms); if (ms === 1000) active = 9; };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'tab-changed' });
    expect(calls).toBe(1);  // Retry capture never ran, stopped by beforeCapture
  });

  it('a cancel during the last frame returns no result', async () => {
    const controller = new AbortController();
    const h = harness({ signal: controller.signal });
    const origFrame = h.deps.draw.frame;
    h.deps.draw.frame = async (dataUrl, f) => {
      if (f.destY === 1440) controller.abort();  // Last frame for METRICS (1280x2000)
      return origFrame(dataUrl, f);
    };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'cancelled' });
    expect(h.log).toContain('fpRestore');
    expect(h.log).not.toContain('finish');
  });
});
