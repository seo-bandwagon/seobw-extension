# Chrome Web Store Listing — SEO Bandwagon

> Last Updated: 2026-10-13

Single source of truth for the Chrome Web Store dashboard fields. Lives at the
repo root, outside `extension/`, so `npm run zip` never ships it. Update it on
every PR that changes the extension: bump the date, refresh the descriptions if
user-facing behaviour changed, re-justify any permission, host or content-script
change, and add a Version History row.

Long-form reviewer text (one paragraph per permission, data-use reasoning,
reviewer test steps) is in `docs/CWS-LISTING.md`; the two Chrome theme
items have their own listing text in the seobw-themes repo's `store/LISTING.md`. This file
summarises both and says where to paste what.

Store item: `dphmaddiedhkejfhabkfdenfphjljioj`. Read 2026-10-13: the live
store page shows version 1.7.1, "Updated October 2, 2026", and Google's update
server (what Chrome installs from) also returns 1.7.1. Check the update server,
not only the listing page:
`https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=140.0&acceptformat=crx3&x=id%3Ddphmaddiedhkejfhabkfdenfphjljioj%26uc`
Next submission: **1.7.7** (see Version History). Not re-checked since
2026-09-24: the live category was **Productivity › Tools**, not the Developer
Tools set below (change it in the dashboard with this submission if it still
is), and the listing had 1 rating (5 stars). The six permission justifications
the 1.6.0 draft lacked (`docs/CWS-LISTING.md` §3) must have been in place for
1.6.1 and 1.7.1 to publish.

## Store Listing

**Extension Name**

```
SEO Bandwagon
```

**Short Description** (120 chars, matches `extension/manifest.json` `description`; a sentence, never a list of terms)

```
Check the on-page SEO of any page in one click: a score and the issues it finds, link and indexability checks, and more.
```

**Detailed Description**

Paste `docs/CWS-LISTING.md` §2 verbatim. Rewritten 2026-09-24 after the
keyword-stuffing violation below: plain sentences, **no lists of schema types,
metric names, crawler names, product names or export targets**, and **no single
keyword more than five times** (Google's spam FAQ). Rewritten again the same
day to meet the five-times rule; `tests/unit/listing-copy.test.js` fails if
either rule breaks. Every
feature named there is shipped on `main`; nothing planned appears in it.

**Category**

```
Developer Tools
```

**Single Purpose**

```
SEO Bandwagon analyses the SEO signals of the page you are viewing and syncs that analysis — and the local-SEO citation and outreach records derived from it — to the user's own SEO Bandwagon account.
```

**Primary Language**

```
English
```

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `extension/src/icons/icon128.png` |
| Screenshot 1 — popup, Analysis tab with score and issues | 1280×800 | ✅ Ready 2026-10-13 (1.7.7) | `store-assets/1.7.7/screenshot-1-analysis-1280x800.png` |
| Screenshot 2 — Link Check results grouped by outcome, with "Can't check" | 1280×800 | ✅ Ready 2026-10-13 (1.7.7) | `store-assets/1.7.7/screenshot-2-link-check-1280x800.png` |
| Screenshot 3 — Indexability panel with redirect chain | 1280×800 | ✅ Ready 2026-10-13 (1.7.7) | `store-assets/1.7.7/screenshot-3-indexability-1280x800.png` |
| Screenshot 4 — Google results overlay and its Copy / Export toolbar | 1280×800 | ✅ Ready 2026-10-13 (1.7.7) | `store-assets/1.7.7/screenshot-4-serp-overlay-1280x800.png` |
| Screenshot 5 — Page-checks panel in Night and Day | 1280×800 | ✅ Ready 2026-10-13 (1.7.7) | `store-assets/1.7.7/screenshot-5-night-day-1280x800.png` |
| Small Promo Tile | 440×280 | ✅ Ready 2026-10-13 (1.7.7) | `store-assets/1.7.7/promo-tile-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready 2026-10-13 (1.7.7) | `store-assets/1.7.7/promo-marquee-1400x560.png` |

### Screenshot Notes

1.7.7 set: `store-assets/1.7.7/` (README there says how each was made and
how to re-shoot; the 1.6.1 set stays for history). Upload all five with the
1.7.7 package, replacing the 1.6.1 ones.

Take them from the unpacked build at `extension/` on a real public page,
Night appearance for 1–4 and a Night/Day pair for 5. Show the extension in
action on the page, not the popup floating alone. No competitor names or
logos anywhere in frame.

## Permissions Justification

One line each here; the reviewer-length paragraph for every row is in
`docs/CWS-LISTING.md` §3 — paste those into the dashboard's
per-permission fields.

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Reads the current tab's URL and title only when the user clicks the icon or uses the shortcut, and screenshots that tab when the user asks for listing proof. |
| `storage` | permissions | Saves analyses, cached responses, the API key and settings on the user's device. |
| `contextMenus` | permissions | Right-click "Analyze this page", "Analyze linked page", "Count words" and the tools submenu. Nothing runs without a menu choice. |
| `scripting` | permissions | Injects into the active tab only on request: the analysis script, the NAP reader (Check NAP), and the scroll helper for a full-page proof screenshot. |
| `sidePanel` | permissions | Powers the Citations / Link Building side panel. |
| `tabs` | permissions | Opens dashboard links; matches finished page loads against a bundled directory-hostname list to paint a badge. Local string compare only. |
| `alarms` | permissions | 15-minute retry of captures that failed to sync. Idle with no account connected. |
| `webRequest` | permissions | Observe-only main-frame status/redirect/header buffer per tab for the Indexability panel; never blocks or modifies. Fires only once optional `<all_urls>` is granted. |
| `webNavigation` | permissions | Detects client-side redirects and page reloads for Indexability. Observe-only. |
| `declarativeNetRequestWithHostAccess` | permissions | Rendering "View as": one session rule rewriting User-Agent for the current tab only, removed on Default or tab close. No static rulesets. |
| `https://seobandwagon.com/*` | host_permissions | The only host the extension talks to: the user's own analyses, citations and link-building data. |
| `http://localhost/*`, `http://127.0.0.1/*` | optional_host_permissions | Requested only if the Advanced API URL points at a local dev server. |
| `<all_urls>` | optional_host_permissions | Requested on first use of Link Check, Indexability, Hreflang or Rendering, with the consent text in `extension/src/lib/perms.js`. Cookieless fetches; nothing read on those sites is sent to us. |
| `https://search.google.com/search-console/*` | content_scripts | Queries-tab "open in Google Search" icons and compare-mode percent badges, computed from the table already on the page. Nothing fetched or sent. |
| `https://www.google.com/search*` + 9 ccTLDs | content_scripts | Results overlay: appends a stats bar and toolbar, never hides or moves anything including ads. Sends only bare result domains to our API, never the query. The CSV and clipboard exports stay entirely on the device and now also carry each result's own snippet plus the search context read from the URL — none of it is transmitted. |
| `externally_connectable` → `https://seobandwagon.com/*` | manifest key | Lets the dashboard's "Connect Chrome extension" button hand over a freshly minted API key. No other origin can message the extension. |

Not present and deliberately so: `management`, `chrome_url_overrides`,
`web_accessible_resources`, `identity`, `oauth2`.

The themed page-checks panel added 2026-09-08 needs **no manifest change**: it
is opened per tab with `chrome.sidePanel.setOptions({ tabId, path })` from the
existing side panel's footer, so `side_panel.default_path` is untouched and no
permission or host is added. Reviewers who ask what the second panel is: it
shows the same on-page checks as the toolbar popup, computed in the page, and
requires no account.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes — only with an account
connected and the data-collection setting on. Signed out, it sends nothing at
all except the bare-domain overlay lookup on Google results pages.

From 1.7.4 a first install opens our welcome page in a tab, and removing the
extension opens a one-question survey page. Both are ordinary visits to
seobandwagon.com, handled under its privacy policy; the extension adds only
`ref`, the UTM tags and (survey only) its version number to the address. No
install id, setting or usage leaves with either, so no data-use answer changes.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | — | — | No |
| Health info | No | — | — | No |
| Financial info | No | — | — | No |
| Authentication info | Yes | Yes, to seobandwagon.com only | The user's own API key, as a Bearer header | No |
| Personal communications | No | — | — | No |
| Location | No | — | — | No |
| Web history | Yes | Yes, to seobandwagon.com only | URL + timestamp of pages the user chose to analyze; bare domains shown on a Google results page | No |
| User activity | No | — | — | No |
| Website content | Yes | Yes, to seobandwagon.com only | Extracted metadata of analyzed pages (title, meta, headings, links, images, structured-data type and property names, technical facts). Never structured-data values. | No |

Reasoning for each row: `docs/CWS-LISTING.md` §5.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**

```
https://seobandwagon.com/privacy
```

The page carries a "Browser extension" section stating exactly what is sent
and when. Keep it in step with the table above.

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**: SEO Bandwagon

**Contact Email**: the address on the developer account (owner-held; not
recorded here).

**Support URL**: https://github.com/seo-bandwagon/seo-bw-extension/issues

**Homepage URL**: https://seobandwagon.com

## Companion items

Two Chrome themes, separate store items, in their own repo, [seo-bandwagon/seobw-themes](https://github.com/seo-bandwagon/seobw-themes): listing
text in its `store/LISTING.md`, packaged by its `npm run zip`:

| Item | Status | Item ID |
|------|--------|---------|
| SEO Bandwagon — Neon Night | Published 2026-09-08, category Dark & Black | `bomhiblgnbmpgbddhocomnbijdkmpbhl` |
| SEO Bandwagon — Neon Day | Published 2026-09-08, category Other | `ldifldabjbffldoekbebpickddaiiggm` |

Both ids are in `THEME_IDS` in `extension/src/lib/theme-mode.js`, so the
extension's options page shows its theme links from 1.6.0 on.

**Open on the live listings:** both descriptions were uploaded with the
placeholder cross-link URLs (`.../detail/ITEM_ID_DAY` and `.../ITEM_ID_NIGHT`)
still in them, so each theme's "PREFER LIGHT / PREFER DARK" link is dead. Paste
the corrected blocks from the seobw-themes repo's `store/LISTING.md` over the description in each
item's dashboard listing. Re-measured 2026-09-24: both placeholders still live,
both items at 1.0.0 with 3 users. The corrected blocks also describe the
extension's 1.6 features (Appearance, Link Check and the rest), which the store
extension only has once 1.6.1 is approved; until then, fix just the two
cross-link URLs.

**Known and worth saying in the theme listings:** the new-tab wallpaper is a
Chrome feature. Brave replaces the new tab page with its own and shows the frame
and toolbar colours but not the wallpaper — a long-standing Brave limitation,
not a fault in the package. Both theme descriptions now say so.

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.7.8 | 2026-10-13 (branch `fix/1.7.8-proof-off-popup`) | 1.7.7 plus full-page proof fixes. **A capture outlives the popup (#48):** the scroll-and-stitch loop, its canvas and the finished image lived in the action popup, which closes on any click away, so a 10–20 s capture or an undownloaded proof was lost; now the service worker runs one capture per tab (`OffscreenCanvas`), keeps the finished image in the extension's IndexedDB and its state in `chrome.storage.session`, and a reopened popup shows the progress or the proof. **Smaller proofs with a time estimate (#51):** full-page proofs are JPEG (quality 0.85; 35–40% smaller in live runs, e.g. a Wikipedia article 4.36 MB → 2.6 MB) and progress reads "Capturing 3 of 14 · about 6 s left". **Switching tabs ends a capture at once with "You switched tabs" (#64)** instead of a 6 s wait and "The page stopped responding". No permission, host or content-script change; the activeTab grant from the toolbar click covers the worker's capture as it did the popup's. **Data use: unchanged** — the proof still never leaves the device; the listing's §5 note now says where it waits. | Not submitted |
| 1.7.7 | 2026-10-13 (branch `fix/1.7.7-correctness`) | 1.7.6 plus small correctness fixes. **Signed out, the results overlay sends nothing (#50):** until now a signed-out user's result domains were POSTed to `/domain/quick-batch` (answered 401) despite the listing's §5 "sends nothing at all"; the overlay now asks the worker, which calls the API only with a key and caches stats per domain for 10 minutes (the content-script cache never worked). **Side panel "Page checks →" opens (#49).** **The popup on a results page says what the overlay found (#56).** Results exports gain an "Absolute position (approx.)" column, last (#45); export filenames carry the page path and time, so they no longer collide (#55); Copy buttons' text is clean after a flash (#54). No permission, host or content-script change. **Data use: less** — a signed-out user now matches §5 exactly. | **Ready to submit** (2026-10-13): `npm run zip` from `main` at `74d1d5e`, checked with `check:zip` (72 files, `manifest.json`, `lib/`, `src/` only). Listing text: `docs/CWS-LISTING.md`, release notes in its section 6. No permission or data-use change since 1.7.1 |
| 1.7.6 | 2026-10-13 (branch `fix/1.7.6-link-check`) | 1.7.5 plus link check fixes. **A check outlives the popup (#47):** the action popup closes on any click away or tab switch, and the worker used to abort the run with it; now the run belongs to the worker, one per tab, is mirrored to `chrome.storage.session`, and a reopened popup shows its progress or results (it resumes the unchecked links if Chrome stopped the worker). Cancel, "Check again" and closing the tab end it. **Chrome Web Store links read "Can't check" (#46)** instead of NETWORK/broken; they're never fetched. **Faster (#52):** 4 requests per host / 10 overall (was 2 / 6), and the GET retry gets its own 10 s timeout. No permission, host or content-script change; no data-use change (results stay in the browser's session storage, which the README now says). | Not submitted (folded into 1.7.7) |
| 1.7.5 | 2026-10-12 (branch `release/1.7.5`) | 1.7.4 plus SERP overlay and full-page proof fixes. Results behind Google redirects (#41): signed-out Google results pages link every third-party result through an opaque `/goto?url=` redirect, and the overlay read none of them ("Copy results (0)", no bars, a header-only CSV). It now reads those results, taking the site from the `<cite>` breadcrumb (or the site name, for Reddit/YouTube/Quora results) and exporting its origin as the URL; the bar's Analyze link opens the result through Google's own link. And Google's own properties count as results again (#42): Chrome Web Store listings, Search Console, Search Central and support.google.com were all dropped as "internal", which hid our own listing and moved every later result up; only Google's navigation (search, redirect, settings, maps) is skipped now. Copy PAA and Copy results work again (#37): both always said "Copy failed" because a content script may not use the async clipboard API; they now copy through `execCommand('copy')` during the click. Deliberately **no `clipboardWrite` permission** (its install warning would disable the extension on update). With nothing to copy or export the buttons now say "No results found" / "No questions found" instead of copying or downloading an empty table (#44). Full-page proof no longer throws the capture away when the page lands a few px from the planned scroll (#43): seobandwagon.com/seo-chrome-extension and the home page failed every time on 1.7.4 and now capture. No permission, host or content-script change. | Not submitted (folded into 1.7.7) |
| 1.7.4 | 2026-10-09 (main) | 1.7.3 plus onboarding: a first install opens one tab at `https://seobandwagon.com/seo-chrome-extension/welcome?ref=install` (never on an update), and the uninstall URL is set on every install and update to `https://seobandwagon.com/seo-chrome-extension/uninstalled?ref=uninstall&v=<version>`, a one-question survey. Every link the extension opens on seobandwagon.com (popup, options page, Citations tab, side panel, and the two pages above) carries `utm_source=chrome_extension&utm_medium=extension&utm_campaign=<surface>` (`extension/src/lib/site-links.js`). No permission, host or content-script change; no data-use category changes (the survey URL carries the version only). | Not submitted (folded into 1.7.7) |
| 1.7.3 | 2026-10-07 (main) | 1.7.2 plus a corrected short description (manifest `description`, which the store shows as the summary): "a score with fixes" became "a score and the issues it finds", since the popup lists issues with no fix text. The detailed description in `docs/CWS-LISTING.md` drops "a short list of fixes" and "Every section exports a CSV" the same way. No permission, host or content-script change. | Not submitted (folded into 1.7.4) |
| 1.7.2 | 2026-10-06 (main) | A "Rate us" link in the popup footer and on the options page, opening the store reviews page. Full-page proof: shows "Building the image…" while a long page saves and honours Cancel there; a page that stops answering ends the capture after 6 s with a message instead of hanging; a capped page's label rounds the captured height down and the page height up. No permission, host or content-script change. | Not submitted (folded into 1.7.3) |
| 1.7.1 | 2026-10-01 (main) | 1.7.0 plus a fix found in the first real-browser check: a cookie banner whose text overrides its container's visibility was drawn over every frame of a full-page proof, and the macOS overlay scrollbar appeared at the right edge of each frame. Hidden elements now also get `opacity: 0`, and the page's scrollbar is hidden during capture. No permission, host or content-script change. | **Published.** Submitted 2026-10-01; Google's update server served 1.7.1 on 2026-10-03 (package from `npm run zip` on `main`; GitHub release `1.7.1`, commit `d42d84e`) |
| 1.7.0 | 2026-10-01 (main) | Full-page proof screenshots in the Citations tab: the SCREENSHOT tile scrolls and stitches the whole page (capped at Chrome's 32,767 px image height and a 100-million-pixel budget, and labelled when capped), with a "Visible area only" option. No permission, host or content-script change; the page helper is injected on demand with the existing activeTab + scripting. | Not submitted (folded into 1.7.1) |
| 1.6.1 | 2026-09-24 (main) | Short description (manifest) and detailed description rewritten without term lists after a keyword-stuffing violation on the 1.6.0 draft. 1.6.0 plus fixes: Search Console compare mode reduced to two inline badges (#13); row icons stay on the Queries tab, tab detection fails closed (#20); SERP export carries each result's description, date, rating, site name, display URL and breadcrumb plus the search's context (#22). No permission, host or content-script change from 1.6.0. Listing text: `docs/CWS-LISTING.md`. Remove the downtime notice from the live description when submitting. | Draft — package with `npm run zip`, not Finder |
| 1.6.0 | 2026-09-06 | Competitor parity: Link Check, Indexability, Hreflang, Rendering + "View as", Structured Data validation, Google results overlay, Search Console compare badges, tools menu, CSV exports. New permissions: `webRequest`, `webNavigation`, `declarativeNetRequestWithHostAccess`, optional `<all_urls>`; new content-script match on Google search. 2026-09-07: Night/Day/Auto appearance, bundled brand fonts. 2026-09-08: themed page-checks side panel, opened per tab from the existing panel. Neither changes the manifest. Release notes in `docs/CWS-LISTING.md` §6. | Uploaded as a dashboard draft, not published: six permission justifications missing (2026-09-24). Replace the package with 1.6.1 |
| 1.5.2 | 2026-09-06 | Search Console helpers (Queries-tab icons, compare badges). Content-script match on `search.google.com/search-console/*` (added in 1.5.1). | Not submitted (folded into 1.6.0) |
| 1.5.0 | 2026-09-04 | API-key connect flow, capture sync with retry, citations and link-building in the side panel; `identity`/`oauth2` removed; `alarms` + `externally_connectable` added. | Not submitted (folded into 1.6.0) |
| 1.2.0 | 2026-04-23 | Repointed API host to seobandwagon.com. | Published |

## Review Notes

### Known Issues / Limitations

- The install-time warning grows in 1.6.0: it now names ten Google search
  hosts plus Search Console. The Google-search justification above says so
  plainly rather than minimising it.
- `webRequest` is dormant until the optional `<all_urls>` grant; reviewers
  testing Indexability must grant it and then reload the page.
- Reviewer test steps for every permission-bearing feature, none of which
  need an account: `docs/CWS-LISTING.md` §7.
- The live store screenshots still show the 1.2.0 interface. Replacements for 1.6.1
  are in `store-assets/1.6.1/` (real extension, real pages; how in its README).
- The live 1.2.0 description still carries the April 23 downtime notice
  (measured 2026-09-24). The description in `docs/CWS-LISTING.md` §2
  replaces it; until then, the notice can be removed from the live listing on
  its own.

### Rejection History

| Date | Version | Policy | Cause | Fix |
|---|---|---|---|---|
| 2026-09-24 | 1.6.0 draft | Keyword stuffing (spam policy) | The detailed description listed about fifteen structured-data types in one sentence, plus lists of metric names, crawler names, tool names and export targets; the short description was a comma list of eight terms | Both rewritten as plain sentences (`docs/CWS-LISTING.md` §1–2, manifest `description`). Resubmit as a revision with the 1.6.1 package; do not spend the one allowed appeal on it |
