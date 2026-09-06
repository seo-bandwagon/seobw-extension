# SEO Bandwagon Chrome Extension

**Version 1.6.0** · Manifest V3 · vanilla JS, zero dependencies, no build step

Instant on-page SEO analysis, local-SEO citation checks, and link-building review, in one toolbar icon. Works fully offline; connect an SEO Bandwagon account to sync captures, check citations, and manage outreach without leaving the page.

## What it does

- **SEO Analysis** — score ring (0–100, A–F grade) with four sub-scores (Meta, Content, Links, Tech), page meta with a SERP preview, Core Web Vitals (LCP/INP/CLS/FCP/TTFB), heading structure, link and image audit with on-page highlighting, content stats and n-grams, tech stack detection, and a domain-history strip showing this domain's and URL's past captures.
- **Link Check** — probes every link on the page (status groups, on-page highlighting, CSV export); needs the optional "check other sites" permission.
- **Indexability** — the page's redirect chain, response headers, and X-Robots-Tag, combined with its meta robots/canonical, into an indexable/not-indexable verdict; also traces any URL you type.
- **Hreflang** — validates every declared `hreflang` tag (BCP 47 form, duplicates, self-reference, x-default) and, on request, fetches each alternate to confirm it links back.
- **Rendering** — compares the page's raw (unrendered) HTML against what your browser actually rendered, and a "View as" switcher for testing server-side rendering and cloaking under a different user-agent.
- **Structured Data** — extracts JSON-LD, Microdata, and RDFa, validates required/recommended properties per type, and shows which Google rich results an item is eligible for.
- **Citations** — detects 40 curated local-SEO directories on the current page, extracts the page's NAP (JSON-LD → microdata → heuristic) and scores it against your business record, captures a proof screenshot, and files the citation to your account in one click.
- **Link Building** — side panel view of your outlets (qualified prospects), pitches (draft/approved), and results (placements, funnel, spend), plus "Add current tab as outlet."
- **SERP overlay** — on Google's own results pages, a stats bar under each organic result, one-click results/PAA export, and a location simulator for seeing what searchers in another metro are shown.
- **Search Console helpers** — row-level "open in Google Search" actions and compare-mode math (percent change, sort/filter, copy as TSV) on Search Console's own Performance report.
- **Tools** — a right-click "SEO Bandwagon tools" submenu (and matching popup row) for Google Search Console, PageSpeed Insights, Rich Results Test, Wayback Machine, `site:` search, and sitemap.xml/robots.txt shortcuts.

## Installation

### From the Chrome Web Store

Search "SEO Bandwagon" in the Chrome Web Store, or use the one-click "Connect Chrome extension" button on [seobandwagon.com/dashboard/api-keys](https://seobandwagon.com/dashboard/api-keys) once it's installed.

### Load unpacked (development)

1. Clone this repo
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select this folder
5. Pin the extension to your toolbar

**Testing the one-click "Connect Chrome extension" flow on an unpacked build**: the dashboard's connect button targets the published extension's fixed id (`dphmaddiedhkejfhabkfdenfphjljioj`), but Chrome assigns an unpacked load a random id unless `manifest.json` declares a `"key"`. To test the real one-click flow locally, paste the public key from the Chrome Web Store developer dashboard (your item → Package → View public key) into `manifest.json`'s `"key"` field on your own machine — don't invent one, and don't commit it. Otherwise, skip the one-click flow in dev and use manual key paste in Options instead; it exercises the same `SBW.verifyKey()` path.

## Connect your account

Citations, Link Building, domain history, and capture sync all need an API key.

- **One-click**: visit [seobandwagon.com/dashboard/api-keys](https://seobandwagon.com/dashboard/api-keys) with the extension installed and click "Connect Chrome extension." The site messages the extension directly (`externally_connectable`) and saves the key for you.
- **Manual**: mint a key on the same page, then paste it into the extension's Options page and click Verify.

A key carries scopes (what it's allowed to do) set when it was created; Options shows the connected account, key name, and scopes once verified.

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
| `webRequest` | Observe the current tab's own redirects, status codes and response headers (Indexability section) — only after you've granted `<all_urls>` below. Fires on nothing without that permission, and never reads response bodies |
| `webNavigation` | Detect client-side (JS) redirects for the same Indexability section, and notice when a reload finishes so "Reload to capture" can re-check the page |
| `declarativeNetRequestWithHostAccess` | Rewrites the outgoing User-Agent header for exactly the tab you pick in the Rendering section's "View as" — only while a preset other than Default is selected, only for that one tab, and removed the instant you switch back to Default or close the tab. Needs the same optional `<all_urls>` grant below to actually take effect on that tab's requests; no rule ships with the extension until you choose a preset |
| `host_permissions: https://seobandwagon.com/*` | Talk to the SEO Bandwagon API |
| `content_scripts` matches: `https://www.google.com/search*` and the same path on nine other Google TLDs (`.co.uk`, `.ca`, `.com.au`, `.de`, `.fr`, `.es`, `.it`, `.nl`, `.in`) | Runs the SERP overlay on Google's own results pages: it reads the results already on screen, sends only bare domain names to `seobandwagon.com` (never your search query) to look up their stats, and copies results/PAA questions to your clipboard or a CSV only when you click. It injects additively — it never hides, moves, covers, or restyles an ad or any Google UI. This is a declared content-script match, not a `host_permissions` entry — it's granted at install like any other content script, not requested at first use, and doesn't touch the optional `<all_urls>` permission below at all: every stats lookup routes through the background worker's existing `seobandwagon.com` access, never a fetch from the page itself |
| `optional_host_permissions: http://localhost/*, http://127.0.0.1/*` | Only requested if you point the Advanced API URL setting at a local dev server; never requested otherwise |
| `optional_host_permissions: <all_urls>` | Only requested when you click "Allow access to check other sites" in the Link Check, Indexability, Hreflang or Rendering section (never at install, never automatically). The consent text shown at request time, verbatim (`ALL_URLS_REASON` in `src/lib/perms.js`): *"To check links, hreflang alternates and redirects, and to compare a page's raw HTML with what your browser rendered, the extension has to look at pages on other sites from your browser: it fetches them without cookies, and when you ask it to trace a URL it opens that URL in a background tab like any normal visit. The "View as" option uses the same access to change the User-Agent header on requests from the current tab only, until you switch it off or close the tab. Nothing it sees on those sites is sent to SEO Bandwagon. You can revoke this at any time from the extensions page."* |

The Advanced API URL field (Options page) is an allowlist, not "any URL": `seobandwagon.com` and any of its subdomains, a `--seobandwagon.netlify.app` deploy preview, or `http://localhost`/`http://127.0.0.1` (any port). Every other host is rejected client-side before it's ever saved.

There is no `identity` permission and no OAuth — connecting an account is just an API key.

## Search Console helpers

### Row actions

On any Search Console **Performance** report (Queries or Pages), every data row
gets two small icons after the query/URL: **Open in Google Search** (new tab)
and **Open in Google Search (private window)**. The icons are dim until you
hover the row. Nothing is sent anywhere — the extension only opens
`https://www.google.com/search?q=<row text>`.

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
- A small toolbar above the table: a metric picker, **Sort ▼ (biggest
  drops)** / **Sort ▲ (biggest gains)** / **Original order** (reorders the
  table rows, never removes any), filter chips for **All** / **Drops ≥ 25%**
  / **Gains ≥ 25%** (hides non-matching rows, never deletes them), and
  **Copy as TSV** to copy the visible rows to your clipboard.
- A summary line under the table totalling the currently visible rows:
  clicks and impressions summed, CTR and Average position weighted by
  impressions, each with its own change and direction.

Everything here is computed from the numbers already on the page. Nothing is
sent anywhere — there is no network call involved at all.

## SERP overlay

On a Google results page (google.com and nine other Google TLDs — see the
Permissions table below), the extension appends one small bar under each
organic result and a toolbar under the results list. It never touches an ad
or any Google UI — additive only, always: nothing is hidden, moved, covered,
or restyled.

**What's injected:**

- A `.sbw-serp-bar` under each organic result, showing the domain and its
  SEO Bandwagon stats (score, capture count) once looked up, with a small
  **Analyze** link that opens the result in a new tab — the popup does the
  analysis from there, the same as it would for any page you visit directly.
- A toolbar with **Copy results (N)** (TSV to clipboard), **Export CSV**,
  **Copy PAA (N)** (People-also-ask questions, to clipboard), and the
  location simulator.

**What's sent:** only the bare domain names of the results currently shown
(deduped, looked up in successive batches of up to 20 per request — never
truncated, just spread across further requests when there are more than
20) go to `POST /api/domain/quick-batch` — never the search query, never a
title or snippet. Each domain's response is cached in `chrome.storage.session`
for 10 minutes, keyed by domain, so a domain already looked up isn't
re-requested even when it reappears in a later batch of results. If no
account is connected (or the key is rejected), each bar shows "Connect your
account" once and doesn't retry; a bar shows "Unavailable" if the lookup
itself failed to reach the worker. Extracted results and PAA questions never
leave the browser at all — Copy/Export only ever touch your clipboard or a
local file download.

**Location simulator:** builds a Google search URL with location parameters
(`uule`, `gl`, `hl`, optionally `pws=0` to turn off personalization) from a
54-metro preset list or a typed canonical location name, and opens it in a
new tab — or two, for the "Compare in two tabs" button. This **opens a
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

Page analysis runs entirely in your browser. **Nothing leaves your device unless an API key is connected AND the data-collection toggle (Options / popup footer) is on** — both conditions, not either. Everything that does get sent goes only to `seobandwagon.com` over HTTPS. Enforced at the code level, not just by policy: every account-facing call in `src/lib/api.js` (captures, domain history, citations, link building) checks for a stored key before it builds a request, and returns/throws a `no_key` result instead of ever calling `fetch` when one isn't there.

**A synced capture sends the full analysis result** — this is more than a summary, so here it is broken out honestly rather than glossed over:

- the page URL and the capture timestamp
- the extracted on-page SEO data: title/meta description, canonical, robots, Open Graph and Twitter Card tags, and any structured data (JSON-LD, Microdata, RDFa) found on the page — types and property NAMES only (the missing-required/recommended chips and the "Eligible for" rollup need those); property VALUES are stripped before this is saved or synced, so a customer's name, price, or review text sitting in a page's own JSON-LD never leaves your device
- headings and their text (H1–H6 and ARIA headings)
- link, image and media audits (internal/external link counts and anchor text, missing alt text, lazy-loaded images, iframes, media types, favicons/feeds)
- as of this fix round, the CSV-export-only detail lists stay on this device only and are never part of a synced capture: the headings outline (level/text/order/ARIA), the full Images and Links CSV lists, and the up-to-50 nofollow/UGC/sponsored anchor list shown in the popup — only the counts above (link/image totals, nofollow/UGC/sponsored counts) sync
- content statistics: word/character/sentence counts, and the page's top words and phrases
- page technical facts: DOM element/script/stylesheet counts, load time, and URL depth
- detected technologies (CMS, analytics, frameworks, etc.)
- Core Web Vitals and load timing (LCP/INP/CLS/FCP/TTFB, above-the-fold and text-to-HTML analysis)
- readability, keyword-density, table-of-contents and n-gram statistics computed from the page's text
- hreflang tags, mixed-content and social-card checks, schema validation results
- a SHA-256 hash of the page's content, and the computed SEO score/grade
- the extension version and your browser's user-agent string

None of this is trimmed or summarized before sending — it's the same analysis object the popup renders from, sent unmodified. If that's more than you want synced, turn the data-collection toggle off; analysis still runs and saves locally, it just doesn't sync.

**Upgrading from before 1.5.0?** Captures saved by an older version are never auto-uploaded on upgrade — they're marked "skipped" locally, and stay that way until you click "Include them in sync" on the History page, which is the only thing that opts them into the normal sync/retry flow described below.

**Citations** work differently and separately: checking a listing's NAP against your business record happens entirely in your browser and sends nothing. Only when you click "File Citation" does anything go out, and only the citation fields go — the directory name and URL, the name/address/phone/website found on that page, the NAP match score, the status you chose, and any notes. The screenshot is never part of that payload — it only ever saves to your device (see `preview/DESIGN-GAPS.md` for the full-page-capture roadmap).

**On Google search pages the extension sends the bare domain names of the results shown (never your query) to look up their stats; the results list and questions are copied only when you click.** See "SERP overlay" above for the full breakdown — the 10-minute local cache, the "Connect your account" no-retry behaviour, and the location simulator's copy rules.

**Link checks fetch third-party URLs directly from your browser** (Link Check section, 1.6.0+) — with credentials omitted (`credentials: 'omit'`, so no cookies go out), no caching (`cache: 'no-store'`), and a 10-second timeout per URL. This only runs after you click "Check N links" — it never runs on its own — and only after you've granted the optional `<all_urls>` permission. Results (status codes, redirects, timings) stay on your device; nothing about them is sent to SEO Bandwagon unless you choose to export the CSV yourself.

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
manifest.json           # Extension config (Manifest V3)
lib/                     # Shared pure modules (content-analysis, dom-extraction) injected before analyzer.js
src/
  background/            # Service worker: context menus, badge, capture-sync alarm, external connect handler,
                         # redirect tracer (webRequest/webNavigation, gated on <all_urls>), raw-HTML fetch
                         # and per-tab UA-switch DNR session rules (declarativeNetRequestWithHostAccess)
  content/                # Page analyzer + GSC Search Console helper
  history/                # Capture history page (search, export, sync, retry)
  lib/                    # api.js (SBW client), sync-state.js, domain-history.js, citations-ui.js,
                           # link-building-ui.js, nap-compare.js, directory-matcher.js, options-logic.js,
                           # gsc-inject.js + gsc-compare.js (Search Console helpers)
                           # perms.js (optional <all_urls> gate), csv.js, link-check.js (broken-link checker),
                           # redirect-chain.js (redirect/header/indexability logic, worker + popup share it),
                           # hreflang.js (tag validity, duplicates, x-default/self-ref, reciprocity),
                           # html-diff.js (raw-HTML vs rendered-DOM summarize/diff), ua-switch.js
                           # (user-agent presets + DNR rule shape), structured-data.js (JSON-LD/microdata/
                           # RDFa extraction + required/recommended validation, no fetch), credits.js
                           # (attribution data for the popup's About & credits panel), tool-links.js
                           # (context-menu/TOOLS-row URL builder), review-prompt.js (one-time
                           # review-prompt state machine)
  options/                # Settings page (API key, Advanced endpoint, dashboard links)
  overlay/                # SERP overlay content script (see "SERP overlay" above)
  popup/                  # Popup UI: SEO Analysis tab + Citations tab + link-check.js (Link Check section)
                           # + indexability.js (Indexability section — redirect chain, headers, trace-a-URL)
                           # + hreflang.js (Hreflang section — tag table, return-tag check)
                           # + render-check.js (Rendering section — raw-vs-rendered diff, UA switcher)
                           # + structured-data.js (Structured Data section — item/problem list, "Eligible
                           # for", CSV export, and the footer's About & credits panel)
                           # + tools.js (TOOLS row under the header) + review.js (the review-prompt strip)
  sidepanel/              # Side panel: Citations mode + Link Building mode
  styles/                 # popup.css (shared across popup/side panel/history/options)
  icons/
```

## Development

```bash
# Clone
git clone git@github.com:seo-bandwagon/seo-bw-extension.git
cd seo-bw-extension

# Install dev deps (test harness)
npm install

# Run the automated suite
npm test                 # vitest — unit + integration, ~1s
npm run test:e2e         # Playwright canary against production, ~15s

# Make changes, then reload in chrome://extensions/
```

## Testing

Three layers of automated test cover this extension, plus a manual dev harness:

| Layer | Runner | Where | When |
|---|---|---|---|
| Unit | vitest + JSDOM | `tests/unit/` | Every PR + push |
| Integration | vitest + JSDOM + fixture HTML | `tests/integration/` | Every PR + push |
| E2E canary | Playwright + real Chromium + real prod | `tests/e2e/` | Weekly cron + push to main |

CI workflows in `.github/workflows/`. The weekly canary auto-creates a GitHub issue on scheduled failure.

**Manual preview harness** — `preview/index.html` renders every popup/side-panel UI state against the real render code with stubbed APIs (`preview/stub.js`); `preview/verify.html` asserts all of them plus shell-drift checks against the real `src/` HTML. Open both directly in a browser (no build, no server) after any UI change. This harness is not run by Playwright or CI — it's a dev-only visual/DOM check you run and read yourself.

Before every Chrome Web Store submission, also walk through [MANUAL_SMOKE_TEST.md](./MANUAL_SMOKE_TEST.md) end-to-end (~10 min). It covers UI regressions, keyboard shortcuts, offline behaviour, and edge-case pages that the automated suite can't reach.

## Releasing

```bash
npm run zip        # manifest.json lib/ src/ README.md ROADMAP.md → seo-bw-extension.zip
npm run check:zip  # same, plus: fails if any file manifest.json/popup.html/options.html/
                    # history.html/sidepanel.html reference is missing from the zip; deletes
                    # the zip itself afterward (scripts/check-zip-manifest.mjs)
```

Bump `version` and `version_name` in `manifest.json` first (see `ROADMAP.md`'s versioning policy). Unzip and inspect the listing before uploading to the Chrome Web Store — it should contain `manifest.json`, `lib/`, `src/`, `README.md`, `ROADMAP.md` and nothing else (no `preview/`, `tests/`, `node_modules/`, or internal docs).

## API contract

The full request/response contract for every endpoint this extension calls lives in the site repo: `docs/API.md` on seobandwagon.com.

## License

Private - SEO Bandwagon internal tool
