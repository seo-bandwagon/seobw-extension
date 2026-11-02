# SEO Bandwagon Chrome Extension

**Version 1.13.2** · Manifest V3 · vanilla JS, zero dependencies, no build step

Instant on-page SEO analysis, local-SEO citation checks, and link-building review, in one toolbar icon. Works fully offline; connect an SEO Bandwagon account to sync captures, check citations, and manage outreach without leaving the page.

## What it does

- **SEO Analysis** — score ring (0–100, A–F grade) with four sub-scores (Meta, Content, Links, Tech), page meta with a SERP preview, Core Web Vitals (LCP/INP/CLS/FCP/TTFB), heading structure, link and image audit with on-page highlighting, content stats and n-grams, tech stack detection, and a page-history strip showing your account's earlier captures of this page.
- **Link Check** — probes every link on the page (status groups, on-page highlighting, CSV export); needs the optional "check other sites" permission.
- **Indexability** — the page's redirect chain, response headers, and X-Robots-Tag, combined with its meta robots/canonical, into an indexable/not-indexable verdict; also traces any URL you type.
- **Hreflang** — validates every declared `hreflang` tag (BCP 47 form, duplicates, self-reference, x-default) and, on request, fetches each alternate to confirm it links back.
- **Rendering** — compares the page's raw (unrendered) HTML against what your browser actually rendered, and a "View as" switcher for testing server-side rendering and cloaking under a different user-agent.
- **Structured Data** — extracts JSON-LD, Microdata, and RDFa, validates required/recommended properties per type, and shows which Google rich results an item is eligible for.
- **Citations** — detects 40 curated local-SEO directories on the current page, extracts the page's NAP (JSON-LD → microdata → heuristic) and scores it against your business record, captures a proof screenshot (the full page by default, or just the visible area), and files the citation to your account in one click.
- **Link Building** — side panel view of your outlets (qualified prospects), pitches (draft/approved), and results (placements, funnel, spend), plus "Add current tab as outlet."
- **SERP overlay** — on Google's own results pages, keyword data for the search (monthly searches, difficulty, CPC, competition and trend, with volumes for its related searches and People also ask, and "Add to my keywords" for the rank tracker), a stats bar under each organic result, one-click results/PAA export, and a location simulator for seeing what searchers in another metro are shown.
- **Search Console helpers** — row-level "open in Google Search" actions and compare-mode percent-change badges on Search Console's own Performance report.
- **Tools** — a right-click "SEO Bandwagon tools" submenu (and matching popup row) for Google Search Console, PageSpeed Insights, Rich Results Test, Wayback Machine, `site:` search, and sitemap.xml/robots.txt shortcuts.

## Installation

### From the Chrome Web Store

Search "SEO Bandwagon" in the Chrome Web Store, or use the one-click "Connect Chrome extension" button on [seobandwagon.com/dashboard/api-keys](https://seobandwagon.com/dashboard/api-keys) once it's installed.

### Load unpacked (development)

1. Clone this repo
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select the `extension/` folder (the only folder that ships; everything else in this repo is tests, preview pages, docs and scripts)
5. Pin the extension to your toolbar

**An unpacked copy has the store ID** (`dphmaddiedhkejfhabkfdenfphjljioj`), because `manifest.json` carries the store item's public key as `"key"` (from 1.8.3; owner ruling 2026-10-17). Without it Chrome derives the ID from the folder path, so the dashboard's one-click "Connect Chrome extension" button, which messages the store ID, reported "Extension not detected", and settings were lost when the extension was loaded from another folder. Two consequences: an unpacked copy and the store copy can't be installed in the same profile at once (they are the same item to Chrome), and the first load after this change starts with empty settings, since they were stored under the old path-derived ID; reconnect from the dashboard. `npm run zip` leaves the `"key"` line out of the store package, and `check:zip` fails if it ever gets in. The key is public: it ships inside every published package.

## Connect your account

Citations, Link Building, page history, and capture sync all need an API key.

- **One-click**: visit [seobandwagon.com/dashboard/api-keys](https://seobandwagon.com/dashboard/api-keys) with the extension installed and click "Connect Chrome extension." The site messages the extension directly (`externally_connectable`) and saves the key for you.
- **Manual**: mint a key on the same page, then paste it into the extension's Options page and click Verify.

A key carries scopes (what it's allowed to do) set when it was created; Options shows the connected account, key name, and scopes once verified.

## Support

Questions, bugs and ideas go to this repository's issues:
[open an issue](https://github.com/seo-bandwagon/seobw-extension/issues/new/choose)
and pick **Question or help**, **Bug report** or **Feature request** (a free
GitHub account is needed). Issues are public, so never paste your API key.
Security problems are reported privately instead; see [`SECURITY.md`](SECURITY.md).

## Appearance and the Chrome themes

The popup, side panel and options page render in **Night** (midnight navy) or
**Day** (off-white) from one token block in `extension/src/styles/popup.css`; `<html
data-theme>` is the only switch, set by `extension/src/lib/theme-mode.js`. **Auto** (the
default) follows your system setting; picking Night or Day in the side panel's
header or on the options page stores one key (`bwThemeMode`) that all three
surfaces read, so a choice made anywhere applies everywhere. Auto is the absence
of a stored choice — it removes the key rather than writing "auto". The last
mode is mirrored into the page's own `localStorage` so the first paint is right
before storage answers.

The **page-checks panel** (`src/panel/`) is a second side panel: the current
page's checks, the tools row, the citation-directory note and the account line,
opened from the "Page checks" link in the existing panel's footer and swapped
back from its own. Both panels ship; `chrome.sidePanel.setOptions` switches the
path for that tab only, so `side_panel.default_path` in the manifest is
untouched. Everything it shows comes through `src/lib/sbw-data.js`, the one
bridge from a themed surface to the product — see `docs/API-INVENTORY.md`.
From 1.7.9 it reads a page only when you ask: opening the panel scans the tab
it opens on, and after that a tab switch or a page load shows a result
already taken for that page or waits for **Scan this page**. It can read a
tab after you've clicked the toolbar icon there; for other tabs it offers
"Allow access to analyze other tabs", Chrome's prompt for the optional
access to all sites.

The **new tab page** (`src/newtab/`, 1.9.0, `chrome_url_overrides.newtab`)
replaces Chrome's new tab: the recent audits with each page's change in score,
the latest capture's checks and the next fix (the analyzer's first issue on
it), read from the newest 50 local captures through `src/lib/sbw-data.js`.
Signed out, opening it sends no request; with an account connected it adds
Rank changes and Tasks from the site's `GET /api/extension/progress`
(scope `progress`, at most one request every 10 minutes; a 403 shows
Reconnect, a 404 shows only the local cards). From 1.10.0 the signed-in page
leads with rank changes, one tracker at a time: each dropped keyword's from →
to, the page that lost it, the page Google swapped in, the next fix for that
page when it was captured, and a link to its drop page on seobandwagon.com;
then gains, with Tasks beside and the recent audits (full address, issues,
date) below. Its scan box opens a typed site
in that tab and the popup analyzes it (the 1.8.4 analyze flow). It draws the Neon Night and
Neon Day wallpapers itself, because an extension's new tab hides the theme's
own. Adding it added the install warning "Replace the page you see when
opening a new tab"; see `CHROMEWEBSTORE.md`.

Two matching **Chrome themes** — SEO Bandwagon Neon Night and Neon Day — ship as
separate Web Store items from their own repo, [seo-bandwagon/seobw-themes](https://github.com/seo-bandwagon/seobw-themes) (a theme is images and
colours only and cannot follow the OS setting, so light and dark are two
listings). The extension does not detect which theme is installed —
that would need the `management` permission, which it does not ask for — so the
Appearance control is how you match them. Links to the two listings appear on
the options page once their Web Store item ids are filled into `THEME_IDS`.

The brand faces (Bebas Neue, Space Grotesk, Space Mono; SIL Open Font License)
are bundled in `src/styles/fonts/` because MV3 blocks remote `font-src`.

## Permissions, and why

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab's URL/title when you click the icon or a keyboard shortcut |
| `storage` | Save captures locally, cache API responses, and store your API key/settings |
| `contextMenus` | The right-click "Analyze this page" / "Analyze linked page" / "Count words & characters" entries, plus the "SEO Bandwagon tools" submenu (see "Tools" below) |
| `scripting` | Inject the page-analysis script into the active tab on demand |
| `sidePanel` | The Link Building and Citations side panel |
| `tabs` | Read the active tab's URL to open dashboard links in new tabs, **and** — via `chrome.tabs.onUpdated` in the background service worker — read every tab's URL as it finishes loading to match it against a bundled list of citation directories and paint the "DIR" toolbar badge. That match is local hostname comparison only; the URL is never sent anywhere for it |
| `alarms` | The 15-minute background retry drainer for captures that failed to sync |
| `webRequest` | Observes top-level navigations in every tab (a fixed listener filter, `types: ['main_frame']`) — not just the one you're looking at — buffering the last 25 redirect/status/response-header events per tab in `chrome.storage.session`; only the buffer for the tab you currently have the popup open on is ever read, by the Indexability panel. Cleared when that tab closes, the browser restarts, or the optional permission below is revoked. Fires on nothing without `<all_urls>` below, and never reads a response body |
| `webNavigation` | Detect client-side (JS) redirects for the same Indexability section, and notice when a reload finishes so "Reload to capture" can re-check the page |
| `declarativeNetRequestWithHostAccess` | Rewrites the outgoing User-Agent header for exactly the tab you pick in the Rendering section's "View as" — only while a preset other than Default is selected, only for that one tab, and removed the instant you switch back to Default or close the tab. From 1.12.0, while Analyze on Google reads pages, it also blocks the extension's own requests to local and private addresses (redirect hops included) and removes those rules when done. Needs the same optional `<all_urls>` grant below to actually take effect on that tab's requests; no rule ships with the extension until you choose a preset |
| `offscreen` | 1.12.0. Analyze on Google reads a result's HTML in an offscreen document (reason `DOM_PARSER`), since the service worker can't parse HTML: the popup's analyzer, on a page fetched on your click. No install warning (measured with `getPermissionWarningsByManifest`) |
| `host_permissions: https://seobandwagon.com/*` | Talk to the SEO Bandwagon API |
| `content_scripts` matches: `https://www.google.com/search*` and the same path on 29 other Google domains (`.co.uk`, `.ca`, `.com.au`, `.de`, `.fr`, `.es`, `.it`, `.nl`, `.co.in`, and from 1.11.0 `.com.br`, `.com.mx`, `.co.jp`, `.pl`, `.se`, `.no`, `.dk`, `.fi`, `.be`, `.at`, `.ch`, `.ie`, `.co.nz`, `.co.za`, `.pt`, `.com.tr`, `.com.sg`, `.com.ph`, `.com.ar`, `.co.id`) | Runs the SERP overlay on Google's own results pages: it reads the results already on screen, shows each one's position and, from 1.11.0, its figures, and copies results/PAA questions to your clipboard or a CSV only when you click. From 1.11.0, with an account connected and the figures accepted in Options, it sends each result's address and site (never the search) to `seobandwagon.com` for the figures; from 1.13.0, with an account connected and keyword data's own yes, the search's words, its related searches and People also ask questions, for keyword data, on a click unless you choose with the page (1.13.0's two content-script files left the install warning unchanged, measured with `getPermissionWarningsByManifest`); otherwise it sends nothing (1.10.2 sent nothing; until then, the bare domains of the results, for a per-site stat). The twenty domains added in 1.11.0 left the install warning unchanged (measured with `getPermissionWarningsByManifest`: Chrome names every `www.google.*` host as www.google.com). It injects additively — it never hides, moves, covers, or restyles an ad or any Google UI. This is a declared content-script match, not a `host_permissions` entry — it's granted at install like any other content script, not requested at first use. Its Analyze button reads the result in a background tab, which needs the optional `<all_urls>` permission below; the extension asks for it once, from its own window, when Analyze is first clicked. India's host is `www.google.co.in` from 1.10.2 (`www.google.in` only redirects there, so the overlay never ran in India); the install warning is unchanged (measured with `getPermissionWarningsByManifest`) |
| `optional_host_permissions: http://localhost/*, http://127.0.0.1/*` | Only requested if you point the Advanced API URL setting at a local dev server; never requested otherwise |
| `optional_host_permissions: <all_urls>` | Only requested when you click "Allow access to check other sites" in the Link Check, Indexability, Hreflang or Rendering section (never at install, never automatically). The consent text shown at request time, verbatim (`ALL_URLS_REASON` in `src/lib/perms.js`): *"To check links, hreflang alternates and redirects, and to compare a page's raw HTML with what your browser rendered, the extension has to look at pages on other sites from your browser: it fetches them without cookies, and when you ask it to trace a URL it opens that URL in a background tab like any normal visit. The "View as" option uses the same access to change the User-Agent header on requests from the current tab only, until you switch it off or close the tab. Nothing it sees on those sites is sent to SEO Bandwagon. You can revoke this at any time from the extensions page."* |

The Advanced API URL field (Options page) is an allowlist, not "any URL": `seobandwagon.com` and any of its subdomains, or `http://localhost`/`http://127.0.0.1` (any port). The Netlify deploy-preview hosts were dropped in 1.10.3: the site no longer runs on Netlify. Every other host is rejected client-side before it's ever saved.

There is no `identity` permission and no OAuth — connecting an account is just an API key.

## Search Console helpers

### Row actions

On a Search Console **Performance** report's **Queries** tab only, every data
row gets two small icons after the query: **Open in Google Search** (new tab)
and **Open in Google Search (private window)**. The icons are dim until you
hover the row. Nothing is sent anywhere — the extension only opens
`https://www.google.com/search?q=<row text>`, from 1.10.2 with `pws=0`
(personalisation off) and, when the property is on a country-code domain
(`example.co.uk`, `example.de`), that country's `gl`. When you switch the
report's tab, Search Console changes the address with `history.pushState`;
from 1.10.2 the worker notices that through `webNavigation`
(`onHistoryStateUpdated`, already in the manifest) and the icons follow the
tab. The content script's own patch of `pushState` before then never fired,
since a content script's world doesn't see the page's own calls.

Private windows need the browser's permission: turn on **Allow in Private**
(Brave) or **Allow in Incognito** (Chrome) for SEO Bandwagon on the
extensions page. Until then the private icon opens a normal window and shows a
one-time hint saying so.

### Compare mode

When a Performance report is comparing two date ranges, the extension adds
the math and controls Search Console itself doesn't show:

- A small badge on each metric summary card with the percent change
  (percentage points for CTR) and colour — green when the metric moved in
  the good direction, red when it didn't (a lower **Average position** counts
  as good).
- A **% change** column next to each metric's pair of columns in the table,
  coloured the same way, with the raw current/previous values in the cell's
  tooltip.
- A small percent badge inside each row's Difference cell ("▲ 10%", "▼ 50%",
  "▲ new" when the previous period was zero; colour follows the metric's
  direction, so a lower position is green). Nothing else changes: no extra
  columns, no toolbar, no sorting or filtering, no copies of the table — the
  report looks the way Google draws it.

Everything here is computed from the numbers already on the page. Nothing is
sent anywhere — there is no network call involved at all.

## SERP overlay

On a Google results page (google.com and 29 other Google domains — see
the Permissions table below), the extension appends one small bar under each
organic result and one SEO Bandwagon panel below the results list, or above
it by setting. It never touches an ad or any Google UI — additive only,
always: nothing is hidden, moved, covered, or restyled. Dates, star ratings
and ad labels are read in each Google's own language (1.11.0).

**What's injected:**

- A `.sbw-serp-bar` under each whole organic result (below its description
  and sitelinks), showing the result's **organic position** and its domain,
  with an **Analyze** link. The position's tooltip gives the position
  **counting everything on the page** (ads, AI Overview, People also ask,
  maps, videos and every other block above it). Both are the same numbers as
  Copy results, the CSV and Collect. A result whose Google redirect names no
  site keeps its slot as "unknown site", so the positions after it stay
  right; People also ask answers are never results. (Until 1.10.2 the bar
  showed "Score N · M captures", an on-page grade averaged over the whole
  host and every account's captures.)
- **Analyze** (1.12.0, the owner's "Stay on Google"): a click opens a row
  under the result with the page's checks: its title and description in
  characters and in Google's pixels, H1, word count, structured-data types,
  canonical (itself or elsewhere), indexable and why not (status, the robots
  or Googlebot meta, the X-Robots-Tag header, a canonical elsewhere), status
  and redirect, hreflang, technologies, the AI crawlers its site's
  robots.txt blocks, whether the site has an llms.txt, and the **on-page
  checklist**. The worker fetches the page from your browser without
  cookies, three at a time, and its site's robots.txt and llms.txt once a
  session (`src/lib/serp-page-check.js`); an offscreen document reads the
  HTML with the popup's own analyzer (`src/offscreen/`, `src/lib/page-row.js`;
  the `offscreen` permission, no install warning), and on Firefox the
  background page does. No tab opens, and nothing it reads goes to
  SEO Bandwagon. It never reads a local or private address (loopback,
  private, link-local, `.local` and the like): such an address is refused,
  and while pages are read `declarativeNetRequest` session rules block the
  extension's own requests to one, so a page that redirects there is never
  followed (if Chrome won't take the rules, nothing is read). The row says the checks are from the page's HTML (no
  scripts run); **Full report** opens the page in a new tab with the full
  analysis of it as your browser draws it. Without "access to all sites",
  the first click opens the extension's own small window
  (`src/access/access.html`) with the reason; once allowed, the waiting
  pages are checked. A result Google hides while you're signed out of
  Google asks you to sign in to Google or open it; nothing fetches it.
  Ctrl/Cmd/Shift and middle clicks open the link as a plain link. (1.10.2
  to 1.11.0 opened the result in a background tab instead.)
- **Analyze top 10** (1.12.0) in the panel checks every result at once.
- **The results table** (1.12.0, `src/lib/serp-table.js`) in the panel: one
  row per result with its position (on the page and counting everything),
  title and URL, type, the search's words in its title, URL and
  description, title length, date, the page's and the site's figures,
  domain age, words, schema and checklist. Cells are marked ▲ above or ▼
  below the search's median, or your pinned page (settings); only columns
  where higher is better are marked. Columns are chosen in settings and
  sorted by a click; **Export table CSV** carries the same columns.
- **Your page pinned** (1.12.0): type its address in the table and Pin; it
  becomes the first row, checked from its HTML and, with figures on, given
  its figures (its address goes to SEO Bandwagon for them on that click).
- **AI Overview sources** (1.12.0): the pages an AI Overview cites, in a
  table of their own, with "Load figures for sources" (one search of the
  day's allowance), "Analyze sources" and their own CSV.
- **Figures** (1.11.0, the owner's "metrics on the SERP page"): the bar's
  second row, with the figures chosen in settings: the **page**'s referring
  domains, backlinks, rank, estimated traffic and ranking keywords; the
  **site**'s rank, referring domains, traffic and ranking keywords; **domain
  age**, with registrar, created and expiry dates on hover; and **your own
  on-page checklist** where you captured that page. Link and traffic figures
  are DataForSEO's, its rank on a 0 to 100 scale, labelled so; domain age is
  RDAP's; there is no authority score of ours, and the checklist is never
  called a ranking factor. They come from `POST /api/v1/serp/metrics` (the
  key's `serp` scope; up to 10 results a call) through the worker
  (`src/lib/serp-figures-service.js`), which keeps them for the browser
  session only. Signed out of Google, a result known only by its site gets
  the site's figures and "sign in to Google to see page figures"; no
  request goes to Google to find its page. Signed out of SEO Bandwagon, the
  bar shows position and Analyze and "Connect free to see figures". A key
  made before the scope says Reconnect; too many requests in a minute, the
  site being busy and offline each have their own words. The panel shows the
  plan and what is left of the day's allowance (free 20 searches with new
  figures a day, Pro 250); at the limit, or with new figures paused at the
  site-wide monthly ceiling, the bars and the panel say so and offer the
  upgrade where it helps, and nothing else stops working.
- **Keyword data** (1.13.0, #68; `src/overlay/serp-keywords.js`,
  `src/lib/serp-keywords.js`): one strip above the results, under the
  search box and under any top ads (which it never moves), and above the
  panel when the panel is at the top. On a click on **Show keyword data**
  (the default) or with the page (settings), it shows for the search
  DataForSEO's **monthly searches**, **difficulty** (0 to 100), **cost per
  click**, **competition** and the **12-month trend** as a line, labelled as
  DataForSEO's, and gives each **related search** and **People also ask
  question** its monthly searches in the same request (50 keywords at most,
  the search first): a small label beside each on Google's page, and a list
  in the strip with CPC and difficulty. Questions People also ask opens
  later are asked for on a click ("Get volumes for N more"), so opening
  them never spends the allowance by itself. **Add to my keywords** puts the
  search, or any related search or question, into your rank tracker
  (`POST /api/v1/keywords`): with one tracker it goes there; with several
  the strip asks which; with none it links to making one on the dashboard.
  If the rank tracker already tracks the search, the tracked site's result
  shows its **rank history** on its bar (the latest position, the change
  and a line), and the strip says it too. A search with an operator
  (`site:`, `inurl:` and the rest) gets no strip. Signed out of SEO
  Bandwagon, the strip says "Connect free"; before the first send it shows
  its own disclosure and takes a yes (below). The plan and the day's
  allowance show under the strip; at the limit or paused it says so and
  offers the upgrade where it helps, and nothing else stops working. A key
  made before the `keywords` scope says Reconnect; offline, busy and too
  many requests in a minute each have their own words. **Export keywords
  CSV** gives one row a keyword (the search, each related search, each
  question) with its figures.
- **Your own sites** (a list in Options, until 1.14.0 fills it from the
  account) are marked "Your site" on their bars.
- **The look**: the extension's own tokens, in Match Google (follows Google's
  own light or dark page, in Google's font), Night or Day; every text colour
  meets WCAG AA (`tests/unit/serp-overlay-look.test.js`). Pink is an accent
  only: the rule down each bar's edge, never a ground behind text.
- When the parser reads no results from a page that has result headings,
  a notice in the panel says so (the console warning of #44 stays).
- **The panel** (1.11.0; was the toolbar): one collapsible SEO Bandwagon
  panel, below or above the results by setting (#53; above, it pushes them
  down), with groups: **Figures** (the plan and allowance, Load figures when
  they load on a click), **Analyze** and **Table** (1.12.0), **AI Overview
  sources** (when the page has one), **Export** (**Copy results (N)**, TSV to clipboard,
  and **Export CSV**), **People also ask** (**Copy PAA (N)**), **Collect
  pages** and **Location** (the simulator).
- **Settings** ("Google results" in Options and in the popup): the overlay
  on or off, the panel's place, the look, figures on or off, loaded with the
  page (the default) or on a click, and which figures show; from 1.13.0
  keyword data on or off, and on a click (the default) or with the page. Changes reach an
  open results page at once (`src/lib/serp-settings.js`).
- **The popup on a results page** is that page's panel: what the search
  shows (AI Overview, local pack, People also ask, ads, shopping, videos and
  the rest), the exports (and the AI Overview's sources), the account, the
  figures and the allowance, keyword data and its allowance (1.13.0), and
  the settings (`src/popup/serp-panel.js`).
- **Collect pages** (1.8.0, #45): Google ignores `&num=`, so a top 50 is five
  pages. **Add page N** adds the page you're on; **Next page →** is Google's
  own Next link and **Web results only** Google's own Web tab (`udm=14`; a
  `udm=web` link is accepted too). Nothing walks pages by itself: each page
  is a click (a human in the loop, since Google's terms rule out automated
  scraping). **Copy collected** and **Export collected CSV** give one list,
  deduped in page order on each result's link (its URL when Google shows it;
  signed out, where only the site's home address is known, the link Google
  rendered, so two results from one site are both kept), with an exact
  **Absolute position** (blank after a page you didn't add), an **Absolute
  position (approx.)** that counts the organic results of the earlier pages
  (10 for a page you didn't add), the page and the position on it, and
  **Collection notes** (a page skipped, or a result that moved when you added
  a page again). Up to 10 pages per search; kept in `chrome.storage.session`
  by the worker (cleared with the browser) and never sent anywhere.
- Every export ends with **Position counting everything**, **URL known**
  ("yes", "site only" or "no") and **Place name** (the location the
  simulator's `uule` stands for, readable), then from 1.11.0 **Result type**
  (web, video, forum, social, pdf), **Your site**, the search's **Search
  features** and **AI Overview citations**, and each figure in a column of
  its own, named for its source (DataForSEO or RDAP), blank where it wasn't
  loaded; and from 1.13.0 the search's **keyword data** (volume, CPC,
  competition, difficulty, trend), the **related searches** and **People
  also ask with volume**, and **Your rank tracker position** on the tracked
  site's row; and from 1.13.2, for the AI Overview inclusion study, **AI
  Overview state** (none, loaded or empty), **AI Overview text**, **AI
  Overview citations via Google redirect** and **Extension version**.

**What's sent (1.11.0):** with an account connected **and** the figures
accepted in Options ("Send result addresses and show figures", a specific
action; the consent module, `src/lib/consent.js`, checks it before every
send), the address and site of each result on a Google results page you
open, up to 10 a call, to `POST /api/v1/serp/metrics`, for the figures.
Never the search terms, and never a request to Google: a result Google
hides behind a redirect is sent by its site alone, a result on one of
Google's own hosts (Books, Scholar…) without its query string, and any
other address without a parameter that holds the search's words. Without both, nothing is
sent (1.10.2 sent nothing; until then, with an account, the bare domain
names went to `POST /api/domain/quick-batch`). An analysis from Analyze is
saved and synced exactly as the popup's is (with an account connected and
data collection on). Extracted results and PAA questions never leave the
browser at all — Copy/Export only ever touch your clipboard or a local file
download.

**What's sent (1.13.0), keyword data:** with an account connected **and**
keyword data's own yes (its first-use disclosure on Google, "Yes, send my
searches for keyword data", or "Send my searches for keyword data" in
Options; the consent module's `keywordData` flow, Firefox's `searchTerms`),
the **words of the search**, with its related searches and People also ask
questions as Google shows them (lowercased, their punctuation kept, 50 at
most), and that Google's country and language (`gl`, and `hl` with its
region, such as `pt-BR`), to
`POST /api/v1/keywords/metrics`, when you click Show keyword data or, if you
chose it, with each search; and a search you add with "Add to my keywords"
to `POST /api/v1/keywords`. Never a result's address with them, and never a
request to Google. Only the person's own click sends: a click a page script
makes on the strip (`isTrusted` false) sends nothing and can't say yes, and
the disclosure takes the focus only when the person's click opened it. Only
a 429, a busy site or no connection is asked again on its own (the same
request, at most three times); a server error waits for a click, since it
may have counted against the allowance. This is the first time the
extension sends a search's words; the figures (above) still never do. Keyword data is kept for the
browser session only (`src/lib/serp-keywords-service.js`).

**Location simulator:** builds a Google search URL with location parameters
(`uule`, `gl`, `hl`, optionally `pws=0` to turn off personalization) from a
54-metro preset list or a typed canonical location name, and opens it in a
new tab — or two, for the "Compare in two tabs" button, which the worker
opens (one click may open only one tab from a page). Every preset is a name
in Google's geotargets list; from 1.10.2 six metro areas Google doesn't know
by that name search as their principal city (Dallas, Fort Myers,
Minneapolis, Raleigh, Sarasota, Tampa). This **opens a
search with location parameters so you can see what searchers in that area
are shown**. It does not simulate Googlebot or any other crawler, and the
extension never describes it that way.

## Tools

Right-click any page for a "SEO Bandwagon tools" submenu — every item opens
a new tab, nothing is fetched from the extension itself:

- **Open in Google Search Console (URL inspection)** — the page's origin as
  the resource and the exact URL as the inspection target.
- **Open in Wayback Machine** — that URL's archive.org calendar view.
- **Open in PageSpeed Insights**
- **Test with Rich Results Test**
- **site: search for this domain** — a `site:` search scoped to the page's
  hostname only (never the path or query string).
- **Search Google for the selected text in quotes** (shown only when text is
  selected) — the selection, capped at 200 characters, wrapped in quotes
  (any literal `"` in the selection is replaced with a space first, so it
  can't close the wrapping quotes early).
- **Open sitemap.xml** / **Open robots.txt** — origin-rooted, regardless of
  the current page's own path.

The same seven page-scoped items (everything except the selection search,
which needs actual selected text the popup doesn't have) also appear as a
small TOOLS row under the popup header. Every URL is built by
`src/lib/tool-links.js` from `new URL(pageUrl)` — never a string-split of
the origin — with every user-controlled part percent-encoded and any
embedded HTTP Basic Auth credentials in the page's own URL (`user:pw@host`)
stripped before it's used anywhere; a page that isn't `http(s)://` (an
internal `chrome://` page, for instance) makes every tool return nothing
rather than open something broken. Google's own tools here (Search
Console, PageSpeed Insights, Rich Results Test) are named nominatively,
never with a logo — see "Credits" below.

### Exports

Besides the JSON export in the footer, individual sections export their own
CSV (`src/lib/csv.js`, RFC 4180, UTF-8 BOM, formula-injection guarded):
Link Check, Indexability, Hreflang, Rendering, and Structured Data (all
1.6.0-earlier), plus, as of this feature: **Headings** (level, text,
document order — a "Copy outline" button next to it copies the same outline
as indented plain text to your clipboard), **Images** (src, alt, has-alt,
lazy-loaded, width/height where set), and **Links** (URL, anchor text, rel,
internal/external). Each of these three lists is capped at 500 rows; a CSV
that hit the cap gets a final `# truncated to 500 rows` row and its button
label reads "(first 500)" so the truncation is visible before you even
click. A cached analysis captured before 1.6.0 shipped these lists has no
`outline`/`list` field to export from — the affected button is disabled
with a "Re-run the analysis to export this" tooltip instead of downloading
a header-only file (Headings is the exception: it falls back to
reconstructing a level-ordered outline from the older H1-H6 arrays, which
did already exist, so its button and "Copy outline" stay enabled unless
even those are missing). None of these leave your device until you choose
to save or paste the file yourself — and, as of this fix round, none of
the three lists themselves are included in a synced capture either (see
"Privacy" below); only their counts are.

Field notes for the Images CSV: an `<img>` using only `srcset` (no `src`)
exports an empty Src; an `<img data-src="...">` used for lazy-loading
exports that value as Src and is marked `lazy: true` even without a
`loading="lazy"` attribute (this is how most lazy-load libraries actually
work); otherwise `lazy` is only ever `loading="lazy"`. Width/height are the
raw HTML attribute values, unmodified.

### Review prompt

After your 5th analysis, a one-line strip appears once, asking for a
Chrome Web Store review — un-incentivized, and never tied to your score or
whether the page could be analyzed at all. **Leave a review** opens the
listing's reviews tab in a new tab; **No thanks** dismisses it. Either way
it's marked as shown and never appears again (`chrome.storage.local`, key
`sbwReview` — nothing about this is sent anywhere).

## Privacy

Page analysis runs entirely in your browser. **Nothing leaves your device unless an API key is connected.** With one, three things can be sent, each only on its own switch: your analyses while the data-collection toggle (Options / popup footer) is on; from 1.11.0, the addresses of the results on a Google results page after you accept the figures in Options; and from 1.13.0, the words of a Google search, with its related searches and People also ask questions, after you say yes to keyword data (see "SERP overlay" above). All three go through the consent module (`src/lib/consent.js`), which maps each to the data categories Firefox asks about and, on Chrome and Edge, reads those switches. Everything that does get sent goes only to `seobandwagon.com` over HTTPS. Enforced at the code level, not just by policy: every account-facing call in `src/lib/api.js` (captures, page history, citations, link building) checks for a stored key before it builds a request, and returns/throws a `no_key` result instead of ever calling `fetch` when one isn't there.

**A synced capture sends the full analysis result** — this is more than a summary, so here it is broken out honestly rather than glossed over:

- the page URL and the capture timestamp
- the extracted on-page SEO data: title/meta description, canonical (and whether it points to the page itself), robots and googlebot, the page's declared language, viewport and character set, how many title, description and canonical tags it has, Open Graph and Twitter Card tags, and any structured data (JSON-LD, Microdata, RDFa) found on the page — types and property NAMES only (the missing-required/recommended chips and the "Eligible for" rollup need those); property VALUES are stripped before this is saved or synced, so a customer's name, price, or review text sitting in a page's own JSON-LD never leaves your device. This includes the raw JSON-LD blocks kept for the score calculator's own "has schema" check: each one — and each member of a `@graph`, one level down — is reduced to its type and its sorted top-level property names before it's saved or synced; structured-data blocks are reduced to their type and property names, never their values
- headings and their text (H1–H6 and ARIA headings)
- link, image and media audits: internal/external link counts and up to 100 URLs each, up to 50 anchor texts with their href (`links.anchors`), missing-alt image count and up to 20 of those image srcs (`images.missingAlt.srcs`), up to 50 alt texts from images that have them (`images.altTexts`), lazy-loaded images, iframes, media types, favicons/feeds
- as of this fix round, four CSV-export-only detail lists stay on this device only and are never part of a synced capture: the headings outline (level/text/order/ARIA), the full Images and Links CSV lists (`images.list`, `links.list`), and the up-to-50 nofollow/UGC/sponsored anchor list shown in the popup (`links.nofollowAnchors`) — only the link/image totals and nofollow/UGC/sponsored counts sync from those. This is separate from the older link/image fields listed just above (anchor text, internal/external URLs, missing-alt image srcs, alt texts), which do sync — they predate this fix round and aren't affected by it
- content statistics: word/character/sentence counts, and the page's top words and phrases
- page technical facts: DOM element/script/stylesheet counts, load time, and URL depth
- detected technologies (CMS, analytics, frameworks, etc.)
- Core Web Vitals and load timing (LCP/INP/CLS/FCP/TTFB, above-the-fold and text-to-HTML analysis)
- readability, keyword-density, table-of-contents and n-gram statistics computed from the page's text
- hreflang tags, mixed-content and social-card checks, schema validation results
- a SHA-256 hash of the page's content, and the computed SEO score/grade
- the extension version and your browser's user-agent string

Apart from the fields listed above as stripped, nothing else is trimmed or summarized before sending — it's the same analysis object the popup renders from. If that's more than you want synced, turn the data-collection toggle off; analysis still runs and saves locally, it just doesn't sync.

**Upgrading from before 1.5.0?** Captures saved by an older version are never auto-uploaded on upgrade — they're marked "skipped" locally, and stay that way until you click "Include them in sync" on the History page, which is the only thing that opts them into the normal sync/retry flow described below.

**Citations** work differently and separately: checking a listing's NAP against your business record happens entirely in your browser and sends nothing. Only when you click "File Citation" does anything go out, and only the citation fields go — the directory name and URL, the name/address/phone/website found on that page, the NAP match score, the status you chose, and any notes. The screenshot, whether full page or visible area, is never part of that payload — it only ever saves to your device. From 1.7.8 a full-page proof is built in the extension's background worker, so closing the popup doesn't stop it, and the finished image (a JPEG) is kept in the extension's own browser storage (IndexedDB) for that tab until you dismiss it, take another, close the tab or restart the browser.

**On Google search pages the extension sends each result's address and site for the figures, and only with an account connected and the figures accepted in Options (from 1.11.0; 1.10.2 sent nothing); never the search with them, and never a request to Google. From 1.13.0 it also sends the search's words, its related searches and People also ask questions (50 at most) and that Google's country and language for keyword data, and a search you add to your rank tracker, only with an account connected and keyword data's own yes; never a result's address with them. The results list and questions are copied only when you click, and Analyze checks a result in your own browser.** See "SERP overlay" above for the full breakdown and the location simulator's copy rules.

**Link checks fetch third-party URLs directly from your browser** (Link Check section, 1.6.0+) — with credentials omitted (`credentials: 'omit'`, so no cookies go out), no caching (`cache: 'no-store'`), and a 10-second timeout per request (the HEAD and, when needed, a GET retry each get their own). This only runs after you click "Check N links" — it never runs on its own — and only after you've granted the optional `<all_urls>` permission. From 1.7.6 a check keeps running in the extension's background worker when the popup closes, and its progress and results are kept in the browser's session storage (`chrome.storage.session`) for that tab until the tab closes, the check is cancelled or re-run, or the browser restarts. Chrome Web Store links are never fetched (Chrome doesn't allow it) and show as "Can't check". Results (status codes, redirects, timings) stay on your device; nothing about them is sent to SEO Bandwagon unless you choose to export the CSV yourself.

**Indexability observes the current tab's own network requests** (Indexability section, 1.6.0+) — the current tab's main-frame redirects, status codes, and a fixed list of response headers (X-Robots-Tag, Cache-Control, Content-Type, Link, and whether HSTS/CSP are present), and only after you've granted the same optional `<all_urls>` permission; it's kept in `chrome.storage.session` and cleared when the tab closes or the browser restarts, and is never sent anywhere. "Trace another URL" opens a background tab to the URL you type, reads the same kind of data from it, and closes it — again nothing leaves your device unless you export the CSV yourself.

**The hreflang return-tag check fetches the alternate pages you listed** (Hreflang section, 1.6.0+) — from your browser, credentials omitted (`credentials: 'omit'`), no caching, a 10-second timeout and at most 256 KB read per page, capped at 50 alternates. This only runs after you click "Check return tags" — everything above it (the tag table, code validity, duplicate/x-default/self-reference checks) reads only the current page's own HTML and needs no permission at all. Results stay on your device; nothing about them is sent to SEO Bandwagon unless you export the CSV yourself.

**The raw-HTML vs rendered-DOM comparison fetches the current tab's own URL a second time, unrendered** (Rendering section, 1.6.0+) — from your browser, credentials omitted (`credentials: 'omit'`), no caching, a 10-second timeout, and at most 1 MB of body read. This only runs after you click "Compare raw HTML with rendered DOM," and only after you've granted the optional `<all_urls>` permission. The comparison — and the CSV export of it — never leaves your device.

**The "View as" user-agent switcher rewrites a header, nothing more** (Rendering section, 1.6.0+) — choosing a preset other than Default sets a session-only `declarativeNetRequest` rule that rewrites the User-Agent header on requests from the current tab, then reloads that tab; switching back to Default (or closing the tab) removes it immediately. Nothing about which preset you chose, or what the page looked like under it, is sent anywhere. This is for testing how a page's server-side rendering or cloaking behaves under a different user-agent — not for bypassing a paywall, a login gate, or any other access control.

**Structured data validation reads only the current page's own HTML — no permission, no fetch, at all** (Structured Data section, 1.6.0+) — `src/lib/structured-data.js` extracts every JSON-LD `<script>` block (including `@graph`, recursively — a `@graph` member that's itself an array or that carries its own nested `@graph` is flattened too), every WHATWG microdata `[itemscope]` tree (including properties referenced via `itemref` elsewhere in the document), and every basic RDFa Lite `[typeof]` tree already on the page, and checks each item against a required/recommended property table per type (Article, Product, LocalBusiness and every subtype we recognize — Plumber, Electrician, Restaurant, and around 100 others — Organization, Person, BreadcrumbList, FAQPage, HowTo, Recipe, Event, VideoObject, Review/AggregateRating, WebSite, WebPage, JobPosting). A type schema.org actually defines but that isn't on this list yet (e.g. `Service`) gets a "no required-property list for this type" note rather than a false "Unknown type" — that flag is reserved for a genuinely unrecognized `@type`. "Eligible for" only lists a Google rich-result feature when that item's required properties are all present, **and only for rich results Google currently shows** — it never promises "will get," since eligibility is necessary, not sufficient, for a rich result to actually appear. FAQPage and HowTo are validated as markup the same as any other type, but Google retired both rich results (FAQ in 2026-05/06, How-to earlier), so a complete item there renders "Valid markup; Google no longer shows a rich result for this type" instead of appearing in Eligible for. See "Credits" below for where those required/recommended lists come from.

**The "SEO Bandwagon tools" menu and TOOLS row open a new tab — nothing is fetched by the extension** (1.6.0+): each item builds a URL from the current page's own address (and, for the quoted-search item, up to 200 characters of your selected text) and opens it with `chrome.tabs.create`, the same as clicking a link. No network request happens inside the extension for any of these.

Nothing is sent without a key configured, regardless of the toggle.

## Credits

The Structured Data section's required/recommended property lists derive from:

- **[schema.org](https://schema.org)** type and property definitions — [CC BY-SA 3.0](https://schema.org/docs/terms.html)
- **[Google Search Central](https://developers.google.com/search/docs/appearance/structured-data)** structured-data documentation — CC BY 4.0

Every type category the section validates against (Article, Product, LocalBusiness, Organization, Person, BreadcrumbList, FAQPage, HowTo, Recipe, Event, VideoObject, Review/AggregateRating, WebSite, WebPage, JobPosting) links back to the specific Google Search Central feature page or schema.org type page its list was derived from — see the "About & credits" link in the popup footer for the full, always-current list (`src/lib/credits.js`, read straight off `src/lib/structured-data.js`'s own table so the two can't drift apart). FAQPage and HowTo link to their schema.org type pages rather than a Google Search Central feature page, since Google no longer documents either as a rich result (both are validated-but-retired — see above). Google tools (Rich Results Test, Search Console) are named by name where relevant, never with logos.

The same "About & credits" panel also lists the third-party tools the "SEO Bandwagon tools" menu and popup TOOLS row link out to — Google Search Console, PageSpeed Insights, Rich Results Test, and the Internet Archive's Wayback Machine — each named for identification only; none of them are affiliated with or endorse SEO Bandwagon.

## Local-first + sync/retry behaviour

Every analyzed page saves to `chrome.storage.local` immediately — no network required. When an API key is configured:

- A new capture posts to `POST /api/v1/captures` right after it's saved.
- A failed post (network error, 5xx, or a `503` from the server) is marked `pending` and retried with exponential backoff (15 min → 6 hr cap, 5 attempts) by a `chrome.alarms`-driven drainer that runs every 15 minutes.
- A `429` doesn't burn a retry attempt — it just waits until the server's `Retry-After` window.
- A `401`/`403` marks the capture `skipped` rather than retrying forever against a bad key.
- Turning the data-collection toggle off also stops the drainer, mid-batch if it's running — it never posts a capture while collection is off.
- After 5 failed attempts a capture is marked `failed` and stops auto-retrying; the History page's "Retry failed" button resets it back to `pending` and drains again.
- Captures from before 1.5.0 are the one exception to all of the above: they start `skipped`, not `pending`, and stay that way — see "Upgrading from before 1.5.0?" above — until the History page's "Include them in sync" button opts them in.
- The History page's "Sync to SEO Bandwagon" button runs a bounded manual drain (up to 60 captures) across your full local backlog.

## Files

```
extension/               # the only folder that ships (load unpacked from here; `npm run zip` zips it)
  manifest.json           # Extension config (Manifest V3)
  lib/                     # Shared pure modules (content-analysis, dom-extraction) injected before analyzer.js
  src/
    background/            # Service worker: context menus, badge, capture-sync alarm, external connect handler,
                           # redirect tracer (webRequest/webNavigation, gated on <all_urls>), raw-HTML fetch
                           # and per-tab UA-switch DNR session rules (declarativeNetRequestWithHostAccess)
    content/                # Page analyzer + GSC Search Console helper
                             # + page-scroller.js (full-page capture: measures, scrolls, restores the page)
    history/                # Capture history page (search, export, sync, retry)
    lib/                    # api.js (SBW client), sync-state.js, domain-history.js, citations-ui.js,
                             # link-building-ui.js, nap-compare.js, directory-matcher.js, options-logic.js,
                             # gsc-inject.js + gsc-compare.js (Search Console helpers)
                             # perms.js (optional <all_urls> gate), csv.js, link-check.js (broken-link checker),
                             # link-check-runs.js (per-tab link-check runs that outlive the popup),
                             # redirect-chain.js (redirect/header/indexability logic, worker + popup share it),
                             # hreflang.js (tag validity, duplicates, x-default/self-ref, reciprocity),
                             # html-diff.js (raw-HTML vs rendered-DOM summarize/diff), ua-switch.js
                             # (user-agent presets + DNR rule shape), structured-data.js (JSON-LD/microdata/
                             # RDFa extraction + required/recommended validation, no fetch), credits.js
                             # (attribution data for the popup's About & credits panel), tool-links.js
                             # (context-menu/TOOLS-row URL builder), review-prompt.js (one-time
                             # review-prompt state machine), fullpage-plan.js (full-page capture frame
                             # planner, caps and the proof label), fullpage-capture.js (the full-page
                             # screenshot loop: rate limit, Cancel, restore; runs in the worker),
                             # fullpage-runs.js (one capture per tab, outliving the popup),
                             # proof-store.js (finished proofs in IndexedDB), consent.js (1.11.0:
                             # every send's data category and acceptance), serp-figures.js (the figures
                             # under each Google result: request, words, allowance), serp-figures-service.js
                             # (the worker's figures calls and session cache), serp-settings.js and
                             # serp-settings-ui.js (the "Google results" settings), 1.12.0:
                             # serp-page-check.js (Analyze's fetch, robots.txt, llms.txt), page-row.js
                             # (a page's checks from its HTML), robots-ai.js, serp-table.js (the table),
                             # 1.13.0: serp-keywords.js (keyword data: request, market, words,
                             # exports), serp-keywords-service.js (the worker's keyword calls,
                             # "Add to my keywords" and session cache)
    offscreen/              # 1.12.0: the offscreen document Analyze on Google reads HTML in
    options/                # Settings page (API key, Advanced endpoint, dashboard links, Google results)
    overlay/                # SERP overlay content scripts (see "SERP overlay" above): serp-overlay.js,
                             # and serp-keywords.js (1.13.0: the keyword data strip)
    popup/                  # Popup UI: SEO Analysis tab + Citations tab + link-check.js (Link Check section);
                             # serp-panel.js (1.11.0: the popup on a Google results page)
                             # + indexability.js (Indexability section — redirect chain, headers, trace-a-URL)
                             # + hreflang.js (Hreflang section — tag table, return-tag check)
                             # + render-check.js (Rendering section — raw-vs-rendered diff, UA switcher)
                             # + structured-data.js (Structured Data section — item/problem list, "Eligible
                             # for", CSV export, and the footer's About & credits panel)
                             # + tools.js (TOOLS row under the header) + review.js (the review-prompt strip)
    sidepanel/              # Side panel: Citations mode + Link Building mode
    styles/                 # popup.css (shared across popup/side panel/history/options)
    icons/
tests/ preview/ docs/ scripts/   # not shipped
```

## Development

```bash
# Clone
git clone git@github.com:seo-bandwagon/seobw-extension.git
cd seobw-extension

# Install dev deps (test harness)
npm install

# Run the automated suite
npm test                 # vitest — unit + integration, ~1s
npm run test:e2e         # Playwright: production canary (~15s) + offline Collect pages (~5s)

# Make changes, then reload in chrome://extensions/
```

## Testing

Three layers of automated test cover this extension, plus a manual dev harness:

| Layer | Runner | Where | When |
|---|---|---|---|
| Unit | vitest + JSDOM | `tests/unit/` | Every PR + push |
| Integration | vitest + JSDOM + fixture HTML | `tests/integration/` | Every PR + push |
| E2E canary | Playwright + real Chromium + real prod; loads `extension/` and injects popup.js's own file list. With the `SBW_CANARY_KEY` secret (an `sbw_` key with the `captures` scope) it uploads a real capture; without it, it checks the no-key refusal and production's 401 | `tests/e2e/canary.spec.mjs` | Weekly cron + push to main |
| E2E Collect pages | Playwright + real Chromium, offline; loads `extension/`, answers `www.google.com/search` from the saved pages in `tests/fixtures`, blocks every other request, and clicks the results overlay through Add page 1, Next, Add page 2 (twice), Add page 4 and Export collected CSV. No network, no secrets | `tests/e2e/serp-collect.spec.mjs` | Every PR + push |
| E2E Analyze on Google | Playwright + real Chromium, offline; result pages from a local server, a results page in Google's markup linking to them: Analyze's checks read in the offscreen document, no tab opened, no cookie sent, robots.txt read once a site, a hidden result never fetched, Analyze top 10 filling the table. `SBW_SCREENSHOTS=<dir>` saves the row and the table | `tests/e2e/serp-analyze.spec.mjs` | Every PR + push |
| E2E figures on Google | Playwright + real Chromium, offline; saved Google pages, and `POST /api/v1/serp/metrics` answered from `tests/fixtures/serp-metrics`: signed out sends nothing, the Options button accepts, the figures, plan and allowance show, a second look is answered from the session, then a 403, the allowance reached, the monthly pause and offline, a result hidden behind `/goto`, and the panel moved to the top. `SBW_SCREENSHOTS=<dir>` also saves the four looks | `tests/e2e/serp-figures.spec.mjs` | Every PR + push |

CI workflows in `.github/workflows/`. The weekly canary auto-creates a GitHub issue on scheduled failure.

**Manual preview harness** — `preview/index.html` renders every popup/side-panel UI state against the real render code with stubbed APIs (`preview/stub.js`); `preview/verify.html` asserts all of them plus shell-drift checks against the real `src/` HTML. Open both directly in a browser (no build, no server) after any UI change. This harness is not run by Playwright or CI — it's a dev-only visual/DOM check you run and read yourself.

Before every Chrome Web Store submission, also walk through [MANUAL_SMOKE_TEST.md](./MANUAL_SMOKE_TEST.md) end-to-end (~10 min). It covers UI regressions, keyboard shortcuts, offline behaviour, and edge-case pages that the automated suite can't reach.

## Releasing

```bash
npm run zip        # manifest.json lib/ src/ (from inside extension/) → seo-bw-extension.zip,
                    # with comments left out (scripts/build-zip.mjs; KEEP_COMMENTS=1 keeps them)
npm run check:zip  # same, plus: fails if any file manifest.json or one of the five pages
                    # (popup, options, history, both side panels, with their module imports)
                    # references is missing from the zip; deletes the zip afterward
                    # (scripts/check-zip-manifest.mjs). CI runs it on every pull request.
npm run bump -- patch   # or minor / x.y.z — see ROADMAP.md's versioning policy
```

Releases go through two hand-started workflows: **Release** (tests, zip, GitHub release) and **Submit to Chrome Web Store** (upload and a staged submission, which waits for someone to press Publish after review). Steps and the one-time Google setup: [`docs/RELEASING.md`](docs/RELEASING.md).

Bump the version first with `npm run bump` (see `ROADMAP.md`'s versioning policy); CI fails a pull request that changes `extension/` without a bump. Unzip and inspect the package before uploading to the Chrome Web Store — it should contain `manifest.json`, `lib/` and `src/` and nothing else (no `preview/`, `tests/`, `node_modules/`, docs or README). Listing text for the submission is in `docs/CWS-LISTING.md`; store-facing metadata in `CHROMEWEBSTORE.md`.

## API contract

The full request/response contract for every endpoint this extension calls lives in the site repo: `docs/API.md` on seobandwagon.com.

## License

Private - SEO Bandwagon internal tool
