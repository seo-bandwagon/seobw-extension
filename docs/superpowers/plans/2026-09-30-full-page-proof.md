# Full-Page Proof Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Citations tab's SCREENSHOT tile captures the whole page, not just the visible viewport, and downloads it as one PNG. A "Visible area only" option keeps the old behaviour.

**Architecture:** The popup does the work. `chrome.scripting.executeScript` injects a small helper into the page, which scrolls it one screen at a time. The popup calls `chrome.tabs.captureVisibleTab` after each scroll and draws the frame onto a canvas at the position computed by a pure planning module. The page is restored on every exit path. There is no service worker change, no new permission and no site API change.

**Tech Stack:** Manifest V3, vanilla JS (classic scripts, dual-export `src/lib` modules), vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-30-full-page-proof-design.md`

## Global Constraints

- **No new permission, host permission or manifest `content_scripts` entry.** `activeTab` + `scripting` already cover this.
- **No change to** `src/background/service-worker.js` or the citation payload (`SBWCitations.buildCitationPayload`). The existing `captureScreenshot` action stays for the visible-area option.
- **Canvas limits:** `MAX_CANVAS_PX = 32767` (output px, height) and `MAX_PIXELS = 100000000` (width × height).
- **Capture spacing:** at least `MIN_GAP_MS = 550` ms between `captureVisibleTab` calls. On `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`, wait `1000` ms and retry once.
- **Page helper timing:** 5000 ms watchdog, 150 ms settle after each scroll.
- **Error codes:** `tab-changed | capture-failed | canvas-failed | cancelled`.
- **Label strings, copied exactly:**
  - `FULL PAGE · {w}×{h} · {size}`
  - `FULL PAGE · first {n} of {m} px · {size}` (n and m rounded to the nearest 100, `en-US` thousands separators)
  - `VIEWPORT · page scrolls inside a panel · {w}×{h} · {size}`
  - `VIEWPORT · {w}×{h} · {size}`
- **Dual-export header** for new `src/lib`/`src/popup` modules. Copy the pattern at the top of `extension/src/lib/sync-state.js`.
- **Version:** this is the 1.7.0 minor bump (`npm run bump -- minor`) in the last task. CI fails a PR that changes `extension/` without it.
- Commit titles are conventional commits phrased as the outcome, and every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `extension/src/lib/fullpage-plan.js` | create | Pure: frame layout from page metrics (`planCapture`) and the proof label (`describeProof`) |
| `extension/src/content/page-scroller.js` | create | Injected into the page: measure, scroll, hide fixed/sticky, restore, watchdog |
| `extension/src/popup/fullpage-capture.js` | create | Orchestrates inject → prepare → scroll/capture/draw loop → restore; canvas drawer |
| `extension/src/popup/citations-tab.js` | modify | Tile copy, "Visible area only", progress + Cancel, labels, blob-URL download, errors |
| `extension/src/popup/popup.html` | modify | Load the two new classic scripts before `citations-tab.js` |
| `extension/src/styles/popup.css` | modify | Styles for the "Visible area only" button and the Cancel chip |
| `tests/unit/fullpage-plan.test.js`, `tests/unit/page-scroller.test.js`, `tests/unit/fullpage-capture.test.js` | create | Unit tests |
| `preview/stub.js`, `preview/popup.html`, `preview/index.html`, `preview/verify.html` | modify | Harness states for the new UI |
| `docs/superpowers/specs/2026-09-30-full-page-proof-design.md` | modify | One refinement (Task 1): a page that fits the window is a one-frame full page, not "inner scroll" |
| manifest, `package*.json`, `ROADMAP.md`, `CHROMEWEBSTORE.md`, `MANUAL_SMOKE_TEST.md`, `preview/DESIGN-GAPS.md`, `README.md` | modify | 1.7.0 release bookkeeping (Task 5) |

---

### Task 1: Frame planning and proof labels (`fullpage-plan.js`)

**Files:**
- Create: `extension/src/lib/fullpage-plan.js`
- Create: `tests/unit/fullpage-plan.test.js`
- Modify: `docs/superpowers/specs/2026-09-30-full-page-proof-design.md` (unit 1 and the `fpPrepare` row)

**Interfaces:**
- Produces: `globalThis.SBWFullPage = { planCapture, describeProof, MAX_CANVAS_PX, MAX_PIXELS }`
  - `planCapture({ scrollHeight, viewportWidth, viewportHeight, dpr, innerScroll = false, maxCanvasPx = 32767, maxPixels = 100000000 })`
    → `{ mode: 'fullpage'|'viewport', reason: null|'inner-scroll', width, height, pageHeight, capturedCssHeight, truncated, frames: [{ scrollY, srcY, srcH, destY }] }`
    - `scrollY` and `pageHeight`/`capturedCssHeight` are CSS px.
    - `width`, `height`, `srcY`, `srcH` and `destY` are output (device) px.
  - `describeProof({ mode, reason, width, height, truncated, capturedCssHeight, pageHeight }, sizeText)` → label string

**Refinement over the spec.** The spec used `reason: 'inner-scroll'` whenever the document can't scroll. But a short page that simply fits the window would then be mislabelled. `page-scroller.js` therefore also reports `innerScroll`, which says whether an inner element scrolls. When the page fits and `innerScroll` is false, the result is a one-frame **full page**. Update the spec in this task, as shown in Step 5.

- [ ] **Step 1: Write the failing tests**

`tests/unit/fullpage-plan.test.js`:

```js
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

  it('says how much of a capped page it covers, rounded to 100 px', () => {
    expect(describeProof({ mode: 'fullpage', reason: null, width: 2560, height: 32766, truncated: true, capturedCssHeight: 16383, pageHeight: 41200 }, '9.4 MB'))
      .toBe('FULL PAGE · first 16,400 of 41,200 px · 9.4 MB');
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/fullpage-plan.test.js`
Expected: FAIL. The import rejects because `extension/src/lib/fullpage-plan.js` doesn't exist.

- [ ] **Step 3: Write the implementation**

`extension/src/lib/fullpage-plan.js`:

```js
// SEO Bandwagon — full-page proof planner
//
// Pure layout for a scroll-and-stitch screenshot: given the page's height,
// the window size and the device-pixel ratio, where to scroll for each frame
// and which rows of that frame go where on the final canvas. Also the label
// the proof card shows. No chrome/DOM dependency, so it's fully unit-testable.
//
// Units: scrollY, pageHeight and capturedCssHeight are CSS px; width, height,
// srcY, srcH and destY are output (device) px. Every output-px value is
// rounded from a CSS-px boundary once, so frames abut exactly at fractional
// ratios (1.25, 1.5).
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWFullPage` when loaded as a classic <script>, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWFullPage = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Chrome refuses a canvas taller than this.
  const MAX_CANVAS_PX = 32767;
  // Keeps a wide Retina window from allocating a canvas big enough to take the
  // popup down (100M px is ~400 MB of RGBA).
  const MAX_PIXELS = 100000000;

  function planCapture({
    scrollHeight, viewportWidth, viewportHeight, dpr, innerScroll = false,
    maxCanvasPx = MAX_CANVAS_PX, maxPixels = MAX_PIXELS
  }) {
    const ratio = dpr > 0 ? dpr : 1;
    const px = css => Math.round(css * ratio);
    const width = px(viewportWidth);
    const fits = scrollHeight <= viewportHeight + 2;

    if (fits && innerScroll) {
      return {
        mode: 'viewport', reason: 'inner-scroll',
        width, height: px(viewportHeight),
        pageHeight: viewportHeight, capturedCssHeight: viewportHeight, truncated: false,
        frames: [{ scrollY: 0, srcY: 0, srcH: px(viewportHeight), destY: 0 }]
      };
    }

    const pageHeight = fits ? viewportHeight : scrollHeight;
    const capPx = Math.min(maxCanvasPx, Math.floor(maxPixels / width));
    const capturedCssHeight = Math.min(pageHeight, Math.floor(capPx / ratio));
    const frames = [];

    for (let top = 0; top < capturedCssHeight; top += viewportHeight) {
      const bottom = Math.min(top + viewportHeight, capturedCssHeight);
      // The window can't scroll past pageHeight - viewportHeight, so the last
      // frame starts higher and its top rows repeat the previous frame.
      const scrollY = Math.min(top, pageHeight - viewportHeight);
      frames.push({
        scrollY,
        srcY: px(top - scrollY),
        srcH: px(bottom) - px(top),
        destY: px(top)
      });
    }

    return {
      mode: 'fullpage', reason: null,
      width, height: px(capturedCssHeight),
      pageHeight, capturedCssHeight,
      truncated: capturedCssHeight < pageHeight,
      frames
    };
  }

  function round100(n) {
    return Math.round(n / 100) * 100;
  }

  // The proof card's header line. `sizeText` is already formatted
  // (citations-tab.js's fmtBytes).
  function describeProof(r, sizeText) {
    const dims = `${r.width}×${r.height}`;
    if (r.mode === 'viewport') {
      return r.reason === 'inner-scroll'
        ? `VIEWPORT · page scrolls inside a panel · ${dims} · ${sizeText}`
        : `VIEWPORT · ${dims} · ${sizeText}`;
    }
    if (r.truncated) {
      const fmt = n => round100(n).toLocaleString('en-US');
      return `FULL PAGE · first ${fmt(r.capturedCssHeight)} of ${fmt(r.pageHeight)} px · ${sizeText}`;
    }
    return `FULL PAGE · ${dims} · ${sizeText}`;
  }

  return { planCapture, describeProof, MAX_CANVAS_PX, MAX_PIXELS };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/fullpage-plan.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Record the refinement in the spec**

In `docs/superpowers/specs/2026-09-30-full-page-proof-design.md`:
1. Replace the bullet
   ``- `mode: 'viewport', reason: 'inner-scroll'` when `scrollHeight <= viewportHeight + 2`.``
   with:
   ``- When `scrollHeight <= viewportHeight + 2`: if an inner element scrolls (`innerScroll` from `fpPrepare`), `mode: 'viewport', reason: 'inner-scroll'`; otherwise the page simply fits, and the result is a one-frame `mode: 'fullpage'` of `viewportHeight`.``
2. Add `innerScroll` to `planCapture`'s argument list in unit 1.
3. In the `fpPrepare` row, add `innerScroll` to the returned object, described as "true when some element at least half the window tall has `overflow-y: auto|scroll` and more content than it shows".

- [ ] **Step 6: Commit**

```bash
git add extension/src/lib/fullpage-plan.js tests/unit/fullpage-plan.test.js docs/superpowers/specs/2026-09-30-full-page-proof-design.md
git commit -m "feat(proof): plan full-page frames and label the proof honestly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The page helper (`page-scroller.js`)

**Files:**
- Create: `extension/src/content/page-scroller.js`
- Create: `tests/unit/page-scroller.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a content script that registers one `chrome.runtime.onMessage` listener. `analyzer.js`'s listener returns `true` for every message but answers only its own actions, so this listener's reply is the one the popup receives. It answers:
  - `{ action: 'fpPrepare' }` → `{ scrollHeight, viewportWidth, viewportHeight, dpr, innerScroll }` (these field names match `planCapture`'s arguments)
  - `{ action: 'fpScrollTo', y }` → `{ scrollY }`, asynchronous, after 2 animation frames + 150 ms
  - `{ action: 'fpHideFixed' }` → `{ hidden: number }`
  - `{ action: 'fpRestore' }` → `{ ok: true }`
  - Messages with any other action are ignored and the listener returns `undefined`. `nap-extractor.js` may share the tab, so this matters.

- [ ] **Step 1: Write the failing tests**

`tests/unit/page-scroller.test.js`:

```js
// Unit tests for the page helper injected for full-page proof
// (src/content/page-scroller.js): measuring, scrolling, hiding fixed and
// sticky elements, restoring every inline style exactly, and the watchdog
// that puts the page back if the popup closes mid-capture.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let listener;
let scrollY;

async function load() {
  vi.resetModules();
  await import('../../extension/src/content/page-scroller.js');
}

function call(action, extra = {}) {
  return new Promise(resolve => { listener({ action, ...extra }, {}, resolve); });
}

// Fake timers for every test: each fpPrepare arms a 5 s watchdog, and with
// real timers a leftover one could fire during a later test. Switching back
// to real timers in afterEach drops them.
beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
  delete window.__sbwPageScrollerLoaded;
  listener = null;
  scrollY = 0;
  globalThis.chrome = { runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => 0 });
  window.scrollTo = vi.fn((_x, y) => { scrollY = y; });
  await load();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('page-scroller', () => {
  it('registers one message listener and is harmless when injected twice', async () => {
    expect(typeof listener).toBe('function');
    listener = null;
    await load(); // guard flag still set
    expect(listener).toBe(null);
  });

  it('ignores messages meant for other scripts', () => {
    expect(listener({ action: 'extractNap' }, {}, () => {})).toBe(undefined);
  });

  it('measures the page and forces instant scrolling', async () => {
    document.documentElement.style.setProperty('scroll-behavior', 'smooth');
    const m = await call('fpPrepare');
    expect(m).toMatchObject({ viewportHeight: window.innerHeight, dpr: window.devicePixelRatio || 1, innerScroll: false });
    expect(typeof m.scrollHeight).toBe('number');
    expect(typeof m.viewportWidth).toBe('number');
    expect(document.documentElement.style.getPropertyValue('scroll-behavior')).toBe('auto');
  });

  it('reports an inner scroll panel', async () => {
    const panel = document.createElement('div');
    panel.style.overflowY = 'auto';
    Object.defineProperty(panel, 'clientHeight', { value: window.innerHeight });
    Object.defineProperty(panel, 'scrollHeight', { value: window.innerHeight * 3 });
    document.body.appendChild(panel);
    expect((await call('fpPrepare')).innerScroll).toBe(true);
  });

  it('scrolls, waits for the page to settle, and reports where it landed', async () => {
    await call('fpPrepare');
    const reply = call('fpScrollTo', { y: 720 });
    await vi.advanceTimersByTimeAsync(149);
    let settled = false;
    reply.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await reply).toEqual({ scrollY: 720 });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 720);
  });

  it('hides only visible fixed and sticky elements', async () => {
    document.body.innerHTML = `
      <header id="h" style="position: fixed"></header>
      <nav id="n" style="position: sticky"></nav>
      <div id="d" style="position: relative"></div>
      <div id="gone" style="position: fixed; display: none"></div>`;
    await call('fpPrepare');
    expect(await call('fpHideFixed')).toEqual({ hidden: 2 });
    expect(document.getElementById('h').style.visibility).toBe('hidden');
    expect(document.getElementById('n').style.visibility).toBe('hidden');
    expect(document.getElementById('d').style.visibility).toBe('');
  });

  it('restores scroll position and every inline style exactly, including !important', async () => {
    scrollY = 300;
    document.documentElement.style.setProperty('scroll-behavior', 'smooth', 'important');
    document.body.innerHTML = `<header id="h" style="position: fixed; visibility: visible"></header>
      <nav id="n" style="position: sticky"></nav>`;
    await call('fpPrepare');
    await call('fpHideFixed');
    expect(await call('fpRestore')).toEqual({ ok: true });

    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 300);
    const de = document.documentElement.style;
    expect(de.getPropertyValue('scroll-behavior')).toBe('smooth');
    expect(de.getPropertyPriority('scroll-behavior')).toBe('important');
    expect(document.body.style.getPropertyValue('scroll-behavior')).toBe('');
    expect(document.getElementById('h').style.visibility).toBe('visible');
    expect(document.getElementById('n').style.getPropertyValue('visibility')).toBe('');
  });

  it('restores the page by itself after 5 s without a message', async () => {
    scrollY = 120;
    document.body.innerHTML = '<header id="h" style="position: fixed"></header>';
    await call('fpPrepare');
    await call('fpHideFixed');
    await vi.advanceTimersByTimeAsync(4999);
    expect(document.getElementById('h').style.visibility).toBe('hidden');
    await vi.advanceTimersByTimeAsync(2);
    expect(document.getElementById('h').style.visibility).toBe('');
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 120);
  });

  it('treats fpRestore without fpPrepare as a no-op', async () => {
    expect(await call('fpRestore')).toEqual({ ok: true });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
```


- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/page-scroller.test.js`
Expected: FAIL, because `page-scroller.js` doesn't exist.

- [ ] **Step 3: Write the implementation**

`extension/src/content/page-scroller.js`:

```js
// SEO Bandwagon — page helper for full-page proof screenshots
//
// Injected on demand by the popup (src/popup/fullpage-capture.js), the same
// way src/content/nap-extractor.js is. The popup drives it one message at a
// time: measure, scroll to each frame, hide fixed/sticky elements after the
// first frame (so a sticky header appears once, at the top), then restore.
//
// Every inline style it touches is saved with its priority and put back
// exactly. If the popup closes mid-capture, no fpRestore ever arrives, so a
// watchdog restores the page 5 s after the last message.

(function () {
  // Guard against double-injection
  if (window.__sbwPageScrollerLoaded) return;
  window.__sbwPageScrollerLoaded = true;

  const WATCHDOG_MS = 5000;
  const SETTLE_MS = 150;

  let saved = null; // { x, y, styles: [{ el, prop, value, priority }] }
  let watchdog = null;

  function arm() {
    clearTimeout(watchdog);
    watchdog = setTimeout(restore, WATCHDOG_MS);
  }

  function remember(el, prop) {
    saved.styles.push({
      el, prop,
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop)
    });
  }

  function hasInnerScroller() {
    const minHeight = window.innerHeight * 0.5;
    for (const el of document.querySelectorAll('body *')) {
      if (el.clientHeight < minHeight || el.scrollHeight <= el.clientHeight + 2) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
    return false;
  }

  function prepare() {
    if (saved) restore();
    saved = { x: window.scrollX, y: window.scrollY, styles: [] };
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      remember(el, 'scroll-behavior');
      el.style.setProperty('scroll-behavior', 'auto', 'important');
    }
    const de = document.documentElement;
    return {
      scrollHeight: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0),
      viewportWidth: de.clientWidth || window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      innerScroll: hasInnerScroller()
    };
  }

  function nextFrame() {
    return new Promise(resolve => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 16);
    });
  }

  async function scrollToY(y) {
    window.scrollTo(0, y);
    // Two frames so the scroll paints, then a pause for lazy images.
    await nextFrame();
    await nextFrame();
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    return { scrollY: window.scrollY };
  }

  function hideFixed() {
    if (!saved) return { hidden: 0 };
    let hidden = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      remember(el, 'visibility');
      el.style.setProperty('visibility', 'hidden', 'important');
      hidden++;
    }
    return { hidden };
  }

  function restore() {
    clearTimeout(watchdog);
    watchdog = null;
    if (!saved) return { ok: true };
    // Scroll back while scroll-behavior is still forced to auto, so it's instant.
    window.scrollTo(saved.x, saved.y);
    for (const s of saved.styles.reverse()) {
      if (s.value) s.el.style.setProperty(s.prop, s.value, s.priority);
      else s.el.style.removeProperty(s.prop);
    }
    saved = null;
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg && msg.action) {
      case 'fpPrepare': {
        const metrics = prepare();
        arm();
        sendResponse(metrics);
        return false;
      }
      case 'fpScrollTo':
        arm();
        scrollToY(msg.y).then(reply => { arm(); sendResponse(reply); });
        return true;
      case 'fpHideFixed':
        arm();
        sendResponse(hideFixed());
        return false;
      case 'fpRestore':
        sendResponse(restore());
        return false;
      default:
        return undefined;
    }
  });
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/page-scroller.test.js`
Expected: PASS, 9 tests. If the "measures the page" test fails on `viewportWidth` because jsdom reports `clientWidth` as 0, the `|| window.innerWidth` fallback covers it. Don't loosen the test.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/page-scroller.js tests/unit/page-scroller.test.js
git commit -m "feat(proof): a page helper that scrolls for capture and always puts the page back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The capture loop (`fullpage-capture.js`)

**Files:**
- Create: `extension/src/popup/fullpage-capture.js`
- Create: `tests/unit/fullpage-capture.test.js`

**Interfaces:**
- Consumes:
  - `globalThis.SBWFullPage.planCapture` (Task 1)
  - the `fp*` message protocol (Task 2)
- Produces: `globalThis.SBWFullPageCapture = { captureFullPage, canvasDrawer, MIN_GAP_MS }`
  - `captureFullPage(opts)` → `Promise<{ blob, width, height, mode, reason, pageHeight, capturedCssHeight, truncated }>`
    - Rejects with an `Error` carrying `.code` from `'tab-changed'|'capture-failed'|'canvas-failed'|'cancelled'`, and a user-facing `.message`.
    - `opts` fields:

      | Field | Signature |
      |---|---|
      | `tabId` | `number` |
      | `windowId` | `number` |
      | `inject` | `() => Promise` |
      | `send` | `(msg) => Promise<reply>` |
      | `capture` | `(windowId) => Promise<dataUrl>` |
      | `getActiveTabId` | `(windowId) => Promise<number\|null>` |
      | `draw` | `{ begin(w, h), frame(dataUrl, frame), finish() → Promise<Blob> }` |
      | `plan?` | defaults to `SBWFullPage.planCapture` |
      | `now?` | clock function |
      | `sleep?` | `(ms) => Promise` |
      | `onProgress?` | `(n, total)`, called before capturing frame n |
      | `signal?` | an `AbortSignal` |
  - `canvasDrawer(document)` → a `draw` object backed by a real `<canvas>`. Only the popup uses it; jsdom has no canvas, so it's verified in the preview harness (Task 4).

- [ ] **Step 1: Write the failing tests**

`tests/unit/fullpage-capture.test.js`:

```js
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
  it('scrolls, hides fixed elements once, captures, draws and restores in order', async () => {
    const h = harness();
    const result = await captureFullPage(h.deps);
    expect(h.log).toEqual([
      'inject', 'fpPrepare', 'begin:1280x2000',
      'progress:1/3', 'fpScrollTo:0', 'capture', 'draw:0',
      'progress:2/3', 'fpScrollTo:720', 'fpHideFixed', 'capture', 'draw:720',
      'progress:3/3', 'fpScrollTo:1280', 'capture', 'draw:1440',
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/fullpage-capture.test.js`
Expected: FAIL, because `fullpage-capture.js` doesn't exist.

- [ ] **Step 3: Write the implementation**

`extension/src/popup/fullpage-capture.js`:

```js
// SEO Bandwagon — full-page proof capture loop
//
// Scrolls the page one screen at a time through the injected helper
// (src/content/page-scroller.js), captures each screen with
// chrome.tabs.captureVisibleTab, and draws it where
// SBWFullPage.planCapture (src/lib/fullpage-plan.js) says. The page is
// restored on every exit: success, error or cancel.
//
// Every Chrome call and the canvas are passed in, so tests run the loop with
// fakes and a virtual clock. canvasDrawer() is the real canvas the popup uses.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWFullPageCapture = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Chrome allows two captureVisibleTab calls a second.
  const MIN_GAP_MS = 550;
  const RATE_LIMIT_WAIT_MS = 1000;
  const RATE_LIMIT_RE = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/;

  const MESSAGES = {
    'tab-changed': 'You switched tabs, so the capture stopped.',
    'capture-failed': 'Chrome blocked the capture on this page.',
    'canvas-failed': 'This page is too large to stitch into one image in this browser.',
    'cancelled': 'Capture cancelled.'
  };

  function captureError(code, message) {
    const e = new Error(message || MESSAGES[code]);
    e.code = code;
    return e;
  }

  async function captureFullPage(opts) {
    const {
      tabId, windowId, inject, send, capture, getActiveTabId, draw,
      plan = globalThis.SBWFullPage.planCapture,
      now = () => Date.now(),
      sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
      onProgress = () => {},
      signal = null
    } = opts;

    let injected = false;
    let restored = false;

    function checkCancelled() {
      if (signal && signal.aborted) throw captureError('cancelled');
    }

    async function restore() {
      if (!injected || restored) return;
      restored = true;
      try { await send({ action: 'fpRestore' }); } catch (_) { /* the helper's watchdog restores the page */ }
    }

    async function captureWithRetry() {
      try {
        return await capture(windowId);
      } catch (e) {
        if (!RATE_LIMIT_RE.test(String(e && e.message))) throw captureError('capture-failed', e && e.message);
        await sleep(RATE_LIMIT_WAIT_MS);
        try {
          return await capture(windowId);
        } catch (e2) {
          throw captureError('capture-failed', e2 && e2.message);
        }
      }
    }

    try {
      checkCancelled();
      await inject();
      injected = true;

      const metrics = await send({ action: 'fpPrepare' });
      if (!metrics || !metrics.viewportHeight) throw captureError('capture-failed', 'Could not measure this page.');
      const p = plan(metrics);

      try { await draw.begin(p.width, p.height); } catch (_) { throw captureError('canvas-failed'); }

      let lastShot = -Infinity;
      for (let i = 0; i < p.frames.length; i++) {
        const frame = p.frames[i];
        checkCancelled();
        onProgress(i + 1, p.frames.length);
        await send({ action: 'fpScrollTo', y: frame.scrollY });
        // Keep sticky headers in the first frame only.
        if (i === 1) await send({ action: 'fpHideFixed' });
        checkCancelled();
        // captureVisibleTab shoots whatever tab is active; never stitch in another tab.
        if ((await getActiveTabId(windowId)) !== tabId) throw captureError('tab-changed');
        const wait = lastShot + MIN_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        checkCancelled();
        const dataUrl = await captureWithRetry();
        lastShot = now();
        try { await draw.frame(dataUrl, frame); } catch (_) { throw captureError('canvas-failed'); }
      }

      // Give the page back before the (slow) PNG encode.
      await restore();

      let blob;
      try { blob = await draw.finish(); } catch (_) { throw captureError('canvas-failed'); }

      return {
        blob,
        width: p.width, height: p.height,
        mode: p.mode, reason: p.reason,
        pageHeight: p.pageHeight, capturedCssHeight: p.capturedCssHeight,
        truncated: p.truncated
      };
    } catch (e) {
      throw e && MESSAGES[e.code] ? e : captureError('capture-failed', e && e.message);
    } finally {
      await restore();
    }
  }

  function loadImage(doc, src) {
    return new Promise((resolve, reject) => {
      const img = new doc.defaultView.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('A captured frame did not decode.'));
      img.src = src;
    });
  }

  // The popup's real canvas. begin() throws when Chrome won't allocate the
  // size; drawImage clamps to what the frame actually has (rounding can leave
  // a frame 1px short), and a scrollbar on the right is cropped by width.
  function canvasDrawer(doc) {
    let canvas = null;
    let ctx = null;
    return {
      begin(width, height) {
        canvas = doc.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d');
        if (!ctx || canvas.width !== width || canvas.height !== height) throw new Error('canvas unavailable');
      },
      async frame(dataUrl, f) {
        const img = await loadImage(doc, dataUrl);
        const w = Math.min(img.naturalWidth, canvas.width);
        const h = Math.min(f.srcH, img.naturalHeight - f.srcY);
        if (h > 0) ctx.drawImage(img, 0, f.srcY, w, h, 0, f.destY, w, h);
      },
      finish() {
        return new Promise((resolve, reject) => {
          canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
        });
      }
    };
  }

  return { captureFullPage, canvasDrawer, MIN_GAP_MS };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/fullpage-capture.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. That's the 905 existing tests plus the three new files.

- [ ] **Step 6: Commit**

```bash
git add extension/src/popup/fullpage-capture.js tests/unit/fullpage-capture.test.js
git commit -m "feat(proof): stitch full-page captures under Chrome's rate limit, restoring the page on every exit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire it into the Citations tab, plus preview states

**Files:**
- Modify: `extension/src/popup/popup.html` (script list, around lines 49–59)
- Modify: `extension/src/popup/citations-tab.js` (state vars at the top; `renderMain` ~227–262; `renderResult` ~295–311; `renderLoading` ~338–343; `renderAlert` ~345–349; `renderProof` ~387–410; `runScreenshot` ~449–464)
- Modify: `extension/src/styles/popup.css` (after `.cf-card.loading-card` at ~1457)
- Modify: `preview/popup.html`, `preview/stub.js`, `preview/index.html`, `preview/verify.html`

**Interfaces:**
- Consumes:
  - `SBWFullPage.describeProof` (Task 1)
  - `SBWFullPageCapture.captureFullPage` and `SBWFullPageCapture.canvasDrawer` (Task 3)
  - `src/content/page-scroller.js` (Task 2), injected by path
- Produces:
  - `cfResult` of kind `'proof'` now has the shape `{ kind: 'proof', href, label, downloaded }`. It was `{ dataUrl, w, h, bytes }`.
  - `cfResult` of kind `'loading'` may carry `onCancel`.
  - `cfResult` of kind `'alert'` may carry `retryVisible: true`.
  - A top-level `cfShowResult(r)` for the preview harness.

- [ ] **Step 1: Load the new scripts in the popup**

In `extension/src/popup/popup.html`, insert these two lines immediately before `<script src="citations-tab.js"></script>`:

```html
  <script src="../lib/fullpage-plan.js"></script>
  <script src="fullpage-capture.js"></script>
```

- [ ] **Step 2: Add state and the preview hook to `citations-tab.js`**

After `let cfRecent = [];         // recent citations for the idle panel`, add:

```js
let cfProofUrl = null;     // blob: URL of the current full-page proof; revoked when the result changes
let cfShotAbort = null;    // AbortController of a running full-page capture
```

After the `send(msg)` helper, add:

```js
// Lets preview/stub.js show a result state directly (the preview harness has
// no real page to capture). Unused in the extension itself.
function cfShowResult(r) {
  cfResult = r;
  renderResult();
}
```

- [ ] **Step 3: Tile copy and the "Visible area only" button**

In `renderMain`, change the SCREENSHOT tile's sub-line:

```html
          <span class="act-tile-sub">Download full-page proof of this listing</span>
```

Close the `.act-pair` `</div>`, and before the closing `</div>` of `.cf-actions`, add:

```html
      <button class="cf-shot-visible" id="cfShotVisible">Visible area only</button>
```

Then, after the existing `document.getElementById('cfShot').addEventListener('click', runScreenshot);`, add:

```js
  document.getElementById('cfShotVisible').addEventListener('click', runVisibleShot);
```

- [ ] **Step 4: Revoke old blob URLs, and add Cancel to loading and retry to alerts**

At the very top of `renderResult()`, before `const zone = …`, add:

```js
  // A full-page proof holds its PNG in a blob: URL. Free it once that proof
  // is no longer the result on screen.
  if (cfProofUrl && !(cfResult && cfResult.kind === 'proof' && cfResult.href === cfProofUrl)) {
    URL.revokeObjectURL(cfProofUrl);
    cfProofUrl = null;
  }
```

In the `switch`, change the loading case to:

```js
    case 'loading': renderLoading(zone, cfResult.label, cfResult.onCancel); break;
```

Replace `renderLoading` with:

```js
function renderLoading(zone, label, onCancel) {
  zone.innerHTML = `<div class="cf-card loading-card">
    <div class="load-label">${esc(label || 'Working…')}</div>
    <div class="skeleton"><i style="width:62%"></i><i style="width:88%"></i><i style="width:44%"></i></div>
    ${onCancel ? '<button class="proof-chip bare" id="cfLoadCancel">CANCEL</button>' : ''}
  </div>`;
  if (onCancel) document.getElementById('cfLoadCancel').addEventListener('click', onCancel);
}
```

Replace `renderAlert` with:

```js
function renderAlert(zone, r) {
  zone.innerHTML = `<div style="margin:0 14px 12px">
    <div class="alert alert-${esc(r.tone)}"><b>${esc(r.title)}</b><span>${esc(r.body)}</span></div>
    ${r.retryVisible ? '<button class="proof-chip cf-retry-visible" id="cfShotVisibleRetry">CAPTURE VISIBLE AREA INSTEAD</button>' : ''}
  </div>`;
  if (r.retryVisible) document.getElementById('cfShotVisibleRetry').addEventListener('click', runVisibleShot);
}
```

- [ ] **Step 5: The proof card reads `href` and `label`**

In `renderProof`, change three things:

1. The dims line:
   ```html
         <span class="proof-dims">${esc(r.label)}</span>
   ```
2. The thumbnail `src="${r.dataUrl}"` becomes `src="${esc(r.href)}"`.
3. The download chip `href="${r.dataUrl}"` becomes `href="${esc(r.href)}"`.

Leave the rest of `renderProof` unchanged. That covers the filename, the `downloaded` flag and the close button.

- [ ] **Step 6: Replace `runScreenshot`, and keep the old path as `runVisibleShot`**

Replace the whole `runScreenshot` function with these two functions:

```js
// Full-page proof: scroll and stitch in the popup (src/popup/fullpage-capture.js).
async function runScreenshot() {
  if (cfShotAbort) cfShotAbort.abort();
  const controller = new AbortController();
  cfShotAbort = controller;
  const tab = cfTab;

  const showProgress = label => {
    if (cfShotAbort !== controller) return;
    cfResult = { kind: 'loading', label, onCancel: () => controller.abort() };
    renderResult();
  };
  showProgress('Measuring the page…');

  try {
    const shot = await SBWFullPageCapture.captureFullPage({
      tabId: tab.id,
      windowId: tab.windowId,
      inject: () => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/page-scroller.js'] }),
      send: msg => chrome.tabs.sendMessage(tab.id, msg),
      capture: windowId => chrome.tabs.captureVisibleTab(windowId, { format: 'png' }),
      getActiveTabId: async windowId => {
        const [active] = await chrome.tabs.query({ active: true, windowId });
        return active ? active.id : null;
      },
      draw: SBWFullPageCapture.canvasDrawer(document),
      onProgress: (n, total) => showProgress(`Capturing ${n} of ${total}…`),
      signal: controller.signal
    });
    if (cfShotAbort !== controller) return;
    cfProofUrl = URL.createObjectURL(shot.blob);
    cfResult = {
      kind: 'proof',
      href: cfProofUrl,
      label: SBWFullPage.describeProof(shot, fmtBytes(shot.blob.size)),
      downloaded: false
    };
    renderResult();
  } catch (e) {
    if (cfShotAbort !== controller) return;
    if (e.code === 'cancelled') { cfResult = null; renderResult(); return; }
    cfResult = {
      kind: 'alert', tone: 'error', title: 'CAPTURE FAILED',
      body: e.message || 'Chrome blocked the capture on this page.',
      retryVisible: e.code === 'canvas-failed'
    };
    renderResult();
  } finally {
    if (cfShotAbort === controller) cfShotAbort = null;
  }
}

// Visible area only: the pre-1.7 one-frame capture through the service
// worker's captureScreenshot action.
async function runVisibleShot() {
  if (cfShotAbort) { cfShotAbort.abort(); cfShotAbort = null; }
  cfResult = { kind: 'loading', label: 'Capturing proof…' };
  renderResult();

  const res = await send({ action: 'captureScreenshot' });
  if (!res || !res.ok) {
    cfResult = { kind: 'alert', tone: 'error', title: 'CAPTURE FAILED', body: res?.error || 'Chrome blocked the capture on this page.' };
    renderResult();
    return;
  }

  const dims = await imageDims(res.dataUrl);
  const bytes = Math.round((res.dataUrl.length - res.dataUrl.indexOf(',') - 1) * 0.75);

  cfResult = {
    kind: 'proof',
    href: res.dataUrl,
    label: SBWFullPage.describeProof({ mode: 'viewport', reason: null, width: dims.w, height: dims.h }, fmtBytes(bytes)),
    downloaded: false
  };
  renderResult();
}
```

`runReport` needs no change. It still reads `cfResult.kind === 'proof' && cfResult.downloaded`.

- [ ] **Step 7: Styles**

In `extension/src/styles/popup.css`, directly after the `.cf-card.loading-card { … }` rule, add:

```css
/* "Visible area only": the one-frame proof, under the SCREENSHOT / REPORT tiles */
.cf-shot-visible {
  justify-self: end;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--paper-50);
  background: none;
  border: 0;
  border-bottom: 1px solid transparent;
  padding: 0 0 1px;
  cursor: pointer;
}
.cf-shot-visible:hover { color: var(--ink); border-bottom-color: var(--pink); }
.loading-card #cfLoadCancel { margin-top: 10px; }
.cf-retry-visible { margin-top: 8px; }
```

- [ ] **Step 8: Preview harness states**

In `preview/popup.html`, insert the same two scripts before `<script src="../extension/src/popup/citations-tab.js"></script>`:

```html
  <script src="../extension/src/lib/fullpage-plan.js"></script>
  <script src="../extension/src/popup/fullpage-capture.js"></script>
```

In `preview/stub.js`, make these changes:

1. After `const SHOT = makeShot();` add:
   ```js
   // One screen of a 1280×720 window, the frame the full-page proof stitches.
   const SHOT_FRAME = makeShot(1280, 720);
   ```
2. Replace `captureVisibleTab(_, __, cb) { cb(SHOT); },` with:
   ```js
       // The popup's full-page proof calls this promise-style (no callback).
       captureVisibleTab(_, __, cb) {
         if (cb) { cb(SHOT); return; }
         return new Promise(resolve => setTimeout(() => resolve(SHOT_FRAME), 0));
       },
   ```
3. In `handleMessage`'s `switch`, directly after `case 'captureScreenshot': …`, add:
   ```js
       // src/content/page-scroller.js, driven by the full-page proof: a
       // 1,800px page in a 1280×720 window → three frames.
       case 'fpPrepare': return { scrollHeight: 1800, viewportWidth: 1280, viewportHeight: 720, dpr: 1, innerScroll: false };
       case 'fpScrollTo': return { scrollY: msg.y };
       case 'fpHideFixed': return { hidden: 1 };
       case 'fpRestore': return { ok: true };
   ```
4. In the final `switch (PREVIEW_STATE)`, after the `case 'proof':` block, add:
   ```js
         case 'proof-visible':
           document.getElementById('cfShotVisible')?.click();
           break;
         case 'proof-capturing':
           cfShowResult({ kind: 'loading', label: 'Capturing 3 of 9…', onCancel() {} });
           break;
         case 'proof-truncated':
           cfShowResult({ kind: 'proof', href: SHOT, downloaded: false, label: SBWFullPage.describeProof(
             { mode: 'fullpage', reason: null, width: 2560, height: 32766, truncated: true, capturedCssHeight: 16383, pageHeight: 41200 }, '9.4 MB') });
           break;
         case 'proof-panel':
           cfShowResult({ kind: 'proof', href: SHOT, downloaded: false, label: SBWFullPage.describeProof(
             { mode: 'viewport', reason: 'inner-scroll', width: 1280, height: 720 }, '214 KB') });
           break;
         case 'proof-canvas-failed':
           cfShowResult({ kind: 'alert', tone: 'error', title: 'CAPTURE FAILED',
             body: 'This page is too large to stitch into one image in this browser.', retryVisible: true });
           break;
   ```

In `preview/index.html`, in the `g1` list, after `['proof', 'Screenshot captured — proof card'],` add:

```js
        ['proof-visible', 'Screenshot — visible area only'],
        ['proof-capturing', 'Full-page proof — capturing, with Cancel'],
        ['proof-truncated', 'Full-page proof — capped, says how much'],
        ['proof-panel', 'Full-page proof — page scrolls inside a panel'],
        ['proof-canvas-failed', 'Full-page proof — too large, offers visible area'],
```

In `preview/verify.html`, after the `state=proof` case, add:

```js
  { q: 'popup.html?state=proof-visible',       need: ['.proof', '.proof-thumb', '.proof-chip'], click: '#cfShotVisible', text: ['VIEWPORT ·'] },
  { q: 'popup.html?state=proof-capturing',     need: ['.loading-card', '#cfLoadCancel'], text: ['Capturing 3 of 9'] },
  { q: 'popup.html?state=proof-truncated',     need: ['.proof', '.proof-dims'], text: ['first 16,400 of 41,200 px'] },
  { q: 'popup.html?state=proof-panel',         need: ['.proof', '.proof-dims'], text: ['page scrolls inside a panel'] },
  { q: 'popup.html?state=proof-canvas-failed', need: ['.alert-error', '#cfShotVisibleRetry'] },
```

Also add `text: ['FULL PAGE ·']` to the existing `state=proof` case.

`run()` already checks `c.text` against the frame's `body.textContent` (verify.html ~line 330), so these assertions work as written.

- [ ] **Step 9: Run the automated gates**

Run: `npm test && npm run check:zip`
Expected: all tests pass. `check-zip-manifest: OK — every referenced file is present.` now also counts `src/lib/fullpage-plan.js` and `src/popup/fullpage-capture.js`.

- [ ] **Step 10: Check the preview harness in a browser**

Open `preview/index.html` directly (`open preview/index.html` on macOS) and look at each new state:

| State | What to check |
|---|---|
| `proof` | After about 1.7 s: the thumbnail shows the pink-banner shot, the label reads `FULL PAGE · 1280×1800 · … KB`, and DOWNLOAD PNG saves a 1280×1800 PNG |
| `proof-visible` | `VIEWPORT · 320×220 · …` |
| `proof-capturing` | "Capturing 3 of 9…" with a CANCEL chip |
| `proof-truncated`, `proof-panel` | the exact labels from Global Constraints |
| `proof-canvas-failed` | the alert with CAPTURE VISIBLE AREA INSTEAD, which switches to the visible-area proof when clicked |

Then open `preview/verify.html`. Every case must be green, including the shell-drift check for `popup.html`, which compares the real popup markup with the preview's.

- [ ] **Step 11: Commit**

```bash
git add extension/src/popup/popup.html extension/src/popup/citations-tab.js extension/src/styles/popup.css preview/
git commit -m "feat(proof): the SCREENSHOT tile captures the whole page, with a visible-area option

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 1.7.0 release bookkeeping and a real-Chrome check

**Files:**
- Modify:
  - `extension/manifest.json`, `package.json`, `package-lock.json` and the `ROADMAP.md` "Current version" line (all written by `npm run bump`)
  - `extension/manifest.json` `version_name`
  - `CHROMEWEBSTORE.md` Version History
  - `ROADMAP.md` (a changelog section, plus the v1.7 list)
  - `preview/DESIGN-GAPS.md` ("Full-page capture")
  - `MANUAL_SMOKE_TEST.md` §8
  - `README.md` (the Citations feature text and the Files section)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: version 1.7.0, with docs that describe it.

- [ ] **Step 1: Bump**

Run: `npm run bump -- minor`
Expected: the output reports 1.6.1 → 1.7.0 in `extension/manifest.json`, `package.json`, `package-lock.json` and ROADMAP's "Current version" line.

- [ ] **Step 2: Hand-edit what the bump leaves**

- **`extension/manifest.json` `version_name`:** `"1.7.0 — full-page proof screenshots"`.
- **`CHROMEWEBSTORE.md`:** add a row at the top of the Version History table:
  `| 1.7.0 | 2026-MM-DD (main) | Full-page proof screenshots in the Citations tab: the SCREENSHOT tile scrolls and stitches the whole page (capped at Chrome's 32,767 px image limit, and labelled when capped), with a "Visible area only" option. No permission, host or content-script change; the page helper is injected on demand with the existing activeTab + scripting. | Draft |`
  Replace `MM-DD` with the merge date.
- **`ROADMAP.md`:** add a `## Changelog — v1.7.0 (2026-MM-DD)` section above `## Changelog — v1.6.1`. Write it in the style of the 1.6.1 entry. One bullet describes the feature and names the three new modules. One bullet says there's no permission change. One bullet gives the limits: 2 captures a second, the 32,767 px / 100M px caps, and the honest labels.
  In `## v1.7 — feature candidates`, remove the "Full-page screenshot stitching" bullet and add the line `Shipped in 1.7.0: full-page proof screenshots.` under the section's intro.
- **`preview/DESIGN-GAPS.md`:** under "### Full-page capture", replace **Shipped instead** and **Needs decision** with:
  `**Shipped in 1.7.0:** scroll-and-stitch in the popup, full page by default with a "Visible area only" option; pages taller than Chrome's image limit are captured from the top and labelled "first N of M px".`
- **`MANUAL_SMOKE_TEST.md` §8:** add:
  `- [ ] **Full-page proof** — on a directory listing with a sticky header (Yelp or BBB), Citations → SCREENSHOT: progress counts up, the PNG shows the header once with no seams, the page scrolls back to where it was, and the label reads FULL PAGE with the PNG's real size. Cancel mid-capture restores the page. "Visible area only" gives a VIEWPORT proof.`
- **`README.md`:**
  - Where the Citations tab's screenshot is described, say it captures the full page, with a visible-area option.
  - In the `## Files` section, list `src/lib/fullpage-plan.js`, `src/content/page-scroller.js` and `src/popup/fullpage-capture.js` next to their siblings, one line each, in the section's existing format.

- [ ] **Step 3: Run the gates**

Run: `npm test && npm run check:zip && node scripts/check-version-bump.mjs origin/main`
Expected:
- all tests pass, including `version.test.js`, which checks that the manifest, `version_name`, `package.json`, the lockfile, ROADMAP and the CHROMEWEBSTORE row agree on 1.7.0
- zip OK
- the bump check passes

- [ ] **Step 4: Check it in real Chrome**

1. Load `extension/` unpacked in `chrome://extensions`, or reload it if it's already loaded.
2. Run the new §8 line on a long directory listing with a sticky header.
3. Also check a short page: the label reads `FULL PAGE`, in one frame.
4. Also check a page that scrolls inside a panel, such as Google Maps: the label reads `VIEWPORT · page scrolls inside a panel`.
5. Open the service worker console and confirm it shows no errors from our code.
6. Record anything that differs from the spec as a finding before merging, not as a silent fix.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json package.json package-lock.json ROADMAP.md CHROMEWEBSTORE.md preview/DESIGN-GAPS.md MANUAL_SMOKE_TEST.md README.md
git commit -m "release: 1.7.0 — full-page proof screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
