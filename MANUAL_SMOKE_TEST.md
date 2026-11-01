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
  - [ ] Searching for "local seo" returns it (words match the URL, host or title, whatever the separator), and a search with no matches says "No captures match …", not "No captures yet" (#62)
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
- [ ] A PDF rendered in Chrome (any public PDF URL): "NOT A WEB PAGE · This tab shows a PDF", no score (#63)
- [ ] An XML sitemap (e.g. `https://seobandwagon.com/sitemap.xml`) and a raw SVG file: "NOT A WEB PAGE" naming it, never stuck on "Analyzing page…" (#89)
- [ ] A page with a very long title (e.g. some Wikipedia article pages)

### 8. 1.6.x and 1.7 surfaces

On a real content page (e.g. `https://seobandwagon.com/local-seo`) unless noted:

- [ ] **Rate us** — the popup footer's RATE US ★ and the options page's "Rate it on the Chrome Web Store" both open the store's reviews tab for SEO Bandwagon. A long page's full-page proof shows "Building the image…" before the proof card
- [ ] **Link check** — "Check N links" runs only on click. The first time, it asks for the optional site access, and the request can be declined. Result chips (ok / redirect / 4xx / 5xx / timeout / network / can't check) add up, and "Export CSV" downloads
- [ ] **Link check outlives the popup** (#47) — on a page with 100+ links (e.g. a long Wikipedia article), start a check, click the page so the popup closes, wait a moment and reopen: it shows the progress so far or the finished results, not "Check N links". Switch to another tab and back: same. Cancel stops it; "Check again" re-reads the page's links. On seobandwagon.com/seo-chrome-extension the Chrome Web Store links read **Can't check**, not NETWORK (#46).
- [ ] **Indexability** — shows an indexable / not-indexable verdict, the redirect chain and headers. Tracing `http://` → `https://` for a redirecting URL lists every hop
- [ ] **Hreflang** — on a page with hreflang tags (e.g. a multi-language site), the alternates list shows return-tag status; the page's own entries read SELF (#91), and the same page opened with `?utm_source=x` reads the same, with Indexability still INDEXABLE (#92)
- [ ] **Rendering** — raw-HTML vs rendered-DOM comparison loads, and the user-agent switcher changes the result for this tab only
- [ ] **Structured data** — JSON-LD / Microdata / RDFa items listed with rich-result eligibility
- [ ] **Right-click menu** — "SEO Bandwagon tools" opens the chosen tool for this page
- [ ] **SERP overlay** — `https://www.google.com/search?q=local+seo`: each result has a bar below its description (not between title and description) with its position (`#1`, `#2`…; the tooltip gives the position counting everything on the page), and "Copy results", "Export CSV" and "Copy PAA" work. **Paste after each Copy** (into a text editor): the questions / the result rows must be there, since a "Copied" flash alone isn't proof (#37). Repeat in a signed-out (guest) window, where Google links results through `/goto?url=` (#41), and on `seo stats chrome`, where Chrome Web Store listings must appear as results (#42). The CSV includes description, site name and breadcrumb. The location simulator changes the results
- [ ] **Collect pages** (#45) — on `https://www.google.com/search?q=best+crm+for+nonprofits`: loading a page adds nothing by itself. Click **Add page 1**, then **Next page →**, and repeat to page 5: the line under the buttons counts pages, results and repeats left out. **Export collected CSV**: one row per URL, `Absolute position` 1…N with no gaps, `Page` and `Position` per page. Go back to page 1 and add it again: "Added again: N changed", and moved rows say where they were in `Collection notes`. Skip a page (add 1 and 3): rows from page 3 have a blank `Absolute position` and a note. **Web results only** opens Google's Web tab (`udm=web`) and starts a separate collection. The popup on a results page says what's been collected.
- [ ] **SERP overlay sends nothing** (#50, 1.10.2) — signed in or out, open a results page with DevTools on the extension's service worker (chrome://extensions → Inspect views): no request to `seobandwagon.com` and no "Access to storage" errors in the page console; no bar shows "Score", "captures" or "Connect your account". Open the popup there: it says "Found N results…" (#56). Export CSV: the file name ends `-p1-<date>-<hhmmss>.csv` and the last six columns are "Absolute position (approx.)", "Absolute position", "Collection notes", "Position counting everything", "URL known" and "Place name" (#45, #55, 1.10.2); each row's Position and Position counting everything match its bar.
- [ ] **Side panel Page checks** (#49) — open the side panel (e.g. from the popup), click "Page checks →": the page-checks panel replaces it for that tab; its Citations link goes back.
- [ ] **Human in the loop** (S53, S55) — with Page checks open, reload the page and follow a link: the panel says "Click "Scan this page" to check it." and History gains no capture; "Scan this page" scans. Without "access to all sites", a tab whose toolbar icon wasn't clicked offers "Allow access to analyze other tabs" (Chrome's prompt) and reads nothing until allowed.
- [ ] **Analyze stays on Google** (1.10.2) — on `https://www.google.com/search?q=local+seo`, with "access to all sites" **not** granted (chrome://extensions → Details → Site access → On click), click a bar's Analyze: a small SEO Bandwagon window asks for access with the reason. Allow it: the window closes and the result is analyzed; Google stays the active tab throughout, and a new tab appears beside it. Under the bar a line reads "Analyzing in a background tab…", then "On-page checklist: N/100 (G) · N issues" with **Open report**, which switches to that tab with the popup open on its analysis. Click Analyze on three other results quickly: each gets its own tab and its own line. Click Analyze again on the first: it reuses its tab (no new tab). Revoke access and click Analyze, then **Not now**: the line says Analyze needs access, and nothing opens. A result Google hides behind `/goto` (signed out of Google) still analyzes the page it lands on.
- [ ] **Results-page numbers** (1.10.2) — expand two People also ask questions: the bars' positions and Copy results' count don't change. Signed out of Google, a result shown with no URL line keeps its place as "unknown site". **Compare in two tabs** opens two tabs. **Web results only** goes to Google's Web tab (`udm=14`). The Location menu lists Dallas, Fort Myers, Minneapolis, Raleigh, Sarasota and Tampa (no hyphenated metros), and Open with this location shows that city's results. On `https://www.google.co.in/search?q=seo` the bars and toolbar show. Collect, signed out of Google: two results from one site on a page are both kept, "URL known" reads "site only" for them, and "Place name" names the simulated location.
- [ ] **Analyze linked page** (S29) — right-click a link → Analyze linked page: without "access to all sites", the popup on the new tab reads "NO ACCESS TO THIS TAB YET" with the Allow button (not "CAN'T READ THIS PAGE"); allowing it analyzes the page.
- [ ] **Search Console** (Performance report, on a property you own): row icons ("open in Google", "open in private window") appear on the **Queries** tab only, and disappear when you switch to Pages. With "Compare" dates on, each metric card and changed cell gets a % badge, and nothing else changes (1.10.2) Switching Queries → Pages → Queries by clicking the tabs removes and restores the icons without any other change on the page (the worker's `webNavigation` notice). A row's "open in Google" on a country-code property (e.g. `example.co.uk`) opens `…&gl=gb&pws=0`; on a `.com` property, `…&pws=0` only.
- [ ] **Appearance** — Auto / Night / Day in Settings changes the popup, both side panels, the new tab page and Settings together
- [ ] **New tab page** (1.9.0) — a fresh profile's install shows "Replace the page you see when opening a new tab" among the warnings; updating an installed 1.8.x copy to this build disables it until the new permission is accepted. Open a new tab: the SEO Bandwagon page, with no request to `seobandwagon.com` in the service worker's network log. With no captures it says "No captures yet" and hides Next fix. Analyze two pages (one twice, after changing it), open a new tab: Recent audits lists both with the twice-analyzed one's change (green +N or red −N), Latest capture matches the popup's score and "N of 14 checks", and Next fix names the popup's first issue. Type `example.com` and Scan: the site opens in the same tab, then the popup analyzes it. Type `best plumber near me`: "Type a site address, like example.com." and nothing opens. Night / Day / Auto on the page changes the popup too, and the wallpaper follows. Signed in with a key made before the site's `progress` scope: Rank tracking says Reconnect, and Reconnect opens the api-keys page; after connecting again it shows your trackers and Tasks starts with the next fix. Against a site without `/api/extension/progress` (404), the page looks as it does signed out, and a second new tab within 10 minutes sends no request. In an incognito window the new tab is Chrome's own
- [ ] **Welcome tab** (fresh profile, first load of the unpacked `extension/`) — exactly one tab opens at `https://seobandwagon.com/seo-chrome-extension/welcome?ref=install&utm_source=chrome_extension&utm_medium=extension&utm_campaign=install`, and the page answers (not a 404). Reloading the extension at `chrome://extensions` (an update) opens nothing
- [ ] **Uninstall survey** — Remove the extension: Chrome opens `https://seobandwagon.com/seo-chrome-extension/uninstalled?ref=uninstall&v=<this version>&utm_source=chrome_extension&utm_medium=extension&utm_campaign=uninstall`, and the page answers
- [ ] **Tagged links** — PRIVACY in the popup footer, the options page's api-keys link and its Captures / Citations / Link building links, the Citations tab's "Create one →" and OPEN DASHBOARD, and the side panel's "Set your sender address" all open seobandwagon.com with `utm_source=chrome_extension&utm_medium=extension` and their surface (`popup`, `options`, `citations_tab`, `side_panel`) as `utm_campaign`
- [ ] **Full-page proof** — on a directory listing with a sticky header (Yelp or BBB), Citations → SCREENSHOT: progress counts up with a time left, the image shows the header once with no seams, a cookie banner at most once (in the first screen) and no scrollbar strip at the right edge, the page scrolls back to where it was, and the label reads FULL PAGE with the image's real size; the download is a `.jpg`. Cancel mid-capture restores the page. Start another capture and click the page (the popup closes): reopening the popup shows the progress or the finished proof (#48). Start one and switch tabs: reopening shows "You switched tabs, so the capture stopped." at once (#64). "Visible area only" gives a VIEWPORT proof.

When a new user-facing feature ships, add its check here in the same PR.

- [ ] **New tab follows the theme (1.9.5).** With no Neon theme installed, a new tab is Chrome's own (empty address bar) and the popup shows "Your dashboard on every new tab: add Neon Night or Neon Day". Install Neon Night: a new tab shows the dashboard in Night, with no appearance control; settings say "Neon Night is installed". Settings → New tab → Never: a new tab is Chrome's own. Always, with no theme: the dashboard, with the appearance control. Tick "show a search box and your most visited sites": Chrome asks once; the dashboard then shows both below it, and a search opens your own search engine.
- [ ] **Rank drops first (1.10.0).** Signed in, with a key that has the `progress` scope and a tracker with drops in the last 7 days: the new tab leads with "Rank changes · last 7 days · <domain>", on the tracker with the most drops, with a switcher when there are several (clicking one shows its drops; the count beside each name matches). Each drop shows from → to as the feed gives it (`out` when it left the checked results, with "Out of the checked results now"), the page that lost it as a full address, "Google now ranks … instead" only when the pages differ, "At N now: <domain>" when known, "Next fix for this page" only when that page was captured, and "Analyze this drop on seobandwagon.com →", which opens that keyword's drop page signed in. Gains list only keywords that went up. Tasks sit to the right; Recent audits below show each page's full address, two issues and the date; Latest capture and Next fix are gone. Below 900 px wide it is one column. Signed out the page is the 1.9 layout, with the same audit rows. One request to `/api/extension/progress` per 10 minutes, as before.
- [ ] **The account on a second device (1.10.3).** On a second Chrome profile signed in to the same Google account (sync on), with the extension connected on the first: the new tab's badge reads "Checking key" for a moment, then "Synced", and the Rank changes and Tasks cards show (1.10.2: "Signed out", no cards). Connect from seobandwagon.com with another account: the side panel, the popup's Citations tab and the new tab show the new account's businesses and email, never the old one's. With DevTools offline (or the site answering 429), open the side panel: it says it can't reach SEO Bandwagon or is rate limited, not NOT CONNECTED. Revoke the key on the dashboard, analyze a page (History marks it skipped), then Connect again from seobandwagon.com: the capture syncs at once (reconnected through Options, at the next 15-minute retry). Options → Advanced: a `…--seobandwagon.netlify.app` address is refused; `https://cf.seobandwagon.com` is accepted.
- [ ] **Citations and page history tell the truth (1.10.3).** On a Yelp listing of a business in your account whose record has a website: Check NAP shows the business's own website (not the Yelp page) and 100% when it is the record's site, with or without `https://`; on a Dentist or Plumber listing the name, address and phone come from its structured data. Click REPORT without checking first: "Checking the listing before filing…", then "CITATION FILED … at N% NAP match"; on a page with no business details, REPORT says it couldn't read the page and files nothing. The idle list reads "Latest citations · this business", newest first. Side panel → Citations with two scored citations: the footer's average is a number, never "NaN%". Link Building → Outlets: Approve/Hold/Reject on Qualified, Approve/Reject on Held, no buttons on Approved or Candidate. Popup on a page you captured before: "Page history · This page: N earlier captures"; on a never-captured page of a site you captured: "This page: no earlier captures", and no "Domain avg".

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
3. If the failure looks like the canary caught it too, check the [Actions tab](https://github.com/seo-bandwagon/seobw-extension/actions/workflows/canary.yml) — there may already be a `[canary]` auto-issue open.
