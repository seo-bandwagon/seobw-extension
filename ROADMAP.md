# SEO Bandwagon Extension — Roadmap

**Current version: 1.5.0** · Manifest V3 · vanilla JS, zero dependencies, no build step

Instant on-page SEO analysis, local-SEO citation management (NAP checks, proof
screenshots, campaign triggers), and link-building review, synced to your SEO
Bandwagon account.

---

## Versioning policy

Semantic-ish, three digits, driven by what the user would notice:

| Change | Bump | Example |
|---|---|---|
| Bug fix, copy tweak, style polish, doc change bundled with a fix | **Patch** | 1.5.0 → 1.5.1 |
| New user-facing feature | **Minor** | 1.5.x → 1.6.0 |
| Rework that resets expectations (rare) | **Major** | 1.x → 2.0.0 |

- **Stay on 1.5.x until a new feature lands.** Little changes increment the patch
  digit only.
- The version lives in `manifest.json` (`version` + human-readable `version_name`).
  The popup footer and side panel header read it via `chrome.runtime.getManifest()`,
  so **bump the manifest only** — nothing else to update.
- Docs-only changes (like this file) don't bump anything.

---

## Changelog — v1.5.0 (2026-09-03)

Repoints the extension from CitationForge's own backend to the SEO Bandwagon
site API (`seobandwagon.com/api`) and adds account sync throughout:

- **Unified API client** (`src/lib/api.js`, `SBW` namespace) replaces the old
  `citationforge-api.js`; every network call goes through `sbwFetch` with a
  consistent `{ ok, status, data, code }` result shape.
- **Capture sync + retry** — a `chrome.alarms`-driven drainer (`sbw-sync`,
  every 15 min) posts locally-saved captures to `POST /api/v1/captures` with
  exponential backoff (15 min → 6 hr, 5 attempts), tracked per-capture via
  `src/lib/sync-state.js`; sync-status badges (synced/pending/failed/duplicate)
  on the History page. Captures saved by a pre-1.5.0 install are opt-in, not
  automatic: `SBW.markLegacyPending()` stamps them `skipped`/`legacy` rather
  than `pending` so a 1.4.0 upgrader's local backlog isn't silently bulk-
  uploaded the first time the drainer alarm fires; the History page's
  "Include them in sync" banner (`SBWSync.unskipLegacy()`) is the only thing
  that opts them in.
- **Domain history strip** (`src/lib/domain-history.js`) — the popup's SEO
  Analysis tab now shows this domain's and URL's capture history under the
  score ring, backed by `SBW.quickDomain` / `SBW.capturesForUrl`.
- **Citations re-pointed** to `/api/citations/*` (businesses, stats, citations,
  campaigns) instead of the retired CitationForge backend.
- **Link Building side panel** — outlets (qualified prospects), pitches
  (draft/approved with approve/reject), and results (funnel, spend,
  placements), plus "Add current tab as outlet" from the popup.
- **Options page** rebuilt — verify/connect/disconnect a key, dashboard
  shortcut links, and an Advanced section for pointing at a local dev API
  (`optional_host_permissions` requested only if you use it).
- **Chrome extension "Connect" flow** — `externally_connectable` lets
  seobandwagon.com/dashboard/api-keys hand the extension a key directly via
  `chrome.runtime.connect`/`sendMessage`, without copy-paste.
- **Permissions diet** — dropped `identity` and the unused Google OAuth
  `oauth2` block (account connection is an API key, not OAuth); dropped the
  hardcoded `http://localhost:8000/*` host permission in favor of the
  Options-gated optional one above.

**Deferred to later versions:**
- Proof-screenshot upload/storage — still local-download-only; needs object
  storage on the site side before screenshots can attach to a filed citation.
- SERP overlay re-enable — moved to v1.6.0, bundled with the Google
  content-script work below (see "v1.6 — feature candidates").
- Moving `lib/content-analysis.js` / `lib/dom-extraction.js` under `src/lib/`
  — they're a runtime dependency of `src/content/analyzer.js` (injected before
  it) and currently ship from the repo root; not moved this release to keep
  the diff scoped to the API migration.
- Unify `SBW.ct.*` (throws `CtError`) and `SBW.lb.*` (returns `{ ok, code }`)
  onto one non-throwing convention (~21 call sites, counted across
  `src/sidepanel/sidepanel.js`, `src/popup/citations-tab.js`, and
  `src/popup/popup.js`) — flagged during Task 4's review as an
  accepted-for-now inconsistency between the two namespaces.

---

## Where we are — v1.5.0 (Sep 2026)

- **SEO Analysis tab** — score ring + four sub-scores, issues, page meta with SERP
  preview, Core Web Vitals (LCP/INP/CLS/FCP/TTFB), headings, links & images with
  on-page highlighting, content stats + n-grams, tech stack detection, technical
  panel, domain-history strip. `src/content/analyzer.js` (~25 data categories).
- **Citations tab** — directory takeover header (40 curated directories
  auto-detected), client-side NAP extraction (JSON-LD → microdata → heuristic)
  and weighted match scoring, proof screenshot capture (local download only),
  one-click citation filing against the SEO Bandwagon API.
  `src/popup/citations-tab.js`, `src/lib/nap-compare.js`, `src/content/nap-extractor.js`.
- **Side panel** — Citations mode (businesses / campaigns / citations) and
  Link Building mode (outlets / pitches / results), CSV export. `src/sidepanel/`.
- **Capture sync** — local-first storage with account sync, retry, and History
  page controls. `src/lib/sync-state.js`, `src/history/`.
- **Options page** — connect/verify/disconnect a key, dashboard links, Advanced
  local-dev endpoint. `src/options/`.
- **GSC row actions (1.5.1)** — two icons on every Search Console Performance row:
  open in Google Search, and in a private window. `src/lib/gsc-inject.js` +
  `src/content/gsc-serp.js`. Replaces the 1.4/1.5 "Search in Incognito" injector,
  which only fired when GSC's own hover icons were already in the DOM and so
  never appeared on a freshly loaded report.
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

## v1.5.x — maintenance lane (patch bumps)

Follow-ups from `preview/DESIGN-GAPS.md`; none of these bump the minor:

- [ ] Copy pass on signed-out proof strip and empty states
- [ ] Keyboard shortcut for Check NAP (extend `commands` in manifest)
- [ ] Real directory favicons in the takeover header (cache via
      `https://www.google.com/s2/favicons`) — cosmetic
- [ ] Scroll NAP result card into view on completion (partially done)
- [ ] Move `lib/content-analysis.js` / `lib/dom-extraction.js` under `src/lib/`
      (deferred from 1.5.0 — see changelog above)

## v1.6 — feature candidates (competitor-informed, by value ÷ effort)

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
health dashboard) live in the main SEO Bandwagon Notion. The old extension
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
