# Chrome Web Store Listing — SEO Bandwagon

> Last Updated: 2026-11-03

Single source of truth for the Chrome Web Store dashboard fields. Lives at the
repo root, outside `extension/`, so `npm run zip` never ships it. Update it on
every PR that changes the extension: bump the date, refresh the descriptions if
user-facing behaviour changed, re-justify any permission, host or content-script
change, and add a Version History row.

Long-form reviewer text (one paragraph per permission, data-use reasoning,
reviewer test steps) is in `docs/CWS-LISTING.md`; the two Chrome theme
items have their own listing text in the seobw-themes repo's `store/LISTING.md`. This file
summarises both and says where to paste what.

Store item: `dphmaddiedhkejfhabkfdenfphjljioj`. Read 2026-11-01 17:08 UTC: Google's
update server (what Chrome installs from) returns **1.10.2**. Check the update server,
not only the listing page:
`https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=140.0&acceptformat=crx3&x=id%3Ddphmaddiedhkejfhabkfdenfphjljioj%26uc`
**1.10.2 published 2026-11-01; nothing in review.** 1.10.3 to 1.13.2 are
built and not submitted. The owner ruled on 2026-11-02 that submissions B
(1.10.3 to 1.11.0) and C (1.12.0 and 1.13.0) become one: "I think we might
skip publishing that because these versions are too close together. We could
probably finish up a few more versions quickly." They go to the store as one
upload, **the combined submission**, now of 1.13.2: 1.13.0 plus American
spelling (owner, 2026-11-02) and the AI Overview export columns, neither of which changes any dashboard text. Every dashboard text that
upload must change is under **"To paste with the combined submission
(1.13.0)"** below, paste-ready. With that upload, paste the whole detailed
description from `docs/CWS-LISTING.md` §2.
**1.13.3 is built and not submitted either:** study mode for SEO Bandwagon's AI
Overview study, for invited testers. It follows the combined submission;
outside testers start from the store on 2026-12-07, and pilot testers may load
the build unpacked the week of 2026-11-30 if the store has not approved it. The install warning is unchanged
(measured; Version History). It adds a sentence on the study to four of the
texts below: the Google results justification (1), the Web history (5) and
Website content (6) data-use texts and the description's PRIVACY block (8),
each in its final form, and leaves the single purpose as it is. They say more
than 1.13.2 does, not less, so whether the combined upload carries them or
1.13.3's does is the owner's call.
1.10.2 is store submission A on the road to 2.0.0, alone. Release (run
`41323033820`) made GitHub release `v1.10.2` from `be5fe7d`; Submit to Chrome
Web Store (run `41323144644`) read "Published now: PUBLISHED (1.10.1)",
"Uploaded version 1.10.2.", then "Submitted for review as a staged publish:
PENDING_REVIEW" at 15:49 UTC. Google approved it and the owner pressed
Publish the same day: a check run at 17:07 UTC (`41329861291`) read "Published
now: PUBLISHED (1.10.2)" with nothing waiting.
**Two dashboard texts were not changed with 1.10.2:** the Google results
content-script justification and the Web history data-use purpose (under
Permissions Justification and Privacy & Data Use below). The dashboard still says bare
result domains are sent, which 1.10.2 no longer does. That says more than
happens, not less; change both with the next submission (B).
The live detailed description has **no NEW TAB section** (read in the
dashboard 2026-10-27: it goes from SIDE PANELS straight to EXPORTS AND
SHORTCUTS). The NEW TAB paragraph in `docs/CWS-LISTING.md` §2 has never been
pasted in.
Not re-checked since
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

**Single Purpose** (980 of 1,000 characters; saved in the dashboard 2026-10-27, live since 2026-10-28)

```
SEO Bandwagon analyzes the on-page SEO of the web page the user is viewing, so the user can see what the page gets right and what it is missing. In one click it scores the page and lists what it found in the title and description, headings, links, images, structured data, canonical and hreflang tags, indexability and redirects, and compares the raw HTML with the rendered page. On Google results pages it numbers each result and analyzes any of them in one click. With an account connected, it saves those analyses to the user's own SEO Bandwagon account, checks the user's local business citations against the user's own business record, and lists the user's link-building prospects and placements. On its new tab page, shown with its Neon Night or Neon Day theme or when chosen in settings, it summarizes the user's recent analyses, the first issue found and the rank changes of the user's own tracked keywords. Its findings export as spreadsheet or JSON files the user saves.
```

**Primary Language**

```
English
```

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `extension/src/icons/icon128.png` |
| Screenshot 1 — popup, Analysis tab with score and issues | 1280×800 | ✅ Ready 2026-10-23 (1.9.4) | `store-assets/1.9.4/screenshot-1-analysis-1280x800.png` |
| Screenshot 2 — Link Check results grouped by outcome, with "Can't check" | 1280×800 | ✅ Ready 2026-10-23 (1.9.4) | `store-assets/1.9.4/screenshot-2-link-check-1280x800.png` |
| Screenshot 3 — Indexability panel with redirect chain | 1280×800 | ✅ Ready 2026-10-23 (1.9.4) | `store-assets/1.9.4/screenshot-3-indexability-1280x800.png` |
| Screenshot 4 — Google results overlay and Collect pages (page 1 added) | 1280×800 | ✅ Ready 2026-10-23 (1.9.4) | `store-assets/1.9.4/screenshot-4-serp-collect-1280x800.png` |
| Screenshot 5 — the new tab page in Night and Day, signed in: rank drops first, in search-volume order (1.10.1) | 1280×800 | ✅ Live 2026-10-28 (shot 2026-10-27 from 1.10.1) | `store-assets/1.10.1/screenshot-5-new-tab-1280x800.png` |
| Small Promo Tile | 440×280 | ✅ Ready 2026-10-23 (1.9.4) | `store-assets/1.9.4/promo-tile-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready 2026-10-23 (1.9.4) | `store-assets/1.9.4/promo-marquee-1400x560.png` |

### Screenshot Notes

1.9.4 set: `store-assets/1.9.4/` in the project folder (on disk only, not in
git; README there says how each was made and how to re-shoot, with the capture
scripts beside it). Captured 2026-10-23 from 1.9.4 (`292686a`). Upload all five
and both tiles, replacing whatever the listing shows. The 1.8.0 set's files are
no longer on disk; the 1.6.1 set stays for history.

The set is shot **signed in** (the owner's account, connected through the
site's own Connect button in a capture profile), so screen 1 shows Domain
History, screen 4's result bars show domain scores, and screen 5 shows the new
tab's account cards (1.9.1): rank tracking and tasks, filtered to
seobandwagon.com's tracker so no client site appears. From 1.10.3 screen 1's
strip is "Page history" and has no "Domain avg" line, and screen 4's bars
changed in 1.10.2, so both are re-shot for the combined submission (1.13.0). Screen 5 is the new tab
page (1.9.0) in Night and Day; it replaces the 1.8.0 set's Night/Day
page-checks panel. The README beside the set says what was arranged for each
screen. A signed-out set of the same day is in `store-assets/1.9.4/signed-out/`.

Take them from the unpacked build at `extension/` on a real public page,
Night appearance for 1–4 and the new tab in Night and Day for 5.

1.10.0 replaces screenshot 5 only: `store-assets/1.10.0/` holds the new tab
with rank drops first, shot 2026-10-27 from the 1.10.0 branch in the owner's
signed-in profile against production, with the feed filtered to
seobandwagon.com's own tracker (no client site in frame); its README says how.
Screens 1 to 4 and both tiles stay the 1.9.4 set. 1.10.1 re-shot it again
in `store-assets/1.10.1/`: the drops in search-volume order (the site's feed
sorts them that way since 2026-10-27) with each page's "Next fix" line. That
is the screenshot 5 on the live listing since 2026-10-28. Show the extension in
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
| `declarativeNetRequestWithHostAccess` | permissions | Rendering "View as": one session rule rewriting User-Agent for the current tab only, removed on Default or tab close. From 1.12.0 also, while Analyze reads result pages, session rules that block the extension's own requests to local and private addresses (redirect hops included), removed after. No static rulesets. |
| `https://seobandwagon.com/*` | host_permissions | The only host the extension talks to: the user's own analyses, citations and link-building data. |
| `http://localhost/*`, `http://127.0.0.1/*` | optional_host_permissions | Requested only if the Advanced API URL points at a local dev server. |
| `<all_urls>` | optional_host_permissions | Requested on first use of Link Check, Indexability, Hreflang or Rendering, with the consent text in `extension/src/lib/perms.js`; from 1.10.2 also on the first Analyze click on a Google results page, from the extension's own small window with the same text. From 1.12.0 Analyze fetches the result's page (and its site's robots.txt and llms.txt) from the user's browser instead of opening a tab. Cookieless fetches; nothing read on those sites is sent to us. |
| `https://search.google.com/search-console/*` | content_scripts | Queries-tab "open in Google Search" icons and compare-mode percent badges, computed from the table already on the page. Nothing fetched or sent. From 1.10.2 the search opens with `pws=0` and the property's country (a country-code domain's `gl`), and a report tab switch is seen through the already-declared `webNavigation`. |
| `https://www.google.com/search*` + 29 other Google domains | content_scripts | Results overlay: appends a bar under each result (its position, figures and Analyze), a keyword strip above the results (1.13.0) and one panel below or above them, never hides or moves anything including ads. From 1.11.0, with an account connected and the figures accepted in Options, it sends each result's address and site (never the query) for the figures under it; from 1.13.0, with keyword data's own yes, the query with its related searches and People also ask questions, for keyword data; from 1.13.3, for an invited tester of the AI Overview study who turned on study sends, that search and its results page's export on a click on Send to study, in a private window the study opened, and a note that Google stopped them on a click on Google stopped me; otherwise nothing (1.10.2 sent nothing; until then, bare result domains). 1.13.0 adds two scripts to the entry (`src/lib/serp-keywords.js`, `src/overlay/serp-keywords.js`) and no match: the install warning measured unchanged (Version History). 1.11.0 adds twenty Google domains (`.com.br`, `.com.mx`, `.co.jp`, `.pl`, `.se`, `.no`, `.dk`, `.fi`, `.be`, `.at`, `.ch`, `.ie`, `.co.nz`, `.co.za`, `.pt`, `.com.tr`, `.com.sg`, `.com.ph`, `.com.ar`, `.co.id`): `getPermissionWarningsByManifest` (Chrome for Testing 156) gives the same four warnings before and after. Dashboard text: "To paste with the combined submission (1.13.0)". The CSV and clipboard exports a person makes stay entirely on the device and carry each result's own snippet plus the search context read from the URL — none of it is transmitted; the one send of a results page's export is 1.13.3's Send to study, by an invited tester, described above. 1.13.3 adds one script to the entry (`src/lib/aio-study.js`) and no match, host or permission: the install warning measured unchanged (Version History). India's host is `www.google.co.in` from 1.10.2 (`www.google.in` redirects); install warning measured unchanged. |
| `offscreen` | permissions | 1.12.0. Analyze on Google reads a result's HTML in an offscreen document (reason `DOM_PARSER`), because the service worker has no DOM parser: the same analyzer the popup runs, on HTML the extension fetched on the user's click. Nothing is shown and nothing it reads is sent anywhere. `getPermissionWarningsByManifest` (Chrome for Testing 156): no warning, the same four before and after. Dashboard text: "To paste with the combined submission (1.13.0)". |
| `externally_connectable` → `https://seobandwagon.com/*` | manifest key | Lets the dashboard's "Connect Chrome extension" button hand over a freshly minted API key. No other origin can message the extension. |
| `chrome_url_overrides.newtab` → `src/newtab/newtab.html` | manifest key | 1.9.0. The new tab page lists the user's recent analyses with score changes and the first issue found, all read from `chrome.storage.local`; signed out it sends no request on open, and with an account connected it reads the account's rank tracking summary and derived tasks (`GET /api/extension/progress`) at most every 10 minutes. It has no web search box. Its scan box opens a typed site in that tab and the popup analyzes it. Owner ruling 2026-10-18, reversing the 2026-09-07 one. From 1.9.5 it shows only with Neon Night or Neon Day installed (or the Always setting); otherwise it hands the tab to Chrome's own new tab before drawing anything. |
| `management` | permissions | 1.9.5. `chrome.management.getAll()` tells the new tab, popup and settings whether SEO Bandwagon's Neon Night or Neon Day theme is installed and on; the dashboard shows only then. Nothing it reads leaves the browser; it never enables, disables or removes anything. Owner ruling 2026-10-26, reversing the 2026-09-07 one. |
| `topSites`, `search` | optional_permissions | 1.9.5. Asked only from the settings checkbox that adds a search box (the user's own default engine, `chrome.search.query`) and the most-visited sites (`chrome.topSites.get`) below the dashboard. Neither is sent anywhere. |

Not present and deliberately so: `web_accessible_resources`, `identity`,
`oauth2`. `management` was declined on 2026-09-07 and added in 1.9.5 (owner
ruling 2026-10-26), so the new tab shows the dashboard only with a Neon theme.

**1.9.0 adds an install warning, and that disables existing installs.** Measured
2026-10-18 with `chrome.management.getPermissionWarningsByManifest`: 1.8.4 shows
two warnings ("Read and change your data on search.google.com,
seobandwagon.com, and www.google.com", "Read your browsing history"); 1.9.0 adds
a third, "Replace the page you see when opening a new tab". Chrome's rule
(developer.chrome.com, permission warnings): when an update adds a warning,
"the extension will be disabled until the user accepts the new permission".
Every existing user's copy turns off on the 1.9.0 update until they re-enable
it, and Chrome also shows its own "Change back to Google?" dialog the first
time an extension controls the new tab.

**1.9.5 adds a fourth install warning.** Measured 2026-10-26 with
`getPermissionWarningsByManifest`: 1.9.4's three plus "Manage your apps,
extensions, and themes" (`management`). The optional `topSites` and `search` add
none at install. Existing copies turn off on the 1.9.5 update until the user
accepts. Chrome's "Change back to Google?" dialog still appears on the first new
tab after install even when the extension hands the tab to Chrome's own; its
"Change it back" disables the extension (Chromium
`extension_settings_overridden_dialog.cc`: `kChangeSettingsBack` →
`DisableControllingExtension()`), and "Keep it" acknowledges it for good.

The themed page-checks panel added 2026-09-08 needs **no manifest change**: it
is opened per tab with `chrome.sidePanel.setOptions({ tabId, path })` from the
existing side panel's footer, so `side_panel.default_path` is untouched and no
permission or host is added. Reviewers who ask what the second panel is: it
shows the same on-page checks as the toolbar popup, computed in the page, and
requires no account.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes — only with an account
connected, and each flow on its own switch: analyses with the data-collection
setting on; from 1.11.0, the addresses of the results on a Google results page
after the user accepts the figures in Options; from 1.13.0, the words of a
Google search with its related searches and People also ask questions, after
the user says yes to keyword data; from 1.13.3, for an invited tester of the
AI Overview study, a study search and that results page's export, and a
note that Google stopped them, after the study's own yes in Options and a
click on Send to study or Google stopped me
(`src/lib/consent.js` checks each before every send). Signed out, it sends
nothing at all.

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
| Web history | Yes | Yes, to seobandwagon.com only | URL + timestamp of pages the user chose to analyze. From 1.13.0, after the user says yes to keyword data, the query of a Google search the user makes, with that Google's country and language, for its keyword figures, and a query the user adds to their rank tracker (Chrome has no search-terms category; Firefox's `searchTerms`). From 1.13.3, for an invited tester of the AI Overview study who turned on study sends, the study's search term, on Send to study, and a record that Google stopped them that day, on Google stopped me; both to the study, apart from the account | No |
| User activity | No | — | — | No |
| Website content | Yes | Yes, to seobandwagon.com only | Extracted metadata of analyzed pages (title, meta, headings, links, images, structured-data type and property names, technical facts). Never structured-data values. From 1.11.0, after the user accepts it in the extension's settings, the result links on a Google results page the user opens, for the figures under each result; never the search with them. From 1.13.0, after the user says yes to keyword data, the related searches and People also ask questions shown on that page, with its query, for their keyword figures; never a result link with them. From 1.13.3, for an invited tester of the AI Overview study who turned on study sends, on Send to study, that results page's export (the results' positions, addresses, sites, titles, snippets, breadcrumbs, dates and ratings, the page's features, related searches and People also ask questions, the result count, the AI Overview's text and sources, Google's country and language, the capture time, the extension version), to the study apart from the account, with no figures or keyword data | No |

Reasoning for each row: `docs/CWS-LISTING.md` §5.

### Changes the road to 2.0.0 will make here

ROADMAP.md → "The road to 2.0.0" plans four new data flows. Each one changes
the table above, `docs/CWS-LISTING.md` §5 and seobandwagon.com/privacy in the
release that ships it, and is accepted inside the extension with a specific
action first; until then none of it is sent:

| Release | What starts leaving the device, and only after the user accepts |
|---|---|
| 1.11.0 | Full result URLs on a Google results page (from 1.10.2 nothing; before it, bare domains), for the figures under each result and, from 1.12.0, the results table; signed in only. **Built in 1.11.0:** accepted with "Send result addresses and show figures" in Options; the table above, `docs/CWS-LISTING.md` §5 and seobandwagon.com/privacy say so |
| 1.13.0 | The search text, for keyword volume and difficulty, and from 1.15.0 for the user's own Search Console figures for that search. **Built in 1.13.0:** the query with its related searches and People also ask questions, after keyword data's own yes (its first-use disclosure on the results page, or "Send my searches for keyword data" in Options); the table above, `docs/CWS-LISTING.md` §5 and the in-extension words say so; seobandwagon.com/privacy is the website's to change before the combined submission |
| 1.16.0 | An analyzed page's URL to the site for field Core Web Vitals; robots.txt and the share image fetched from the page's own host on a click (nothing from them sent to us) |
| 1.18.0 | A citation's proof screenshot, uploaded on a click and stored with the citation |

*Renumbered 2026-10-31: 1.10.0 and 1.10.1 shipped the rank-drops new tab, so each planned release moved up one. 2026-11-01: the Google results page comes first, so the result URLs move from 1.12.0 to 1.11.0. 2026-11-03: 1.13.3 became the AI Overview study's study mode, a flow the road did not list (invited testers only, its own yes; Version History), so the planned 1.13.3 to 1.13.5 moved up one.*

1.12.0's Analyze on Google sends nothing new to us: on a click the extension
fetches the result's own page from the user's browser, without cookies,
under the existing optional all-sites access. It adds the `offscreen`
permission (Chrome and Edge) to run the analyzer, which shows no warning;
measured first like any manifest change.

No release on that road should add an install warning; any host or
content-script change is measured with `getPermissionWarningsByManifest`
first.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## To paste with the combined submission (1.13.0)

Submissions B and C are one upload, of 1.13.0 (owner, 2026-11-02). These
are every Chrome Web Store dashboard field that upload must change, each in
its final form: where 1.12.0 or 1.13.0 changed a text 1.11.0 had changed,
only the last version is here. Paste them with the upload, before submitting
for review. seobandwagon.com/privacy must cover all three flows first: the
result addresses (1.11.0, live with the website's `/privacy` change of
1.11.0), the pinned page and AI Overview sources (1.12.0) and the search's
words for keyword data (1.13.0, the website's to add). 1.13.3 adds the
study's search and results page export, and the note that Google stopped a
tester (the stop record), as a fourth, the website's to add to that section
too, since it must stay in step with the table above.

Texts 1, 5, 6 and the PRIVACY block of text 8 carry 1.13.3's sentence on the
AI Overview study (invited testers only, off until their own yes, sent on a
click on Send to study or Google stopped me, kept apart from the account). They are written for
1.13.3, which follows the combined upload; they say more than 1.13.2 does, not
less. Texts 2, 3, 4 and 7 are the same for both.

**1. Privacy practices → Host permission justification: the Google results
content scripts.** Replaces the live paragraph, stale since 1.10.2 (it says
bare result domains are sent) (995 of 1,000 characters; the listing
doc's own text, `docs/CWS-LISTING.md` §3; 1.13.3 added the study's sentence):

```
Content scripts on Google's results pages (www.google.com/search and the same path on 29 other Google country domains): not a host permission, so the install warning is unchanged. It reads the results on the page and adds a bar under each, a keyword strip above them and one panel; it never hides, moves or covers anything, including ads. With an account connected it sends only what the user turned on: for figures, the address and site of each result (up to 10 at a time); for keyword data, after its own disclosure, the query and the related searches and questions shown (up to 50); for the AI Overview study, after an invited tester's own yes and only on a click, that search and its page's export (Send to study, in a private window the study opened) or a note that Google stopped them (Google stopped me). seobandwagon.com answers with figures and the user's checklist score. Otherwise it sends nothing. It never fetches Google pages. Analyze reads a clicked result's page without cookies.
```

**2. Privacy practices → Host permission justification: the optional
all-sites access.** Replace its sentence about Analyze with this (1.12.0):

```
Analyze on a Google results page fetches the clicked result's page, and its site's robots.txt and llms.txt, from the user's browser without cookies, under the optional access to all sites, asked once from the extension's own window; no tab opens. Nothing read on those sites is sent to SEO Bandwagon.
```

**3. Privacy practices → permission justification, `offscreen` (new, 1.12.0).**

```
Analyze on a Google results page reads the clicked result's page in an offscreen document, because the extension's service worker cannot parse HTML. The document runs the same on-page analyzer as the extension's popup on the HTML the extension fetched, on the user's click, from the user's browser without cookies. Nothing is shown in it, and nothing it reads is sent anywhere.
```

**4. Privacy practices → permission justification,
`declarativeNetRequestWithHostAccess`: replace with this (1.12.0).**

```
Two uses, both session rules created at runtime; the extension ships no static rulesets. Rendering's "View as": choosing a preset other than Default installs one rule that rewrites the User-Agent header on requests from the current tab only, removed when the user picks Default or closes the tab. Analyze on a Google results page: while the extension reads the result pages the user asked for, rules block the extension's own requests to local and private network addresses (loopback, private ranges, .local names), so a page that redirects there is never followed; they are removed when the reading ends.
```

**5. Privacy practices → data usage, Web history.** Stays ticked. Stale
since 1.10.2 (it names the bare domains on a Google results page); 1.13.0
adds the query, since Chrome's list has no search-terms category; 1.13.3 adds
the study's search term:

```
The address and time of each page the user chooses to analyze, saved to the user's own SEO Bandwagon account while the data-collection setting is on. After the user says yes to keyword data, the query of a Google search the user makes, with that Google's country and language, to look up its monthly searches and other keyword figures, and a query the user adds to their rank tracker on seobandwagon.com. For invited testers of SEO Bandwagon's AI Overview study who turn on study sends, the search term the study gave them, sent when they click Send to study on its results page, and a record that Google stopped them that day, sent when they click Google stopped me. Both go to the study, kept apart from the account.
```

**6. Privacy practices → data usage, Website content.** Stays ticked; 1.11.0
adds the result links, 1.12.0 the pinned page and AI Overview sources,
1.13.0 the related searches and questions, 1.13.3 the study's results page
export:

```
Extracted metadata of the pages the user chooses to analyze (title, meta tags, headings, links, images, structured-data type and property names, technical facts; never structured-data values). After the user turns figures on in the extension's settings, the address and site of each result on a Google results page the user opens, up to 10 at a time, and, on the user's click, the address of a page the user pins to compare with the results and of the pages a Google AI Overview cites, to look up their link, traffic and domain-age figures. After the user says yes to keyword data, the related searches and People Also Ask questions shown on that results page, with its query, up to 50 at a time, for their keyword figures. Never a result's address with the keyword data. For invited testers of SEO Bandwagon's AI Overview study who turn on study sends, on Send to study, that results page's export from a private window the study opened: the results' positions, addresses, sites, titles, snippets, breadcrumbs, dates and ratings, the page's features, related searches and People Also Ask questions, the result count, the AI Overview's text and sources, Google's country and language, the capture time and the extension version, with no figures or keyword data. It goes to the study, kept apart from the account.
```

The other categories and the three certifications do not change. The
result addresses are links on a page (Website content), not pages the user
visited; the query is declared under Web history as well as Website
content, since no category names search terms; User activity stays No (no
keystrokes, clicks or scrolling are recorded); nothing identifies the user
beyond the key already declared under Authentication information. The
study's term and export are declared under the same two categories as the
query is.

**7. Single purpose** (998 of 1,000 characters; `docs/CWS-LISTING.md`
§4, which has the check and what was trimmed):

```
SEO Bandwagon analyzes the on-page SEO of the web page the user is viewing, to show what the page gets right and what it misses. In one click it scores the page and lists what it found in the title and description, headings, links, images, structured data, canonical and hreflang tags, indexability and redirects, and compares the raw HTML with the rendered page. On Google results pages it numbers each result, shows its link, traffic and domain-age figures and the query's keyword data, and analyzes any of them in one click. With an account connected, it saves those analyses and chosen keywords to the user's own SEO Bandwagon account, checks the user's local business citations against their business record, and lists their link-building prospects and placements. On its new tab page, shown with its Neon themes or when chosen in settings, it summarizes the user's recent analyses, the first issue found and the rank changes of their tracked keywords. Findings export as files the user saves.
```

Single-purpose check, 1.13.0: keyword data is figures about the results
page the user has open (its query, its related searches, its People also
ask questions), shown on that page, so it is the same purpose as the
figures under each result; "Add to my keywords" saves a keyword the user
chose to the user's own account, as the analyses are saved. Nothing in
1.13.0 runs outside a Google results page or the user's own account, and
no new surface or permission is added.

Single-purpose text, 1.13.3: unchanged (998 of 1,000 characters). The study
(an invited tester sends a Google results page's export, which is what the
overlay already reads and exports, to the study) adds no surface outside a
Google results page; whether it needs a sentence of its own is the owner's
call.

**8. Detailed description.** Paste the whole block in `docs/CWS-LISTING.md`
§2. These paragraphs are what changed since the live text (the live text
also lacks the NEW TAB paragraph, never pasted):

ON-PAGE ANALYSIS, 1.10.4 (two paragraphs):

```
ON-PAGE ANALYSIS
Open the popup anywhere for a score from 0 to 100, a letter grade and four sub-scores covering meta tags, content, links and technical setup. The score is a checklist: it starts at 100 and each issue takes off its own points. Beneath it is the list of issues it found, such as a missing H1 or a title that runs too long, each with what to change and the points it costs, so you know what to look at first. The grade also appears on the toolbar icon, so you can tell how it did without opening anything.

The analysis goes well past the headline number. You get a preview of how the listing could look in results, with the title and meta description measured in pixels and cut where results usually cut them. The heading outline shows every H1 to H6 in order, flags a level that is skipped or a heading left empty, and one click highlights them where they sit. Links are split into internal and external and marked when they carry nofollow, sponsored or user-generated attributes. Images without alt text are counted apart from decorative ones, which carry an empty alt on purpose, and can be highlighted where they sit. The content view gives the word count in any language, the reading level of English text and the phrases used most often, which helps you see what the text is really about. A technical view shows where the canonical tag points, reads the robots and Googlebot directives, catches a title, description or canonical repeated in the head, checks the declared language, viewport and character set, and flags insecure resources on a secure page along with images that only load as you scroll. Loading and layout speed are reported as your own browser measured them on this visit, using the Core Web Vitals that Google publishes, so the numbers reflect a real visit rather than a lab estimate, and a measure the visit did not give says so instead of guessing. The extension also names the technology behind the site, such as the content management system, the framework or the analytics in use.
```

RESULTS PAGE OVERLAY, 1.11.0:

```
RESULTS PAGE OVERLAY
On Google's results pages, a bar under each organic listing shows its position and, with a free account, figures for that listing: the referring domains, backlinks, link rank and estimated traffic of the listing and of its site, how old the domain is, with its registrar and dates when you point at it, and your own checklist score where you analyzed it. Link and traffic figures come from DataForSEO and the domain dates from the registries' public records, and each figure says where it came from. You choose which figures show, whether they load with the page or when you ask, and the look: matching the results in light or dark, Night or Day. A free account gets a daily allowance of figures, and the panel shows what is left of it. Sites you list in Settings are marked as yours. Signed out, the bars show positions and nothing is sent. One panel below the results, or above them if you prefer, copies the listings to your clipboard as a table or exports them to a spreadsheet, with each listing's type, its figures and the features shown with them, such as an AI overview or a map pack. Each row keeps what Google showed for that result, its description and breadcrumb included, along with an approximate overall position when you are past the first page. Dates, ratings and ad labels are read in the language the results are in. Results pages can also be collected one at a time: add each page with a click, move on with the next-page link, and the pages you added become one list with repeats removed and an exact overall position for every listing, ready to copy or export. Another button copies the questions from the People Also Ask box. A location option reopens the same query as it would appear in another city, from 54 metro presets or any place you type, and can open two locations side by side for comparison.
```

Analyze and the results table, 1.12.0 (after RESULTS PAGE OVERLAY):

```
Analyze checks a listing right under it: its title and description measured in pixels, headings, word count, structured data, canonical, whether it can be indexed and why not, its status and redirects, the technology behind it, whether its site's robots.txt shuts out AI crawlers and whether it has an llms.txt, all read from its HTML in your browser without your cookies, with no new tab. One click checks the top ten. A table in the panel lines the listings up, with position, type, the query's words in each title, address and description, title length, date, figures, domain age, words, schema and checklist, each cell marked above or below the median, or below your own page once you pin it as the first row. The sources an AI overview cites get a table of their own.
```

KEYWORD DATA, 1.13.0 (new, after the Analyze paragraph):

```
KEYWORD DATA
Above the listings, a strip shows figures for the query you typed: how many times a month it is looked up, how hard it is to reach the top ten, what advertisers pay a click, how many of them bid, and a line for the last twelve months. The related queries at the foot of the results and each People Also Ask question get their monthly volume beside them, in the same request, and in a list you can export. It loads when you click, or each time if you choose that in Settings, and the figures come from DataForSEO and say so. Add to my keywords puts the query, or any related query or question, in your rank tracker on seobandwagon.com, and asks which tracker when you have more than one. When your tracker already follows the query, your listing shows its position over time. This needs a free account and its own yes: the first time, a note says what is sent before anything is, and a daily allowance applies, with what is left shown under the strip.
```

SEARCH CONSOLE HELPERS, 1.11.0 (any of its languages):

```
SEARCH CONSOLE HELPERS
Inside Search Console's performance report, in any of its languages, each query gets two small buttons: open it on Google, or open it in a private window to see results without your history. When you compare two date ranges, the percent change is placed beside each number so you do not have to work it out.
```

PRIVACY, 1.11.0 to 1.13.3 (two paragraphs):

```
PRIVACY
No account is needed for the analysis, the checks or the exports, and their results stay on your computer. Signed out, nothing is sent. With an account connected, the analyses you run are saved to your account; untick Help improve SEO insights in the popup or in Settings to stop saving them. Figures under results are off until you turn them on in Settings, which says what they send first: the address of each listing shown, never your query. Saved analyses keep the page address, its metadata and the names of its structured data fields, never their values. Screenshots are saved to your computer only and never uploaded. Fetches made for the checks leave out your cookies. Your account key is stored in the browser and sent only to seobandwagon.com.

Analyze reads a listing from your browser without your cookies, and nothing it reads is sent to us. Keyword data is off until you say yes to its own note, which says what it sends first: the words of your query with the related queries and questions shown with it, never a listing's address. Study mode is for invited testers of SEO Bandwagon's AI Overview study and is off until you turn it on in Settings, which says what it sends first: the study's search and the export of its results when you click Send to study and, when you click its stop button, a note that you were stopped that day, to the study and not to your account.
```

**9. Release notes:** `docs/CWS-LISTING.md` §6: 1.13.0's four lines for the
combined upload (1.12.0's and 1.11.0's if the field takes them); 1.13.3's
lines, first in that section, for 1.13.3's own upload.

**Not text, but due with this upload:** store screenshot 4 shows the 1.9.4
bars ("Score 90 · 1 capture") and toolbar, which 1.10.2 removed and 1.11.0
redrew; re-shoot it in `store-assets/1.13.0/` before submitting, with the
keyword strip in view.

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

## Other stores from 2.0.0

Owner, 2026-10-31: "When we launch 2.0.0 I want to have Edge and Firefox
versions." Plan in ROADMAP.md → "The road to 2.0.0" (1.13.5, 1.13.6, 2.0.0);
reasoning in the SEO Bandwagon vault, `03_Wiki/Extension_Roadmap_To_2_0_Design.md`.
Nothing is listed in either store yet; this section gets each store's fields
when its listing is written, as the sections above do for Chrome.

| | Microsoft Edge Add-ons | Firefox Add-ons (AMO) |
|---|---|---|
| Package | `npm run zip -- --target edge` (from 1.13.5): the Chrome manifest without `key`, the new-tab override and `management` | `npm run zip -- --target firefox`: `background.scripts`, `sidebar_action`, `browser_specific_settings.gecko` (id, `strict_min_version`, `data_collection_permissions`), no `externally_connectable`, comments kept so no source upload is needed |
| Listing rules | Policy 1.1.2: the extension and listing name no other browser; reviewer test account (1.3.1); certification up to seven business days | Data consent: `required: ["none"]`; the optional categories follow the data-use table above (see the vault design's consent map); every send is gated on the user's choice |
| Item ID | Assigned at the first upload; the site's Connect uses a bridge, so it doesn't need it | Ours, in `gecko.id` |
| Publishing | `scripts/edge-publish.mjs` (Edge Add-ons API v1.1) uploads; the owner presses Publish in Partner Center (the API has no staged publish). The product and its first listing are created by hand | `web-ext sign --channel=listed`; listed versions go live after the automated check |
| Account | Microsoft Partner Center developer account (owner) | Mozilla add-on developer account with two-factor sign-in (owner) |

## Developer Info

**Publisher Name**: SEO Bandwagon

**Contact Email**: the address on the developer account (owner-held; not
recorded here).

**Support URL**: https://seobandwagon.com/contact

Changed 2026-10-22 (#77): it was this repo's GitHub issues page under its old
name, `seo-bw-extension`. The repo is private, so store users who clicked
Support got a 404. Paste the new URL into the dashboard: Store listing tab,
Additional fields, Support URL.

**Homepage URL**: https://seobandwagon.com

## Companion items

Two Chrome themes, separate store items, in their own repo, [seo-bandwagon/seobw-themes](https://github.com/seo-bandwagon/seobw-themes): listing
text in its `store/LISTING.md`, packaged by its `npm run zip`:

| Item | Status | Item ID |
|------|--------|---------|
| SEO Bandwagon — Neon Night | Published 2026-09-08, category Dark & Black; 1.0.1. Listing updated 2026-10-28 with five screenshots (seobw-themes `store/neon-night-1-new-tab.png` to `-5-side-panel.png`), and again 2026-10-30, both at 1.0.1. **1.0.2 submitted 2026-11-01**, staged publish (run `41332069953`, seobw-themes `f24e9ae`): PENDING_REVIEW. Same images; the version moves with every upload from now on | `bomhiblgnbmpgbddhocomnbijdkmpbhl` |
| SEO Bandwagon — Neon Day | Published 2026-09-08, category Other; 1.0.1. Listing updated 2026-10-28 with five screenshots (seobw-themes `store/neon-day-1-new-tab.png` to `-5-side-panel.png`), and again 2026-11-01, both at 1.0.1. **1.0.2 submitted 2026-11-01**, staged publish (run `41332073322`, seobw-themes `f24e9ae`): PENDING_REVIEW. Same images; the version moves with every upload from now on | `ldifldabjbffldoekbebpickddaiiggm` |

A theme's version goes up with every upload to its store item, a listing
update included (owner, 2026-11-01: "The themes are supposed to get updated
version numbers when we udpated the package and upload new shit to the
store"). Bump its `manifest.json` in seobw-themes, then run that repo's
`store-submit.yml`; a listing change saved in the dashboard goes out with
that submission.

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
| 1.13.3 | 2026-11-03 | 1.13.2 plus **study mode for SEO Bandwagon's AI Overview inclusion study** (invited testers only; the study's pilot is 2026-11-30) and **the AI Overview's sources read on a signed-out page**. **Study mode:** Options gains a section "AI Overview study" with the card "For invited testers of the AI Overview study" (the consent module's `aioStudy` flow, Firefox's `searchTerms`, `browsingActivity` and `websiteContent`; accepted with "Turn on study sends", ended with "Turn off study sends"; its words say the export holds the result count, that the extension never sends a request to Google itself, and that Google's personalization parameter is off (`hl=en`, `gl=us`, `pws=0`); the figures flow's words now read "Never your search terms with them, and never a request to Google.", its version staying 2). Only after that yes does the popup show a **STUDY** tab: `GET /api/v1/aio-study/today` (key scope `study`) lists the day's terms (To do, Carried over, Sent; the date is shown as UTC), each with Search; the worker keeps the list five minutes on the same UTC day, the tab draws it once per opening and asks afresh only after a refusal that says it is stale or a stop, and a rate-limited or unavailable answer never replaces a list it keeps (the site limits an account to a few requests a minute); its states are not available yet, connect, reconnect (a key without the study scope), join on seobandwagon.com, paused this week and turn on study sends. **Search** opens the term in a private window (`chrome.windows.create({ incognito: true })`, `https://www.google.com/search?q=<term>&hl=en&gl=us&pws=0`) and never in a normal one: if the extension is not allowed in private windows, or the window comes back not private, it refuses (closing such a window) and says how to switch on Allow in Incognito, with a button to the extension's Details page. The worker remembers the tab it opened (`chrome.storage.session`, cleared on Connect and Disconnect and when the tab closes). In that tab the overlay's panel sits at the top whatever the placement setting, shows even with "Show on Google results" off, and has an "AI Overview study" group: the term, the AI Overview's state, **Send to study** and **Google stopped me** (`POST /api/v1/aio-study/stop`) asks for a second click, because a stop moves the day's other terms to tomorrow: the first changes the button to "Click again to end today's searches" for five seconds; it is in the STUDY tab too (shown while the day has a term), since Google's CAPTCHA page is not a page the overlay runs on. Figures and keyword data never load or send in a study tab (the overlay never asks and the worker refuses for that tab whatever the settings). **Send to study** (a real click only) posts `{ term_id, csv }` to `POST /api/v1/aio-study/captures`: the overlay's own CSV export of that page, with no figures, no keyword data and no "Your site" marks, only from the tab the study opened, for a term on today's list not yet sent, while the tab still shows the study's search (same words, page 1, `hl=en`, `gl=us`, `pws=0`, not another Google tab such as Videos or News, and none of `tbs`, `lr`, `cr`, `num`, `nfpr`, `filter`, `uule` or `near`, which change the results), at most 262,144 bytes; a term the list names twice is filled oldest first. **The export, every results page:** `Search features` lists the AI Overview wherever it sits (1.13.2 missed it outside `#search` and `#center_col`); an expanded People also ask answer that holds its own AI answer is no longer read as the AI Overview; `AI Overview citations` also lists the pages read from Google's hidden source records (signed out, the overview's links are `/goto` redirects and each source carries a record with the real address) and a side-panel source card's site when its page is hidden; two columns follow `Extension version`: `AI Overview citations read from` (`link`, `record` or `card site`) and `AI Overview citation titles (JSON)`; the citations, text, state and redirect count read only the AI Overview boxes that are shown (1.13.2's known gap, a hidden stale box's links, is closed). The sources are read in the overview's own order (a source chip's link and its record side by side), and addresses of pictures, style sheets and scripts (including `ytimg.com` and `ggpht.com`) are not read as pages. The overlay's AI Overview sources table and the popup's count include the record pages. Measured on the three saved private-window pages (2026-11-03): 27 sources, 23 with page addresses, 4 card sites. **Install warning:** unchanged, measured (`getPermissionWarningsByManifest`, Chromium 156.0.8078.4: the same four warnings for 1.13.2's and 1.13.3's manifests: "Read and change your data on search.google.com, seobandwagon.com, and www.google.com", "Replace the page you see when opening a new tab", "Read your browsing history" and "Manage your apps, extensions, and themes"). No permission or host; one script (`src/lib/aio-study.js`) joins the Google content-script entry. **Data use: new**, for invited testers who turn on study sends, on Send to study, the study's search term and that results page's export (the results' positions, addresses, sites, titles, snippets, breadcrumbs, dates and ratings, the page's features, related searches and People also ask questions, the result count, the AI Overview's text and sources, Google's country and language, the capture time, the extension version), to the study, kept apart from the account; and a stop record on Google stopped me (`POST /api/v1/aio-study/stop`, a note that Google stopped them that day). The Web history and Website content texts and the Google results justification change, and the description's PRIVACY paragraph gains a sentence: "To paste with the combined submission (1.13.0)" (texts 1, 5, 6 and 8). The single purpose (998 of 1,000) is unchanged. | Not submitted (follows the combined submission; outside testers start from the store on 2026-12-07) |
| 1.13.2 | 2026-11-02 | 1.13.1 plus **the AI Overview in the export** (for SEO Bandwagon's AI Overview inclusion study): four columns appended to the results CSV and clipboard export, Collect pages included: AI Overview state (none, loaded or empty), AI Overview text, AI Overview citations via Google redirect, Extension version. Read from the results page on export, or when a page is added to Collect pages; nothing new is sent anywhere. No permission, host, content-script, data-use or listing change. Joins the combined submission, which now uploads 1.13.2. | Not submitted (the combined submission, uploaded at 1.13.2) |
| 1.13.1 | 2026-11-02 | 1.13.0 plus **American English** (owner ruling 2026-11-02: every word the extension shows is American English). The full-page capture's cancel message reads "Capture canceled." (was "Capture cancelled."), the one British word the extension showed; comments and test names follow. No permission, host, content-script, data-use or listing change. Joins the combined submission, which now uploads 1.13.1. | Not submitted (the combined submission, uploaded at 1.13.1) |
| 1.13.0 | 2026-11-02 | 1.12.0 plus **keyword data on Google, into the account** (#68; the last of the four releases that finish the results page; **the combined submission**, owner 2026-11-02: B and C go up as one upload of 1.13.0). **The strip** above the results (under the search box and any top ads, never moving them; above the panel when that is at the top): DataForSEO's monthly searches, difficulty, cost per click, competition and 12-month trend for the search, on a click (the default) or with the page, by setting. **Related searches and People Also Ask questions** get their volume in the same request (50 keywords at most, the search first): a label beside each on Google's page and a list in the strip; questions opened later are asked for on a click. **Add to my keywords** puts the search or any related search or question in the rank tracker (`POST /api/v1/keywords`): added, already tracked, which tracker (several), or a link to making one (none). **Rank history:** a search the tracker already tracks shows the tracked site's position history on its bar. **Limits:** the plan and the day's allowance; at the limit or paused it says so and offers the upgrade where it helps; a key from before the `keywords` scope says Reconnect; nothing else stops. **Exports** gain the keyword data (results CSV columns, a keywords CSV); **settings** gain keyword data on or off, on a click or with the page; the **popup** gains a keyword data block. Two scripts join the Google content-script entry (`src/lib/serp-keywords.js`, `src/overlay/serp-keywords.js`); no permission, host or match. **Install warning:** unchanged, measured (`getPermissionWarningsByManifest`, Chromium 156.0.8078.4: the same four warnings for 1.12.0's and 1.13.0's manifests; a control with `www.example.com` added to the content script turns the first into "Read and change your data on a number of websites"). **Data use: new** — the search's words, its related searches and People Also Ask questions, the Google's country and language, and a search added to the rank tracker, only with an account connected and after keyword data's own yes (its first-use disclosure on the results page, a real click only, or its card in Options; the consent module's `keywordData`, Firefox's `searchTerms`); Web history and Website content's texts, the Google results justification, the single purpose (998 of 1,000) and the description change: "To paste with the combined submission (1.13.0)". | Not submitted (the combined submission, uploaded at 1.13.0) |
| 1.12.0 | 2026-11-02 | 1.11.0 plus **Analyze on Google** (the owner's "Stay on Google", 2026-11-01; store submission C, with 1.13.0). **Analyze** opens a row under the result with the page's checks: title and description in characters and Google's pixels, H1, words, schema types, canonical (itself or elsewhere), indexable and why not (status, robots or Googlebot meta, X-Robots-Tag, canonical), status and redirect, hreflang, technologies, the AI crawlers its site's robots.txt blocks, whether it has an llms.txt, and the on-page checklist. The worker fetches the page from the user's browser without cookies (under the optional all-sites access asked once, 1.10.2's window), three at a time, and reads it in an offscreen document (`offscreen`, new, no warning: measured) with the popup's analyzer; on Firefox the background page reads it. No tab opens; "Full report" opens the page with its full analysis. A result Google hides from a signed-out user asks to sign in to Google or open it; nothing fetches it. **Analyze top 10** checks every result at once. **The results table** where the panel sits: position, result, type, the search's words in title, URL and description, title length, date, the page's and the site's figures, domain age, words, schema, checklist; cells marked ▲▼ against the search's median or the user's pinned page; columns chosen in settings, sortable, exported as CSV. **Your page pinned** as the first row (its checks, and its figures on the Pin click). **AI Overview sources** in their own table, with figures and checks on a click and their own export. **Data use:** the page fetches go to the result's own site, never to us; a pinned page's address and the AI Overview's sources go to `/api/v1/serp/metrics` for their figures only on the user's click, so the figures' consent words change (version 2: everyone who accepted is asked again). | Not submitted (the combined submission, uploaded at 1.13.0) |
| 1.11.0 | 2026-11-01 | 1.10.4 plus **figures under every Google result** (the owner's "metrics on the SERP page", 2026-11-01; the last of store submission B). **Figures:** one bar under each result with its position, then, chosen in settings, the page's referring domains, backlinks, rank, traffic and ranking keywords and the site's rank, referring domains, traffic and ranking keywords (DataForSEO's, rank on its 0 to 100 scale, labelled so), the domain's age with registrar and dates on hover (RDAP), and the user's own on-page checklist where they captured the page; no authority score of ours. From `POST /api/v1/serp/metrics` (key scope `serp`; a key without it shows Reconnect), 10 results a call, kept for the browser session only. Signed out of Google, a result known only by its site gets the site's figures and "sign in to Google to see page figures", with no request to Google; signed out of SEO Bandwagon, position, Analyze and "Connect free to see figures". The plan and the day's allowance (free 20 searches with new figures, Pro 250) show in the panel; at the limit or paused at the monthly ceiling the bars say so and offer the upgrade where it helps. **The panel:** the toolbar becomes one collapsible panel with groups (Figures, Export, People also ask, Collect pages, Location), below or above the results by setting (#53). **Look:** the extension's tokens in Match Google, Night or Day, WCAG AA (Analyze was 3.3:1, white on pink). **Settings:** a "Google results" section in Options and the popup. **Popup on a results page:** the search's features, exports, account, plan and allowance, settings. **Exports** gain each result's type, its figures, the search's features and the AI Overview's sources. **Your own sites** marked, from a list in Options. **Other Googles:** 20 more domains, dates, ratings and ad labels in each one's language, Search Console in its other languages. **Consent module** (`src/lib/consent.js`): every send checks its data category (Firefox's, or today's switch on Chrome and Edge) and its acceptance. **Install warning:** unchanged, measured (the same four warnings with 10 and with 30 Google domains). **Data use: new** — the result addresses on a Google results page, after the user accepts them in Options, never the search; Website content's purpose, the content-script justification, the single purpose and the description change (see "To paste with the combined submission (1.13.0)"). | Not submitted (the combined submission, uploaded at 1.13.0) |
| 1.10.4 | 2026-11-01 | 1.10.3 plus **the score and the page analysis tell the truth** (the second of store submission B). **One list of checks** behind the score, the four sub-scores, the page-checks panel and the new tab's next fix: 18 checks whose points add up to 100, so https, mixed content and noindex count in the score as well as the sub-scores (an http or noindex page could score 100). The score is an on-page checklist, 100 minus the points its issues cost; every issue in the popup shows its fix and its points. **Words in every language** (a Russian or Japanese page counted 0 words and read "Thin content"); readability scored for English pages only; JSON-LD, Microdata and RDFa all count as structured data. **Page Meta:** the canonical as its URL, pointing to itself or elsewhere; the Googlebot meta; repeated title, description and canonical tags; lang, viewport and charset; the result preview cut by pixel width. **Core Web Vitals** measured as the spec measures them, "No data" where the visit gave none (a background tab gets no LCP), "measured on this visit". **Headings:** the full ordered H1 to H6 tree with skipped and empty headings flagged. **Images:** an empty alt is decorative, not missing; the word count reads the body when the main region is tiny. **Tech stack** read in the page's own world with one `executeScript` (`world: 'MAIN'`) from the worker, under the `scripting` permission it already has: the Facebook Pixel, Nuxt and Vue are found, and Tag Manager is not reported as Analytics. No permission, host, content-script or install-warning change (the manifest differs by its version only). **Data use:** nothing new is sent; a synced capture carries more on-page facts of the same page in the fields it already has. Detailed description: ON-PAGE ANALYSIS updated in `docs/CWS-LISTING.md`, to paste with the combined submission. | Not submitted (the combined submission, uploaded at 1.13.0) |
| 1.10.3 | 2026-11-01 | 1.10.2 plus **the account features work for a normal user** (the first of store submission B). **Connection:** the API module exports `hasApiKey`, which the new tab and the page-checks panel read; without it a second device (the key arrives through Chrome sync, the key's status doesn't) read as signed out. "Connected" now means a key that verified; a key with no answer yet reads "Checking key" and is checked once with `/v1/me`. Every Connect, key change, Disconnect and API address change clears the account's caches (key status, `/v1/me` answer, chosen business, the new tab's progress, the popup's page history). A 429, a 503 or no connection is no longer "signed out" in the Citations tab and the side panel. **Capture sync:** a capture refused for the key is sent again after a reconnect, instead of never; any other 4xx is not retried (a 400 was posted five times). **Page history** (the popup's strip, was "Domain history"): only this page's own captures, labelled "This page"; the "Domain avg" line is gone, and with it the popup's `GET /api/domain/:domain/quick` request (its figure pooled every account's captures). **Citations:** the listing's own website is read (JSON-LD `url`, Microdata `url` and the fallback were the directory's page) and compared by host, without `https://`; every schema.org business subtype (Dentist, Plumber…) is read; REPORT runs the NAP check first, so nothing is filed unchecked (it was filed as "active"); the signed-out and picker copy no longer promise proof filed with the citation; "Last 3 checks" is "Latest citations", newest first. **Side panel:** the average is a number ("NaN%" with two scored citations); a failed campaign says failed; Approve/Hold/Reject only on qualified and held outlets; Link Building has its own not-connected words. **Options:** the Advanced API address no longer accepts the retired `--seobandwagon.netlify.app` hosts. No permission, host, content-script or install-warning change. **Data use:** less is sent (no domain lookup from the popup); no dashboard answer changes. | Not submitted (the combined submission, uploaded at 1.13.0) |
| 1.10.2 | 2026-11-01 | 1.10.1 plus **the Google results page shows the right numbers, and Analyze stays on Google** (owner, 2026-11-01; store submission A, alone). The bar under each result drops "Score N · M captures" (an on-page grade averaged over the whole host and every account's captures, "No score yet · 0 captures" for nearly every site) and its `quick-batch` lookup: it shows the organic position, with the position counting everything on the page in its tooltip, the same as Copy results, the CSV and Collect, and it sits below the whole result instead of between title and description. People also ask answers no longer count as results; a result the parser can't place keeps its slot as "unknown site"; "Absolute position (approx.)" counts the earlier pages' organic results. **Analyze** opens the result in a background tab, analyzes that tab by its ID and puts the on-page checklist line under the result with "Open report"; without all-sites access it asks once from the extension's own window (`src/access/access.html`, the existing `ALL_URLS_REASON`). Collect keeps two results from one site that only Google's link tells apart; exports gain "Position counting everything", "URL known" and "Place name". Six metro presets renamed to Google's geotargets names; "Compare in two tabs" opens both; "Web results only" finds Google's `udm=14` Web tab; a visible notice when no results are read. Search Console: icons follow tab switches (`webNavigation.onHistoryStateUpdated`); searches open with `pws=0` and the property's country. **India:** `www.google.co.in` replaces `www.google.in` in the content-script matches; `getPermissionWarningsByManifest` (Chrome for Testing 151) gives the same four warnings before and after. No new permission. **Data use:** less is sent: the overlay's bare-domain lookup is gone; an Analyze capture is saved and synced as the popup's always was. Dashboard text to change on submit: the Google results content-script justification and the Web history purpose (above); not changed with this submission, due with submission B. | **Published** 2026-11-01 (check run `41329861291`: PUBLISHED (1.10.2); the update server serves 1.10.2). Submitted 2026-11-01, staged publish: run `41323144644` (GitHub release `v1.10.2`, commit `be5fe7d`), the first submission on the 2026-11-01 road (submission A, alone) |
| 1.10.1 | 2026-10-27 | 1.10.0 plus a fix for the new tab with Neon Night or Neon Day on: the Night / Day / Auto switch stayed on screen and did nothing, because its `display` overrode the `hidden` attribute. It is now hidden, as 1.9.5 meant; the popup, side panel and settings are unchanged. It was #137, written as 1.9.6 and rebuilt on 1.10.0 after #138 merged first. No permission, host or content-script change; no data-use change. | **Published** 2026-10-28 (check run `40728987116`: PUBLISHED (1.10.1); the update server serves 1.10.1). Submitted 2026-10-28, staged publish: run `40683986066` (GitHub release `v1.10.1`, commit `1df4ff6`), approved the same day (STAGED at 15:53 UTC). Two earlier tries on 2026-10-27 were refused (HTTP 400) while 1.9.5, then its listing update, was in review |
| 1.10.0 | 2026-10-27 | 1.9.5 plus **rank drops first on the new tab** (part C of the rank-drops design): signed in, the tab leads with Rank changes for one tracker at a time (a switcher when there are several, the one with the most drops first). Each keyword that fell shows from → to as the site's feed gives it (`rankTracking.drops`, the window's start against now), the page that lost it, the page Google ranks instead when it swapped them, who holds the old position, the next fix for that page when it has been captured, and "Analyze this drop on seobandwagon.com", which opens the drop page on the user's own dashboard. Then the keywords that went up; Tasks beside; recent audits below with each page's full address, first two issues and date (signed out too). The scan box stays, smaller. Single-purpose statement grows to name rank changes. No permission, host or content-script change; **no data-use change**: the same `GET /api/extension/progress` request as 1.9.1, which already returned these fields. Screenshot 5 re-shot (`store-assets/1.10.0/`). | Not submitted (folded into 1.10.1) |
| 1.9.5 | 2026-10-26 | 1.9.4 plus **the new tab follows the theme**: the dashboard shows only with SEO Bandwagon's Neon Night or Neon Day theme installed (found with the new `management` permission), in that theme's Night or Day; anyone else is handed to Chrome's own new tab. A New tab setting (with a theme, Always, Never), an optional search box (the user's own engine) and most-visited sites (`optional_permissions` `topSites`, `search`), and a popup prompt to add a theme. New install warning "Manage your apps, extensions, and themes" (see Permissions Justification). Data use: unchanged, nothing new is sent. | **Published** 2026-10-27 (the update server serves 1.9.5); its listing update (single purpose, screenshot 5) was live 2026-10-28 (check run `40683781629`). Submitted 2026-10-26, staged publish: run `40386533992` (GitHub release `v1.9.5`, commit `678816c`); the first try (run `40373427903`) was refused until the dashboard fields were filled in |
| 1.9.4 | 2026-10-23 | 1.9.3 plus #129: on a page Chrome never lets an extension script (its own pages, the new tab, other extensions' pages, the Chrome Web Store, a file while file access is off) the popup says why before trying, and no longer leaves "Receiving end does not exist" on chrome://extensions → Errors. The side panel's Scan uses the same check. No permission, host or content-script change; no data-use change. | **Published** by 2026-10-26 (check run `40373177944`: PUBLISHED (1.9.4); the update server serves 1.9.4). Submitted 2026-10-23, staged publish: run `39988339252` (GitHub release `v1.9.4`, commit `451d19c`) |
| 1.9.3 | 2026-10-21 | 1.9.2 plus a fix for signed-in Google results, where result links are direct: the sitelinks under a result (Contact, About Us…) and the AI Overview's heading each counted as a result of their own, so on "seo bandwagon" the overlay and the exports held seobandwagon.com seven times and LinkedIn at 8 instead of 2. Sitelinks now count as part of their result, as DataForSEO counts them, and the AI Overview is left out. No permission, host or content-script change; no data-use change. | **Published 2026-10-23** by the owner after approval (submitted 2026-10-22, run `39858017060`, GitHub release `v1.9.3`, commit `828146d`). A check run that day read PUBLISHED (1.9.3); Google's update server served 1.9.3 |
| 1.9.2 | 2026-10-21 | 1.9.1 plus a fix for signed-out Google results: LinkedIn, Facebook, Instagram, TikTok and Pinterest profiles that show a follower count instead of a URL breadcrumb were dropped from the overlay and the exports, and every later position moved up. They are now placed by their site name, as Reddit, YouTube and Quora already were. No permission, host or content-script change; no data-use change. | Not submitted (folded into 1.9.3) |
| 1.9.1 | 2026-10-18 | 1.9.0 plus **the new tab's account cards**: signed in, Rank tracking (per tracker, keywords in the top 10 and top 3, moved up and down over 7 days, the biggest movers) and Tasks (the next fix first, then tasks the site derives from rank data) from `GET /api/extension/progress` (scope `progress`), at most one request every 10 minutes (`chrome.storage.session`). A 403 (a key from before the scope) shows Reconnect; a 404 or a network failure shows only the local cards. Signed out or with sync off, nothing is sent. No permission, host or content-script change; the request is a read with the user's own key. | Not submitted (folded into 1.9.3) |
| 1.9.0 | 2026-10-18 | 1.8.4 plus **a new tab page** (`chrome_url_overrides.newtab`, owner ruling 2026-10-18 reversing the 2026-09-07 one): recent audits with each page's score change since its previous capture, the latest capture's checks, and the next fix (the analyzer's first issue, with fix text built from the page's numbers). Read from the newest 50 local captures; opening a new tab sends no request. The scan box opens a typed site in that tab through the 1.8.4 analyze flow (`analyzeResult` with `sameTab`), and the popup analyzes it. Night, Day and Auto follow the other surfaces, over the Neon 1.0.1 wallpapers as WebP (118 KB together). New install warning, "Replace the page you see when opening a new tab", so the update disables existing installs until accepted (see Permissions Justification). No permission or host added; nothing new is sent. | Not submitted (folded into 1.9.3) |
| 1.8.4 | 2026-10-17 | 1.8.3 plus **Analyze on a Google result runs the analysis**: the bar's Analyze link only opened the result in a new tab, and nothing analyzed it until the icon was clicked. A plain click now opens the result and, once the page it lands on has loaded (past Google's `/goto` or `/url` redirect), the popup, which analyzes it; the context menu's "Analyze linked page" uses the same flow (`src/lib/analyze-link.js`). Each analysis starts from that person's click on one result. Without "access to all sites" the popup offers "Allow access to analyze other tabs" (S29). No permission, host or content-script change; nothing new is sent. | Not submitted (folded into 1.9.3) |
| 1.8.3 | 2026-10-17 | 1.8.2 plus `"key"` in `extension/manifest.json`: the store item's public key, so an unpacked copy has the store ID and the dashboard's "Connect Chrome extension" button finds it. **Nothing changes in the store package**: `npm run zip` drops the `"key"` line (the store assigns the ID and reportedly rejects an upload carrying it), and `check:zip` fails if it is there. No permission, host, content-script or data-use change. | Not submitted (folded into 1.9.3) |
| 1.8.2 | 2026-10-16 (branch `fix/1.8.2-overlay-connect-link`) | 1.8.1 plus a fix for signed-out users on Google results: "Connect your account" under each result linked to the extension's Options page, which Chrome blocks from a web page ("This page has been blocked by Chrome", ERR_BLOCKED_BY_CLIENT). It now opens seobandwagon.com/dashboard/api-keys, which signs the user in and connects the extension in one click. Nothing is made web-accessible. No permission, host or content-script change; no data-use change. | Not submitted (folded into 1.9.3) |
| 1.8.1 | 2026-10-14 (branch `fix/1.8.1-lighter-package`) | 1.8.0 plus a lighter package. About 29% of the shipped code was comments, so `npm run zip` (`scripts/build-zip.mjs`, new) now passes JavaScript and CSS through esbuild's parser with no minification (names and formatting stay readable for review; only comments go) and drops HTML comments: the zip goes from 327 KB to 222 KB (858 KB → 629 KB unpacked). The source keeps its comments. Also removes a worker message handler nothing sent (`getLocalCaptures`) and an unused popup helper. Live on the stripped package: analysis, non-HTML states, hreflang SELF, View as, visible text, side-panel scan-on-click and access prompts, full-page proof surviving the popup, and Collect pages over 5 Google pages all behave as on 1.8.0. No permission, host or content-script change; no data-use change. | Not submitted (folded into 1.9.3) |
| 1.8.0 | 2026-10-14 (branch `feat/1.8.0-collect-pages`) | 1.7.9 plus the first feature of the 1.8 line. **Collect results pages (#45):** Google ignores `&num=`, so a top 50 is five pages, each numbered from 1. On a Google results page, **Add page N** adds the page you're on and **Next page →** follows Google's own Next link; **Web results only** opens Google's own Web tab. Each page is a person's click: nothing walks or fetches pages by itself. **Copy collected** / **Export collected CSV** give one list deduped by URL in page order, with an exact absolute position, the page and position on it, and notes for a skipped page or a result that moved when a page was added again. Up to 10 pages per search, kept in `chrome.storage.session` (cleared with the browser), never sent. Exports gain "Absolute position" and "Collection notes" columns, after the existing ones. No permission, host or content-script change. **Data use: unchanged.** | **Published.** Submitted 2026-10-14 as a staged publish (Submit to Chrome Web Store run `38585569640`, GitHub release `v1.8.0`, commit `f19c404`; the store API answered `PENDING_REVIEW`). Google's update server served 1.8.0 on 2026-10-22; the day it was published is not recorded |
| 1.7.9 | 2026-10-14 (branch `fix/1.7.9-verified-fixes`) | 1.7.8 plus fixes confirmed at runtime from the 2026-10-12 static review. **A PDF, an SVG or a sitemap says what it is (#63, #89)** instead of a score of 25 (a PDF) or a popup stuck on "Analyzing page…" (an SVG: the analysis threw and never answered); an analysis that throws now says so. **Hreflang and the canonical check ignore tracking parameters (#92):** a correct page opened from a `?utm_…` link read NOT INDEXABLE with every alternate NO RETURN; **the page's own hreflang entries read SELF (#91)**, not UNREACHABLE. **"View as" shows the new user agent's analysis (#93).** **Headings and link text keep words apart across `<br>` (#87).** **Local history makes room by size (#90):** captures average 35 KB, so the 10 MB local quota filled at ~290, before the 500 cap, and saving then stopped silently. **History search matches words, titles and hosts (#62).** Results labelled "Downloads", "Threads" and the like are no longer taken for ads (#94). **A person starts every scan:** the side panel's Page checks no longer analyzes (and saves, and syncs) each page as you switch tabs or a page loads; it shows a result already taken or waits for "Scan this page". Where the extension can't read a tab (the side panel on a tab whose icon wasn't clicked; the tab "Analyze linked page" opens), it offers "Allow access to analyze other tabs", which asks for the existing optional access to all sites through Chrome's prompt, instead of "Chrome blocked analysis". No permission, host or content-script change; the optional permission's consent text and the listing (§ permissions) name the two new places it can be asked from. **Data use: less** — no capture is taken or synced without a click. | Not submitted (folded into 1.8.0) |
| 1.7.8 | 2026-10-13 (branch `fix/1.7.8-proof-off-popup`) | 1.7.7 plus full-page proof fixes. **A capture outlives the popup (#48):** the scroll-and-stitch loop, its canvas and the finished image lived in the action popup, which closes on any click away, so a 10–20 s capture or an undownloaded proof was lost; now the service worker runs one capture per tab (`OffscreenCanvas`), keeps the finished image in the extension's IndexedDB and its state in `chrome.storage.session`, and a reopened popup shows the progress or the proof. **Smaller proofs with a time estimate (#51):** full-page proofs are JPEG (quality 0.85; 35–40% smaller in live runs, e.g. a Wikipedia article 4.36 MB → 2.6 MB) and progress reads "Capturing 3 of 14 · about 6 s left". **Switching tabs ends a capture at once with "You switched tabs" (#64)** instead of a 6 s wait and "The page stopped responding". No permission, host or content-script change; the activeTab grant from the toolbar click covers the worker's capture as it did the popup's. **Data use: unchanged** — the proof still never leaves the device; the listing's §5 note now says where it waits. | Not submitted (folded into 1.8.0) |
| 1.7.7 | 2026-10-13 (branch `fix/1.7.7-correctness`) | 1.7.6 plus small correctness fixes. **Signed out, the results overlay sends nothing (#50):** until now a signed-out user's result domains were POSTed to `/domain/quick-batch` (answered 401) despite the listing's §5 "sends nothing at all"; the overlay now asks the worker, which calls the API only with a key and caches stats per domain for 10 minutes (the content-script cache never worked). **Side panel "Page checks →" opens (#49).** **The popup on a results page says what the overlay found (#56).** Results exports gain an "Absolute position (approx.)" column, last (#45); export filenames carry the page path and time, so they no longer collide (#55); Copy buttons' text is clean after a flash (#54). No permission, host or content-script change. **Data use: less** — a signed-out user now matches §5 exactly. | **Published.** The store API reported 1.7.7 published on 2026-10-14, before 1.8.0 was submitted. Package: `npm run zip` from `main` at `74d1d5e`, checked with `check:zip` (72 files, `manifest.json`, `lib/`, `src/` only). Listing text: `docs/CWS-LISTING.md`, release notes in its section 6. No permission or data-use change since 1.7.1 |
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
  plainly rather than minimising it. From 1.11.0 the content script runs on
  thirty Google search hosts; Chrome names them all as www.google.com, so the
  warning reads the same (measured).
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
