# Reconciliation — 2026-09-03

*Moved from ROADMAP.md on 2026-09-28. Historical: `lib/content-analysis.js` and `lib/dom-extraction.js` now live in `extension/lib/`, and the 1.4.0 snapshot branch `wip/1.4.0-citationforge` is tagged `archive/1.4.0-baseline`.*

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
