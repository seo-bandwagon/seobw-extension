# Chrome Web Store Listing — SEO Bandwagon

> Last Updated: 2026-09-24

Single source of truth for the Chrome Web Store dashboard fields. Lives at the
repo root, outside `extension/`, so `npm run zip` never ships it. Update it on
every PR that changes the extension: bump the date, refresh the descriptions if
user-facing behaviour changed, re-justify any permission, host or content-script
change, and add a Version History row.

Long-form reviewer text (one paragraph per permission, data-use reasoning,
reviewer test steps) is in `docs/CWS-LISTING-1.6.1.md`; the two Chrome theme
items have their own listing text in `themes/store/LISTING.md`. This file
summarises both and says where to paste what.

Store item: `dphmaddiedhkejfhabkfdenfphjljioj`. Measured on the live store page
2026-09-24: version 1.2.0, "Updated May 8, 2026", 7 users, and the detailed
description still opens with the April 23 downtime notice ("We are updating our
infrastructure for our new version, you may experience downtime April 23,
2026"). Google's update server (what Chrome installs from) also returned
1.2.0 that day. In the dashboard, 1.6.0 is an **uploaded draft that cannot be
published** until six permissions have a justification (alarms,
declarativeNetRequestWithHostAccess, sidePanel, tabs, webNavigation,
webRequest; paste text in `docs/CWS-LISTING-1.6.1.md` §3a). The listing edits
(downtime notice removed, theme cross-link IDs) were made in the dashboard but
had not reached the public pages on 2026-09-24. Check the update server, not
only the listing page:
`https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=140.0&acceptformat=crx3&x=id%3Ddphmaddiedhkejfhabkfdenfphjljioj%26uc` The live
category is **Productivity › Tools**, not the Developer Tools set below; change
it in the dashboard with this submission. 1 rating (5 stars).

## Store Listing

**Extension Name**

```
SEO Bandwagon
```

**Short Description** (130 chars, matches `extension/manifest.json` `description`)

```
SEO analysis, link check, indexability, hreflang, rendering, structured data, citations and link-building, synced to your account.
```

**Detailed Description**

Paste `docs/CWS-LISTING-1.6.1.md` §2 verbatim. Section headings it covers, in
order: On-page analysis · Link check · Indexability · Hreflang · Rendering ·
Structured data · Google results overlay · Search Console helpers ·
Appearance · Tools menu · Exports · Account sync (optional). Every feature
named there is shipped on `main`; nothing planned appears in it.

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
| Screenshot 1 — popup, Analysis tab with score and fixes | 1280×800 | ✅ Ready 2026-09-24 | `store-assets/1.6.1/screenshot-1-analysis-1280x800.png` |
| Screenshot 2 — Link Check results grouped by outcome | 1280×800 | ✅ Ready 2026-09-24 | `store-assets/1.6.1/screenshot-2-link-check-1280x800.png` |
| Screenshot 3 — Indexability panel with redirect chain | 1280×800 | ✅ Ready 2026-09-24 | `store-assets/1.6.1/screenshot-3-indexability-1280x800.png` |
| Screenshot 4 — Google results overlay stats bar | 1280×800 | ✅ Ready 2026-09-24 | `store-assets/1.6.1/screenshot-4-serp-overlay-1280x800.png` |
| Screenshot 5 — Page-checks panel in Night and Day | 1280×800 | ✅ Ready 2026-09-24 | `store-assets/1.6.1/screenshot-5-night-day-1280x800.png` |
| Small Promo Tile | 440×280 | ✅ Ready 2026-09-24 | `store-assets/1.6.1/promo-tile-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready 2026-09-24 | `store-assets/1.6.1/promo-marquee-1400x560.png` |

### Screenshot Notes

Take them from the unpacked build at `extension/` on a real public page,
Night appearance for 1–4 and a Night/Day pair for 5. Show the extension in
action on the page, not the popup floating alone. No competitor names or
logos anywhere in frame.

## Permissions Justification

One line each here; the reviewer-length paragraph for every row is in
`docs/CWS-LISTING-1.6.1.md` §3 — paste those into the dashboard's
per-permission fields.

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Reads the current tab's URL and title only when the user clicks the icon or uses the shortcut. |
| `storage` | permissions | Saves analyses, cached responses, the API key and settings on the user's device. |
| `contextMenus` | permissions | Right-click "Analyze this page", "Analyze linked page", "Count words" and the tools submenu. Nothing runs without a menu choice. |
| `scripting` | permissions | Injects the analysis script into the active tab when an analysis is requested. |
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

Reasoning for each row: `docs/CWS-LISTING-1.6.1.md` §5.

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

Two Chrome themes, separate store items, listing text in
`themes/store/LISTING.md`, packaged by `npm run zip:themes`:

| Item | Status | Item ID |
|------|--------|---------|
| SEO Bandwagon — Neon Night | Published 2026-09-08, category Dark & Black | `bomhiblgnbmpgbddhocomnbijdkmpbhl` |
| SEO Bandwagon — Neon Day | Published 2026-09-08, category Other | `ldifldabjbffldoekbebpickddaiiggm` |

Both ids are in `THEME_IDS` in `extension/src/lib/theme-mode.js`, so the
extension's options page shows its theme links from 1.6.0 on.

**Open on the live listings:** both descriptions were uploaded with the
placeholder cross-link URLs (`.../detail/ITEM_ID_DAY` and `.../ITEM_ID_NIGHT`)
still in them, so each theme's "PREFER LIGHT / PREFER DARK" link is dead. Paste
the corrected blocks from `themes/store/LISTING.md` over the description in each
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
| 1.6.1 | 2026-09-24 (main) | 1.6.0 plus fixes: Search Console compare mode reduced to two inline badges (#13); row icons stay on the Queries tab, tab detection fails closed (#20); SERP export carries each result's description, date, rating, site name, display URL and breadcrumb plus the search's context (#22). No permission, host or content-script change from 1.6.0. Listing text: `docs/CWS-LISTING-1.6.1.md`. Remove the downtime notice from the live description when submitting. | Draft — package with `npm run zip`, not Finder |
| 1.6.0 | 2026-09-06 | Competitor parity: Link Check, Indexability, Hreflang, Rendering + "View as", Structured Data validation, Google results overlay, Search Console compare badges, tools menu, CSV exports. New permissions: `webRequest`, `webNavigation`, `declarativeNetRequestWithHostAccess`, optional `<all_urls>`; new content-script match on Google search. 2026-09-07: Night/Day/Auto appearance, bundled brand fonts. 2026-09-08: themed page-checks side panel, opened per tab from the existing panel. Neither changes the manifest. Release notes in `docs/CWS-LISTING-1.6.1.md` §6. | Uploaded as a dashboard draft, not published: six permission justifications missing (2026-09-24). Replace the package with 1.6.1 |
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
  need an account: `docs/CWS-LISTING-1.6.1.md` §7.
- The live store screenshots still show the 1.2.0 interface. Replacements for 1.6.1
  are in `store-assets/1.6.1/` (real extension, real pages; how in its README).
- The live 1.2.0 description still carries the April 23 downtime notice
  (measured 2026-09-24). The 1.6.1 description in `docs/CWS-LISTING-1.6.1.md` §2
  replaces it; until then, the notice can be removed from the live listing on
  its own.

### Rejection History

None recorded.
