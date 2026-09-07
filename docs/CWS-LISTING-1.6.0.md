# Chrome Web Store listing text — v1.6.0

`docs/CWS-LISTING-1.5.2.md` does not exist and is not needed: 1.5.2 shipped
under the listing text already live on the Chrome Web Store (no new
permission, no new content-script match, so nothing in the store listing
needed to change). This file is the first CWS-LISTING doc in the repo — it
covers v1.6.0, the release that adds new permissions and a new content-script
match and therefore needs reviewer-facing justification text and an updated
listing. Paste the relevant section into the corresponding Chrome Web Store
Developer Dashboard field when submitting this version.

Every claim below is verifiable against this branch — no feature described
here that isn't shipped, no competitor names, no authority-metric claims,
no bot-impersonation framing, no accuracy or superiority claims.

---

## 1. Short description (≤ 132 chars)

Same text as `manifest.json`'s `description` field (130 chars):

```
SEO analysis, link check, indexability, hreflang, rendering, structured data, citations and link-building, synced to your account.
```

---

## 2. Detailed description

```
SEO Bandwagon is an on-page SEO toolkit that runs entirely in your browser.
Click the toolbar icon on any page for an instant analysis — no account
required for the core features below.

ON-PAGE ANALYSIS
A 0–100 score with an A–F grade and four sub-scores (Meta, Content, Links,
Tech), page meta with a search-result preview, Core Web Vitals (LCP, INP,
CLS, FCP, TTFB), heading structure with on-page highlighting, link and image
audits, content statistics and word/phrase frequency, and detected
technologies (CMS, analytics, frameworks).

LINK CHECK
Checks every link on the page and groups the results by outcome (working,
redirected, 4xx, 5xx, timeout, network error), highlights broken links on the
page itself, and exports the results as a CSV. Runs only when you click
"Check N links."

INDEXABILITY
Shows the current page's redirect chain, response headers, and X-Robots-Tag
directive alongside its on-page meta robots and canonical tag, combined into
a plain indexable / not-indexable verdict. You can also trace any URL you
type without leaving the page you're on.

HREFLANG
Validates every hreflang tag declared on the page — tag format, duplicate
language tags, a missing x-default, a missing self-reference — and, on
request, fetches each alternate URL to confirm it links back to this page.

RENDERING
Compares the page's raw, unrendered HTML against what your browser actually
rendered, so you can see what changed via JavaScript. A "View as" option lets
you reload the current tab under a different User-Agent (Googlebot Desktop,
Googlebot Smartphone, Bingbot, or iPhone Safari) for testing how a page's
server-side rendering or cloaking behaves — not for bypassing a paywall,
login gate, or any other access control.

STRUCTURED DATA
Extracts JSON-LD, Microdata, and RDFa structured data from the page and
checks each item's properties against the required and recommended fields
for its type (Article, Product, LocalBusiness and its many subtypes,
Organization, Person, BreadcrumbList, FAQPage, HowTo, Recipe, Event,
VideoObject, Review, WebSite, WebPage, JobPosting, and more), showing which
Google rich results a complete item is eligible for. FAQPage and HowTo are
still validated as markup, with a note that Google no longer shows a rich
result for either.

GOOGLE RESULTS OVERLAY
On Google's own search results pages, adds a small stats bar under each
organic result and a toolbar for copying the results and "People also ask"
questions, plus a tool for opening a search with location parameters to see
what searchers in another area are shown. Only bare domain names are ever
sent anywhere for this — never your search query, never a page title or
snippet.

SEARCH CONSOLE HELPERS
On a Google Search Console Performance report's Queries tab, adds two
one-click "open in Google Search" actions (a normal tab and a private
window) to each query row, and — when comparing two date ranges — percent-
change badges on the metric cards and inside each row's Difference cell, all
computed from the numbers already on the page.

APPEARANCE
Night or Day for the extension's own pages, or Auto to follow your system
setting — one choice, applied to the popup, side panel and options page.
Matching Chrome themes (SEO Bandwagon Neon Night / Neon Day) are separate
Web Store items.

TOOLS MENU
A right-click menu and a matching row in the popup for opening the current
page in Google Search Console (URL inspection), PageSpeed Insights, Rich
Results Test, and the Wayback Machine, plus a domain-scoped site: search and
shortcuts to the page's sitemap.xml and robots.txt.

EXPORTS
Link Check, Indexability, Hreflang, Rendering, Structured Data, the results
overlay, and the headings/images/links tables each export a CSV you save
yourself; the Search Console helpers copy TSV to the clipboard.

ACCOUNT SYNC (OPTIONAL)
Connect a free SEO Bandwagon account to sync your page analyses, check
citations against local-SEO directories, and manage link-building outreach
without leaving the page. Nothing syncs until you connect an account and
turn on the data-collection setting.
```

---

## 3. Permission justifications

One paragraph per permission, written for a Chrome Web Store reviewer.

**`activeTab`** — reads the current tab's URL and title only when you click
the toolbar icon or use the keyboard shortcut. Never used passively in the
background.

**`storage`** — saves your page analyses locally, caches API responses, and
stores your API key and settings on your own device.

**`contextMenus`** — adds the right-click "Analyze this page" / "Analyze
linked page" / "Count words & characters" entries and the "SEO Bandwagon
tools" submenu. Each item only opens a new tab or runs the page analysis;
nothing runs without you choosing a menu item.

**`scripting`** — injects the page-analysis script into the active tab when
you ask for an analysis. Not used to inject anything into any other tab.

**`sidePanel`** — powers the Link Building and Citations side panel.

**`tabs`** — reads the active tab's URL to open dashboard links in new tabs,
and watches for a tab finishing a page load so the background service worker
can match its URL against a bundled list of local-SEO directory hostnames and
paint a small toolbar badge when there's a match. That match is a local
string comparison only; the URL itself is never sent anywhere for it.

**`alarms`** — runs a 15-minute background timer that retries any capture
that failed to sync to your account. Does nothing when no account is
connected.

**`webRequest`** — observes top-level navigations in every open tab (a fixed
listener filter matching main-frame requests only), buffering each tab's last
25 redirect/status/response-header events in `chrome.storage.session`. Only
the buffer for the tab you currently have the popup open on is ever read —
by the Indexability panel — and it's cleared when that tab closes, the
browser restarts, or the optional permission below is revoked. It is
observe-only: it never blocks, redirects, or modifies a request or response.
It fires on nothing at all unless you've separately granted the optional
`<all_urls>` permission below, and it never reads a response body.

**`webNavigation`** — detects client-side (JavaScript) redirects for the same
Indexability panel, and notices when a page finishes reloading so the
"Reload to capture" button can re-check it. Also observe-only.

**`declarativeNetRequestWithHostAccess`** — used only for the Rendering
section's "View as" option. Choosing a preset other than Default installs
one session-scoped rule that rewrites the outgoing User-Agent header for
requests from exactly the tab you're on; the rule is removed automatically
the moment you switch back to Default or close that tab. No rule is ever
installed until you pick a preset, and the extension ships with no static
rulesets at all — every rule is created and torn down at runtime, per tab.

**`host_permissions`: `https://seobandwagon.com/*`** — the only host the
extension talks to on your behalf: your own analyses, citation checks, and
link-building data, when an account is connected.

**`optional_host_permissions`: `http://localhost/*`, `http://127.0.0.1/*`**
— requested only if you point the Options page's Advanced API URL setting at
a local development server. Never requested otherwise.

**`optional_host_permissions`: `<all_urls>` (optional, requested on first
use)** — never requested at install. Requested only when you click "Allow
access to check other sites" in the Link Check, Indexability, Hreflang, or
Rendering section. The consent text shown at request time, verbatim
(`ALL_URLS_REASON` in `src/lib/perms.js`):

> To check links, hreflang alternates and redirects, and to compare a page's
> raw HTML with what your browser rendered, the extension has to look at
> pages on other sites from your browser: it fetches them without cookies,
> and when you ask it to trace a URL it opens that URL in a background tab
> like any normal visit. The "View as" option uses the same access to change
> the User-Agent header on requests from the current tab only, until you
> switch it off or close the tab. Nothing it sees on those sites is sent to
> SEO Bandwagon. You can revoke this at any time from the extensions page.

**Content-script match on Google Search Console** (`https://search.google.com/search-console/*`,
pre-existing since 1.5.1) — adds two small "open in Google Search" icons to
each row of a Performance report's Queries tab, and, when a report compares
two date ranges, small percent-change badges on the metric cards and inside
each row's Difference cell. Everything here reads the report table already
rendered on the page; nothing is fetched or sent anywhere.

**Content-script match on Google's own results pages** (`https://www.google.com/search*`
and the same path on nine other Google TLDs) — this is a declared
content-script match, not a host permission, so it is granted at install like
any other content script rather than requested at first use. We recognize
this widens the install-time permission warning to cover 10 Google search
hosts, on top of the search.google.com and seobandwagon.com access the
extension already has, and justify it plainly: the
script only reads the organic results already rendered on the page, sends
nothing but the bare domain names of those results to our own API (never the
search query, never a title or snippet), and is additive-only — it appends a
small stats bar and a toolbar, and never hides, moves, covers, or restyles
any existing content, including ads. Nothing is fetched from Google by the
extension itself; the stats lookup goes through our own background service
worker to our own API.

**`web_accessible_resources`** — not present in this manifest. `src/history/
history.html` (the capture-history page) is only ever opened by
`chrome.tabs.create(chrome.runtime.getURL(...))` from the extension's own
Options page (`src/options/options.js`) — a full-tab navigation between two
of the extension's own pages, which Chrome always allows regardless of this
key. No web page and no content script references it, so declaring it
web-accessible would only widen exposure for no purpose; it has been
removed rather than narrowed.

**`externally_connectable`** (`https://seobandwagon.com/*`) — lets the
"Connect Chrome extension" button on the seobandwagon.com dashboard message
the extension directly (`chrome.runtime.onMessageExternal`) to hand it a
freshly minted API key, which the extension then verifies the same way a
key pasted into Options is verified. No other site can message the
extension this way.

---

## 4. Single-purpose statement

SEO Bandwagon analyses the SEO signals of the page you are viewing and syncs
that analysis — and the local-SEO citation and outreach records derived from
it — to the user's own SEO Bandwagon account.

---

## 5. Data-use disclosures (Privacy tab checkboxes)

Chrome's Privacy tab asks for a yes/no against nine data categories. Ours,
with the reasoning behind each:

- **Personally identifiable information — No.** A synced capture carries the
  page URL and its extracted metadata — structured-data blocks are reduced to
  their type and property names, never values — not anything identifying the
  person using the extension. The user's own SEO Bandwagon account email is
  held server-side by seobandwagon.com; the extension never collects it.
- **Health information — No.**
- **Financial and payment information — No.**
- **Authentication information — Yes.** The user's SEO Bandwagon API key is
  stored locally (`chrome.storage`) and sent as a Bearer header to
  `seobandwagon.com` only — never to any other host, never to a page being
  analyzed.
- **Personal communications — No.**
- **Location — No.**
- **Web history — Yes.** Each synced capture carries the URL and timestamp of
  a page the user chose to analyze. Separately, the results-overlay lookup
  sends the bare domain names of search results currently displayed on a
  Google results page — domains shown, not a browsing history and not pages
  visited.
- **User activity — No.**
- **Website content — Yes.** Extracted metadata of the pages a user chooses
  to analyze (title, meta tags, headings, links, images, structured-data type
  and property names, technical facts).

A user with the data-collection setting off sends nothing but the bare-domain
overlay lookup described above; a signed-out user (no API key configured)
sends nothing at all.

**Certifications** — This data is not sold to third parties. It is not used
for purposes unrelated to the extension's stated SEO-analysis and
account-sync functionality. It is not used to determine creditworthiness or
for lending purposes.

**Privacy policy**: https://seobandwagon.com/privacy

---

## 6. What's new in 1.6.0 (release notes, ≤ 10 lines)

```
- Link Check: probes every link on the page, groups results, highlights
  broken ones, exports CSV.
- Indexability: redirect chain, response headers, X-Robots-Tag, and a
  verdict — trace any URL.
- Hreflang: tag validation plus fetched return-tag reciprocity checks.
- Rendering: raw HTML vs. rendered DOM diff, and a "View as" user-agent
  switcher.
- Structured Data: JSON-LD/Microdata/RDFa validation with rich-result
  eligibility.
- Google results overlay is back: stats bar, results/PAA export, location
  simulator.
- New "SEO Bandwagon tools" right-click menu; CSV export for headings,
  images, and links.
```

---

## 7. Reviewer test notes

No account is required to exercise every permission-bearing feature below.

- **Link Check**: open the popup on any page with links, expand "Link
  Check," click "Check N links." Click "Allow access to check other sites"
  first if prompted — this is the optional `<all_urls>` grant.
- **Indexability**: open the popup on any page — the panel populates as soon
  as the optional permission above is granted, then reload the page (or
  click "Reload to capture") — HTTP signals are only recorded on a
  navigation. To test "Trace another URL," type any URL into the trace field
  and submit.
- **Hreflang**: open the popup on a page with `hreflang` tags (or any page —
  the tag table renders even with zero tags). "Check return tags" needs the
  same optional permission.
- **Rendering → "View as"**: open the popup on any page, expand "Rendering,"
  choose a preset other than Default from the dropdown. The current tab
  reloads under that User-Agent; switch back to Default to remove it.
- **Google results overlay**: search anything on google.com. Signed out (no
  API key configured), each result's stats bar shows "Connect your account"
  and does not retry.
- An API key (free to create at seobandwagon.com) is only needed to see real
  stats numbers in the overlay and to sync captures/citations/link-building
  data — every feature above works fully signed out.
