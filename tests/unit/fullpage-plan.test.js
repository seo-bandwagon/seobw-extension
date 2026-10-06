// Unit tests for the full-page proof planner (src/lib/fullpage-plan.js):
// frame layout from page metrics, the canvas and pixel-budget caps, fractional
// device-pixel ratios, and the proof label.

import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/fullpage-plan.js');
const { planCapture, describeProof, MAX_CANVAS_PX, MAX_PIXELS } = globalThis.SBWFullPage;

const base = { viewportWidth: 1280, viewportHeight: 720, dpr: 1, innerScroll: false };

// Every frame must start where the previous one ended, and together they fill
// the canvas exactly: no 1px gaps or overlaps.
function expectContiguous(p) {
  let y = 0;
  for (const f of p.frames) {
    expect(f.destY).toBe(y);
    expect(f.srcH).toBeGreaterThan(0);
    y += f.srcH;
  }
  expect(y).toBe(p.height);
}

describe('SBWFullPage — dual export', () => {
  it('attaches to globalThis with the documented limits', () => {
    expect(typeof planCapture).toBe('function');
    expect(MAX_CANVAS_PX).toBe(32767);
    expect(MAX_PIXELS).toBe(100000000);
  });
});

describe('planCapture', () => {
  it('captures a page that fits the window as a one-frame full page', () => {
    const p = planCapture({ ...base, scrollHeight: 721 });
    expect(p.mode).toBe('fullpage');
    expect(p.reason).toBe(null);
    expect(p.frames).toEqual([{ scrollY: 0, srcY: 0, srcH: 720, destY: 0 }]);
    expect(p).toMatchObject({ width: 1280, height: 720, pageHeight: 720, capturedCssHeight: 720, truncated: false });
  });

  it('falls back to the viewport when the window cannot scroll but an inner panel does', () => {
    const p = planCapture({ ...base, scrollHeight: 720, innerScroll: true });
    expect(p.mode).toBe('viewport');
    expect(p.reason).toBe('inner-scroll');
    expect(p.frames).toEqual([{ scrollY: 0, srcY: 0, srcH: 720, destY: 0 }]);
    expect(p.height).toBe(720);
  });

  it('scrolls by whole screens on a page that is an exact multiple of the window', () => {
    const p = planCapture({ ...base, scrollHeight: 2160 });
    expect(p.frames).toEqual([
      { scrollY: 0, srcY: 0, srcH: 720, destY: 0 },
      { scrollY: 720, srcY: 0, srcH: 720, destY: 720 },
      { scrollY: 1440, srcY: 0, srcH: 720, destY: 1440 }
    ]);
    expect(p.height).toBe(2160);
    expectContiguous(p);
  });

  it('crops the overlapping top of the last frame', () => {
    const p = planCapture({ ...base, scrollHeight: 2000 });
    expect(p.frames[2]).toEqual({ scrollY: 1280, srcY: 160, srcH: 560, destY: 1440 });
    expect(p).toMatchObject({ mode: 'fullpage', height: 2000, truncated: false });
    expectContiguous(p);
  });

  it('works in device pixels at dpr 2', () => {
    const p = planCapture({ ...base, dpr: 2, scrollHeight: 2000 });
    expect(p.width).toBe(2560);
    expect(p.height).toBe(4000);
    expect(p.frames[2]).toEqual({ scrollY: 1280, srcY: 320, srcH: 1120, destY: 2880 });
    expectContiguous(p);
  });

  it('leaves no seams at a fractional dpr', () => {
    const p = planCapture({ viewportWidth: 1280, viewportHeight: 721, dpr: 1.5, scrollHeight: 2003, innerScroll: false });
    expectContiguous(p);
    const framePx = Math.round(721 * 1.5);
    for (const f of p.frames) expect(f.srcY + f.srcH).toBeLessThanOrEqual(framePx + 1);
  });

  it('caps the height at the canvas limit and reports what it covered', () => {
    const p = planCapture({ ...base, dpr: 2, scrollHeight: 41200 });
    expect(p.width).toBe(2560);
    expect(p.capturedCssHeight).toBe(16383);
    expect(p.height).toBe(32766);
    expect(p).toMatchObject({ truncated: true, pageHeight: 41200 });
    expect(p.frames).toHaveLength(23);
    expect(p.frames[22]).toEqual({ scrollY: 15840, srcY: 0, srcH: 1086, destY: 31680 });
    expectContiguous(p);
  });

  it('caps a wide window by the pixel budget before the canvas limit', () => {
    const p = planCapture({ viewportWidth: 1920, viewportHeight: 1000, dpr: 2, scrollHeight: 30000, innerScroll: false });
    expect(p.width).toBe(3840);
    expect(p.capturedCssHeight).toBe(13020);
    expect(p.height).toBe(26040);
    expect(p.width * p.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(p.truncated).toBe(true);
    expectContiguous(p);
  });

  it('treats a missing or zero dpr as 1', () => {
    expect(planCapture({ ...base, dpr: 0, scrollHeight: 2000 }).width).toBe(1280);
    expect(planCapture({ ...base, dpr: undefined, scrollHeight: 2000 }).width).toBe(1280);
  });
});

describe('describeProof', () => {
  it('labels a complete full page with its pixel size', () => {
    expect(describeProof({ mode: 'fullpage', reason: null, width: 1440, height: 9800, truncated: false }, '3.1 MB'))
      .toBe('FULL PAGE · 1440×9800 · 3.1 MB');
  });

  it('says how much of a capped page it covers: captured rounds down, page rounds up, to 100 px', () => {
    expect(describeProof({ mode: 'fullpage', reason: null, width: 2560, height: 32766, truncated: true, capturedCssHeight: 16383, pageHeight: 41200 }, '9.4 MB'))
      .toBe('FULL PAGE · first 16,300 of 41,200 px · 9.4 MB');
  });

  it('never reads "first N of N" for a page cut just short of the end', () => {
    expect(describeProof({ mode: 'fullpage', reason: null, width: 1280, height: 32750, truncated: true, capturedCssHeight: 32750, pageHeight: 32790 }, '20 MB'))
      .toBe('FULL PAGE · first 32,700 of 32,800 px · 20 MB');
  });

  it('explains an inner-scroll fallback', () => {
    expect(describeProof({ mode: 'viewport', reason: 'inner-scroll', width: 1280, height: 720 }, '214 KB'))
      .toBe('VIEWPORT · page scrolls inside a panel · 1280×720 · 214 KB');
  });

  it('labels a visible-area capture as a viewport', () => {
    expect(describeProof({ mode: 'viewport', reason: null, width: 1280, height: 720 }, '214 KB'))
      .toBe('VIEWPORT · 1280×720 · 214 KB');
  });
});
