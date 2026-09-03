# SEO Bandwagon - Public Report Page Specification

## Overview

Build a public report page at `seobandwagon.com/report?url=<encoded-url>` that displays SEO analysis results for a given URL. This page is linked directly from our Chrome extension (v1.2.0) — when a user clicks the report icon in the popup, they land here with the analyzed URL pre-filled.

The page serves two purposes:
1. **Single report view** — Show the most recent analysis for a URL
2. **Historical comparison** — Show how the URL's metrics have changed over time using capture history

---

## Route & Parameters

```
GET /report?url=https%3A%2F%2Fexample.com%2Fpage
```

- `url` (required) — URL-encoded target page
- If `url` is missing, show a search/input field so the user can paste a URL manually
- The page should work for both authenticated users (with richer data) and anonymous visitors (with limited data or a prompt to install the extension)

---

## Data Source

The Chrome extension sends capture data to:

```
POST https://seobandwagon.com/api/v1/captures
```

Each capture includes the full analysis payload below. The report page should query the API for all captures matching the given URL, ordered by `capturedAt` descending.

### Full Data Payload (per capture)

```json
{
  "url": "string",
  "capturedAt": "ISO 8601 timestamp",
  "contentHash": "SHA-256 hash (for change detection)",

  "seoScore": {
    "score": 0-100,
    "grade": "A|B|C|D|F",
    "issues": ["string"]
  },

  "content": {
    "title": "string",
    "wordCount": "number",
    "charCount": "number",
    "sentenceCount": "number",
    "readability": {
      "fleschKincaid": "number (grade level)",
      "fleschEase": "number (0-100)",
      "level": "Elementary|Middle School|High School|College"
    },
    "topWords": [{ "word": "string", "count": "number" }],
    "topPhrases": [{ "phrase": "string", "count": "number" }]
  },

  "meta": {
    "title": { "text": "string", "length": "number" },
    "description": { "text": "string", "length": "number" },
    "canonical": "string|null",
    "robots": "string",
    "openGraph": { "title": "", "description": "", "image": "", "type": "", "url": "", "site_name": "" },
    "twitter": { "card": "", "title": "", "description": "", "image": "" },
    "schema": [{ "@type": "string", ... }]
  },

  "headings": {
    "h1": ["string"], "h2": ["string"], "h3": ["string"],
    "h4": ["string"], "h5": ["string"], "h6": ["string"]
  },

  "links": {
    "internal": { "count": "number" },
    "external": { "count": "number", "urls": ["string"], "domains": ["string"] },
    "anchors": [{ "text": "string", "href": "string" }],
    "nofollow": "number"
  },

  "images": {
    "total": "number",
    "missingAlt": { "count": "number", "srcs": ["string"] },
    "altTexts": ["string"]
  },

  "technical": {
    "domElements": "number",
    "scripts": "number",
    "stylesheets": "number",
    "loadTimeMs": "number|null",
    "urlDepth": "number",
    "url": { "protocol": "", "pathname": "", "search": "", "hash": "" }
  },

  "techStack": [{ "name": "string", "category": "string", "icon": "string" }],

  "webVitals": { "lcp": "number|null", "cls": "number|null", "inp": "number|null", "fcp": "number|null", "ttfb": "number|null" },
  "performance": { "loadTime": "number", "domContentLoaded": "number", "domSize": "number", "resourceCounts": {}, "totalTransferSize": "number" },
  "textToHtml": { "ratio": "number", "textSize": "number", "htmlSize": "number", "status": "string" },
  "aboveFold": { "viewportHeight": "number", "viewportWidth": "number", "totalElements": "number", "textElements": "number", "textLength": "number", "imageCount": "number", "ctaCount": "number" },
  "hreflang": { "count": "number", "entries": [], "issues": [] },
  "schemaValidation": [],
  "lazyImages": {},
  "mixedContent": {},
  "iframes": {},
  "socialCards": {},
  "faviconAndFeeds": {},
  "mediaTypes": {},
  "keywordDensity": { "titleTerms": [], "h1Terms": [] },
  "tocNavigation": {},
  "ngrams": { "totalWords": "number", "uniqueWords": "number", "bigrams": [], "trigrams": [] }
}
```

---

## Page Layout

### Header
- SEO Bandwagon logo + nav
- The analyzed URL displayed prominently (linked, truncated if long)
- "Install Chrome Extension" CTA for users who arrived without one

### Score Hero Section
- Large score circle with letter grade (A-F) and numeric score (0-100)
- Color-coded: A=#06d6a0, B=#4cc9f0, C=#ffd166, D=#f77f00, F=#ef476f
- Quick stat cards: Word Count, Reading Level, Total Links, Total Images
- Date of most recent capture

### Historical Trend (if multiple captures exist)
- **Score over time** — Line chart showing SEO score across captures
- **Content change indicator** — Flag captures where `contentHash` changed (the page was actually edited vs. just re-scanned)
- **Metric comparison table** — Side-by-side of current vs. previous capture showing deltas for: score, word count, internal links, external links, images missing alt, load time, Core Web Vitals
- Dropdown or timeline selector to pick which two captures to compare

### Report Sections (match the extension popup layout)

Display these in collapsible/expandable sections, same order as the extension:

1. **Issues** — List of SEO issues with severity indicators
2. **Top Keywords** — Top words and phrases with frequency bars
3. **Headings** — H1-H6 hierarchy tree
4. **SERP Preview** — Mock Google result (title, URL, description with length badges)
5. **Meta Tags** — Title, description, canonical, robots, Open Graph, Twitter Card, Schema types
6. **Links & Images** — Internal/external/nofollow counts, missing alt images
7. **Tech Stack** — Detected technologies with icons
8. **Content Stats** — Word count, characters, sentences, readability scores
9. **Technical** — DOM size, scripts, stylesheets, URL depth, load time
10. **N-gram Analysis** — Bigrams and trigrams with frequency
11. **Keyword Density** — Title and H1 term density percentages
12. **Core Web Vitals** — LCP, CLS, INP, FCP, TTFB with pass/fail thresholds
13. **Page Performance** — Load time, DOM ready, resource counts, transfer size
14. **Text-to-HTML Ratio** — Percentage with good/fair/poor status
15. **Above the Fold** — Viewport content analysis
16. **Social Cards** — OG and Twitter Card validation
17. **Schema Validation** — Type-by-type validation with missing fields

### Comparison Mode

When comparing two captures:
- Show each metric with a delta indicator (green arrow up = improved, red arrow down = degraded)
- Highlight sections where issues were fixed or new issues appeared
- Show word-level diff of title and meta description if they changed

### Footer
- Link to install Chrome extension
- Link to privacy policy
- "Powered by SEO Bandwagon" branding

---

## API Endpoints Needed

The report page will need these API endpoints (some may need to be built):

1. `GET /v1/captures?url=<encoded-url>` — Return all captures for a URL, sorted by `capturedAt` desc
2. `GET /v1/captures/:id` — Return a single capture by ID (for deep-linking to specific snapshots)

---

## Design Notes

- Use the same dark theme as the extension: background #1a1a2e, cards #16213e, accent #4cc9f0, text #eee
- Or offer a light mode toggle — this is a full web page, not a constrained popup
- Mobile responsive — the extension popup is 500px wide, but the report page should work on any screen
- SEO-friendly: the report page itself should have good meta tags, OG image (auto-generated screenshot or score card), and structured data
- Consider generating a shareable OG image showing the score grade + URL for social sharing

---

## Edge Cases

- **No captures found** — Show an empty state with a CTA to install the extension and analyze the page
- **Only one capture** — Show the report without comparison features; hide the trend chart
- **URL normalization** — Treat `http://` vs `https://`, trailing slashes, and `www.` variants as the same URL when querying
- **Stale data** — Show the capture date prominently so users know how fresh the data is
- **contentHash unchanged** — If consecutive captures have the same hash, indicate "No content changes detected" in the comparison
