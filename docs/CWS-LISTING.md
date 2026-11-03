# Chrome Web Store listing text — next submission: v1.13.0 (the combined submission)

The listing text for the next store submission, kept current with `main`.
The store serves 1.10.2 (published 2026-11-01, store submission A). 1.10.3
to 1.13.0 were built and not submitted: the owner ruled on 2026-11-02 that
submissions B and C become one upload, of 1.13.0. What changes in the
dashboard with it is listed, paste-ready, in `CHROMEWEBSTORE.md` under "To
paste with the combined submission (1.13.0)"; the sections below are where
each text lives. 1.11.0 adds twenty Google domains to the results-page
content script (the install warning measured unchanged) and its first new
data flow since 1.5.0: the addresses of the results on a Google results page,
sent only with an account connected and after the user accepts it in Options.
1.13.0 adds the second: the words of a Google search, with its related
searches and People also ask questions, for keyword data, sent only with an
account connected and after the user says yes to its own disclosure (sections
3 and 5). Paste each section into the matching Chrome Web Store Developer
Dashboard field when submitting.

1.13.3 (study mode for SEO Bandwagon's AI Overview study, invited testers
only) follows the combined submission and is not part of it; outside testers
start from the store on 2026-12-07. It adds a third new data flow since
1.5.0: an invited tester's study search and that results page's export, and a
note when Google stopped them, sent only after the study's own yes and a click
on Send to study or Google stopped me (sections 3, 5 and 6; the description's
PRIVACY paragraph). It adds no permission or host, and the install warning is
unchanged (measured). The single-purpose text in section 4 is unchanged.

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

Read in the dashboard 2026-10-27: the live description has no NEW TAB
section. It goes from SIDE PANELS straight to EXPORTS AND SHORTCUTS; the NEW
TAB paragraph below has never been pasted in.

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
Open the popup anywhere for a score from 0 to 100, a letter grade and four sub-scores covering meta tags, content, links and technical setup. The score is a checklist: it starts at 100 and each issue takes off its own points. Beneath it is the list of issues it found, such as a missing H1 or a title that runs too long, each with what to change and the points it costs, so you know what to look at first. The grade also appears on the toolbar icon, so you can tell how it did without opening anything.

The analysis goes well past the headline number. You get a preview of how the listing could look in results, with the title and meta description measured in pixels and cut where results usually cut them. The heading outline shows every H1 to H6 in order, flags a level that is skipped or a heading left empty, and one click highlights them where they sit. Links are split into internal and external and marked when they carry nofollow, sponsored or user-generated attributes. Images without alt text are counted apart from decorative ones, which carry an empty alt on purpose, and can be highlighted where they sit. The content view gives the word count in any language, the reading level of English text and the phrases used most often, which helps you see what the text is really about. A technical view shows where the canonical tag points, reads the robots and Googlebot directives, catches a title, description or canonical repeated in the head, checks the declared language, viewport and character set, and flags insecure resources on a secure page along with images that only load as you scroll. Loading and layout speed are reported as your own browser measured them on this visit, using the Core Web Vitals that Google publishes, so the numbers reflect a real visit rather than a lab estimate, and a measure the visit did not give says so instead of guessing. The extension also names the technology behind the site, such as the content management system, the framework or the analytics in use.

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
On Google's results pages, a bar under each organic listing shows its position and, with a free account, figures for that listing: the referring domains, backlinks, link rank and estimated traffic of the listing and of its site, how old the domain is, with its registrar and dates when you point at it, and your own checklist score where you analyzed it. Link and traffic figures come from DataForSEO and the domain dates from the registries' public records, and each figure says where it came from. You choose which figures show, whether they load with the page or when you ask, and the look: matching the results in light or dark, Night or Day. A free account gets a daily allowance of figures, and the panel shows what is left of it. Sites you list in Settings are marked as yours. Signed out, the bars show positions and nothing is sent. One panel below the results, or above them if you prefer, copies the listings to your clipboard as a table or exports them to a spreadsheet, with each listing's type, its figures and the features shown with them, such as an AI overview or a map pack. Each row keeps what Google showed for that result, its description and breadcrumb included, along with an approximate overall position when you are past the first page. Dates, ratings and ad labels are read in the language the results are in. Results pages can also be collected one at a time: add each page with a click, move on with the next-page link, and the pages you added become one list with repeats removed and an exact overall position for every listing, ready to copy or export. Another button copies the questions from the People Also Ask box. A location option reopens the same query as it would appear in another city, from 54 metro presets or any place you type, and can open two locations side by side for comparison.

Analyze checks a listing right under it: its title and description measured in pixels, headings, word count, structured data, canonical, whether it can be indexed and why not, its status and redirects, the technology behind it, whether its site's robots.txt shuts out AI crawlers and whether it has an llms.txt, all read from its HTML in your browser without your cookies, with no new tab. One click checks the top ten. A table in the panel lines the listings up, with position, type, the query's words in each title, address and description, title length, date, figures, domain age, words, schema and checklist, each cell marked above or below the median, or below your own page once you pin it as the first row. The sources an AI overview cites get a table of their own.

KEYWORD DATA
Above the listings, a strip shows figures for the query you typed: how many times a month it is looked up, how hard it is to reach the top ten, what advertisers pay a click, how many of them bid, and a line for the last twelve months. The related queries at the foot of the results and each People Also Ask question get their monthly volume beside them, in the same request, and in a list you can export. It loads when you click, or each time if you choose that in Settings, and the figures come from DataForSEO and say so. Add to my keywords puts the query, or any related query or question, in your rank tracker on seobandwagon.com, and asks which tracker when you have more than one. When your tracker already follows the query, your listing shows its position over time. This needs a free account and its own yes: the first time, a note says what is sent before anything is, and a daily allowance applies, with what is left shown under the strip.

SEARCH CONSOLE HELPERS
Inside Search Console's performance report, in any of its languages, each query gets two small buttons: open it on Google, or open it in a private window to see results without your history. When you compare two date ranges, the percent change is placed beside each number so you do not have to work it out.

LOCAL CITATIONS
With a free account, the Citations tab helps you keep business listings consistent. It recognizes 40 common directories, reads the name, address and phone number on the listing you have open, and scores how closely they match your own business record. It can save a screenshot of the whole listing as proof, stitched from the top of the page to the bottom and kept on your computer, and file the citation to your account in one click.

LINK BUILDING
Also with an account, a side panel lists your outreach prospects, your draft and approved pitches, and the placements you have won, and you can add the tab you are reading as a new prospect.

SIDE PANELS
A side panel keeps the page checks open while you work, with pass, warning and fail counts for the page in the current tab. A second view holds your citations and link building work.

NEW TAB
With SEO Bandwagon's Neon Night or Neon Day theme installed, each new tab becomes a summary of your recent work: the addresses you analyzed most recently, each in full with its score, the first issues found, the date, and how far its score moved since its previous analysis, then the latest analysis and the first issue it found, with what to change. Without one of those themes your new tab stays Chrome's own, and a setting can show the summary always or never. A box takes a site address, opens it in that tab and analyzes it; it only opens addresses. Another setting adds Chrome's usual items below the summary: a box that queries your own default engine, and your most visited sites. With an account connected, it leads with your rank changes over the last week, one tracked site at a time: each keyword that fell, from its old position to its new one, the address of yours that lost it, the one Google shows instead when it swapped them, and the first issue found at that address when you have analyzed it, with a link to an explanation of the drop on seobandwagon.com. The keywords that rose and a short list of tasks follow, asked of your account at most every ten minutes. Signed out, it reads only analyses stored on your computer and opening a new tab sends nothing.

EXPORTS AND SHORTCUTS
Headings, links, images and the results of each check export as spreadsheet files you save yourself, and the whole analysis can be saved as one JSON file. File names include the page and the time, so one export never replaces another. A right-click menu opens the current address in tools you already use, including Search Console's URL inspection, PageSpeed Insights and the Wayback Machine, and can count the words and characters in any text you select.

APPEARANCE
Choose Night, Day or Auto, which follows your system setting. Two matching Chrome themes are available separately.

PRIVACY
No account is needed for the analysis, the checks or the exports, and their results stay on your computer. Signed out, nothing is sent. With an account connected, the analyses you run are saved to your account; untick Help improve SEO insights in the popup or in Settings to stop saving them. Figures under results are off until you turn them on in Settings, which says what they send first: the address of each listing shown, never your query. Saved analyses keep the page address, its metadata and the names of its structured data fields, never their values. Screenshots are saved to your computer only and never uploaded. Fetches made for the checks leave out your cookies. Your account key is stored in the browser and sent only to seobandwagon.com.

Analyze reads a listing from your browser without your cookies, and nothing it reads is sent to us. Keyword data is off until you say yes to its own note, which says what it sends first: the words of your query with the related queries and questions shown with it, never a listing's address. Study mode is for invited testers of SEO Bandwagon's AI Overview study and is off until you turn it on in Settings, which says what it sends first: the study's search and the export of its results when you click Send to study and, when you click its stop button, a note that you were stopped that day, to the study and not to your account.

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

**`declarativeNetRequestWithHostAccess`** — used for the Rendering
section's "View as" option, and from 1.12.0 to keep Analyze on Google off
local addresses. Choosing a preset other than Default installs
one session-scoped rule that rewrites the outgoing User-Agent header for
requests from exactly the tab you're on; the rule is removed automatically
the moment you switch back to Default or close that tab. While Analyze reads
the result pages the user asked for, session rules block the extension's own
requests (no tab) to loopback, private, link-local and `.local`-style
addresses, so a result that redirects there is never followed, and are
removed when the reading ends. The extension ships with no static rulesets
at all — every rule is created and torn down at runtime.

**`host_permissions`: `https://seobandwagon.com/*`** — the only host the
extension talks to on your behalf: your own analyses, citation checks, and
link-building data, when an account is connected.

**`optional_host_permissions`: `http://localhost/*`, `http://127.0.0.1/*`**
— requested only if you point the Options page's Advanced API URL setting at
a local development server. Never requested otherwise.

**`optional_host_permissions`: `<all_urls>` (optional, requested on first
use)** — never requested at install. Requested only when you click "Allow
access to check other sites" in the Link Check, Indexability, Hreflang, or
Rendering section, or "Allow access to analyze other tabs" in the side
panel's Page checks or the popup opened by "Analyze linked page", or (from
1.10.2) "Allow access" in the extension's own small window that the first
Analyze click on a Google results page opens: from 1.12.0 Analyze fetches
the result's page, and its site's robots.txt and llms.txt, from the user's
browser without cookies (1.10.2 to 1.11.0 opened it in a background tab),
which Chrome allows only with this access. The
consent text shown at request time, verbatim
(`ALL_URLS_REASON` in `src/lib/perms.js`):

> To check links, hreflang alternates and redirects, and to compare a page's
> raw HTML with what your browser rendered, the extension has to look at
> pages on other sites from your browser: it fetches them without cookies,
> and when you ask it to trace a URL it opens that URL in a background tab
> like any normal visit. The same access lets the side panel and "Analyze
> linked page" read a tab you ask them to scan without clicking the toolbar
> icon on it first; nothing is read until you click. The "View as" option uses the same access to change
> the User-Agent header on requests from the current tab only, until you
> switch it off or close the tab. Nothing it sees on those sites is sent to
> SEO Bandwagon. You can revoke this at any time from the extensions page.

**Content-script match on Google Search Console** (`https://search.google.com/search-console/*`,
pre-existing since 1.5.1) — adds two small "open in Google Search" icons to
each row of a Performance report's Queries tab, and, when a report compares
two date ranges, small percent-change badges on the metric cards and inside
each row's Difference cell. Everything here reads the report table already
rendered on the page; nothing is fetched or sent anywhere. From 1.10.2 a
row's search opens with personalisation off (`pws=0`) and, for a property on
a country-code domain, that country (`gl`), and the icons follow a report tab
switch through the already-declared `webNavigation`.

**Content-script match on Google's own results pages** (`https://www.google.com/search*`
and the same path on 29 other Google domains; India's is `www.google.co.in` from
1.10.2, and 1.11.0 adds twenty: `.com.br`, `.com.mx`, `.co.jp`, `.pl`, `.se`,
`.no`, `.dk`, `.fi`, `.be`, `.at`, `.ch`, `.ie`, `.co.nz`, `.co.za`, `.pt`,
`.com.tr`, `.com.sg`, `.com.ph`, `.com.ar`, `.co.id`). The paste-ready text,
1.13.3 (995 of the field's 1,000 characters; 1.11.0's said "never the
search terms", which keyword data's own yes now changes, and "a background
tab", which 1.12.0's Analyze no longer opens; 1.13.3 adds the AI Overview
study's send and its stop note, and to fit drops "like any content script",
"granted at install", "restyles", "already", "link, traffic, domain-age and
keyword", "and rank history", "from the user's browser", "on a click unless
set otherwise" and "own" (the user's own checklist score), and says "It" for
"The script"):

> Content scripts on Google's results pages (www.google.com/search and the same path on 29 other Google country domains): not a host permission, so the install warning is unchanged. It reads the results on the page and adds a bar under each, a keyword strip above them and one panel; it never hides, moves or covers anything, including ads. With an account connected it sends only what the user turned on: for figures, the address and site of each result (up to 10 at a time); for keyword data, after its own disclosure, the query and the related searches and questions shown (up to 50); for the AI Overview study, after an invited tester's own yes and only on a click, that search and its page's export (Send to study, in a private window the study opened) or a note that Google stopped them (Google stopped me). seobandwagon.com answers with figures and the user's checklist score. Otherwise it sends nothing. It never fetches Google pages. Analyze reads a clicked result's page without cookies.

1.13.0 adds two files to the same content-script entry
(`src/lib/serp-keywords.js`, `src/overlay/serp-keywords.js`) and no match,
host or permission: `getPermissionWarningsByManifest` gives the same warnings
before and after (measured; see `CHROMEWEBSTORE.md` Version History).
1.13.3 adds one more file (`src/lib/aio-study.js`), also with no match, host
or permission, measured the same way (Chromium 156.0.8078.4: the same four
warnings for 1.13.2's and 1.13.3's manifests).

Measured before the domains were added
(`chrome.management.getPermissionWarningsByManifest`, Chrome for Testing 156,
2026-11-01): the same four warnings with the ten domains and with all thirty,
"Read and change your data on search.google.com, seobandwagon.com, and
www.google.com" first; a control with a non-Google host added changes that
line to "a number of websites". Until 1.10.2 the script sent the bare domain
names of the results; 1.10.2 sent nothing.

**`offscreen`** (1.12.0) — Analyze on a Google results page reads the
clicked result's page in an offscreen document (reason `DOM_PARSER`), because
the extension's service worker cannot parse HTML. The document runs the same
on-page analyzer as the popup on the HTML the extension fetched on the user's
click, from the user's browser, without cookies. Nothing is shown in it and
nothing it reads is sent anywhere. Measured with
`getPermissionWarningsByManifest` (Chrome for Testing 156): it adds no
warning. The paste-ready text is in `CHROMEWEBSTORE.md`, "To paste with
submission C".

**`management`** (1.9.5) — reads the list of installed themes with
`chrome.management.getAll()` to find out whether SEO Bandwagon's own Neon Night
or Neon Day theme is installed and turned on. The new tab page shows the
extension's dashboard only with one of them (or when the user chooses "Always"
in settings); otherwise it hands the tab straight to Chrome's own new tab
before anything is drawn. The popup and settings page use the same answer to
offer the themes. Nothing it reads leaves the browser, and the extension never
enables, disables or removes anything.

**`optional_permissions`: `topSites`, `search`** (1.9.5) — requested only when
the user turns on "show a search box and your most visited sites" below the
dashboard in settings. The search box searches with the user's own default
search engine through `chrome.search.query()`, so the extension never changes
anyone's search settings; the most-visited list comes from
`chrome.topSites.get()`. Neither is sent anywhere.

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

**1.13.0, to save with the combined submission** (998 of 1,000
characters). Checked against 1.13.0's keyword data: the volumes, difficulty,
cost per click, competition and trend of the query and of the related
searches and questions on the same results page are the on-page SEO of that
page, and "Add to my keywords" saves a chosen keyword to the user's own
account as the analyses are saved, so the purpose does not widen; the
Google results sentence names the keyword data and the account sentence the
chosen keywords. To stay within the limit, "so the user can see what the page
gets right and what it is missing" became "to show what the page gets right
and what it misses", "the user's" became "their" three times and "Its
findings" "Findings".

SEO Bandwagon analyzes the on-page SEO of the web page the user is viewing, to show what the page gets right and what it misses. In one click it scores the page and lists what it found in the title and description, headings, links, images, structured data, canonical and hreflang tags, indexability and redirects, and compares the raw HTML with the rendered page. On Google results pages it numbers each result, shows its link, traffic and domain-age figures and the query's keyword data, and analyzes any of them in one click. With an account connected, it saves those analyses and chosen keywords to the user's own SEO Bandwagon account, checks the user's local business citations against their business record, and lists their link-building prospects and placements. On its new tab page, shown with its Neon themes or when chosen in settings, it summarizes the user's recent analyses, the first issue found and the rank changes of their tracked keywords. Findings export as files the user saves.

**1.11.0's text** (992 of 1,000 characters; never saved: the combined
submission saves 1.13.0's above instead). The Google results sentence named
the figures; "its Neon Night or Neon Day theme" became "its Neon themes" and
"spreadsheet or JSON files" "files".

SEO Bandwagon analyzes the on-page SEO of the web page the user is viewing, so the user can see what the page gets right and what it is missing. In one click it scores the page and lists what it found in the title and description, headings, links, images, structured data, canonical and hreflang tags, indexability and redirects, and compares the raw HTML with the rendered page. On Google results pages it numbers each result, shows its link, traffic and domain-age figures, and analyzes any of them in one click. With an account connected, it saves those analyses to the user's own SEO Bandwagon account, checks the user's local business citations against the user's own business record, and lists the user's link-building prospects and placements. On its new tab page, shown with its Neon themes or when chosen in settings, it summarizes the user's recent analyses, the first issue found and the rank changes of the user's own tracked keywords. Its findings export as files the user saves.

The text live in the dashboard until then (980 of 1,000 characters; saved
2026-10-27, live since 2026-10-28):

SEO Bandwagon analyzes the on-page SEO of the web page the user is viewing, so
the user can see what the page gets right and what it is missing. In one click
it scores the page and lists what it found in the title and description,
headings, links, images, structured data, canonical and hreflang tags,
indexability and redirects, and compares the raw HTML with the rendered page. On
Google results pages it numbers each result and analyzes any of them in one
click. With an account connected, it saves those analyses to the user's own SEO
Bandwagon account, checks the user's local business citations against the user's
own business record, and lists the user's link-building prospects and
placements. On its new tab page, shown with its Neon Night or Neon Day theme or
when chosen in settings, it summarizes the user's recent analyses, the first
issue found and the rank changes of the user's own tracked keywords. Its
findings export as spreadsheet or JSON files the user saves.

The new tab page (`chrome_url_overrides.newtab`, 1.9.0) is the same purpose on
another surface: it reads only the analyses this extension stored and sends no
request when it opens signed out. From 1.9.5 it appears only with the Neon Night
or Neon Day theme installed (or the user's "Always" setting); anyone else keeps
Chrome's own new tab. Its optional search box (off unless the user turns it on)
searches with the user's own default engine through `chrome.search`, so it never
changes the user's search experience. From 1.10.0, signed in, it leads with the
rank changes of the user's own rank trackers on seobandwagon.com, read from the
same `GET /api/extension/progress` request the 1.9.1 cards already made; nothing
new is sent, and it links each drop to a page of the user's own dashboard.

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
  a page the user chose to analyze. (Until 1.10.2 the results overlay also
  sent the bare domain names of the results shown on a Google results page;
  1.10.2 sent nothing; 1.11.0's result addresses are links on a page, so
  they are answered under Website content below, not here.) From 1.13.0,
  after the user says yes to keyword data, also the query of a Google search
  the user makes (the words in that results page's address) and that
  Google's country and language, to look up its keyword figures; and a query
  the user adds to their rank tracker. From 1.13.3, for an invited tester of
  the AI Overview study who turned on study sends, also the study's search
  term, on Send to study, and a record that Google stopped them that day, on
  Google stopped me, to the study and apart from the account. Chrome's list
  has no search-terms category (Firefox's has, `searchTerms`, which the
  consent module maps it to), so the query is declared here, as the visited
  results page's own data, and its related searches and questions under
  Website content: more than one box rather than none. Both boxes were
  already ticked.
- **User activity — No.**
- **Website content — Yes.** Extracted metadata of the pages a user chooses
  to analyze (title, meta tags, headings, links, images, structured-data type
  and property names, technical facts). From 1.11.0 also the links of the
  results on a Google results page the user opens (each result's address and
  site, up to 10 a request), for the figures under each result: sent only
  with an account connected and after the user accepts it with "Send result
  addresses and show figures" in the extension's settings, which say what is
  sent before anything is. Never the search terms with them. seobandwagon.com
  looks the figures up with DataForSEO by those addresses and caches each address with
  its figures for 30 days, without who asked; the account keeps only its
  count of searches with new figures that day, and the call's path in its
  activity record. The user's own checklist score comes from the user's own
  captures. From 1.12.0, on the user's click, also the address of a page the
  user pins to compare with the results and of the pages an AI Overview
  cites; the words the user accepts say so (their version 2 asks again
  anyone who accepted 1.11.0's). Analyze's page fetches go to the result's
  own site, never to us. From 1.13.0, after the user says yes to keyword
  data (its own disclosure on the results page, or its card in the
  extension's settings), the related searches and People also ask questions
  shown on a Google results page, with its query, up to 50 at a time, for
  their keyword figures: on the user's click, or with each results page if
  the user chooses that. Never a result's address with them.
  seobandwagon.com looks the figures up with DataForSEO; what it keeps, and
  for how long, is the website's privacy policy (`/privacy`). From 1.13.3,
  for an invited tester of the AI Overview study who turned on study sends,
  on Send to study, that results page's export from a private window the
  study opened: the results' positions, addresses, sites, titles,
  snippets, breadcrumbs, dates and ratings, the page's features, related searches and
  People also ask questions, the AI Overview's text and sources, Google's
  country and language, the capture time and the extension version, with no
  figures, no keyword data and no "Your site" marks. It goes to the study,
  kept apart from the account: not into its captures, history or keyword
  data.

Proof screenshots are saved to the user's own device as a download (JPEG for
a full page from 1.7.8, PNG for the visible area); the extension never uploads
them. Until it's downloaded or dismissed, a finished full-page proof is kept
in the extension's own IndexedDB for that tab, and removed when the tab
closes or the browser restarts.

A user with the data-collection setting off sends no analyses; the result
addresses go only with the figures accepted, a separate switch; the query and
its related searches and questions only with keyword data's own yes, a third;
the study's search and export only for an invited tester who said yes to the
study, a fourth, and clicked Send to study (or Google stopped me, for its note).
A signed-out user (no API key configured) sends nothing at all.

**Certifications** — This data is not sold to third parties. It is not used
for purposes unrelated to the extension's stated SEO-analysis and
account-sync functionality. It is not used to determine creditworthiness or
for lending purposes.

**Privacy policy**: https://seobandwagon.com/privacy

**1.9.5: `management`, `topSites`, `search`.** The installed-theme check, the
most-visited list and searches stay in the browser; none is collected, stored
by us or sent. A search goes to the user's own default search engine, exactly as
one typed into Chrome's own new tab would.

---

## 6. What's new in 1.13.3 (release notes, ≤ 10 lines)

```
- For invited testers of SEO Bandwagon's AI Overview study: a STUDY tab in
  the popup lists the day's searches and opens each in a private window; one
  click sends that results page's export to the study. It is off until you
  turn it on in Settings, which says what it sends first.
- The export finds the AI Overview wherever it sits on the page and lists
  the pages it cites on a signed-out page, too.
```

1.13.0 (the combined submission, which uploads 1.13.2, carries it):

```
- Keyword data on Google: your search's monthly volume, difficulty, CPC,
  competition and 12-month trend (DataForSEO), on a click or with the page.
- Every related search and People Also Ask question gets its volume.
- Add to my keywords: the search, or any related one, into your rank tracker.
- A tracked search shows your result's position history on its bar.
```

1.12.0 (the combined submission carries it, and 1.10.3 to 1.11.0, too):

```
- Analyze on Google: each result's page checks open right under it, read
  from its HTML in your browser, with no new tab. Analyze top 10 in a click.
- A results table: position, type, your search's words, figures, domain
  age, words, schema and checklist, marked against the median or your page.
- Pin your own page as a row; the AI Overview's sources get their own table.
```

1.11.0 (if it wasn't published on its own, use these lines too):

Submission B carries 1.10.3 and 1.10.4 too:

```
- Figures under every Google result: the page's and the site's referring
  domains, backlinks, rank and traffic (DataForSEO), the domain's age, and
  your own checklist where you analyzed the page. Free with an account.
- One panel at the top or bottom of the results, Match Google, Night or Day.
- Your own sites marked; 20 more Google countries; exports with the figures.
- The score adds up to 100, in every language; every issue with its fix.
- Account features work on a second device; Page history is this page's.
```

1.10.0 (if it wasn't published on its own, use these lines too):

```
- Signed in, your new tab leads with your rank drops: each keyword that fell,
  from its old position to its new one, the page that lost it, the page
  Google ranks instead, and the first issue found on it, with a link to that
  drop's page on seobandwagon.com. Then the keywords that rose.
- Recent audits show each page's full address, the issues found and the date.
```

1.9.5 (if it wasn't published on its own, use these lines too):

```
- Your new tab shows the SEO Bandwagon dashboard only when the Neon Night or
  Neon Day theme is installed; otherwise it stays Chrome's own. Settings can
  show it always or never, and add a search box and your most visited sites.
```

1.9.4 (if it wasn't published on its own, use these lines too):

```
- On a page Chrome doesn't let extensions read, such as the new tab or the
  Chrome Web Store, the popup says so and why.
```

1.9.3 (if it wasn't published on its own, use these lines too):

```
- Signed in to Google, sitelinks and the AI Overview no longer count as
  results of their own, so positions in the overlay and exports match Google's.
```

1.9.2 (if it wasn't published on its own, use this line too):

```
- Signed out on Google, LinkedIn, Facebook, Instagram, TikTok and Pinterest
  profiles keep their places in the overlay and the exports.
```

1.9.1 (if it wasn't published on its own, use these lines too):

```
- Signed in, the new tab shows your rank tracking and a short task list:
  keywords that left the top 10, checks that keep failing, and the next fix.
```

1.9.0 (if it wasn't published on its own, use these lines too):

```
- A new tab page: your recently analyzed pages with their score changes,
  the latest analysis, and the first issue it found. It replaces Chrome's new tab.
- Type a site on the new tab to open it and analyze it there.
```

1.8.4 (if it wasn't published on its own, use these lines too):

```
- Analyze on a Google result opens the page and analyzes it.
- Signed out on Google, "Connect your account" opens SEO Bandwagon's sign-in
  and connects in one click, instead of a page Chrome blocked.
```

1.8.1 (if it wasn't published on its own, use this line too):

```
- A smaller download: about a third smaller, with no change in what it does.
```

1.8.0 (if it wasn't published on its own, use these lines too):

```
- Collect results pages: add each page with a click and get one list with
  repeats removed and an exact overall position, to copy or export.
- Full-page proof keeps going when the popup closes, as a smaller JPEG with
  a time estimate.
- PDFs, images and sitemaps say what they are instead of being scored.
- Hreflang and indexability ignore tracking links (utm and the like).
- The side panel reads a page only when you click Scan; it can ask for access
  to other tabs from that click.
- History search matches words in the address and the title.
```

If 1.7.7 was never submitted, its notes below still apply; keep the two
blocks within the store's limit by dropping the oldest lines first.

1.7.7 (1.7.2 to 1.7.6 were never submitted, so these cover everything since 1.7.1):

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

**New tab page (1.9.0, gated in 1.9.5)**: the extension's page replaces Chrome's
(`chrome_url_overrides.newtab`; Chrome shows "Replace the page you see when
opening a new tab" at install) only when SEO Bandwagon's Neon Night
(`bomhiblgnbmpgbddhocomnbijdkmpbhl`) or Neon Day
(`ldifldabjbffldoekbebpickddaiiggm`) theme is installed, found with
`chrome.management.getAll()`. Without either, a new tab is handed to Chrome's own
(`chrome://new-tab-page/`) before anything is drawn. To review the page, install
either theme, or choose "Always show my dashboard" under New tab in the
extension's settings; the optional search box and most-visited sites are a
checkbox there, which asks for `topSites` and `search`. It lists recent analyses from
`chrome.storage.local`. Signed out it sends no request; with an account
connected it reads `GET /api/extension/progress` at most every 10 minutes for
its Rank changes and Tasks cards (a key from before that route's scope gets a
Reconnect link). From 1.10.0 Rank changes shows, for one rank tracker at a
time, the keywords that fell (`rankTracking.drops` in that answer) with the
pages involved, and links each to its page on seobandwagon.com's dashboard,
which needs the same account signed in on the site. Typing a site address into
its box and pressing Scan opens that site in the same tab and then the popup,
which analyzes it; words that are not an address get a note, never a search.

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
  API key configured), each result's bar shows its position, Analyze and
  "Connect free to see figures", and no request is made; the link opens
  seobandwagon.com's key page to sign in and connect. Copy results and Copy
  PAA (in the SEO Bandwagon panel below the results) put the rows or
  questions on the clipboard.
- **Figures (1.11.0)**: with a key connected, the bars say "Turn on figures"
  and still nothing is sent. In the extension's settings, under Google
  results, the card "Figures under each result" says what is sent;
  "Send result addresses and show figures" turns them on. Reload the results
  page: each bar shows its figures, and the panel the plan and what is left
  of the day's allowance. "Stop sending result addresses" turns them off.
- **Analyze on Google (1.12.0)**: on a results page, click a result's
  Analyze. The first time, a small SEO Bandwagon window asks for access to
  all sites (the optional `<all_urls>`); allow it. The page's checks open
  under the result, read from its HTML: no tab opens. The page, its site's
  robots.txt and its llms.txt are fetched from the browser without cookies;
  the extension's offscreen document (`offscreen`) runs the analyzer.
  "Analyze top 10" in the panel checks every result; the panel's Table lists
  them. Signed out of Google, a result Google hides asks to sign in to Google
  or open it, and nothing is fetched for it.
- **Keyword data (1.13.0)**: signed out, the strip above the results says
  "Connect free" and nothing is sent. With a key connected, click "Show
  keyword data": the strip shows what it would send and asks first ("Yes,
  send my searches for keyword data"; the same yes is a card under Google
  results in the extension's settings). After the yes it shows the query's
  monthly volume, difficulty, CPC, competition and trend, a volume beside
  each related search and People also ask question, and "Add to my
  keywords", which needs a rank tracker on the account (with none, it links
  to making one). "Stop sending my searches" in settings turns it off.
- **AI Overview study (1.13.3)**: for invited testers only. The extension's
  settings show a card, "For invited testers of the AI Overview study", with
  "Turn on study sends"; nothing is sent to the study until that yes, and the
  popup has no STUDY tab before it. After it, the tab lists the day's terms
  for an account enrolled on seobandwagon.com (any other account is told to
  join first). Search opens a term in a private window and never in a normal
  one (without Allow in Incognito it refuses and says how to switch it on);
  there, Send to study (a real click) posts that results page's CSV export,
  without figures or keyword data, to the study, and Google stopped me posts
  a stop record. Figures and keyword data are off in that tab.
- An API key (free to create at seobandwagon.com) is only needed for the
  figures, keyword data and AI Overview study in the overlay and to sync captures/citations/
  link-building data — every other feature above works fully signed out.
