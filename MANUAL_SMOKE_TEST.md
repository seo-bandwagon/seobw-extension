# Manual Smoke Test — Pre-Release Checklist

Run this checklist end-to-end before every Chrome Web Store submission. Budget: **~10 minutes.**

The automated suite (vitest + Playwright canary) covers most regressions, but nothing beats one human walking through the real popup UI on a real page once. Edge-case rendering, keyboard shortcuts, offline behaviour, and visual regressions all live here.

## Setup

1. **Fresh Chrome profile** (or guest window). Prevents stale extension state from tainting the test.
2. **Clone + pull main** — `git pull origin main`
3. **Load unpacked**: Chrome → `chrome://extensions` → Developer mode ON → Load unpacked → select the `extension/` folder (not the repo root; the manifest lives in `extension/`).
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

### 2. Account sync round-trip

Needs an API key saved in Options and data collection on. Without them, captures stay local and this step is skipped.

- Open **History**
- Verify:
  - [ ] The capture from step 1 shows a **synced** badge within a minute (the `sbw-sync` alarm drains the queue)
  - [ ] It appears in the account's captures on seobandwagon.com
  - [ ] `chrome://extensions` → service worker → Network: the `POST …/api/v1/captures` carries `Authorization: Bearer <key>`

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
  - [ ] History still records the capture locally (with sync on, it shows **pending**)
- Return Network to **Online**
- Verify:
  - [ ] With sync on, the pending capture is retried and turns **synced** on a later drain. With sync off it stays local-only and nothing is sent

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

### 8. 1.6.x and 1.7 surfaces

On a real content page (e.g. `https://seobandwagon.com/local-seo`) unless noted:

- [ ] **Rate us** — the popup footer's RATE US ★ and the options page's "Rate it on the Chrome Web Store" both open the store's reviews tab for SEO Bandwagon. A long page's full-page proof shows "Building the image…" before the proof card
- [ ] **Link check** — "Check N links" runs only on click. The first time, it asks for the optional site access, and the request can be declined. Result chips (ok / redirect / 4xx / 5xx / timeout / network) add up, and "Export CSV" downloads
- [ ] **Indexability** — shows an indexable / not-indexable verdict, the redirect chain and headers. Tracing `http://` → `https://` for a redirecting URL lists every hop
- [ ] **Hreflang** — on a page with hreflang tags (e.g. a multi-language site), the alternates list shows return-tag status
- [ ] **Rendering** — raw-HTML vs rendered-DOM comparison loads, and the user-agent switcher changes the result for this tab only
- [ ] **Structured data** — JSON-LD / Microdata / RDFa items listed with rich-result eligibility
- [ ] **Right-click menu** — "SEO Bandwagon tools" opens the chosen tool for this page
- [ ] **SERP overlay** — `https://www.google.com/search?q=local+seo`: the stats bar shows, and "Copy results", "Export CSV" and "Copy PAA" work. **Paste after each Copy** (into a text editor): the questions / the result rows must be there, since a "Copied" flash alone isn't proof (#37). Repeat in a signed-out (guest) window, where Google links results through `/goto?url=` (#41), and on `seo stats chrome`, where Chrome Web Store listings must appear as results (#42). The CSV includes description, site name and breadcrumb. The location simulator changes the results
- [ ] **Search Console** (Performance report, on a property you own): row icons ("open in Google", "open in private window") appear on the **Queries** tab only, and disappear when you switch to Pages. With "Compare" dates on, each metric card and changed cell gets a % badge, and nothing else changes
- [ ] **Appearance** — Auto / Night / Day in Settings changes the popup, both side panels and Settings together
- [ ] **Welcome tab** (fresh profile, first load of the unpacked `extension/`) — exactly one tab opens at `https://seobandwagon.com/seo-chrome-extension/welcome?ref=install&utm_source=chrome_extension&utm_medium=extension&utm_campaign=install`, and the page answers (not a 404). Reloading the extension at `chrome://extensions` (an update) opens nothing
- [ ] **Uninstall survey** — Remove the extension: Chrome opens `https://seobandwagon.com/seo-chrome-extension/uninstalled?ref=uninstall&v=<this version>&utm_source=chrome_extension&utm_medium=extension&utm_campaign=uninstall`, and the page answers
- [ ] **Tagged links** — PRIVACY in the popup footer, the options page's api-keys link and its Captures / Citations / Link building links, the Citations tab's "Create one →" and OPEN DASHBOARD, and the side panel's "Set your sender address" all open seobandwagon.com with `utm_source=chrome_extension&utm_medium=extension` and their surface (`popup`, `options`, `citations_tab`, `side_panel`) as `utm_campaign`
- [ ] **Full-page proof** — on a directory listing with a sticky header (Yelp or BBB), Citations → SCREENSHOT: progress counts up, the PNG shows the header once with no seams, a cookie banner at most once (in the first screen) and no scrollbar strip at the right edge, the page scrolls back to where it was, and the label reads FULL PAGE with the PNG's real size. Cancel mid-capture restores the page. "Visible area only" gives a VIEWPORT proof.

When a new user-facing feature ships, add its check here in the same PR.

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
