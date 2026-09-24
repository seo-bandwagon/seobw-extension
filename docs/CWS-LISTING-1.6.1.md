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

Rewritten 2026-09-24 after a Chrome Web Store keyword-stuffing violation. The
earlier text listed schema types, metric names, crawler names, product names
and export targets; Chrome's spam policy treats long lists of terms as
keyword stuffing. **Rule for this field: sentences, no lists of names, no
term repeated for its own sake.**

```
SEO Bandwagon checks the on-page SEO of the page you are viewing, in your
browser, with one click. No account is needed for any of the checks below.

ON-PAGE ANALYSIS
A score from 0 to 100 with a letter grade, four sub-scores and a short list
of what to fix. It also shows how the page could look in search results, its
loading and layout speed as measured in your browser, its heading outline,
its links and images, and the technology the site is built on.

LINK CHECK
When you ask, checks every link on the page, groups them by result, and
highlights the broken ones on the page itself.

INDEXABILITY
Shows how the page was reached and whether search engines are allowed to
index it, with a plain yes or no. You can check another address without
leaving the page.

HREFLANG
Checks the page's language and region tags for mistakes and, when you ask,
confirms that each alternate page links back.

RENDERING
Compares the page as the server sent it with what your browser displayed,
so you can see what changed after scripts ran. You can also reload the tab
as a search-engine crawler would request it, to test how the site responds.

STRUCTURED DATA
Reads the page's structured data, checks each item for missing required and
recommended fields, and shows which rich results a complete item is eligible
for.

SEARCH RESULTS OVERLAY
On a Google results page, adds a small bar under each organic result and a
toolbar to copy or export what the page shows. Exports stay on your computer.
Only the domain names of the results are looked up, never your search.

SEARCH CONSOLE HELPERS
In a Search Console performance report, adds a one-click search for each
query and, when you compare two date ranges, a percent change next to each
number.

PAGE CHECKS PANEL AND APPEARANCE
A side panel keeps the current page's checks open while you work. Night, Day
or Auto appearance applies to every page of the extension, with two matching
Chrome themes available separately.

EXPORTS AND TOOLS
Each section exports a CSV you save yourself. A right-click menu opens the
current page in common testing and archive tools.

OPTIONAL ACCOUNT
Connect a free SEO Bandwagon account to keep your analyses, check local
business listings and manage outreach. Nothing is sent until you connect an
account and turn on sending in Settings.
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
