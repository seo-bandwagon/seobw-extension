# Chrome Web Store listing text — next submission: v1.7.7

The listing text for the next store submission, kept current with `main`
(it was `CWS-LISTING-1.6.1.md`). The store serves 1.7.1 (listing and Google's
update server, read 2026-10-13); 1.7.2 to 1.7.6 were merged but never
submitted, so 1.7.7 carries all of them, and section 6 covers everything since
1.7.1. 1.7.4's condition is met: `https://seobandwagon.com/seo-chrome-extension/welcome`
and `/uninstalled` answer 200 (2026-10-13). The manifest's permissions, host
permissions, optional host permissions and content-script matches are
identical to 1.7.1's (compared 2026-10-13); only the short description changed
(1.7.3). The `activeTab` and `scripting` justifications below also describe
the full-page proof screenshot (1.7.0). No data-use answer changes: 1.7.7
sends less, not more. Section 5's "a signed-out user … sends nothing at all"
holds from 1.7.7 on; until then the results overlay still sent result domains
signed out (seobw-extension #50). Paste each section into the matching Chrome
Web Store Developer Dashboard field when submitting.

The detailed description is the text inside the fence in section 2 and
nothing after it: the live description read on 2026-10-06 ran on past
"Nothing is sent until you connect" into sections 3 to 7 of this file.

Sections 3 to 5 (permission justifications, single purpose, data use) were
dropped by mistake when this file was renamed for 1.6.1 and are restored here
from the 1.6.0 text.

Every claim below is verifiable against this branch — no feature described
here that isn't shipped, no competitor names, no authority-metric claims,
no bot-impersonation framing, no accuracy or superiority claims.

---

## 1. Short description (≤ 132 chars)

Same text as `manifest.json`'s `description` field. A sentence, not a list:
the earlier comma list of eight terms read as keyword stuffing.

```
Check the on-page SEO of any page in one click: a score and the issues it finds, link and indexability checks, and more.
```

---

## 2. Detailed description

Rewritten 2026-09-24 after the Chrome Web Store removed the 1.6.0 draft for
keyword spam (violation Yellow Argon). The notice cited one string: fifteen
structured-data type names in a row. Expanded 2026-10-13 from about 2,500 to
about 8,200 characters (the field allows 16,000) to describe each feature
properly, still in plain sentences. Google's rules for this field
(developer.chrome.com/docs/webstore/spam-faq, read 2026-10-13):

- keywords relevant to the extension's purpose, in context, not repeated
  unnaturally; "more than 5 instances of a single keyword may result in
  increased scrutiny … but will be allowed if its use is considered
  appropriate and relevant"
- the extension's primary purpose word not more than five times (their
  example: a puzzle extension and the word "puzzle"); ours is "SEO"
- no list of more than five supported sites or brands
- nothing not directly relevant to the extension

`tests/unit/listing-copy.test.js` holds the block below to those: search and
purpose keywords at most five times, no other word repeated to the point of
stuffing, no list of five or more bare terms, and the 16,000-character limit.
Examples go in a sentence, two or three at most. Every claim is checked
against the shipped build; the privacy section follows the code
(`isDataCollectionEnabled`: sending is on by default once an account is
connected, and the description said otherwise until 2026-10-13).

```
SEO Bandwagon reviews the on-page SEO of the site you have open, right in your browser. Click the toolbar icon and the findings open in a popup, with no account and no setup. It is built for people who look after websites: owners checking their own pages, freelancers and agencies auditing a client before a call, developers confirming a release did not break anything, and local businesses keeping their directory listings straight.

The analysis runs in the tab in front of you. The checks that need to look at other websites ask for that access the first time you use them, and you can say no.

ON-PAGE ANALYSIS
Open the popup anywhere for a score from 0 to 100, a letter grade and four sub-scores covering meta tags, content, links and technical setup. Beneath the score is the list of issues it found, such as a missing H1 or a title that runs too long, so you know what to look at first. The grade also appears on the toolbar icon, so you can tell how it did without opening anything.

The analysis goes well past the headline number. You get a preview of how the listing could look in results, with the title and meta description measured against the length that usually fits. The heading outline shows every H1 to H6 in order, and clicking a heading highlights it on the page. Links are split into internal and external and marked when they carry nofollow, sponsored or user-generated attributes. Images without alt text are counted and can be highlighted where they sit. The content view gives the word count, reading level and the phrases used most often, which helps you see what the text is really about. A technical view checks the canonical tag and robots directives, and flags insecure resources on a secure page along with images that only load as you scroll. Loading and layout speed are reported as your own browser measured them, using the Core Web Vitals that Google publishes, so the numbers reflect a real visit rather than a lab estimate. The extension also names the technology behind the site, such as the content management system or the analytics in use.

BROKEN LINK CHECK
On request, the extension tests every link on the page, up to 300, and groups them by what happened to each request, so working links, redirects and each kind of failure are kept apart. Broken ones can be highlighted right where they appear, and the full list exports to a spreadsheet file. A check keeps running in the background if the popup closes or you switch tabs, and opening the popup again shows its progress or the finished results. Each address is requested without your cookies. Links to the Chrome Web Store are marked as ones Chrome does not let extensions open, instead of being counted as broken.

INDEXABILITY
Shows how the address you are on was reached: every redirect hop, its status code and whether a script moved you along, with loops flagged. Response headers that matter for crawling, such as X-Robots-Tag and the canonical link header, sit next to the robots meta tag and canonical on the page itself, and together they produce a plain yes or no on whether search engines may index it. You can trace a different address too: type it in and the extension follows its redirects in a background tab and reports the same way.

HREFLANG
For multilingual sites, every language and region annotation on the page is checked: whether each code is written correctly, whether two tags claim the same language, whether the page points to itself and whether an x-default exists. On request it fetches the alternate versions, up to 50, and confirms each one links back. Missing return links are a common reason these annotations get ignored.

RENDERING
Compares the HTML the server sent with what your browser displayed after scripts ran, field by field, from the title and meta description through to the heading, link and image counts and the length of the text. A summary tells you whether the page is static, hydrated or built by JavaScript, which matters when crawlers may not run your scripts. The View as option reloads the current tab with the user agent of a crawler or a phone, for testing server-side rendering and cloaking on your own sites. It changes only that tab and switches off when you choose Default or close it.

STRUCTURED DATA
Reads the JSON-LD, Microdata and RDFa on the page, including nested items, and compares each item with the properties its type requires and recommends. A local business without a phone number, or a product without an offer, is flagged with the exact field to add. Complete items show the rich result they qualify for, limited to rich results that currently appear, and types whose rich result has been retired are still validated as markup with a note saying so. Each item's data can be copied for a closer look.

RESULTS PAGE OVERLAY
On Google's results pages, a small bar under each organic listing names its domain and, with an account connected, shows what we know about that site. Signed out, nothing is sent. A toolbar below the results copies the listings to your clipboard as a table or exports them to a spreadsheet. Each row keeps what Google showed for that result, its description and breadcrumb included, along with an approximate overall position when you are past the first page. Another button copies the questions from the People Also Ask box. A location option reopens the same query as it would appear in another city, from 54 metro presets or any place you type, and can open two locations side by side for comparison.

SEARCH CONSOLE HELPERS
Inside Search Console's performance report, each query gets two small buttons: open it on Google, or open it in a private window to see results without your history. When you compare two date ranges, the percent change is placed beside each number so you do not have to work it out.

LOCAL CITATIONS
With a free account, the Citations tab helps you keep business listings consistent. It recognizes 40 common directories, reads the name, address and phone number on the listing you have open, and scores how closely they match your own business record. It can save a screenshot of the whole listing as proof, stitched from the top of the page to the bottom and kept on your computer, and file the citation to your account in one click.

LINK BUILDING
Also with an account, a side panel lists your outreach prospects, your draft and approved pitches, and the placements you have won, and you can add the tab you are reading as a new prospect.

SIDE PANELS
A side panel keeps the page checks open while you work, with pass, warning and fail counts for the page in the current tab. A second view holds your citations and link building work.

EXPORTS AND SHORTCUTS
Headings, links, images and the results of each check export as spreadsheet files you save yourself, and the whole analysis can be saved as one JSON file. File names include the page and the time, so one export never replaces another. A right-click menu opens the current address in tools you already use, including Search Console's URL inspection, PageSpeed Insights and the Wayback Machine, and can count the words and characters in any text you select.

APPEARANCE
Choose Night, Day or Auto, which follows your system setting. Two matching Chrome themes are available separately.

PRIVACY
No account is needed for the analysis, the checks or the exports, and their results stay on your computer. Signed out, nothing is sent. With an account connected, the results page overlay looks up the domains shown, never your query, and the analyses you run are saved to your account; untick Help improve SEO insights in the popup or in Settings to stop saving them. Saved analyses keep the page address, its metadata and the names of its structured data fields, never their values. Screenshots are saved to your computer only and never uploaded. Fetches made for the checks leave out your cookies. Your account key is stored in the browser and sent only to seobandwagon.com.

GETTING STARTED
1. Add the extension and pin it to the toolbar.
2. Open any page and click the icon.
3. Expand a section for detail, or run a check from it.
Connecting an account is optional and takes one click from your dashboard.
```

**Privacy policy**: https://seobandwagon.com/privacy

---

## 3. Permission justifications

One paragraph per permission, written for a Chrome Web Store reviewer.

**`activeTab`** — reads the current tab's URL and title only when you click
the toolbar icon or use the keyboard shortcut, and lets the popup take a
screenshot of that tab when you ask for proof of a business listing (the
Citations tab's SCREENSHOT button). Never used passively in the background.

**`storage`** — saves your page analyses locally, caches API responses, and
stores your API key and settings on your own device.

**`contextMenus`** — adds the right-click "Analyze this page" / "Analyze
linked page" / "Count words & characters" entries and the "SEO Bandwagon
tools" submenu. Each item only opens a new tab or runs the page analysis;
nothing runs without you choosing a menu item.

**`scripting`** — injects a script into the active tab only when you ask for
that action: the page-analysis script for an analysis, a reader for the
business name, address and phone number when you click Check NAP, and, when
you take a full-page proof screenshot, a small helper that scrolls the page
one screen at a time and puts it back afterwards. Not used to inject anything
into any other tab.

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

Proof screenshots are saved to the user's own device as a PNG download; the
extension never uploads them.

A user with the data-collection setting off sends nothing but the bare-domain
overlay lookup described above; a signed-out user (no API key configured)
sends nothing at all.

**Certifications** — This data is not sold to third parties. It is not used
for purposes unrelated to the extension's stated SEO-analysis and
account-sync functionality. It is not used to determine creditworthiness or
for lending purposes.

**Privacy policy**: https://seobandwagon.com/privacy

---

## 6. What's new in 1.7.7 (release notes, ≤ 10 lines)

1.7.2 to 1.7.6 were never submitted, so these cover everything since 1.7.1.

```
- The Google results overlay reads every result again, Google's own pages
  included, and Copy results and Copy PAA put the text on your clipboard.
- Signed out, the results overlay sends nothing.
- Link Check keeps going when the popup closes; Chrome Web Store links read
  "Can't check" instead of broken.
- Full-page proof screenshots no longer fail on pages that shift while they
  scroll, show "Building the image…", and Cancel works to the end.
- The side panel's Page checks opens again; export file names no longer clash.
- A welcome page on first install, a one-question page if you remove the
  extension, and a "Rate us" link.
```

---

## 7. Reviewer test notes

On a first install one tab opens at our welcome page
(`https://seobandwagon.com/seo-chrome-extension/welcome`); an update opens
nothing. Removing the extension opens a one-question survey page on
seobandwagon.com. Neither needs a permission or sends anything but the
extension's version (survey only).

No account is required to exercise every permission-bearing feature below.
Full-page proof screenshots (Citations tab) need a connected account; they
use only `activeTab` and `scripting`, which the features below also exercise.

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
  and no request is made (from 1.7.7). Copy results and Copy PAA (at the end
  of the results) put the rows or questions on the clipboard.
- An API key (free to create at seobandwagon.com) is only needed to see real
  stats numbers in the overlay and to sync captures/citations/link-building
  data — every feature above works fully signed out.
