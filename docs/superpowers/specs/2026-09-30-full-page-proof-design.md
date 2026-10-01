# Full-page proof screenshots — design

**Status:** design approved in chat on 2026-09-30. Ships as **1.7.0**, the first
ROADMAP "v1.7 — feature candidates" item ("Full-page screenshot stitching").

## Problem

The Citations tab's SCREENSHOT tile calls `chrome.tabs.captureVisibleTab`
through the service worker (`captureScreenshot` action,
`src/background/service-worker.js`). It captures only the visible viewport and
says so (`VIEWPORT · W×H · size`). The design mockup (1n) asked for
`FULL PAGE · 1440×2100`, which needs scroll-and-stitch
(`preview/DESIGN-GAPS.md` → "Full-page capture").

## Decisions (owner, 2026-09-30)

| Question | Decision |
|---|---|
| Where the proof goes | **Local download only**, as today. No upload, no site endpoint, no schema field, no disclosure change |
| Full page vs viewport | **Full page by default**, with a "visible area only" option |
| Pages longer than the canvas limit | **Cap from the top and say so** in the label |
| Technique | **Scroll and stitch with `captureVisibleTab`** from the popup. No new permission (`activeTab` already covers it). The `debugger` API was rejected: new permission, a "started debugging this browser" bar, and store-review risk |

## Units

### 1. `src/lib/fullpage-plan.js` — pure planning (dual export, `globalThis.SBWFullPage`)

`planCapture({ scrollHeight, viewportWidth, viewportHeight, dpr, innerScroll = false, maxCanvasPx = 32767, maxPixels = 100_000_000 })`
returns:

```js
{
  mode: 'fullpage' | 'viewport',   // 'viewport' when the window can't scroll
  reason: null | 'inner-scroll',    // why mode fell back to viewport
  width,                            // output px = round(viewportWidth * dpr)
  height,                           // output px, after the cap
  pageHeight,                       // CSS px measured at start
  capturedCssHeight,                // CSS px actually covered
  truncated,                        // capturedCssHeight < pageHeight
  frames: [ { scrollY, srcY, srcH, destY } ]   // srcY/srcH/destY in output px
}
```

- The cap is the lower of `maxCanvasPx` and `floor(maxPixels / width)`, in output px.
- Each frame scrolls to `k * viewportHeight`. The last frame scrolls to
  `min(k * viewportHeight, capturedCssHeight - viewportHeight)`, and its
  `srcY` crops the rows the previous frame already drew.
- Rounding is computed from CSS px once per frame and carried in output px, so
  frames abut with no 1px gap or overlap at fractional `dpr` (1.25, 1.5).
- When `scrollHeight <= viewportHeight + 2`: if an inner element scrolls (`innerScroll` from `fpPrepare`), `mode: 'viewport', reason: 'inner-scroll'`; otherwise the page simply fits, and the result is a one-frame `mode: 'fullpage'` of `viewportHeight`.

### 2. `src/content/page-scroller.js` — injected on demand (like `nap-extractor.js`)

A guard (`window.__sbwPageScrollerLoaded`) makes a double injection harmless.
It answers `chrome.runtime.onMessage` actions:

| Action | Does | Returns |
|---|---|---|
| `fpPrepare` | Saves `scrollX/Y` and the inline `scroll-behavior` of `html` and `body`, sets both to `auto`, and measures | `{ scrollHeight, viewportWidth, viewportHeight, dpr, innerScroll }` (`scrollHeight` = max of `documentElement.scrollHeight` and `body.scrollHeight`; viewport = `documentElement.clientWidth/innerHeight`; `innerScroll` = true when some element at least half the window tall has `overflow-y: auto\|scroll` and more content than it shows) |
| `fpScrollTo` `{ y }` | `scrollTo(0, y)`, waits two animation frames plus 150 ms for lazy content to settle | `{ scrollY }` actually reached |
| `fpHideFixed` | Finds elements with computed `position` `fixed` or `sticky` that are visible, saves their inline `visibility` (value and priority), and sets `visibility: hidden !important` | `{ hidden: n }` |
| `fpRestore` | Puts back every saved inline style and the scroll position; clears the watchdog | `{ ok: true }` |

**Watchdog:** each message re-arms a 5 s timer, and when it fires the helper
runs `fpRestore` itself. That covers the popup closing mid-capture.

### 3. `src/popup/fullpage-capture.js` — the orchestrator (dual export, `globalThis.SBWFullPageCapture`)

`captureFullPage({ tabId, windowId, send, capture, getActiveTabId, draw, now, sleep, onProgress, signal })`

- Its dependencies are all passed in, so tests need neither Chrome nor a canvas.
  - `send`: messages the tab.
  - `capture`: wraps `chrome.tabs.captureVisibleTab`.
  - `draw`: creates the canvas, draws a frame and encodes the PNG.
- Flow:
  1. Inject `page-scroller.js` and send `fpPrepare`.
  2. Build the plan with `planCapture`. If `mode === 'viewport'`, take one capture and finish.
  3. For each frame:
     1. Scroll with `fpScrollTo`.
     2. Before the second frame only, send `fpHideFixed`.
     3. Confirm `getActiveTabId(windowId) === tabId`. If not, abort with `tab-changed`.
     4. Wait until at least **550 ms** have passed since the last capture.
     5. Capture and draw.
     6. Report `onProgress(i + 1, frames.length)`.
  4. Always send `fpRestore`, in a `finally` block.
- **Rate limit:** on an error containing `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`,
  wait 1 s and retry once. A second failure aborts.
- **Output:** `{ blob, width, height, mode, reason, pageHeight, capturedCssHeight, truncated }`.
- **Errors** use codes `tab-changed | capture-failed | canvas-failed | cancelled`,
  each with a message.

### 4. `src/popup/citations-tab.js` — interface

- **SCREENSHOT tile:** the sub-line becomes "Download full-page proof of this
  listing". A small text button under the tile row, "Visible area only", keeps
  the old one-frame path (the `captureScreenshot` action is unchanged).
- **Loading state:** shows "Capturing 3 of 9…" and a **Cancel** button, which
  aborts through `signal`. The page is restored.
- **Proof header labels:**
  - `FULL PAGE · 1440×9800 · 3.1 MB`
  - `FULL PAGE · first 16,000 of 41,200 px · …` when truncated (CSS px, rounded to the nearest 100)
  - `VIEWPORT · page scrolls inside a panel · …` for `inner-scroll`
  - `VIEWPORT · …` for the visible-area option
- **Download:** the download chip uses `URL.createObjectURL(blob)`, which is
  revoked when the result is closed or replaced. The thumbnail uses the same URL
  with `object-fit: cover; object-position: top`, so a tall image shows its top.
- **Errors:**
  - `canvas-failed`: offer "Capture visible area instead".
  - `tab-changed`: "You switched tabs, so the capture stopped."
- **Loading:** `popup.html` loads `../lib/fullpage-plan.js` and `fullpage-capture.js` before
  `citations-tab.js`, as classic scripts; `npm run check:zip` then covers both.
- **Filing:** `runReport` is unchanged. It still records
  "screenshot downloaded locally" when the chip was clicked.

## Not changing

- the service worker
- manifest permissions and host permissions
- the site API
- the citation payload

The new content script is injected with `chrome.scripting.executeScript`
(`scripting` and `activeTab` are already granted). It is not a manifest
`content_scripts` entry.

## Testing

- **`tests/unit/fullpage-plan.test.js`:**
  - short page (viewport mode)
  - exact multiple of the viewport
  - an overlapping last frame
  - `maxCanvasPx` cap and `maxPixels` cap (`truncated`, `capturedCssHeight`)
  - `dpr` 1, 2 and 1.5 (`destY + srcH` of each frame equals the next frame's `destY`; total equals `height`)
- **`tests/unit/page-scroller.test.js`** (jsdom):
  - prepare/restore round-trips scroll and inline styles, including pre-existing `!important` values
  - hide affects fixed and sticky elements only
  - the watchdog restores after 5 s of silence, with fake timers
  - a double injection is harmless
- **`tests/unit/fullpage-capture.test.js`:**
  - call order (scroll → hide once → capture)
  - 550 ms spacing, with fake timers
  - one retry on the rate-limit error
  - `tab-changed` abort
  - cancel
  - `fpRestore` is sent on success, on error and on cancel
- **`preview/stub.js`:** a `captureVisibleTab` stub, so the harness shows progress,
  the full-page label, the truncated label and the inner-scroll label.
- **`MANUAL_SMOKE_TEST.md` §8:** on a directory listing with a sticky header
  (Yelp or BBB), check that:
  - the header appears once
  - there are no seams
  - the page returns to where it was
  - the label matches the image
  - Cancel restores the page
- **Gates:** `npm test`, `npm run check:zip`, and the version-bump check
  (`npm run bump -- minor` → 1.7.0, plus the `version_name` summary, the
  CHROMEWEBSTORE.md row and the ROADMAP changelog).

## Out of scope

- uploading proof or attaching it to the citation
- scrolling inner panels
- capturing content that loads after the start measurement
- the `debugger` API
