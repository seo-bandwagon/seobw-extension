# Chrome Web Store listing text — v1.6.1

This file is the listing text for the first submission since 1.2.0. It was
written for 1.6.0, which added new permissions and a new content-script match
and therefore needs reviewer-facing justification text and an updated listing.
1.6.0 was uploaded as a draft but never published; 1.6.1 is 1.6.0 plus the fixes listed in ROADMAP.md
("Changelog — v1.6.1") and changes no permission. Paste the relevant section
into the corresponding Chrome Web Store Developer Dashboard field when
submitting.

Every claim below is verifiable against this branch — no feature described
here that isn't shipped, no competitor names, no authority-metric claims,
no bot-impersonation framing, no accuracy or superiority claims.

---

## 1. Short description (≤ 132 chars)

Same text as `manifest.json`'s `description` field. A sentence, not a list:
the earlier comma list of eight terms read as keyword stuffing.

```
Check the on-page SEO of any page in one click: a score with fixes, link and indexability checks, and more.
```

---

## 2. Detailed description

Rewritten 2026-09-24 after the Chrome Web Store removed the 1.6.0 draft for
keyword spam (violation Yellow Argon). The notice cited one string: fifteen
structured-data type names in a row. Google's rules for this field
(developer.chrome.com/docs/webstore/spam-faq and /troubleshooting):

- no lists of sites, brands or keywords without substantial added value
- no single keyword more than five times
- keywords used in context, in clear sentences

`tests/unit/listing-copy.test.js` enforces the second rule and a list
detector on the block below. Examples go in a sentence, two at most.

```
SEO Bandwagon reviews the on-page SEO of the site you have open, right in
your browser. One click gives you the findings, and no account is needed.

ON-PAGE ANALYSIS
A score from 0 to 100 with a letter grade, four sub-scores and a short list
of fixes. You also see a preview of how the listing could look on Google,
loading and layout speed as your browser measured it, the heading outline,
links and images, and the technology behind the site.

LINK CHECK
On request, tests every link, groups them by status code and highlights the
broken ones where they sit.

INDEXABILITY
Shows the redirects that led to the URL and whether search engines may index
it, with a plain yes or no. You can trace another address without leaving.

HREFLANG
Finds mistakes in language and region tags and, when you ask, confirms that
each alternate version links back.

RENDERING
Compares the HTML the server sent with what your browser displayed, so you
can spot what scripts changed. You can also reload the tab the way a crawler
requests it.

STRUCTURED DATA
Reads the structured data on the page and tells you what is missing before
Google can use it. A local business without a phone number, or a product
without an offer, is flagged with the exact field to add, and complete items
show the rich result they qualify for.

SEARCH RESULTS OVERLAY
Adds a small stats bar under each organic listing on Google and a toolbar to
copy or export what you see. Exports stay on your computer, and only domain
names are looked up, never your query.

SEARCH CONSOLE HELPERS
In a performance report, opens any query on Google in one click and, when
you compare two date ranges, puts the percent change beside each number.

PANELS AND APPEARANCE
A side panel keeps the findings open while you work. Choose Night, Day or
Auto; two matching Chrome themes are available separately.

EXPORTS AND TOOLS
Every section exports a CSV you save yourself, and a right-click menu opens
the current URL in common testing and archive tools.

OPTIONAL ACCOUNT
Connect a free SEO Bandwagon account to keep your analyses, review local
business listings and manage outreach. Nothing is sent until you connect and
turn on sending in Settings.
```

**Privacy policy**: https://seobandwagon.com/privacy

---

## 6. What's new in 1.6.1 (release notes, ≤ 10 lines)

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
- Google results overlay is back: stats bar, location simulator, and an
  export with each result's description, date, rating and breadcrumb.
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
