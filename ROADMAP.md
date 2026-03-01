# SEO Bandwagon Extension - Project Roadmap

## Overview
Browser extension that captures comprehensive SEO data from any webpage and saves to api.seobandwagon.dev.

---

## Status: ✅ COMPLETE

All phases done. Extension is fully functional and syncing to API.

---

## Data Collection ✅ All Done

- **Phase 1-6:** Content, meta, headings, links, images, technical — all complete
- **UI:** Score badge, SERP preview, history page, settings, export
- **Local Storage:** Offline-first with sync when API available

---

## API Endpoints ✅ Deployed

| Endpoint | Status |
|----------|--------|
| `POST /v1/captures` | ✅ Live |
| `GET /v1/captures` | ✅ Live |
| `GET /v1/captures?domain=` | ✅ Live |
| Health check | ✅ Live (`/health`) |

**API URL:** `https://api.seobandwagon.dev`
**Version:** `2026-02-27-v1-captures`

---

## Database ✅ Created

Tables created in Supabase:
- `page_captures`
- `page_analyses`
- `domain_stats`
- `serp_snapshots`
- `domain_rankings`
- `whois_cache`
- `contact_submissions`

---

## Frontend Dashboards ✅ Merged

- `/captures` — View extension captures
- `/mcp-tracker` — Public MCP rankings
- `/tools/link-analyzer` — Link analysis tool

---

## What's Next

Extension project is **DONE**. Remaining work is on the SaaS platform:

1. GSC OAuth integration (connect user's Search Console)
2. Dashboard rebuild (account info, connected services)
3. Search Console data display (pages, queries, CTR)
4. Site health dashboard (CWV, readability, structured data)

See main seobandwagon.dev Notion tasks.
