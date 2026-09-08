# Manual Smoke Test — Pre-Release Checklist

Run this checklist end-to-end before every Chrome Web Store submission. Budget: **~10 minutes.**

The automated suite (vitest + Playwright canary) covers most regressions, but nothing beats one human walking through the real popup UI on a real page once. Edge-case rendering, keyboard shortcuts, offline behaviour, and visual regressions all live here.

## Setup

1. **Fresh Chrome profile** (or guest window). Prevents stale extension state from tainting the test.
2. **Clone + pull main** — `git pull origin main`
3. **Load unpacked**: Chrome → `chrome://extensions` → Developer mode ON → Load unpacked → select the repo root.
4. **Pin the extension** to the toolbar (optional, but makes the icon click easier).

## Critical path (must pass)

### 0. Themed page-checks panel

- Click the extension icon, then open the side panel
- Click **Page checks →** in the panel footer
- Verify:
  - [ ] The panel swaps to page checks for the tab you are on
  - [ ] The host in the header matches the tab
  - [ ] Check rows show green / amber / red dots and a "N of 14 passed" heading
  - [ ] **Tools** shows Search Console, PageSpeed, Rich results, sitemap.xml, robots.txt
  - [ ] **Account** reads "Connected" with a key saved, "Signed out" without one
  - [ ] Auto / Night / Day switches this panel, the popup and the options page together
  - [ ] **Citations & link building →** swaps back to the other panel
  - [ ] Switching browser tabs re-runs the checks for the new tab


### 1. Happy-path capture against the canonical fixture

- Navigate to **`https://seobandwagon.com/local-seo`**
- Click the extension icon
- Popup should open and analysis should complete in **< 3 seconds**
- Verify in the popup UI:
  - [ ] Non-zero **SEO score** visible with a letter grade
  - [ ] **Title** section populated
  - [ ] At least one **H1** detected
  - [ ] **Links** section shows both internal + external counts
  - [ ] **Images** section shows total and missing-alt counts
  - [ ] No red error banner, no "Analysis failed" state

### 2. Backend round-trip

- Check Neon `extension_analyses` table in your DB dashboard (search by `url LIKE '%/local-seo'`, most recent)
- Verify:
  - [ ] A row was created within the last minute
  - [ ] `domain` = `'seobandwagon.com'`
  - [ ] `overall_score` is non-null and matches what the popup showed
  - [ ] `seo_score`, `content`, `meta`, `headings`, `links`, `images`, `technical` are all populated JSON blobs

### 3. Local history

- In the popup, click **History** (or open `chrome://extensions` → the extension's "history" link)
- Verify:
  - [ ] The capture from step 1 appears in the list
  - [ ] Searching for "local seo" returns it
  - [ ] Clicking it opens the capture detail

### 4. Service-worker console is clean

- `chrome://extensions` → find the extension → click **service worker** (opens DevTools)
- Console tab
- Verify:
  - [ ] No `Uncaught`, `error`, or `warn` entries from our code during the capture flow
  - [ ] (`Node.js 20 deprecation` notices from Chromium itself are fine; ignore those)

### 5. Offline graceful degradation

- DevTools → Network tab → **Offline** throttle
- Navigate to any page (e.g. `https://example.com`)
- Click extension icon
- Verify:
  - [ ] Popup still opens
  - [ ] Analysis completes
  - [ ] No error UI shown to the user
  - [ ] History still records the capture locally
- Return Network to **Online**
- Verify:
  - [ ] Extension does **not** retry the offline capture (fire-and-forget behaviour is intentional — the capture is local-only once the POST has been skipped)

### 6. Keyboard shortcut

- On any webpage, press **Ctrl+Shift+S** (Windows / Linux) or **⌘+Shift+S** (Mac)
- Verify:
  - [ ] Analysis fires on the current tab (the manifest command is `analyze-current`)

### 7. Edge-case pages don't crash the extension

For each URL below, click the extension icon and confirm the popup shows a graceful "nothing to analyze" state or handles it cleanly:

- [ ] `chrome://newtab` — extension action disabled or shows a "not supported" message
- [ ] `about:blank`
- [ ] A PDF rendered in Chrome (any public PDF URL)
- [ ] A page with a very long title (e.g. some Wikipedia article pages)

## Post-v1.2.0 additions (fill in when shipped)

When the following features ship, add their smoke checks here:

- **v1.3.0 — SERP overlay**: `https://www.google.com/search?q=local+seo` → badges under each organic result showing domain age + aggregate capture stats where available.
- **v1.3.0 — Paid-tier Authorization header**: Options page → set API Key to any non-empty string → capture a page → Network tab shows `Authorization: Bearer <key>` header on the POST to `/api/v1/captures`. Clear API Key → verify header is absent on subsequent captures.
- **v1.3.0 — `visibility` column**: after a free-tier capture, the new Neon row has `visibility = 'public'`; after a paid-tier capture (with an API key), the row has `visibility = 'private'`.

## Sign-off

- Tester: _______________
- Date: _______________
- Extension version tested: _______________
- Result: ☐ Pass  ☐ Pass with notes  ☐ Block release

Notes / observations:

```
(free text — anything unusual, even if you passed it)
```

## If something fails

1. **Don't ship.** The CWS submission can wait.
2. File an issue with:
   - Which step failed
   - What you saw vs what you expected
   - A screenshot + the service-worker console output
3. If the failure looks like the canary caught it too, check the [Actions tab](https://github.com/seo-bandwagon/seo-bw-extension/actions/workflows/canary.yml) — there may already be a `[canary]` auto-issue open.
