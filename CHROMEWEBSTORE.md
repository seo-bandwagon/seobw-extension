# Chrome Web Store Listing — SEO Bandwagon

> Last Updated: 2026-09-07

Single source of truth for the Chrome Web Store dashboard fields. Lives at the
repo root, outside `extension/`, so `npm run zip` never ships it. Update it on
every PR that changes the extension: bump the date, refresh the descriptions if
user-facing behaviour changed, re-justify any permission, host or content-script
change, and add a Version History row.

Long-form reviewer text (one paragraph per permission, data-use reasoning,
reviewer test steps) is in `docs/CWS-LISTING-1.6.0.md`; the two Chrome theme
items have their own listing text in `themes/store/LISTING.md`. This file
summarises both and says where to paste what.

Store item: `dphmaddiedhkejfhabkfdenfphjljioj` (serving 1.2.0 as of
2026-09-07; 1.6.0 is on `main` and not yet submitted).

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

Paste `docs/CWS-LISTING-1.6.0.md` §2 verbatim. Section headings it covers, in
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
| Screenshot 1 — popup, Analysis tab with score and fixes | 1280×800 | 🟡 Needs update (store still shows 1.2.0 UI) | not in repo |
| Screenshot 2 — Link Check results grouped by outcome | 1280×800 | ⬜ Not created | not in repo |
| Screenshot 3 — Indexability panel with redirect chain | 1280×800 | ⬜ Not created | not in repo |
| Screenshot 4 — Google results overlay stats bar | 1280×800 | ⬜ Not created | not in repo |
| Screenshot 5 — Side panel (Citations / Links) in Night and Day | 1280×800 | ⬜ Not created | not in repo |
| Small Promo Tile | 440×280 | ⬜ Not created | (theme tiles exist under `themes/store/`, not for this item) |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes

Take them from the unpacked build at `extension/` on a real public page,
Night appearance for 1–4 and a Night/Day pair for 5. Show the extension in
action on the page, not the popup floating alone. No competitor names or
logos anywhere in frame.

## Permissions Justification

One line each here; the reviewer-length paragraph for every row is in
`docs/CWS-LISTING-1.6.0.md` §3 — paste those into the dashboard's
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
| `https://www.google.com/search*` + 9 ccTLDs | content_scripts | Results overlay: appends a stats bar and toolbar, never hides or moves anything including ads. Sends only bare result domains to our API, never the query. |
| `externally_connectable` → `https://seobandwagon.com/*` | manifest key | Lets the dashboard's "Connect Chrome extension" button hand over a freshly minted API key. No other origin can message the extension. |

Not present and deliberately so: `management`, `chrome_url_overrides`,
`web_accessible_resources`, `identity`, `oauth2`.

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

Reasoning for each row: `docs/CWS-LISTING-1.6.0.md` §5.

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
| SEO Bandwagon — Neon Night | Draft, not uploaded | fill `THEME_IDS.dark` in `extension/src/lib/theme-mode.js` and `ITEM_ID_NIGHT` in the listing after upload |
| SEO Bandwagon — Neon Day | Draft, not uploaded | fill `THEME_IDS.light` and `ITEM_ID_DAY` |

Until both ids are real, the options page hides its theme links.

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.6.0 | 2026-09-06 (main) | Competitor parity: Link Check, Indexability, Hreflang, Rendering + "View as", Structured Data validation, Google results overlay, Search Console compare badges, tools menu, CSV exports. New permissions: `webRequest`, `webNavigation`, `declarativeNetRequestWithHostAccess`, optional `<all_urls>`; new content-script match on Google search. 2026-09-07: Night/Day/Auto appearance, bundled brand fonts (no manifest change). Release notes in `docs/CWS-LISTING-1.6.0.md` §6. | Draft — package with `npm run zip`, not Finder |
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
  need an account: `docs/CWS-LISTING-1.6.0.md` §7.
- Store screenshots still show the 1.2.0 interface; refresh before submitting.

### Rejection History

None recorded.
