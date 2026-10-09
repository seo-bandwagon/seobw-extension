# Promotion kit — SEO Bandwagon extension (1.7.1)

Copy for directory submissions, listing claims and pitches. The target lists,
with what each one wants and where each one stands, live in the vault (SEO
Bandwagon Brain): `03_Wiki/Extension_Link_Campaign_2026-10.md` and its
`Data_Exports/Extension_Link_Targets_2026-10-08.csv` for pitches,
`03_Wiki/Directory_Listings_Two_Tiers.md` and
`03_Wiki/Extension_Promotion_Targets.md` for directories.

Every claim here describes the version the store serves: **1.7.1** (Google's
update server, 2026-10-09). Where a form takes a version, write 1.7.1 until a
newer one is approved. Its feature set is described in `docs/CWS-LISTING.md`.

House rules, from the vault's standing facts and the owner's rulings:
- one link, `https://seobandwagon.com/seo-chrome-extension`, in every pitch and
  post; never the store listing (owner, 2026-10-03, reaffirmed 2026-10-08).
  Directories follow "Which link to use" below
- never say each issue comes with a fix: the extension names the issues it
  finds, with no fix text
- never say nothing leaves the browser or that analyses stay on the computer:
  the Google-results overlay sends result domains to seobandwagon.com
- no mention of corrections, bugs or anything removed (owner, 2026-10-03)
- no prices
- no install or user counts
- no ratings we don't have
- no Bandwagon Score as a feature
- no competitor put-downs

## Identity

| Field | Value |
|---|---|
| Name | SEO Bandwagon |
| Maker | SEO Bandwagon (seobandwagon.com) |
| Category | Tools on the Chrome Web Store (read 2026-10-09); "SEO tools" / "Browser extensions" elsewhere |
| Price | Free. The page checks need no account |
| Platform | Chrome and Chromium browsers (Edge, Brave, Arc, Opera). The Firefox port is on the roadmap, not shipped |
| Landing page | https://seobandwagon.com/seo-chrome-extension |
| Alternative pages | https://seobandwagon.com/seo-chrome-extension/detailed-seo-extension-alternative · …/ahrefs-seo-toolbar-alternative · …/seo-minion-alternative · …/keyword-surfer-comparison |
| Store listing | https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj (for reference; not a link we give out) |
| Privacy policy | https://seobandwagon.com/privacy |
| Companion themes | Neon Night https://chromewebstore.google.com/detail/bomhiblgnbmpgbddhocomnbijdkmpbhl · Neon Day https://chromewebstore.google.com/detail/ldifldabjbffldoekbebpickddaiiggm |
| Contact | kyle@seobandwagon.com |

## Which link to use

| Where | Link |
|---|---|
| Pitches, listicles, roundups, reviews, posts | https://seobandwagon.com/seo-chrome-extension |
| Directories with no badge requirement | https://seobandwagon.com (owner, 2026-10-08) |
| Directories that require a badge on the linked site | https://freeseochromeextension.com (owner, 2026-10-08) |

Never the store listing. If a form accepts nothing but a store URL, ask Kyle
before submitting it.

## Assets

`store-assets/1.6.1/` in this repo (named for the version they were captured on):
- `screenshot-1-analysis-1280x800.png` … `screenshot-5-night-day-1280x800.png`
- `promo-tile-440x280.png`, `promo-marquee-1400x560.png`
- Logo: `extension/src/icons/icon128.png`, or the pink "SB" mark from the tiles

Forms that want a square logo larger than 128 px: export the "SB" mark from
`promo-tile-440x280.png` or ask for a vector.

## One-liners

- **≤ 132 characters** (126): Free on-page SEO toolkit for Chrome: page score,
  link check, indexability, hreflang, structured data and Google results stats.
- **≤ 120 characters** (112): Free SEO Chrome extension: score any page, check
  its links, indexability and structured data. No account needed.
- **Tagline:** On-page SEO in one click.

## 50 words

SEO Bandwagon is a free Chrome extension for on-page SEO. One click scores any
page from 0 to 100 and names the issues it finds. It checks the page's links,
shows redirects and indexability, and validates hreflang and structured data.
On Google, it adds a stats bar and an export.

## 150 words

SEO Bandwagon is a free Chrome extension that audits the page you are on; its
page checks need no account. One click gives a 0 to 100 score, an A to F grade
on the toolbar icon, four sub-scores (Meta, Content, Links, Tech) and the issues
it finds, by name. It also shows page meta with a search-result preview, Core
Web Vitals, and headings, links and images, each exportable as CSV.

Six deeper checks sit behind it:
- Link Check probes the page's links and groups them by status.
- Indexability shows the redirect chain, headers and X-Robots-Tag, with a verdict.
- Hreflang validates the tags and their return links.
- Rendering compares raw HTML with the rendered page and can reload as Googlebot.
- Structured Data validates JSON-LD, Microdata and RDFa against rich-result
  requirements.
- On Google's results, a stats bar sits under each result, and an export
  captures each one's description, date, rating and breadcrumb.

## 500 words

Use the description inside the fence in `docs/CWS-LISTING.md` §2, which is
written to the same rules, without its last sentence ("Nothing is sent until
you connect and turn on sending in Settings."): the results overlay sends
result domains whether or not an account is connected.

## Tags / keywords

seo, seo chrome extension, on-page seo, seo audit, technical seo, meta tags,
broken link checker, redirect checker, hreflang, structured data, schema
validator, core web vitals, serp, google search console, free seo tool

## Feature list (1.7.1)

- One-click page score (0 to 100, with an A to F grade on the toolbar icon), four sub-scores, and the issues it finds
- Page meta and a search-result preview; Core Web Vitals (LCP, INP, CLS, FCP, TTFB)
- Headings, links and images, with on-page highlighting and CSV export; nofollow, UGC and sponsored links surfaced
- Link Check: the page's links probed and grouped by status, broken links highlighted, CSV
- Indexability: redirect chain, response headers, X-Robots-Tag, verdict; trace any URL
- Hreflang: tag validation plus return-tag checks
- Rendering: raw HTML vs. rendered DOM, and a "View as" user-agent switcher
- Structured Data: JSON-LD, Microdata and RDFa, with rich-result eligibility
- Google results overlay: stats bar per result, a 19-column CSV export, "People also ask" copy, location simulator
- Search Console helpers: open a query in Google (or privately) from the Queries tab; percent-change badges in compare mode
- Right-click tools menu: Search Console, PageSpeed Insights, Rich Results Test, Wayback Machine, site: search, sitemap.xml, robots.txt
- Local-SEO citation checks against 40 directories (NAP extraction and match scoring), with full-page proof screenshots saved to your computer (free account)
- Night / Day / Auto appearance, with two matching Chrome themes
- Analyses are kept in the browser; a free account syncs captures. The Google results overlay looks up result domains on seobandwagon.com

## Pitch copy

Kyle sends these by hand from kyle@seobandwagon.com, one personal email per
page; nothing is sent automatically. The tiers, the sending rules and the gate
after the first 30 pitches are in the vault's
`03_Wiki/Extension_Link_Campaign_2026-10.md`. Rules for every send:
- **One link**, always `https://seobandwagon.com/seo-chrome-extension`. Never
  the store listing.
- **Never** say each issue comes with a fix, and never say that nothing leaves
  the browser: the Google-results overlay sends result domains to our server.
- No mention of corrections, bugs or anything we removed. No price, no install
  count.
- Fill the brackets from the target's row in the vault's
  `Data_Exports/Extension_Link_Targets_2026-10-08.csv`. If the row's `names_us`
  is `yes`, do not send.

| Tier | Who | Draft |
|---|---|---|
| 1 and 2 | Listicles ("best SEO Chrome extensions") | A |
| 1 and 2 | Roundups of free SEO tools | B |
| 3 | Alternatives, comparison and single-extension review pages | C |

### A. Listicle refresh

> **Subject:** A free SEO Chrome extension for your [year] list
>
> Hi [name],
>
> Your "[article title]" is one of the lists people use to pick an SEO extension. If you refresh it, SEO Bandwagon
> may be worth a look.
>
> It is free, and the page checks need no account. One click scores the page from 0 to 100 and names the issues it
> finds. Past that it checks the page's links for errors, shows the redirect chain and the indexability headers,
> validates hreflang return tags and structured data, and adds an export on Google's own results pages.
>
> There is a short video tour here: https://seobandwagon.com/seo-chrome-extension
>
> Happy to send screenshots or answer anything.
>
> Kyle Alm, SEO Bandwagon

### B. Tool roundup

> **Subject:** A free SEO Chrome extension for "[article title]"
>
> Hi [name],
>
> "[article title]" lists free tools for [audits / technical SEO]. Ours fits it: a free Chrome extension that
> grades the page you are on and names the issues it finds, checks the page's links for errors, and validates
> structured data against Google's rich-result requirements. The page checks need no account.
>
> https://seobandwagon.com/seo-chrome-extension
>
> If it is useful to your readers, I am glad to send anything you need.
>
> Kyle Alm, SEO Bandwagon

### C. Alternatives and reviews

> **Subject:** Another free option for "[article title]"
>
> Hi [name],
>
> Your "[article title]" covers [competitor] and the options around it. SEO Bandwagon is a free Chrome extension
> that could sit on that list: one click gives a 0 to 100 score with the issues named, and it adds link checking,
> indexability and hreflang checks, and structured-data validation. Our page is upfront about where [competitor] does
> more than ours.
>
> https://seobandwagon.com/seo-chrome-extension
>
> Kyle Alm, SEO Bandwagon

For a page about SEO META in 1 CLICK only, one sourced line may be added: "Its
store listing shows its last update as 31 August 2024 (read [date])." Read the
listing again on the day of sending and use that day's date, or leave the line
out.
