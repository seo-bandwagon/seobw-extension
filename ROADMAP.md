# SEO Bandwagon Extension - Project Roadmap

## Overview
Browser extension that captures comprehensive SEO data from any webpage and saves to seobandwagon.com.

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

**API URL:** `https://seobandwagon.com/api`
**Version:** `2026-04-23-platform-consolidation` (v1.2.0 of extension)

---

## Database ✅ Created

Tables in Neon Postgres (migrated from Supabase 2026-04-23):
- `extension_analyses` (replaces `page_captures` + `page_analyses`)
- `domain_stats`
- `whois_cache`
- `contact_submissions` (in platform repo)
- `serp_snapshots`, `domain_rankings` — not yet ported; add when SERP overlay feature is enabled

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

See main seobandwagon.com Notion tasks.
