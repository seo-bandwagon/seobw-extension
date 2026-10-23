# SEO Bandwagon Extension — Roadmap

**Current version: 1.9.4** · Manifest V3 · vanilla JS, zero dependencies, no build step

Instant on-page SEO analysis, local-SEO citation management (NAP checks, proof
screenshots, campaign triggers), and link-building review, synced to your SEO
Bandwagon account.

---

## Versioning policy

Semantic-ish, three digits, driven by what the user would notice:

| Change | Bump | Example |
|---|---|---|
| Bug fix, copy tweak, style polish, doc change bundled with a fix | **Patch** | 1.5.0 → 1.5.1 |
| New user-facing feature | **Minor** | 1.5.x → 1.6.0 |
| Rework that resets expectations (rare) | **Major** | 1.x → 2.0.0 |

- **Every PR that changes what ships bumps the version.** "What ships" is
  anything under `extension/` except Markdown. A fix or small edit bumps the
  patch digit (1.6.0 → 1.6.1); only a feature from the feature list below bumps
  the minor. Stay on 1.7.x until the next feature from that list lands (1.8.0).
- **Bump with `npm run bump -- patch`** (or `minor`, or an explicit `x.y.z`). It
  writes `extension/manifest.json` (`version` and the number leading
  `version_name`), `package.json`, `package-lock.json`, the "Current version"
  line above and the "Version" line at the top of README.md. Then edit `version_name`'s summary, add the
  `CHROMEWEBSTORE.md` Version History row, and add a changelog section here.
- **CI enforces it.** `scripts/check-version-bump.mjs` fails a pull request that
  changes `extension/` without raising the version, and
  `tests/unit/version.test.js` fails when the five files disagree or the store
  file has no row for the current version. Until 2026-09-24 only the manifest
  was bumped; seven PRs after 1.6.0 changed shipped code without a bump, and
  `package.json` / `package-lock.json` had drifted to 1.5.0 / 1.4.0.
- The popup footer and side panel header read the version via
  `chrome.runtime.getManifest()`.
- Docs-only changes (like this file) don't bump anything.
- Tag each version submitted to the store: `git tag v1.7.0 <merge commit>`.

---

## Changelog — v1.9.4 (2026-10-23)

Clicking the icon on a page Chrome never lets an extension script (its own
pages, the new tab, other extensions' pages, the Chrome Web Store) left an
entry on `chrome://extensions` → Errors: "Analysis error: Could not establish
connection. Receiving end does not exist" (#129, from the owner's browser).
The popup swallowed the failed injection as "already injected", then sent the
analyze message to a tab with nothing listening, and logged Chrome's refusal
with `console.error`.

- **Those pages are named by address before anything is tried**
  (`SBWAnalysisErrors.unreadablePage`): the popup says why in plain words, with
  its own line for the Chrome Web Store and for a file while "Allow access to
  file URLs" is off, and logs nothing. Before, it said "Try refreshing", which
  can't help there.
- **A web page that still refuses the analyzer logs the injection's own
  error**, not the "Receiving end does not exist" that followed it.
- The side panel's Scan (`analyzeTab`) uses the same check, so a Chrome Web
  Store tab gets the store's line instead of "Reload it, then scan again".
- No permission, host or content-script change; no data-use change.

---

## Changelog — v1.9.3 (2026-10-21)

Signed in, Google links results directly instead of through `/goto`, and on
that layout two things on the "seo bandwagon" page counted as organic results
(`tests/fixtures/serp-google-social-profiles.html`, saved signed in): the five
sitelinks under result 1 and the AI Overview's own "AI Mode reply for seo
bandwagon" heading. `parseResults` returned 11 rows: seobandwagon.com seven
times, then LinkedIn at 8 instead of 2. Signed out the same blocks link through
`/goto` with no breadcrumb and were dropped only because they can't be placed,
so signed-out exports looked right.

- **Sitelinks count as part of their result**, as DataForSEO counts them. They
  sit in a table beside the result's title block rather than inside it, so the
  1.0 containment check missed them. Google wraps a result and its sitelinks in
  one `[data-rpos]` unit, an attribute rather than an obfuscated class, so a
  second h3 in an accepted result's unit is skipped. Where a page has no
  `data-rpos` (the 2026-09-16 commercial fixture), a block with no URL line and
  no site name on the same site as the result just above is a sitelink; a real
  second result from that site has both and is kept.
- **The AI Overview is left out.** Signed in, it sits inside `#rso` as
  `[data-subtree="aimc"]`, and its heading has no link, so it borrowed the
  answer's first citation. That container joins the rejected surfaces.
- The commercial, `/goto` and `site:` fixtures return exactly what they did in
  1.9.2; the commercial page's results are now pinned by a test.

---

## Changelog — v1.9.2 (2026-10-21)

Signed out, Google shows a social profile as "LinkedIn · SEO Bandwagon" over
"200+ followers": no URL breadcrumb, and a `/goto` link that can't be decoded.
`resolveResultUrl` placed such a result by its site name only for Reddit,
YouTube and Quora, so LinkedIn, Facebook and Instagram profiles were dropped
from the overlay, Copy and both exports, and every later position moved up.
Seen live on 2026-10-21 for "seo bandwagon" in Brave: page 1 showed LinkedIn
second, and the export held 4 rows, none of them linkedin.com, facebook.com or
instagram.com, which paid rank checks of the same search place at 2, 3 and 5.

- **`SITE_NAME_DOMAINS`** adds linkedin, facebook, instagram, tiktok and
  pinterest, each a name that maps to exactly one site. The row carries the
  site's origin and `urlResolved: false`, as Reddit's does.
- A name that is not one known site is still dropped rather than guessed.

---

## Changelog — v1.9.1 (2026-10-18)

The new tab page's account cards. Owner ruling 2026-10-18, verbatim: "Option
A: derive tasks from rank data and audits, as the endpoint plan recommends.
Build the progress endpoint that way."

- **Rank tracking** (signed in): per tracker, how many keywords sit in the top
  10 and the top 3 and how many moved up or down over 7 days, and the biggest
  movers, from the site's new `GET /api/extension/progress` (scope `progress`).
- **Tasks** (signed in): the next fix from the latest capture first, then the
  tasks the site derives from rank data: a keyword that left the top 10,
  failed or repeatedly missed checks, a tracker with no Search Console
  property. The separate Next fix card hides while Tasks is on screen.
- **At most one request every 10 minutes**: `accountProgress()` keeps each
  answer, refusal or 404 in `chrome.storage.session` (`sbwProgress`); a network
  failure is retried after a minute, so a request cut off when the tab moves
  on does not hide the cards for ten. Signed out, or with sync off, nothing is
  sent.
- **Works whichever ships first**: a 403 (a key minted before the `progress`
  scope) shows Reconnect, linking to the api-keys page; a 404 or a network
  failure (a site without the route) leaves only the local cards, as in 1.9.0.
- Links go through `siteUrl()` with a new `new_tab` surface.

---

## Changelog — v1.9.0 (2026-10-18)

A feature: the new tab page. Owner ruling 2026-10-18, verbatim: "Reverse the
2026-09-07 ruling: port the designed new-tab page into the main extension,
showing progress and tasks, and scope the API endpoint it needs." The
2026-09-07 ruling had declined the new-tab override and `management`; the new
tab page needs only the first, so `management` stays out.

- **What it shows**: up to five recent audits (newest capture per page, with
  the change since that page's previous capture), the latest capture's score,
  grade and "N of 14 checks", a local history line, and the **next fix**: the
  analyzer's first issue on that capture, with fix text built from the page's
  own numbers and a tool link where one fits. Ported from the Chrome-theme
  design package's new tab onto the shipped tokens, like the panel was.
- **No request on open**: `recentAudits()` reads the newest 50 `capture_*`
  keys (`chrome.storage.local.getKeys()` where Chrome has it), so a new tab
  opens without reading every stored capture. The design's account history
  line was not ported: it would send a request on every new tab, and the popup
  already shows it. Account-level progress and tasks need a website endpoint,
  scoped but not built.
- **Scan box**: a typed site opens in the same tab through the 1.8.4
  analyze flow (`analyzeResult`, now with `sameTab`; `analyze-link.js`
  `open(url, { tabId })`), and the popup analyzes it. A person's submit starts
  it. Words that are not an address get "Type a site address", never a search
  (Chrome Web Store: a new tab page must not change the user's search).
- **Appearance**: Night, Day and Auto, shared with the popup, panels and
  options. The page draws the Neon Night and Neon Day 1.0.1 wallpapers
  (seobw-themes, 3840 × 1080) as WebP, 53 KB and 68 KB, bottom-centred and
  unscaled the way Chrome places a theme's, because an extension's new tab
  hides the theme's own wallpaper. A footer link names the matching theme.
- **Install warning**: 1.9.0 adds "Replace the page you see when opening a new
  tab", so the update disables existing installs until the user accepts it
  (CHROMEWEBSTORE.md, Permissions Justification).

---

## Changelog — v1.8.4 (2026-10-17)

A fix on Google results pages. No permission, host or content-script change;
nothing new is sent.

- **Analyze runs the analysis**: each result bar's Analyze link opened the
  result in a new tab and stopped there; the popup analyzed it only after a
  separate click on the icon. A plain click now asks the worker to open the
  result and, once the page it lands on has loaded, opens the popup on it,
  which analyzes it. Ctrl/Cmd/Shift/Alt and middle clicks stay plain links,
  and an overlay orphaned by an extension reload falls back to the link.
- **One flow for both entry points**: `src/lib/analyze-link.js` opens the tab,
  waits for `complete` on a page that is not Google's redirect (`/goto`,
  `/url` on a Google host; a signed-out results page links every result
  through one), opens the popup 500 ms later, and stops waiting after 60 s.
  The context menu's "Analyze linked page" now uses it too, so a `/goto` link
  there no longer opens the popup on Google's redirect page.
- **A person starts every scan** (owner's rule 2026-10-14) still holds: each
  analysis follows one click on one result. Without "access to all sites"
  the popup on the new tab offers "Allow access to analyze other tabs"
  (S29); after that grant, Analyze runs straight through.

---

## Changelog — v1.8.3 (2026-10-17)

A development fix; the store package is the same as 1.8.2's apart from the
version. No permission, host or content-script change; data use unchanged.

- **An unpacked copy has the store ID**: `extension/manifest.json` carries the
  store item's public key as `"key"` (owner ruling 2026-10-17), read from the
  1.7.7 package Google's update server serves; its SHA-256 gives
  `dphmaddiedhkejfhabkfdenfphjljioj`. Before, Chrome derived an unpacked
  copy's ID from its folder path (`cmhdcep…` for the main checkout), so
  `seobandwagon.com/dashboard/api-keys`, which pings the store ID over
  `externally_connectable`, answered "Extension not detected" to a running
  copy ("Could not establish connection. Receiving end does not exist."),
  and settings were lost whenever the extension was loaded from another
  folder (seen 2026-10-01 and 2026-10-17).
- **The store package leaves it out**: `scripts/build-zip.mjs`'s
  `packageManifest` drops the `"key"` line and keeps every other byte of the
  manifest; it throws if the key is not on a line of its own. `check:zip`
  fails if the packaged manifest carries `"key"`.
- An unpacked copy and the store copy can no longer sit in one profile
  together, and the first load after this starts with empty settings
  (stored under the old ID). README → "Load unpacked" says so.

---

## Changelog — v1.8.2 (2026-10-16)

A fix for signed-out users on Google. No permission, host or content-script
change; data use unchanged.

- **"Connect your account" no longer opens a blocked page**: signed out (no
  API key, or a rejected one), each result's bar on a Google results page
  links "Connect your account". The link pointed at the extension's Options
  page, `chrome.runtime.getURL('src/options/options.html')`, but the overlay
  is a content script, so the click is a navigation from google.com to an
  extension page, which Chrome blocks unless the page is web-accessible.
  Every click landed on "… is blocked / This page has been blocked by Chrome /
  ERR_BLOCKED_BY_CLIENT". Users reported it as an error when they log in.
  The link now opens `seobandwagon.com/dashboard/api-keys` (tagged
  `utm_campaign=serp_overlay`, a new surface), which signs the user in if
  needed and connects the extension in one click through
  `externally_connectable`. The worker builds the URL from the stored API
  URL, so staging and localhost keep working, and sends it with the
  overlay's `no_key`/`unauthorized` reply (`src/lib/serp-stats.js`). Without
  a usable URL the bar shows the words unlinked. Options stays
  non-web-accessible on purpose: a web-accessible page lets any site detect
  the extension.
- **Guard**: `tests/unit/web-page-links.test.js` (new) fails when a content
  script or an injected file builds a `chrome-extension://` URL, or when the
  manifest makes anything web-accessible.
- Live, in Chromium with the unpacked extension and a fixture results page
  served at a google.com/search URL: 1.8.1's link landed on
  `chrome-error://chromewebdata/` reading "… is blocked … ERR_BLOCKED_BY_CLIENT";
  1.8.2's opened the connect page. Production answers that URL, signed out,
  with a 307 to `/auth/signin` carrying it as `callbackUrl`.

## Changelog — v1.8.1 (2026-10-14)

A lighter package. No permission, host, content-script or behaviour change.

- **Comments stay out of the store zip**: about 29% of the shipped code was
  comments (241 KB of 824 KB in 1.8.0), and every user downloads every byte.
  `npm run zip` now runs `scripts/build-zip.mjs` (new): JavaScript and CSS go
  through esbuild's parser with no minification, so names, line structure and
  formatting stay readable for store review and only comments (and quote
  style) change; HTML comments are removed; the manifest, icons and fonts
  are copied byte for byte. The zip is 222 KB, down from 327 KB (858 KB →
  629 KB unpacked). The source keeps its comments; `KEEP_COMMENTS=1` packages
  it as is. esbuild is a dev dependency only. A test builds the package and
  checks its file list, that comments are gone, that code that looks like a
  comment (URLs, regular expressions) survives, and that binary files are
  untouched. Live checks on the stripped package matched 1.8.0 throughout.
- **Dead code**: the worker's `getLocalCaptures` message handler (nothing has
  sent it since History reads storage itself) and the popup's unused
  `dataRowHtml` helper are removed.

## Changelog — v1.8.0 (2026-10-14)

The first feature of the 1.8 line: **collect Google results pages (#45)**.
No permission, host or content-script change.

Google ignores `&num=` (tested 2026-10-13), so checking a keyword's top 50
means five pages, and every page numbers its results from 1. Pages also
overlap and reshuffle between loads. The issue proposed a "Capture top N"
action that walked the pages itself; the owner's rule (2026-10-14) is a
human in the loop, since Google's terms rule out automated scraping, so
nothing here loads or walks a page on its own:

- **Add page N** (the overlay's new "Collect pages" row) adds the page you're
  on. **Next page →** is Google's own Next link (`#pnnext`); **Web results
  only** looks up Google's own Web tab link when clicked (`udm=web` today;
  it sits in the tab row's "More" menu, filled in after load) and its pages
  collect separately.
- `src/lib/serp-collect.js` (new) keys a collection by query, `gl`, `hl`,
  `uule` and `udm`, keeps up to 10 pages ordered by Google's offset, and
  combines them: deduped by URL in page order (a repeat from an earlier page
  is left out and counted), an exact absolute position while every earlier
  page was added (blank after a gap, with a note), and, when a page is added
  again, which results moved and from where (the second pass that shows how
  stable the page is). The worker keeps collections in
  `chrome.storage.session` (`serpCollect`, 20 searches per session); a
  content script can't use session storage itself (#50).
- **Copy collected** / **Export collected CSV**; the popup on a results page
  says what's been collected for that search. Every export gains
  **Absolute position** (on page 1 alone, the position; blank on a later
  page on its own) and **Collection notes**, after the existing columns. The
  overlay's Copy results now builds its table from the CSV's own column list
  (`SBWSerp.resultsToTsv`) instead of a second copy of it.
- Live, `best crm for nonprofits`, signed out, five pages added by click:
  47 results parsed, 8 repeats left out, 38–39 unique results with exact
  positions 1…N. Two runs minutes apart swapped #1 and #2 and held 8 vs 9
  results on page 1, which is the reshuffling #45 described. The Web tab
  parsed 10 of 10.

## Changelog — v1.7.9 (2026-10-14)

Fixes from the 2026-10-12 static review (S1–S63), each confirmed at runtime
on 1.7.8 before it was fixed (`harness/verify179.mjs`, `verify-idle.mjs`,
local fixture pages). No permission, host or content-script change.

- **Non-HTML tabs say what they are; a failed analysis says so (#89, #63;
  S32)**: on a raw SVG the analysis threw (no `document.body`) and
  `analyzePage().then(sendResponse)` had no `.catch`, so the popup sat on
  "Analyzing page…" for good; a PDF was scored as a page (25, "Missing
  title"). The analyzer now answers `{ error: 'not-html', kind }` for a PDF,
  SVG, image, XML (sitemaps, feeds), JSON or text tab and `{ error:
  'analysis-failed' }` when it throws; the popup and the page-checks panel
  show "NOT A WEB PAGE · This tab shows a PDF…" or "COULDN'T FINISH THE
  ANALYSIS" (`src/lib/analysis-errors.js`, new, injected with the analyzer in
  all four lists). The listener also stopped returning `true` for messages it
  doesn't answer.
- **Tracking links (#92; S43)**: a correct page opened as
  `/en?utm_source=…` read **NOT INDEXABLE** ("canonical points to another
  URL"), "Missing self-referencing hreflang", and NO RETURN on every
  alternate, because the comparisons used the raw URL. `utm_*`, `gclid`,
  `fbclid`, `msclkid`, `srsltid` and similar are dropped before comparing
  (`TRACKING_PARAMS`, the same list in `hreflang.js` and `redirect-chain.js`;
  a test keeps them equal). Other query strings still count. Raw-HTML
  hreflang hrefs decode `&amp;`.
- **The page's own hreflang entries read SELF (#91; S42)**, not UNREACHABLE
  (they were never fetched, so had no record).
- **"View as" shows the switched analysis (#93; S44)**: the 5-minute tab cache
  was cleared only on a URL change, and the UA switch reloads the same URL.
  It's now cleared on any reload and by the switch itself.
- **Visible text (#87)**: headings, the outline, link anchors, keyword density,
  n-grams and word counts read `textContent`, which joins the text either side
  of a `<br>` or two blocks ("SEO thatactually works" on seobandwagon.com).
  `visibleText()` in `lib/dom-extraction.js` treats `<br>` and block edges as
  spaces.
- **Local captures make room by size (#90; S36)**: measured 17–77 KB per
  capture (35 KB average), so `chrome.storage.local`'s 10 MB filled at ~290,
  under the 500 cap, and every save after that failed with only a
  `console.error`. `autoSaveLocal` now removes the oldest captures before
  writing until the new one fits in 8 MB and at most 500 remain.
- **History search (#62)**: every typed word must appear in the URL, host or
  title, with spaces, hyphens, underscores, dots and slashes alike ("local
  seo" finds `/local-seo`); an empty result says "No captures match …".
- **Ads by whole-word label (#94; S5)**: `[aria-label*="Ads" i]` also matched
  "Downloads", "Threads", "Leads"; the label must now contain "Ads" or
  "Sponsored" as a word.
- **Test debt**: `.nvmrc` and `engines` pin Node 20–24 (on 25+ Node's own
  `localStorage` shadows jsdom's and `theme-mode.test.js` fails).
- **A person starts every scan (S55, S53, S29, S34)**: owner's rule, 2026-10-14
  — Google's terms rule out automated scraping, so nothing reads a page
  without a click. The side panel's Page checks analyzed, saved and (signed
  in) synced every page on each tab switch and page load; once "access to all
  sites" was granted that was every page browsed. It now shows a result
  already taken for the page or waits for "Scan this page"; opening the panel
  (a click) still scans the tab it opened on. Live: with access, a reload and
  a navigation added no capture; the click added one. Where the extension has
  no access to a tab (the panel on a tab whose icon wasn't clicked, S53; the
  tab "Analyze linked page" opens, S29) the panel and the popup offer "Allow
  access to analyze other tabs", which requests the existing optional
  `<all_urls>` from that click; the consent text (`ALL_URLS_REASON`) and the
  listing say so. The worker's `openSidePanel` fallback, which could never
  open anything, is gone (S34); the context menu's `openPopup()` calls catch
  their rejection.

Checked and **not** confirmed, so not changed: S41 (a redirect hop missed when
a navigation wakes the worker: the hop was captured after a 32 s idle stop)
and S40 (a long hreflang check outliving the worker: 40 alternates at 9 s
each, 180 s, worker alive throughout and all 40 answered).

## Changelog — v1.7.8 (2026-10-13)

Full-page proof off the popup, from the 2026-10-12 test pass and the 1.7.7
smoke test. No permission, host or content-script change.

- **A capture outlives the popup (#48)**: `runScreenshot()` drove the scroll
  loop, the canvas and the finished blob from the action popup, which closes
  on any click away or tab switch. A long page (10–20 s) was lost, and so was
  a proof not yet downloaded. The loop (`src/lib/fullpage-capture.js`, moved
  from `src/popup/`) now runs in the service worker with an `OffscreenCanvas`
  drawer; `src/lib/fullpage-runs.js` (new) keeps one capture per tab the way
  `link-check-runs.js` keeps link checks, mirrors its state to
  `chrome.storage.session`, and stores the finished image in IndexedDB
  (`src/lib/proof-store.js`, new: a Blob of several MB doesn't fit session
  storage). The Citations tab talks to it over a `fullpage-proof` port and
  reattaches when reopened. A capture Chrome stops mid-run is reported as
  interrupted (the page's watchdog has already restored it). Cancel, the ✕ on
  a result, a new capture or closing the tab removes it; proofs are cleared
  on browser start and on update. Live (headless Chromium, popup closed 2.5 s
  into the capture): seobandwagon.com/ and a Wikipedia article both finished,
  the page was scrolled back, and the reopened popup read the image.
- **Smaller proofs, with a time estimate (#51)**: full-page proofs are JPEG at
  quality 0.85 (white under every frame, so nothing needs alpha): 1.6 MB →
  1.06 MB for seobandwagon.com/ (1366×10436) and 4.36 MB → 2.6 MB for the
  Wikipedia article (1366×11327), with text still crisp. Less than the 5–10×
  hoped for: these pages are mostly text and gradients. WebP was ruled out:
  it can't encode images taller than 16,383 px, and proofs go to 32,766. The
  progress line adds the time left ("Capturing 3 of 14 · about 6 s left"),
  first at the 550 ms capture pace, then from the frames' real average (live:
  7.7 s estimated, 7.9 s taken). The popup says the capture keeps going if
  it closes. The download is `citation-<host>-<date>.jpg`; the visible-area
  proof stays PNG.
- **Switching tabs says so at once (#64)**: Chrome runs no animation frames in
  a background tab, so the page helper's two `requestAnimationFrame` waits
  never ended, and the capture stopped 6 s later with "The page stopped
  responding". Each wait is now capped at 100 ms, and the loop checks the
  active tab before every scroll as well as before every capture. Live: the
  error is recorded as soon as the tab changes, with the right message.

## Changelog — v1.7.7 (2026-10-13)

Small correctness fixes from the 2026-10-12 test pass. No permission, host or
content-script change.

- **Signed out, the results overlay sends nothing; its stats cache works
  (#50)**: the overlay cached domain stats in `chrome.storage.session` from
  the content script, which Chrome refuses ("Access to storage is not allowed
  from this context", once per bar), so every read missed and every results
  page re-asked every domain. It also reached the API through a generic
  `sbwFetch` bridge that skipped the "no key, no request" rule, so a
  signed-out user's result domains were POSTed to `/domain/quick-batch`
  anyway and answered 401, contrary to `docs/CWS-LISTING.md` §5. The overlay
  now sends `{ action: 'serpStats', domains }` to the worker and keeps a
  per-page map; the worker (`src/lib/serp-stats.js`, new) caches per domain
  for 10 minutes in session storage and calls `SBW.quickBatch`, which returns
  `no_key` without a request. The `sbwFetch` bridge is gone (the overlay was
  its only caller). Live, signed out: 1.7.6 POSTed and logged 9 storage
  errors on one page; 1.7.7 sends nothing and logs none. Bars still read
  "Connect your account".
- **Side panel "Page checks →" opens (#49)**: `setOptions` alone doesn't
  replace a panel open for the whole window, so the click did nothing; it
  now also calls `sidePanel.open({ tabId })`, as `panel.js`'s `openPanel()`
  does. Live: the page-checks panel opens ("13 of 14 passed").
- **The popup on a results page says what the overlay read (#56)**: it asks
  the overlay (`serpStatus`) and shows "Found N results…" with where the
  toolbar is, or "Couldn't read the results on this page", instead of always
  promising a bar under each result.
- **Approximate absolute position (#45, the patch-sized part)**: results
  exports gain an "Absolute position (approx.)" column, last so existing
  columns don't move: Google's `start` offset plus the position on the page.
  `buildSearchUrl` no longer emits `num`, which Google ignores.
- **Flash text cleared (#54)**: a Copy button's text no longer reads "Copy
  PAA (9)Copied" after the flash ends.
- **Export names no longer collide (#55)**: `SBWCsv.csvFilename` (links,
  hreflang, redirects, render diff, structured data, headings, images) adds
  the page's path slug and the UTC time to the second; the analysis JSON uses
  it too; SERP CSVs add `-p<page>` and seconds.
- Tests: `serp-stats.test.js` (8, including the real `SBW.quickBatch` with no
  key: no fetch); the overlay test stub now refuses `chrome.storage.session`
  like a real content script (the permissive stub is how #50 passed); 19 of
  the updated overlay, parser and CSV tests fail on 1.7.6.

---

## Changelog — v1.7.6 (2026-10-13)

Link check outlives the popup, from the 2026-10-12 test pass. No permission,
host or content-script change.

- **A check keeps going when the popup closes (#47)**: the action popup
  closes on any click away or tab switch, and the worker aborted the run on
  the port's disconnect; reopening showed "Check N links" again with every
  result gone. Runs now belong to the worker, one per tab
  (`src/lib/link-check-runs.js`, new): the popup attaches on open and detaches
  on close, progress is mirrored to `chrome.storage.session` at most every
  500 ms (each write also keeps the worker from idling out), and a reopened
  popup shows the progress so far or the finished results. If Chrome stopped
  the worker mid-run, the next attach resumes the links not yet checked. Only
  Cancel, "Check again" (new, on the results) or closing the tab ends a run. The
  port protocol is now `attach` / `start` / `cancel` → `state` / `progress` /
  `done` / `cancelled` / `error`; `preview/stub.js` speaks it, with a new
  `link-check-reattach` state. Live: popup closed at 50 of 300 links, the
  worker's saved run went on 92 → 152 → 297 with no popup open.
- **Chrome Web Store links read "Can't check" (#46)**: Chrome never lets an
  extension fetch the Web Store, so every such link failed as a broken
  NETWORK result (5 on seobandwagon.com/seo-chrome-extension, including our
  own install link). `SBWLinkCheck.isUncheckable` skips them without a
  request; they get their own chip and a note, and never count as broken.
- **Faster (#52)**: 4 requests per host and 10 overall (was 2 and 6), and the
  GET retry after a failed or refused HEAD gets its own 10 s timeout instead
  of whatever the HEAD left. Live, 300 links on Wikipedia's SEO article:
  4.0–5.0 s (1.7.5: 6.0 s warm, 17.1 s cold).
- Tests: `link-check-runs.test.js` (12) and three `link-check.test.js` cases
  for #46. Each runner behavior was checked by breaking it on purpose:
  aborting on detach, skipping resume, and fetching Web Store links each fail
  the tests meant to catch them.

---

## Changelog — v1.7.5 (2026-10-12)

SERP overlay and full-page proof fixes from the 2026-10-12 test pass
(issues #41–#56). No permission, host or content-script change.

- **Results linked through Google's redirects (#41)**: on signed-out results
  pages Google links its own properties directly and every other site through
  an opaque `/goto?url=CAES…` token, with the destination nowhere in the
  markup. `parseResults` (`src/lib/serp.js`) required `a[href^="http"]`, so it
  read none of them: "Copy results (0)", no bars, a header-only CSV. It now
  accepts `/goto` and `/url` links and resolves them in order: `/url?q=`,
  then `data-curl`/`data-surl`, then the origin in the `<cite>` breadcrumb,
  then a short site-name map (Reddit, YouTube, Quora). A row known only by its
  origin carries `urlResolved: false`, dedupes on the redirect so two pages on
  one site aren't merged, and its bar's Analyze link opens Google's own link
  (non-enumerable `row._href`). Live, signed out, page 1: "rank tracking
  software" 0 → 9 of 9 results, "seo chrome extension" 0 → 7 of 10 (the rest
  are Google properties, #42).
- **Google's own properties are results (#42)**: `bareDomain` dropped every
  `*.google.*` host as "internal", so Chrome Web Store listings (ours
  included), Search Console, Search Central, support.google.com and the rest
  never appeared and every later result moved up. Internal now means Google's
  navigation only: the accounts/consent/myaccount/policies/webcache/maps hosts,
  and search, redirect, settings and vertical paths (`/search`, `/url`,
  `/goto`, `/imgres`, `/maps`, `/intl`, the homepage, …) on `google.<tld>`.
  Live, page 1: "seo stats chrome" 0 → 9 of 9 results (with #41), "seo chrome
  extension" 9 of 10, "google search console" 8 of 9.
- **Copy PAA and Copy results copy again (#37)**: both always flashed "Copy
  failed". `navigator.clipboard.writeText()` rejects in a content script
  ("NotAllowedError: Write permission denied"), since the isolated world
  doesn't inherit the page's clipboard grant, and the error was discarded.
  `copyText` (`src/overlay/serp-overlay.js`) now copies with
  `execCommand('copy')` through an off-screen textarea, which needs only the
  click's user activation, then restores focus and the page's selection; the
  async API stays as a second try, and a failure is logged. The
  `clipboardWrite` permission would also have fixed it, but it carries the
  "Modify data you copy and paste" warning, which disables the extension on
  update until each user accepts it. Verified live, signed out, with default
  permissions: Copy PAA 4 → 9 questions after expanding, Copy results the
  full table. `MANUAL_SMOKE_TEST.md` now says to paste after every Copy.
- **Empty results are reported, not exported (#44)**: with 0 rows, "Copy
  results" flashed "Copied" over a header-only table and "Export CSV"
  downloaded a header-only file, which is how #41 went unnoticed; "Copy PAA"
  with no questions copied an empty string, wiping the clipboard. Now the
  buttons flash "No results found" / "No questions found" and touch neither
  the clipboard nor Downloads. A page that has result headings but yields no
  rows logs one console warning per page (heading and redirect-link counts),
  flagged on the document so a re-injected script stays quiet.
- **Full-page proof survives a page that shifts a few px (#43)**: the loop
  threw away the whole capture when a scroll landed more than 1px from the
  plan. After `fpHideFixed` takes a sticky header or fixed bar out of the
  layout a page can get a few px shorter, so the last scroll falls short:
  seobandwagon.com/seo-chrome-extension (asked 13429, got 13425, 18 frames
  lost) and the seobandwagon.com home page both failed every time. The loop
  (`src/popup/fullpage-capture.js`, `adjustFrame`) now reads each frame's rows
  from where the window actually is when they're on screen. On the last frame
  up to a quarter screen of rows that no longer exist stays white at the
  bottom; a frame whose rows would leave a gap mid-image still fails with the
  same message. Both pages now capture (1366×14242, 1366×10436), with no seam
  at the adjusted frame; Wikipedia still captures as before.
- `tests/fixtures/serp-google-goto-links.html` is a real signed-out page
  ("seo stats chrome", 2026-10-12); `tests/unit/serp.test.js` and
  `serp-overlay.test.js` add 27 tests, 20 of which fail on 1.7.4; `fullpage-capture.test.js` adds 7 for #43, 3 of which fail on 1.7.4 (1008 tests in all, 974 on 1.7.4).

---

## Changelog — v1.7.4 (2026-10-09)

Onboarding, and links to seobandwagon.com that GA4 can attribute. No
permission, host or content-script change.

- **Welcome tab**: on `runtime.onInstalled` with reason `install` only, one tab
  opens at `https://seobandwagon.com/seo-chrome-extension/welcome?ref=install`
  plus the UTM tags (campaign `install`). Updates, Chrome updates and
  shared-module updates open nothing.
- **Uninstall survey**: every `onInstalled` (install and update, so existing
  users get it on updating) calls `runtime.setUninstallURL` with
  `https://seobandwagon.com/seo-chrome-extension/uninstalled?ref=uninstall&v=<version>`
  plus the UTM tags (campaign `uninstall`). The version is the only thing it
  carries.
- **UTM tags**: every page of ours the extension opens carries
  `utm_source=chrome_extension&utm_medium=extension&utm_campaign=<surface>`,
  surface one of `popup`, `options`, `citations_tab`, `side_panel`, `install`,
  `uninstall`. Built by the new `src/lib/site-links.js`; only the privacy link
  was tagged before, and with the source alone.
- `tests/unit/site-links.test.js` covers the URLs and the install-reason
  rule, fails on an untagged static `href` to seobandwagon.com anywhere under
  `extension/src`, and on a script that opens one of our paths without
  `siteUrl()`.
- Both pages are website work (keepkalm/platform) and must answer 200 before
  1.7.4 is submitted.

---

## Changelog — v1.7.3 (2026-10-07)

1.7.2 was never submitted; 1.7.3 is 1.7.2 with the store listing's words
brought in line with what ships. No permission change.

- **Short description** (`extension/manifest.json` `description`, the store's
  summary): "a score with fixes" became "a score and the issues it finds". The
  popup lists issue labels such as "Missing H1" in check order, with no fix
  text (`lib/content-analysis.js`, `calculateSEOScore`).
- **Detailed description** (`docs/CWS-LISTING.md`): "a short list of fixes"
  became the issues it found, with the letter grade placed on the toolbar icon
  where it shows; "Every section exports a CSV" became the sections that do,
  plus the whole analysis as JSON.
- `tests/unit/listing-copy.test.js` now holds the short description equal to
  the listing doc's and keeps "fix" out of both.

---

## Changelog — v1.7.2 (2026-10-06)

Reviews are the extension's call to action (owner, 2026-10-05), plus the
full-page proof follow-ups deferred from 1.7.0. No permission change.

- **"Rate us"** in the popup footer and a "Rate it on the Chrome Web Store"
  line on the options page. Both read the store reviews URL from
  `src/lib/review-prompt.js`, the same one the one-time review prompt uses.
- **Full-page proof** (`src/popup/fullpage-capture.js`): progress reads
  "Building the image…" while the PNG is encoded, and a Cancel pressed then
  now cancels. Every message to the page is bounded at 6 s, so a tab whose
  helper died, for example after an extension update, ends with "The page
  stopped responding" instead of a capture that never finishes.
- **Capped-page label** (`src/lib/fullpage-plan.js`): the captured height
  rounds down and the page height rounds up, so it can never read
  "first 32,800 of 32,800 px".

---

## Changelog — v1.7.1 (2026-10-01)

Fixes from the first real-browser check of full-page proof, on a Datanyze
company page. No permission change.

- **Cookie banners no longer repeat down the proof.** Fixed and sticky elements
  were hidden after the first frame with `visibility: hidden`, but banners that
  set `visibility: visible` on their own text still drew it, without its
  background, over every frame. Hidden elements now also get `opacity: 0`,
  which nothing inside them can override (`src/content/page-scroller.js`).
- **No scrollbar strip at each frame's edge.** macOS shows its overlay
  scrollbar for a moment after every scroll; the page's scrollbar is now hidden
  (`scrollbar-width: none`) while the capture runs and restored afterwards.

---

## Changelog — v1.7.0 (2026-10-01)

The first feature minor since 1.6.0.

- **Full-page proof screenshots.** The Citations tab's SCREENSHOT tile now
  scrolls the page and stitches every frame into one PNG, instead of saving only
  what is on screen; "Visible area only" keeps the old one-frame capture. Three
  new modules: `src/lib/fullpage-plan.js` (the frame planner and the proof
  label), `src/content/page-scroller.js` (injected on demand to measure and
  scroll the page, hide fixed and sticky elements after the first frame, and put
  everything back) and `src/popup/fullpage-capture.js` (the capture loop, with
  progress, Cancel and a tab check before every frame). The proof stays a local
  PNG download; nothing is uploaded.
- **No permission change.** The page helper is injected with the existing
  `activeTab` + `scripting`; no new permission, host permission or content-script
  match, and the service worker is unchanged.
- **Limits, stated honestly.** Chrome allows two screenshots a second, so frames
  are spaced at least 550 ms apart, with one retry after a second on the
  rate-limit error. The stitched image is capped at 32,767 px tall and 100M
  pixels in all; a taller page is captured from the top and labelled
  `FULL PAGE · first N of M px`, and a page too large to stitch offers "Capture
  visible area instead". A page that scrolls inside a panel is labelled
  `VIEWPORT · page scrolls inside a panel`, not passed off as full page.

---

## Changelog — v1.6.1 (2026-09-24)

The first submission since 1.2.0. 1.6.0 was uploaded as a dashboard draft but
never published (it lacked six permission justifications), so the store goes
from 1.2.0 straight to 1.6.1; everything in the 1.6.0 changelog below ships
with it. Fixes since the 1.6.0 bump, and no permission changes:

- **Search Console compare mode is two inline badges and nothing else** (#13,
  `cd5df0e`). A percent-change badge on each metric card and inside each changed
  cell; the sort, filter and copy tools are gone.
- **Search Console row icons stay on the Queries tab** (#20, `0f401c5`). Tab
  detection fails closed: when the extension cannot tell which tab is showing,
  it adds nothing. It re-checks on every in-page navigation, and icons are
  removed as soon as the report leaves Queries.
- **The SERP export captures what the results page actually shows** (#22,
  `7823bba`). Each row carries the description, date, rating, site name,
  display URL and breadcrumb, plus the search's context (query, country,
  language, location, page, result stats, related searches, People also ask).
  Built against two real saved Google results pages, now the test fixtures.
- **Version bookkeeping.** `npm run bump`, the CI bump check and the version
  test above; `package.json` and `package-lock.json` now match the manifest.

---

## Changelog — v1.6.0 (2026-09-06)

- **Appearance (2026-09-07)** — Night / Day / Auto for the popup, both side
  panels and Settings, from one stored key. Two matching Chrome themes ship as
  separate Web Store items (now in their own repo, seo-bandwagon/seobw-themes).
- **Page-checks panel (2026-09-08)** — a second side panel showing the current
  page's checks, opened per tab from the existing panel's footer. No manifest
  change, no new permission. The 14 checks moved to `src/lib/sub-scores.js` so
  the popup and the panel cannot disagree.

Extension competitor-parity work (Phase 3 of the SDD plan). Adds a broken-link
checker, an indexability panel (redirect chain, headers, X-Robots-Tag),
hreflang validation with return-tag checks, a raw-HTML-vs-rendered-DOM
comparison with a per-tab user-agent switcher, structured-data validation
(JSON-LD/Microdata/RDFa) with rich-result eligibility, a re-enabled and
rewritten SERP overlay (stats bar, results/PAA export, location simulator), a
right-click "SEO Bandwagon tools" menu, CSV export for headings/images/links,
nofollow/UGC/sponsored link surfacing, and a one-time review prompt. New
manifest permissions: `webRequest`, `webNavigation`,
`declarativeNetRequestWithHostAccess`, and the optional `<all_urls>` host
permission (requested on first use, never at install); a new content-script
match on Google's own results pages.

- **Broken-link checker** (`src/popup/link-check.js`, new "LINK CHECK" section
  in the SEO Analysis tab) — collects every `a[href]` on the page
  (`collectLinks` in `src/content/analyzer.js`, capped at 300, deduped by
  normalized URL) and probes each one from the background service worker
  (`HEAD`, retried once as `GET` on a 405/501 or a network error; 10 s
  timeout; per-host concurrency 2, global concurrency 6 — see
  `src/lib/link-check.js`). Results group into ok/redirect/4xx/5xx/timeout/
  network chips, can be highlighted on the page (`highlight` action, type
  `broken`), and export to CSV (`src/lib/csv.js`, RFC 4180, UTF-8 BOM).
  The check never runs on its own — it starts only from a real click on
  "Check N links".
- **Optional `<all_urls>` permission** (`src/lib/perms.js`) — requested only
  when you click "Allow access to check other sites" in the Link Check,
  Indexability or Hreflang section, never at install and never automatically.
  Revocable any time from the extensions page.
- **Indexability panel** (`src/popup/indexability.js`, new "INDEXABILITY"
  section in the SEO Analysis tab, directly after "Page Meta") — the
  background service worker observes the current tab's main-frame redirect
  chain, final status, and a fixed set of response headers via
  `chrome.webRequest`/`chrome.webNavigation` (`X-Robots-Tag`, `Cache-Control`,
  `Content-Type`, `Link`, and whether HSTS/CSP are present — see
  `src/lib/redirect-chain.js`), only once you've granted the same optional
  `<all_urls>` permission — the same permission card as Link Check's shows
  when it hasn't been. Combines that with the page's DOM `meta[robots]`/
  canonical to render an indexable/not-indexable verdict, shows the hop-by-hop
  chain (with client-side-redirect and loop detection), lets you trace a
  different URL from a background tab, and exports the captured hops to CSV.
  Nothing captured is sent anywhere; it lives in `chrome.storage.session` and
  clears when the tab closes.
- **Hreflang validation with return tags** (`src/popup/hreflang.js`, new
  "HREFLANG" section directly after Indexability; `src/lib/hreflang.js`) —
  the content script's `analyzeHreflang()` now runs every declared
  `<link rel="alternate" hreflang>` tag through BCP 47 canonical-form
  validation (a wrong-case tag like `EN-us` is told apart from a
  structurally invalid one), and flags duplicate language tags, the same
  URL declared under multiple tags, relative hrefs, a protocol that differs
  from the page, and the existing missing-x-default/missing-self-reference
  checks. A page with no hreflang tags gets a one-line note in Page Meta
  instead of an empty section. "Check return tags (N)" — gated on the same
  optional `<all_urls>` permission, requested only on click — fetches each
  declared alternate from the background worker (capped at 50 URLs, 2 per
  host / 4 global concurrency, 10 s timeout, at most 256 KB of body read per
  page) and reports whether each one's own hreflang set links back to this
  page (yes / no / unreachable), exporting to CSV.
- **HTML vs rendered DOM diff + user-agent switcher** (`src/popup/
  render-check.js`, new "RENDERING" section directly after Hreflang;
  `src/lib/html-diff.js`, `src/lib/ua-switch.js`) — "Compare raw HTML with
  rendered DOM" fetches the current tab's own URL a second time from the
  background worker (unrendered; same optional `<all_urls>` gate, 10 s
  timeout, 1 MB body cap) and diffs it field-by-field against the page's
  already-computed analysis (title, meta description, canonical, robots,
  H1–H6 counts, link/image/JSON-LD counts, approximate word count, hreflang
  count), rendering a static/hydrated/JavaScript-rendered verdict and
  exporting the row table to CSV. "View as" adds a preset selector
  (Googlebot Desktop, Googlebot Smartphone, Bingbot, iPhone Safari, or
  Default) that rewrites the User-Agent header for exactly the current tab
  via a `declarativeNetRequest` session rule and reloads it — for testing
  server-side rendering and cloaking, never for bypassing a paywall or
  "seeing Google as a bot." The rule is removed the moment you switch back
  to Default or close the tab; a badge chip on the section header shows
  when an override is still active. New manifest permission:
  `declarativeNetRequestWithHostAccess` (works with the same optional
  `<all_urls>` grant; no static rulesets ship with the extension).
- **Structured data validation** (`src/popup/structured-data.js`, new
  "STRUCTURED DATA" section directly after Rendering; `src/lib/
  structured-data.js`) — the content script now extracts every JSON-LD
  `<script>` block (flattening `@graph` and top-level arrays recursively — a
  `@graph` member that's itself an array or that nests its own `@graph` is
  flattened too — capturing a parse error as its own item rather than
  dropping the whole block, and stripping a wrapping HTML comment or CDATA
  section first), every WHATWG microdata `[itemscope]` tree (nested
  itemscopes become nested items; properties referenced via `itemref`
  elsewhere in the document are resolved in too; `content`/`href`/`src`/
  `datetime` attribute value rules, with `href`/`src` resolved to an
  absolute URL the same way the browser resolves them), and every basic
  RDFa Lite `[typeof]` tree, then validates each item's properties against a
  required/recommended table for Article (incl. NewsArticle/BlogPosting),
  Product, LocalBusiness (and around 100 subtypes it recognizes — Plumber,
  Electrician, Restaurant, Dentist, and the rest of schema.org's own
  LocalBusiness tree), Organization, Person, BreadcrumbList, FAQPage, HowTo,
  Recipe, Event, VideoObject, Review/AggregateRating, WebSite, WebPage, and
  JobPosting — plus specific shape checks (a genuinely unrecognized `@type`
  — as opposed to a real schema.org type we just don't have a
  required-property list for yet, which gets a note instead — every offer
  in an `offers` array missing `price`/`priceCurrency` (or `lowPrice` for an
  `AggregateOffer`), a non-ISO-8601 `datePublished`, an `image` that isn't a
  URL or ImageObject, a BreadcrumbList item without `position`, a FAQPage
  `mainEntity` without `acceptedAnswer`). "Eligible for" lists a Google
  rich-result feature only when that item's required properties are all
  present, **and only for rich results Google currently shows** — never
  "will get." FAQPage and HowTo are validated as markup like any other type,
  but Google retired both rich results, so a complete item there shows
  "Valid markup; Google no longer shows a rich result for this type" instead
  of appearing in Eligible for. No fetch, no permission: everything here
  reads only the current page's own already-loaded DOM. Items export to
  CSV; each item's underlying data copies as JSON — but only type names and
  property NAMES are ever saved to a synced capture, never property VALUES.
  The popup footer's new "About & credits" link opens a small in-popup panel
  (`src/lib/credits.js`) crediting schema.org (CC BY-SA 3.0) and Google
  Search Central's structured-data documentation (CC BY 4.0) for the
  required/recommended tables, with a source link per type category;
  Google tools are named nominatively, no logos.
- **SERP overlay, re-enabled and rewritten** (`src/overlay/serp-overlay.js`,
  `src/overlay/serp-overlay.css`, new `src/lib/serp.js`) — registered as a
  content script on `google.com` and nine other Google TLDs' `/search`
  pages, additive only: a `.sbw-serp-bar` appends under each organic result
  (never inside the title/URL area, never near an ad — the parser excludes
  `[data-text-ad]`/`#tads`/`#bottomads`/`[aria-label*="Ads"]` blocks
  outright) showing the domain and a stats lookup, and a `.sbw-serp-tools`
  toolbar appends once after the results container with **Copy results
  (N)** (TSV), **Export CSV**, **Copy PAA (N)**, and a location simulator.
  The stats lookup sends only bare domain names (deduped, capped at 20) to
  `POST /api/domain/quick-batch` through the background worker's existing
  bridge — never the query, never a title or snippet — cached in
  `chrome.storage.session` for 10 minutes; a signed-out/rejected key shows
  "Connect your account" once, with no retry. Results and PAA questions
  stay entirely client-side (clipboard/CSV). The location simulator builds
  a Google search URL (`uule`, `gl`, `hl`, optional `pws=0`) from a
  54-metro preset list or a typed canonical name, and opens it — or two
  locations at once via "Compare in two tabs" — described as "opens a
  search with location parameters," never as seeing Google as a bot. The
  old `/serp/collect` and `/analyze` calls, and the analyzer bootstrap that
  ran on Google's own results pages, are deleted outright, not disabled;
  the popup now shows a one-line notice on a Google results page instead
  of running the normal page analyzer there.
- **Context-menu SEO tools** (`src/lib/tool-links.js`, `src/background/
  service-worker.js`, new "SEO Bandwagon tools" submenu) — Open in Google
  Search Console (URL inspection), Open in Wayback Machine, Open in
  PageSpeed Insights, Test with Rich Results Test, `site:` search for this
  domain, Search Google for the selected text in quotes (selection only,
  capped at 200 characters), and Open sitemap.xml / robots.txt. Every URL
  is built from `new URL(pageUrl)` — never a string-split of the origin —
  with every user-controlled part percent-encoded; a non-http(s) page makes
  the click do nothing. The same seven page-scoped items (everything but
  the selection search) also render as a small TOOLS row under the popup
  header (`src/popup/tools.js`). Nothing is fetched by the extension for
  any of these — each just opens a new tab. Google's own tools here are
  named nominatively, no logos, and get their own "About & credits" rows
  alongside PageSpeed Insights and the Wayback Machine
  (`src/lib/credits.js`).
- **Headings outline export + ARIA heading support** — no H7 (H1-H6 is the
  HTML spec; Detailed's "H7" is a quirk, not implemented). Instead, the
  existing Headings section gets "Export CSV" (level, text, document order)
  and "Copy outline" (the same outline as indented plain text to your
  clipboard) buttons; `lib/dom-extraction.js`'s heading extraction now also
  builds a combined, document-order outline that includes
  `[role="heading"][aria-level]` elements the plain H1-H6 arrays ignore
  (an empty aria-level defaults to 2, per WAI-ARIA; role=heading without
  aria-level is skipped entirely, since the selector itself requires the
  attribute to be present; and an out-of-range numeric value clamps into
  1-6). Fix round 1: an `aria-level` present on a real h1-h6 tag now wins
  over the tag name (`<h2 role="heading" aria-level="3">` is level 3, not
  2), and the outline is capped at 500 entries.
- **Images and Links CSV export** — the existing Links & Images section
  gets its own "Export images CSV" (src, alt, has-alt, lazy-loaded,
  width/height where set) and "Export links CSV" (URL, anchor text, rel,
  internal/external) buttons, backed by new `list` fields on
  `extractImages()`/`extractLinks()` (`lib/dom-extraction.js`) — the JSON
  export in the footer is untouched.
- **Nofollow/UGC/sponsored surfacing** — `extractLinks()` now counts `ugc`
  and `sponsored` rel values separately from plain `nofollow` (previously
  only `nofollow` was counted, and the existing Highlight button already
  treats all three as one family), and captures the first 50 matching
  anchors (`{ url, text, rel }`). The Links & Images section shows
  "Nofollow N · UGC N · Sponsored N" plus a "Total links with any of
  nofollow/ugc/sponsored: N" line (fix round 1 — the three per-token counts
  can double-count a single anchor carrying more than one token) and an
  expandable list next to the existing "Nofollow" highlight button. Fix
  round 1 also switched the `rel` check from a substring search to real
  space-separated token matching (`rel="NOFOLLOW"` now counts, `rel="me
  nofollowing"` no longer does) and made the Highlight button use the exact
  same token function, so the highlighted set and the counted set can never
  disagree.
- **One-time review prompt** (`src/lib/review-prompt.js`, `src/popup/
  review.js`, new `.review-strip`) — after the 5th analysis (cached-hit or
  fresh, either counts), a one-line strip offers "Leave a review" (opens
  the Chrome Web Store listing's reviews tab) or "No thanks"; both persist
  `prompted: true` to `chrome.storage.local` before doing anything else, so
  it never shows twice. Deliberately never gated on this analysis's score,
  grade, or whether the page could even be read — the strip's visibility
  is a pure function of stored state (`analyses`/`prompted`), checked even
  from the "can't read this page" and Google-SERP-notice branches.
- **Search Console compare-mode math against the live table** (folded in from the unshipped 1.5.3). The column
  pairing had been built from a two-column fixture; the real report has three
  columns per metric (Last, Previous, Difference), two-line headers, an extra
  leading header cell the body rows lack, and deselected metrics kept in the
  DOM as `display:none`. Result: impressions 10 → 11 rendered as "+9 (+900%)"
  (Previous paired with Difference), every "new" query read "-100%", and a
  phantom Clicks metric appeared. Detection now reads headers with the
  spacing walker, skips hidden columns, and calibrates header→body indices
  against the rows themselves (the Difference column must equal current −
  previous). The sorted copy's label is the value alone, without Google's
  "Copy URL to clipboard / Open in new tab / Inspect URL" hover labels.


- **Appearance: Night / Day / Auto + two Chrome themes** (`src/lib/theme-mode.js`,
  `src/styles/popup.css` token blocks; the themes moved to their own repo,
  seo-bandwagon/seobw-themes, on 2026-10-01). The extension's own pages
  follow a stored choice, else the OS setting, via `<html data-theme>`; the
  control sits in the side panel header and on the options page. Two Web Store
  theme items (Neon Night, Neon Day — `bandwagon-neon-*`, listing text in
  `store/LISTING.md`, both in that repo) match them. Scoped deliberately: no new-tab
  override and no `management` permission (the design's fuller 1.7.0 plan);
  the extension cannot tell which theme is installed, so the theme links on
  the options page are the only cross-promotion, and they stay hidden until
  the item ids exist. Brand fonts bundled locally (OFL). No permission changes.

## Changelog — v1.5.2 (2026-09-06)
- **Search Console row actions: Queries tab only.** The "Open in Google
  Search" / private-window icons now render only on the Queries dimension
  (`breakdown=query`, or the default tab when the header reads "Top
  queries") and are removed in place when the report switches to Pages,
  Countries, Devices, Dates or Search appearance — a page URL is not a
  search. Fixes the search string on the Pages tab picking up Search
  Console's own hover-action labels ("Copy URL to clipboard Open in new tab
  Inspect URL"): the value is now the first text node in the cell, and
  titles that read like an action label are skipped.

- **Search Console compare-mode math.** Scoped to 1.5.1 but pushed to its branch twenty minutes after that PR was squash-merged, so it never reached `main`; lands here. When a Performance report compares two
  date ranges, adds percent change to the metric summary cards and a "%
  change" table column (direction-aware colour; a lower Average position
  counts as good). Reduced on 2026-09-06 to two inline badges only — the
  metric cards and a small percent inside each row's Difference cell — after
  the owner ruled the earlier toolbar/sort/filter/TSV layer redid too much of
  Google's own UI ("we just wanted a little icon and a little number"). `src/lib/gsc-compare.js`, loaded after `gsc-inject.js` in
  `manifest.json`. Pure math + detection are unit-tested against fixture
  tables (no live GSC DOM available); everything computes client-side and
  nothing is sent anywhere.

## Changelog — v1.5.0 (2026-09-03)

Repoints the extension from CitationForge's own backend to the SEO Bandwagon
site API (`seobandwagon.com/api`) and adds account sync throughout:

- **Unified API client** (`src/lib/api.js`, `SBW` namespace) replaces the old
  `citationforge-api.js`; every network call goes through `sbwFetch` with a
  consistent `{ ok, status, data, code }` result shape.
- **Capture sync + retry** — a `chrome.alarms`-driven drainer (`sbw-sync`,
  every 15 min) posts locally-saved captures to `POST /api/v1/captures` with
  exponential backoff (15 min → 6 hr, 5 attempts), tracked per-capture via
  `src/lib/sync-state.js`; sync-status badges (synced/pending/failed/duplicate)
  on the History page. Captures saved by a pre-1.5.0 install are opt-in, not
  automatic: `SBW.markLegacyPending()` stamps them `skipped`/`legacy` rather
  than `pending` so a 1.4.0 upgrader's local backlog isn't silently bulk-
  uploaded the first time the drainer alarm fires; the History page's
  "Include them in sync" banner (`SBWSync.unskipLegacy()`) is the only thing
  that opts them in.
- **Domain history strip** (`src/lib/domain-history.js`) — the popup's SEO
  Analysis tab now shows this domain's and URL's capture history under the
  score ring, backed by `SBW.quickDomain` / `SBW.capturesForUrl`.
- **Citations re-pointed** to `/api/citations/*` (businesses, stats, citations,
  campaigns) instead of the retired CitationForge backend.
- **Link Building side panel** — outlets (qualified prospects), pitches
  (draft/approved with approve/reject), and results (funnel, spend,
  placements), plus "Add current tab as outlet" from the popup.
- **Options page** rebuilt — verify/connect/disconnect a key, dashboard
  shortcut links, and an Advanced section for pointing at a local dev API
  (`optional_host_permissions` requested only if you use it).
- **Chrome extension "Connect" flow** — `externally_connectable` lets
  seobandwagon.com/dashboard/api-keys hand the extension a key directly via
  `chrome.runtime.connect`/`sendMessage`, without copy-paste.
- **Permissions diet** — dropped `identity` and the unused Google OAuth
  `oauth2` block (account connection is an API key, not OAuth); dropped the
  hardcoded `http://localhost:8000/*` host permission in favor of the
  Options-gated optional one above.

**Deferred to later versions:**
- Proof-screenshot upload/storage — still local-download-only; needs object
  storage on the site side before screenshots can attach to a filed citation.
- SERP overlay re-enable — moved to v1.6.0, bundled with the Google
  content-script work below (see "v1.6 — feature candidates").
- Moving `lib/content-analysis.js` / `lib/dom-extraction.js` under `src/lib/`
  — they're a runtime dependency of `src/content/analyzer.js` (injected before
  it) and currently ship from the repo root; not moved this release to keep
  the diff scoped to the API migration.
- Unify `SBW.ct.*` (throws `CtError`) and `SBW.lb.*` (returns `{ ok, code }`)
  onto one non-throwing convention (~21 call sites, counted across
  `src/sidepanel/sidepanel.js`, `src/popup/citations-tab.js`, and
  `src/popup/popup.js`) — flagged during Task 4's review as an
  accepted-for-now inconsistency between the two namespaces.

---

## Where we are — v1.7.0 (Oct 2026)

- **SEO Analysis tab** — score ring + four sub-scores, issues, page meta with SERP
  preview, Core Web Vitals (LCP/INP/CLS/FCP/TTFB), headings (with outline export),
  links & images with on-page highlighting and CSV export, nofollow/UGC/sponsored
  surfacing, content stats + n-grams, tech stack detection, technical panel,
  domain-history strip. `src/content/analyzer.js` (~25 data categories).
- **Link Check** — probes every link on the page, groups results by status,
  highlights broken ones, exports CSV. `src/popup/link-check.js`, `src/lib/link-check.js`.
- **Indexability** — redirect chain, response headers, X-Robots-Tag and a
  computed verdict for the current tab or any traced URL. `src/popup/indexability.js`,
  `src/lib/redirect-chain.js`.
- **Hreflang** — tag validity, duplicates, x-default/self-reference, and
  fetched return-tag reciprocity. `src/popup/hreflang.js`, `src/lib/hreflang.js`.
- **Rendering** — raw-HTML-vs-rendered-DOM diff and a "View as" user-agent
  switcher. `src/popup/render-check.js`, `src/lib/html-diff.js`, `src/lib/ua-switch.js`.
- **Structured Data** — JSON-LD/Microdata/RDFa extraction, required/recommended
  property validation, rich-result eligibility, and an About & credits panel.
  `src/popup/structured-data.js`, `src/lib/structured-data.js`, `src/lib/credits.js`.
- **Citations tab** — directory takeover header (40 curated directories
  auto-detected), client-side NAP extraction (JSON-LD → microdata → heuristic)
  and weighted match scoring, proof screenshot capture (full page by default, with a visible-area
  option; local download only),
  one-click citation filing against the SEO Bandwagon API.
  `src/popup/citations-tab.js`, `src/lib/nap-compare.js`, `src/content/nap-extractor.js`.
- **Side panel** — Citations mode (businesses / campaigns / citations) and
  Link Building mode (outlets / pitches / results), CSV export. `src/sidepanel/`.
- **SERP overlay** — stats bar under each organic result on Google's own
  results pages, results/PAA export (20 columns: description, date, rating,
  site name, breadcrumb, the search's context and, from 1.7.7, an approximate
  absolute position), location simulator. `src/overlay/serp-overlay.js`,
  `src/lib/serp.js`.
- **Tools** — right-click "SEO Bandwagon tools" menu and a matching popup row
  (Search Console, PageSpeed Insights, Rich Results Test, Wayback Machine,
  `site:` search, sitemap.xml/robots.txt). `src/lib/tool-links.js`.
- **Capture sync** — local-first storage with account sync, retry, and History
  page controls. `src/lib/sync-state.js`, `src/history/`.
- **Options page** — connect/verify/disconnect a key, dashboard links, Advanced
  local-dev endpoint. `src/options/`.
- **GSC row actions (1.5.1) + compare mode (1.5.2)** — two icons on every row of
  a Search Console Performance report's Queries tab (open in Google Search, and
  in a private window), plus inline percent-change badges
  when a report compares two date ranges. `src/lib/gsc-inject.js`, `src/lib/gsc-compare.js`, `src/content/gsc-serp.js`.
- **Page-checks panel** — a second side panel with the current page's checks,
  pass/warn/fail counts and the tools row. `src/panel/`.
- **Appearance** — Night / Day / Auto for the popup, side panels and options,
  bundled brand fonts, and two matching Chrome theme items (Neon Night
  `bomhiblgnbmpgbddhocomnbijdkmpbhl`, Neon Day `ldifldabjbffldoekbebpickddaiiggm`).
- **Brand system** — Bandwagon Pink on Midnight Navy, tokens throughout
  `src/styles/popup.css`.
- **Dev harness** — `preview/index.html` renders every UI state against the real
  render code with stubbed APIs; `preview/verify.html` asserts all of them plus
  shell-drift checks. (The harness server config lives in
  `citation-forge/.claude/launch.json` — dev-only, users never see it, left there
  on purpose.)

Open design questions are tracked in `preview/DESIGN-GAPS.md`.

---

## Competitive position (researched Aug 2026)

Compared against the four most-installed on-page extensions (verified against
Chrome Web Store listings Aug 13, 2026): **SEOquake** (1M, 4.5★, Semrush),
**Detailed** (600K, 4.9★, now an Ahrefs property), **Ahrefs SEO Toolbar** (400K,
4.4★, metrics gated behind paid Ahrefs), **SEO Minion** (200K, 4.0★, **no longer
free** — requires a Keywords Everywhere Silver+ plan). Full matrix and sources in
`docs/archive/website/COMPARISON-PAGE.md`.

**Only we have:** local-SEO citation tooling (NAP checks, proof screenshots,
citation filing), in-browser Core Web Vitals, tech stack detection, and a
composite score — free, no account gate.

**Table-stakes gaps** (broken links, redirects/headers, hreflang, SERP overlay
and export, location simulator) were the v1.6 candidates and all closed in
1.6.0. Candidates for the next minor are under "v1.7" below.

---

## Work plan — fixes from the 2026-10-12 test pass

A full runtime test of 1.7.1 (installed build, re-checked against `main` at
1.7.4) filed #41–#56 and diagnosed #37. Every item is still a 1.7.x patch
unless marked; the existing maintenance lane below is unchanged. Releases
are named by order, not number: `npm run bump` rewrites version strings.

**1.7.5: done, on `release/1.7.5` (PR pending).** See its
changelog above.
- [x] #41 results behind Google `/goto` redirects (breadcrumb origin; no new permission)
- [x] #42 Google's own properties (Chrome Web Store, Search Console…) count as results
- [x] #37 Copy PAA / Copy results copy (no `clipboardWrite`, on purpose)
- [x] #44 "No results found" instead of empty copies and exports
- [x] #43 full-page proof survives a page that lands a few px off

**Link check survives the popup: done in 1.7.6.**
- [x] #47 run the check in the service worker keyed by tab + URL, keep it
      going when the popup closes, persist progress in
      `chrome.storage.session`, reattach on reopen
- [x] #46 classify Chrome Web Store links as "can't check", not NETWORK
- [x] #52 raise per-host / global concurrency, dedupe `#fragment` variants,
      separate HEAD and GET timeouts

**Small correctness fixes: done in 1.7.7.**
- [x] #50 SERP stats cache (`storage.session` from a content script) and the
      signed-out "no request" guard the 1.6.0 changelog promises
- [x] #49 side panel "Page checks →" when the panel is open window-wide
- [x] #45 (part) an approximate absolute-position column; drop the dead `num`
      param from `buildSearchUrl`
- [x] #56 popup text on a SERP reflects what the overlay actually read
- [x] #54 flash label leaves stale `textContent`
- [x] #55 export filenames: page number, path slug, seconds

**Next patch: full-page proof off the popup (larger).**
- [x] #48 move the scroll-and-stitch loop out of the popup (service worker
      or offscreen document) so a click away doesn't kill it
- [x] #51 JPEG/WebP proofs and an up-front time estimate (with #48)
- [x] #64 a tab switch mid-capture says so, at once

**Verified static-review fixes: done in 1.7.9.**
- [x] #89 / #63 non-HTML tabs and a failed analysis (S32)
- [x] #92 tracking parameters in hreflang and canonical compares (S43)
- [x] #91 the page's own hreflang entries (S42)
- [x] #93 "View as" shows the switched analysis (S44)
- [x] #87 visible text across `<br>` and blocks
- [x] #90 local captures make room by size (S36)
- [x] #62 History search
- [x] #94 ads by whole-word label (S5)
- [x] S29 / S53 / S34 / S55: ask for access from a click; the side panel
      scans only on a click (owner's decision 2026-10-14: a human in the loop)
- Not confirmed at runtime, left as is: S40, S41.

**Feature candidates (next minor):** see "v1.7 — feature candidates" below.
1.8.0 took *Capture top N* (#45), built as Collect pages; the next finished
candidate makes the following minor.

**Open decisions**
- #53 toolbar placement: the 1.6.0 changelog chose "after the results" on
  purpose; revisit only with the owner.
- #41 full destination URLs: resolving `/goto` tokens needs
  `https://www.google.com/*` host access in the service worker. Check the
  install-warning impact before choosing it; 1.7.5 reports the origin.
- #36 canary: production's capture endpoint stopped returning the expected
  401 on 2026-10-05. Website side, not the extension.

**Test debt**
- [x] Pin Node for local runs (`.nvmrc` / `engines` = 20, as CI). On Node 25+,
      `theme-mode.test.js` fails because Node's own global `localStorage`
      shadows jsdom's.
- [ ] An e2e check of the SERP Copy buttons **without** pre-granted clipboard
      permissions (granting them is how #37 hid).
- [ ] Refresh the real-SERP fixtures when Google's markup moves; the
      overlay's new console warning (#44) is the signal.
- [x] The 63-item static review from the same pass (S1–S63): the items
      still open were checked at runtime for 1.7.9; confirmed ones became
      #89–#94 and were fixed.

## Maintenance lane (patch bumps)

Follow-ups from `preview/DESIGN-GAPS.md`; none of these bump the minor:

- [ ] Copy pass on signed-out proof strip and empty states
- [ ] Keyboard shortcut for Check NAP (extend `commands` in manifest)
- [ ] Real directory favicons in the takeover header (cache via
      `https://www.google.com/s2/favicons`) — cosmetic
- [ ] Scroll NAP result card into view on completion (partially done)
- [ ] Move `lib/content-analysis.js` / `lib/dom-extraction.js` under `src/lib/`
      (deferred from 1.5.0 — see changelog above)

## v1.6 — feature candidates (done)

All six shipped in v1.6.0: SERP overlay (with export and the location
simulator), broken-link checker, redirect tracer + headers (Indexability panel),
and hreflang return-tag validation. See "Changelog — v1.6.0" and "Where we are —
v1.7.0" above.

## v1.7 — feature candidates

1.7.0 shipped the first of these, full-page proof screenshots. The rest are
candidates for the next minor (1.8.0); until one lands, everything is a 1.7.x
patch.

- **Search Console row actions, account-backed** — "add this keyword to my rank
  tracker" on the Queries tab and "send this page to my captures" on the Pages
  tab, shown only with an API key connected and data collection on. Needs a new
  site endpoint (`POST /api/v1/keywords`, scope `keywords:write`) and a
  data-use disclosure change; planned 2026-09-10, not started.
- ~~**Capture top N / page depth (#45)**~~ — done in 1.8.0 as **Collect
  pages**: a person adds each page by click (no automatic paging), and the
  pages combine into one table with an exact absolute position.
- **Keyword difficulty / volume in SERP overlay** — via DataForSEO through the
  CitationForge backend (SEOquake gets this from Semrush)
- **Citation remediation flow** — the `FIX ON THIS SITE` concept from the design
  mockups: corrected-NAP copy block + deep link to each directory's edit page
- **Citation delete/undo endpoint** — enables the `Undo` affordance from mockups
- **Campaign step progress in side panel** — surface the 4-step LangGraph pipeline
  status per running campaign
- ~~**New tab page**~~ — done in 1.9.0 (owner ruling 2026-10-18, reversing the
  2026-09-07 decline): recent audits, score changes and the next fix from local
  captures. Account-level progress and tasks wait on a website endpoint.

## Non-goals

- **Authority metrics (DA/PA/DR)** — requires a proprietary link index; MozBar and
  Ahrefs gate theirs behind paid accounts. We don't chase this; our free CWV +
  citations + score is the counter-position.
- **A runtime build step or runtime dependencies** — the extension ships as
  plain files from `extension/` with no bundler and no npm packages, and that is
  a feature. Keep it. npm is dev-only (tests, `bump`, `zip`, CI).

---

## Platform work (tracked elsewhere)

SaaS-side items (GSC OAuth, dashboard rebuild, Search Console data display, site
health dashboard) live in the main SEO Bandwagon Notion. The old extension
data-capture phases (content/meta/links capture, `/v1/captures` API, Supabase
tables, `/captures` dashboard) shipped and remain live.

The 2026-09-03 reconciliation notes (how 1.5.0 merged the April `origin/main`
with the 1.4.0 tree) are in `docs/archive/2026-09-03-reconciliation.md`.
