// Unit tests for the full-page capture loop (src/lib/fullpage-capture.js).
// Every Chrome call and the canvas are fakes, and time is a virtual clock, so
// the tests check order, spacing, retries and cleanup without a browser.

import { describe, it, expect, vi, afterEach } from 'vitest';

await import('../../extension/src/lib/fullpage-plan.js');
await import('../../extension/src/lib/fullpage-capture.js');
const { captureFullPage, MIN_GAP_MS, MESSAGE_TIMEOUT_MS } = globalThis.SBWFullPageCapture;

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
    // Checked before the first scroll and before the first capture: then gone.
    const ids = [7, 7, 9];
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

  it('checks the active tab before each scroll, so a switch never waits on a background tab (#64)', async () => {
    const h = harness();
    let checks = 0;
    // Front for frame 1's scroll and capture; gone before frame 2's scroll.
    h.deps.getActiveTabId = async () => (++checks <= 2 ? 7 : 9);
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'tab-changed', message: 'You switched tabs, so the capture stopped.' });
    expect(h.log.filter(e => e.startsWith('fpScrollTo'))).toEqual(['fpScrollTo:0']);
    expect(h.log).toContain('fpRestore');
  });

  it('estimates the time left with each frame (#51)', async () => {
    const h = harness();
    const seen = [];
    h.deps.onProgress = (n, total, msLeft) => seen.push([n, total, msLeft]);
    await captureFullPage(h.deps);
    // Frame 1: three frames at the 550 ms capture pace. Later frames use the
    // measured average, never faster than the pace.
    expect(seen[0]).toEqual([1, 3, 3 * MIN_GAP_MS]);
    expect(seen.map(x => x[2])).toEqual([...seen.map(x => x[2])].sort((a, b) => b - a));
    expect(seen[2][2]).toBeGreaterThanOrEqual(MIN_GAP_MS);
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

  it('says when it starts building the image, after the page is restored', async () => {
    const h = harness();
    h.deps.onEncoding = () => h.log.push('encoding');
    await captureFullPage(h.deps);
    expect(h.log.slice(-3)).toEqual(['fpRestore', 'encoding', 'finish']);
  });

  it('a cancel while the image is being built returns no result', async () => {
    const controller = new AbortController();
    const h = harness({ signal: controller.signal });
    h.deps.draw = { ...h.deps.draw, finish: async () => { h.log.push('finish'); controller.abort(); return { size: 1 }; } };
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'cancelled' });
    expect(h.log).toContain('fpRestore');
  });

  describe('a page that stops answering', () => {
    afterEach(() => { vi.useRealTimers(); });

    it(`gives up after ${MESSAGE_TIMEOUT_MS} ms on one message instead of hanging`, async () => {
      vi.useFakeTimers();
      expect(MESSAGE_TIMEOUT_MS).toBe(6000);
      const h = harness();
      const send = h.deps.send;
      h.deps.send = msg => (msg.action === 'fpScrollTo' && msg.y === 720 ? new Promise(() => {}) : send(msg));
      const run = captureFullPage(h.deps);
      const settled = expect(run).rejects.toMatchObject({
        code: 'capture-failed', message: 'The page stopped responding. Reload it and try again.'
      });
      await vi.advanceTimersByTimeAsync(MESSAGE_TIMEOUT_MS + 10);
      await settled;
      expect(h.log).toContain('fpRestore');
    });

    it('stops at once when cancelled while waiting on the page', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const h = harness({ signal: controller.signal });
      const send = h.deps.send;
      h.deps.send = msg => (msg.action === 'fpScrollTo' && msg.y === 720 ? new Promise(() => {}) : send(msg));
      const run = captureFullPage(h.deps);
      const settled = expect(run).rejects.toMatchObject({ code: 'cancelled' });
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await vi.advanceTimersByTimeAsync(10);
      await settled;
    });
  });
});

/* ---------- issue #43: a page that lands a few px off ---------- */

describe('captureFullPage when the page lands a few px from the plan (#43)', () => {
  // The real trace from seobandwagon.com/seo-chrome-extension: 14242 px tall,
  // 813 px window, 18 frames. After fpHideFixed took the sticky header and the
  // fixed bottom bar out, the page was 4 px shorter, so the last scroll
  // (13429) landed at 13425 and 1.7.4 threw the whole capture away.
  const REAL = { scrollHeight: 14242, viewportWidth: 1366, viewportHeight: 813, dpr: 1, innerScroll: false };

  function landing(h, metrics, landAt) {
    const send = h.deps.send;
    const frames = [];
    h.deps.send = async msg => {
      if (msg.action === 'fpPrepare') { h.log.push('fpPrepare'); return metrics; }
      if (msg.action === 'fpScrollTo') { h.log.push(`fpScrollTo:${msg.y}`); return { scrollY: landAt(msg.y) }; }
      return send(msg);
    };
    h.deps.draw = { ...h.deps.draw, frame: async (_u, f) => { frames.push(f); } };
    return frames;
  }

  it('finishes the capture instead of throwing it away', async () => {
    const h = harness();
    const frames = landing(h, REAL, y => Math.min(y, 13425));
    const result = await captureFullPage(h.deps);
    expect(result).toMatchObject({ width: 1366, height: 14242, mode: 'fullpage', truncated: false });
    expect(frames.length).toBe(18);
    // last frame: planned scrollY 13429 / srcY 392; drawn from 13425, so 4 rows lower
    const last = frames[17];
    expect(last.scrollY).toBe(13429);
    expect(last.srcY).toBe(396);
    expect(last.destY).toBe(13821);
    // every other frame is drawn exactly as planned
    frames.slice(0, 17).forEach((f, i) => {
      expect(f.srcY).toBe(0);
      expect(f.destY).toBe(i * 813);
    });
    expect(h.log.at(-2)).toBe('fpRestore');
  });

  it('scales the shift by the device-pixel ratio', async () => {
    const h = harness();
    const frames = landing(h, { ...METRICS, dpr: 2 }, y => (y === 1280 ? 1276 : y));
    await captureFullPage(h.deps);
    // planned last frame: scrollY 1280, srcY px(1440-1280)=320; 4 CSS px up = 8 device px
    expect(frames.at(-1).srcY).toBe(328);
  });

  it('still fails when a middle frame lands off (its rows would leave a gap)', async () => {
    const h = harness();
    landing(h, METRICS, y => (y === 720 ? 710 : y));
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed' });
    expect(h.log).toContain('fpRestore');
  });

  it('still fails when a window lands below the rows it needs (they would be missing)', async () => {
    const h = harness();
    landing(h, METRICS, y => (y === 720 ? 730 : y));
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed' });
  });

  it('uses the last frame when the page grew a little and the window landed lower', async () => {
    const h = harness();
    // rows 1440–2000 are still inside the window at 1290–2010
    const frames = landing(h, METRICS, y => (y === 1280 ? 1290 : y));
    await captureFullPage(h.deps);
    expect(frames.at(-1).srcY).toBe(150);
  });

  it('still fails when the page shrank by more than a quarter screen', async () => {
    const h = harness();
    // 720 px window: up to 180 px may stay white at the bottom; 200 may not
    landing(h, METRICS, y => (y === 1280 ? 1080 : y));
    await expect(captureFullPage(h.deps)).rejects.toMatchObject({ code: 'capture-failed' });
  });

  it('ignores a 1 px miss, as before', async () => {
    const h = harness();
    const frames = landing(h, METRICS, y => (y === 1280 ? 1279 : y));
    await captureFullPage(h.deps);
    expect(frames.at(-1).srcY).toBe(160);
  });
});
