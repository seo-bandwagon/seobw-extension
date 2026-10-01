# SEO Bandwagon Extension — Roadmap

**Current version: 1.7.0** · Manifest V3 · vanilla JS, zero dependencies, no build step

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
  `version_name`), `package.json`, `package-lock.json` and the "Current version"
  line above. Then edit `version_name`'s summary, add the
  `CHROMEWEBSTORE.md` Version History row, and add a changelog section here.
- **CI enforces it.** `scripts/check-version-bump.mjs` fails a pull request that
  changes `extension/` without raising the version, and
  `tests/unit/version.test.js` fails when the four files disagree or the store
  file has no row for the current version. Until 2026-09-24 only the manifest
  was bumped; seven PRs after 1.6.0 changed shipped code without a bump, and
  `package.json` / `package-lock.json` had drifted to 1.5.0 / 1.4.0.
- The popup footer and side panel header read the version via
  `chrome.runtime.getManifest()`.
- Docs-only changes (like this file) don't bump anything.
- Tag each version submitted to the store: `git tag v1.7.0 <merge commit>`.

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
  separate Web Store items from `themes/`.
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
  `src/styles/popup.css` token blocks, `themes/`). The extension's own pages
  follow a stored choice, else the OS setting, via `<html data-theme>`; the
  control sits in the side panel header and on the options page. Two Web Store
  theme items (Neon Night, Neon Day — `themes/bandwagon-neon-*`, listing text in
  `themes/store/LISTING.md`) match them. Scoped deliberately: no new-tab
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
  results pages, results/PAA export (19 columns: description, date, rating,
  site name, breadcrumb and the search's context), location simulator. `src/overlay/serp-overlay.js`,
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
- **Keyword difficulty / volume in SERP overlay** — via DataForSEO through the
  CitationForge backend (SEOquake gets this from Semrush)
- **Citation remediation flow** — the `FIX ON THIS SITE` concept from the design
  mockups: corrected-NAP copy block + deep link to each directory's edit page
- **Citation delete/undo endpoint** — enables the `Undo` affordance from mockups
- **Campaign step progress in side panel** — surface the 4-step LangGraph pipeline
  status per running campaign

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
