# SEO Bandwagon Extension - Project Roadmap

## Overview
Browser extension that captures comprehensive SEO data from any webpage and saves to api.seobw.dev.

---

## Data Collection Spec

### Phase 1: Content Analysis ✅ (Dell - DONE)
- [x] Word count
- [x] Character count
- [x] Sentence count
- [x] Flesch-Kincaid readability
- [x] Flesch Reading Ease
- [x] Top words (frequency)
- [x] Top phrases (2-3 word combos)

### Phase 2: Meta & Head Tags ✅ (Dell - DONE)
- [x] Title tag + character length
- [x] Meta description + character length
- [x] Canonical URL
- [x] Meta robots (index, follow, etc.)
- [x] Open Graph tags (og:title, og:description, og:image, og:type)
- [x] Twitter Card tags
- [x] Schema.org / JSON-LD (extract all structured data)

### Phase 3: Heading Structure ✅ (Dell - DONE)
- [x] H1 text (flag if multiple)
- [x] H2-H6 hierarchy (text + count per level)
- [x] Heading outline/structure

### Phase 4: Links ✅ (Dell - DONE)
- [x] Internal links (count + URLs)
- [x] External links (count + URLs + domains)
- [x] Anchor text list
- [x] Nofollow link count

### Phase 5: Images ✅ (Dell - DONE)
- [x] Total image count
- [x] Images missing alt text (count + src)
- [x] All alt text content

### Phase 6: Technical ✅ (Dell - DONE)
- [x] DOM element count
- [x] Script count
- [x] Stylesheet count
- [x] Page load time (Performance API)
- [x] URL path depth

---

## API Endpoints (Mac)

### `/v1/captures` - Store page capture
- [ ] Accept full data payload
- [ ] Validate required fields
- [ ] Store in database
- [ ] Return capture ID

### `/v1/captures/:id` - Get single capture
- [ ] Fetch by ID
- [ ] Return full data

### `/v1/captures` - List captures
- [ ] Pagination
- [ ] Filter by domain
- [ ] Filter by date range
- [ ] Search by URL

### Authentication
- [ ] API key generation
- [ ] Bearer token validation
- [ ] Rate limiting

### Database Schema
- [ ] Design tables/collections for all data points
- [ ] Indexing for search/filter performance

---

## Assignments

| Task | Owner | Status |
|------|-------|--------|
| Content analysis (Phase 1) | Dell | ✅ Done |
| Meta/head extraction (Phase 2) | Dell | ✅ Done |
| Headings extraction (Phase 3) | Dell | ✅ Done |
| Links extraction (Phase 4) | Dell | ✅ Done |
| Images extraction (Phase 5) | Dell | ✅ Done |
| Technical metrics (Phase 6) | Dell | ✅ Done |
| API endpoint: POST /captures | Mac | 🔄 In Progress |
| API endpoint: GET /captures | Mac | Queued |
| API auth system | Mac | Queued |
| Database schema | Mac | Queued |
| Extension ↔ API integration | Dell + Mac | Blocked on API |
| Extension UI updates | Dell | ✅ Done |
| Settings/options page | Dell | ✅ Done |
| Local backup system | Dell | ✅ Done |
| History page | Dell | ✅ Done |
| Export/copy JSON | Dell | ✅ Done |
| Context menus | Dell | ✅ Done |
| Keyboard shortcuts | Dell | ✅ Done |
| SEO Score (0-100 + grade) | Dell | ✅ Done |
| SERP Preview tab | Dell | ✅ Done |
| Score badge on icon | Dell | ✅ Done |
| Target keyword checker | Dell | ✅ Done |

---

## Timeline

**Today (Feb 27):**
- Dell: Complete Phase 2-6 data collection
- Mac: Deploy POST /v1/captures endpoint

**Next:**
- Integration testing
- Auth implementation
- UI polish

---

## Data Payload (Full Spec)

```json
{
  "url": "string",
  "capturedAt": "ISO timestamp",
  
  "content": {
    "title": "string",
    "wordCount": 0,
    "charCount": 0,
    "sentenceCount": 0,
    "readability": {
      "fleschKincaid": 0,
      "fleschEase": 0
    },
    "topWords": [{ "word": "string", "count": 0 }],
    "topPhrases": [{ "phrase": "string", "count": 0 }]
  },
  
  "meta": {
    "title": { "text": "string", "length": 0 },
    "description": { "text": "string", "length": 0 },
    "canonical": "string",
    "robots": "string",
    "openGraph": {
      "title": "string",
      "description": "string",
      "image": "string",
      "type": "string"
    },
    "schema": []
  },
  
  "headings": {
    "h1": ["string"],
    "h2": ["string"],
    "h3": ["string"],
    "h4": ["string"],
    "h5": ["string"],
    "h6": ["string"],
    "multipleH1": false
  },
  
  "links": {
    "internal": { "count": 0, "urls": ["string"] },
    "external": { "count": 0, "urls": ["string"], "domains": ["string"] },
    "anchors": [{ "text": "string", "href": "string" }],
    "nofollow": 0
  },
  
  "images": {
    "total": 0,
    "missingAlt": { "count": 0, "srcs": ["string"] },
    "altTexts": ["string"]
  },
  
  "technical": {
    "domElements": 0,
    "scripts": 0,
    "stylesheets": 0,
    "loadTimeMs": 0,
    "urlDepth": 0
  }
}
```
