# SEO Bandwagon Extension — Roadmap

**Current version: 1.4.0** · Manifest V3 · vanilla JS, zero dependencies, no build step

Instant on-page SEO analysis plus CitationForge local-SEO citation management (NAP
checks, proof screenshots, campaign triggers) in one extension.

---

## Versioning policy

Semantic-ish, three digits, driven by what the user would notice:

| Change | Bump | Example |
|---|---|---|
| Bug fix, copy tweak, style polish, doc change bundled with a fix | **Patch** | 1.4.0 → 1.4.1 |
| New user-facing feature | **Minor** | 1.4.x → 1.5.0 |
| Rework that resets expectations (rare) | **Major** | 1.x → 2.0.0 |

- **Stay on 1.4.x until a new feature lands.** Little changes increment the patch
  digit only.
- The version lives in `manifest.json` (`version` + human-readable `version_name`).
  The popup footer and side panel header read it via `chrome.runtime.getManifest()`,
  so **bump the manifest only** — nothing else to update.
- Docs-only changes (like this file) don't bump anything.

---

## Where we are — v1.4.0 (Aug 2026)

- **SEO Analysis tab** — score ring + four sub-scores, issues, page meta with SERP
  preview, Core Web Vitals (LCP/INP/CLS/FCP/TTFB), headings, links & images with
  on-page highlighting, content stats + n-grams, tech stack detection, technical
  panel. `src/content/analyzer.js` (~25 data categories).
- **Citations tab (CitationForge)** — directory takeover header (40 curated
  directories auto-detected), client-side NAP extraction (JSON-LD → microdata →
  heuristic) and weighted match scoring, proof screenshot capture + upload,
  one-click citation filing. `src/popup/citations-tab.js`, `src/lib/nap-compare.js`,
  `src/content/nap-extractor.js`.
- **Side panel** — businesses / campaigns / citations / proof gallery, CSV export.
  `src/sidepanel/`.
- **GSC helper** — "Search in Incognito" button injected into Search Console
  performance rows. `src/content/gsc-serp.js`.
- **Brand system** — Bandwagon Pink on Midnight Navy, tokens throughout
  `src/styles/popup.css`.
- **Dev harness** — `preview/index.html` renders every UI state against the real
  render code with stubbed APIs; `preview/verify.html` asserts all of them plus
  shell-drift checks. (The harness server config lives in
  `citation-forge/.claude/launch.json` — dev-only, users never see it, left there
  on purpose.)

Open design questions are tracked in `preview/DESIGN-GAPS.md`.

---

## Competitive position (researched Aug 2026)

Compared against the four most-installed on-page extensions (verified against
Chrome Web Store listings Aug 13, 2026): **SEOquake** (1M, 4.5★, Semrush),
**Detailed** (600K, 4.9★, now an Ahrefs property), **Ahrefs SEO Toolbar** (400K,
4.4★, metrics gated behind paid Ahrefs), **SEO Minion** (200K, 4.0★, **no longer
free** — requires a Keywords Everywhere Silver+ plan). Full matrix and sources in
`COMPARISON-PAGE.md`.

**Only we have:** local-SEO citation tooling (NAP checks, proof screenshots,
citation filing), in-browser Core Web Vitals, tech stack detection, and a
composite score — free, no account gate.

**Table-stakes features we lack** (competitor precedent → our path):

---

## v1.4.x — maintenance lane (patch bumps)

Follow-ups from `preview/DESIGN-GAPS.md`; none of these bump the minor:

- [ ] Copy pass on signed-out proof strip and empty states
- [ ] Keyboard shortcut for Check NAP (extend `commands` in manifest)
- [ ] Real directory favicons in the takeover header (cache via
      `https://www.google.com/s2/favicons`) — cosmetic
- [ ] Scroll NAP result card into view on completion (partially done)

## v1.5 — feature candidates (competitor-informed, by value ÷ effort)

1. **Wire up the SERP overlay** — `src/overlay/serp-overlay.js` is *already
   written* (injects our captures-API domain stats into Google results) but was
   never added to `manifest.json` content scripts. Parity: SEOquake, Ahrefs
   Toolbar. Effort: small (manifest entry + brand-token restyle of
   `serp-overlay.css`).
2. **Broken link checker** — HEAD-request the links the analyzer already collects,
   badge the failures, reuse on-page highlighting. Parity: SEO Minion, Ahrefs
   Toolbar. Effort: medium (rate limiting, CORS fallback to `no-cors` opaque
   checks).
3. **Redirect tracer + HTTP headers** — follow a URL's redirect chain with status
   codes and headers; pairs naturally with citation URL auditing (directory
   listings redirect constantly). Parity: Ahrefs Toolbar (Detailed and SEOquake
   lack it). Effort: medium (`fetch` with manual redirect handling in the service
   worker).
4. **Hreflang reciprocal validation** — `analyzer.js` already checks presence,
   x-default, and self-reference; add cross-page reciprocity checking. Parity:
   SEO Minion. Effort: medium.
5. **SERP data export** — CSV of organic results from the overlay; the side panel
   already has CSV export utilities to reuse. Parity: SEOquake, SEO Minion.
   Effort: small once #1 lands.
6. **SERP location simulator** — re-run the query with `&gl=`/`&uule=` params from
   a country/city picker; high value for local SEO users checking rankings in
   their service area. Parity: SEO Minion, Ahrefs Toolbar. Effort: small.

## v1.6+ — needs backend or heavier lift

- **Keyword difficulty / volume in SERP overlay** — via DataForSEO through the
  CitationForge backend (SEOquake gets this from Semrush)
- **Full-page screenshot stitching** — scroll-and-stitch capture to replace
  viewport-only proof (see DESIGN-GAPS)
- **Citation remediation flow** — the `FIX ON THIS SITE` concept from the design
  mockups: corrected-NAP copy block + deep link to each directory's edit page
- **Citation delete/undo endpoint** — enables the `Undo` affordance from mockups
- **Campaign step progress in side panel** — surface the 4-step LangGraph pipeline
  status per running campaign

## Non-goals

- **Authority metrics (DA/PA/DR)** — requires a proprietary link index; MozBar and
  Ahrefs gate theirs behind paid accounts. We don't chase this; our free CWV +
  citations + score is the counter-position.
- **Build tooling / npm** — the zero-dependency, no-build-step architecture is a
  feature. Keep it.

---

## Platform work (tracked elsewhere)

SaaS-side items (GSC OAuth, dashboard rebuild, Search Console data display, site
health dashboard) live in the main seobandwagon.dev Notion. The old extension
data-capture phases (content/meta/links capture, `/v1/captures` API, Supabase
tables, `/captures` dashboard) shipped and remain live.

## Reconciliation — 2026-09-03

This branch merges two divergent lines: `origin/main` (April 2026: v1.2.0 repoint to
`seobandwagon.com/api`, vitest+jsdom unit harness, integration tests, Playwright
canary, v1.3.0 SERP-overlay spec, `MANUAL_SMOKE_TEST.md`) and the uncommitted
1.4.0 tree snapshotted as `wip/1.4.0-citationforge` (`src/` layout, CitationForge
layer, side panel, preview harness). Product code is the 1.4.0 `src/` tree; the
April test harness, specs and workflows are kept. `lib/content-analysis.js` and
`lib/dom-extraction.js` are April's extracted pure modules and are a RUNTIME
dependency: the merged `src/content/analyzer.js` destructures
`self.SEOBWAnalysis` / `self.SEOBWExtraction`, so both files are injected before
it (popup.js and service-worker.js executeScript lists) and ship in the zip.
`tests/unit` imports them via the same dual-export. A later 1.5.0 task may move
them under `src/lib/`; until then they stay at the root.
