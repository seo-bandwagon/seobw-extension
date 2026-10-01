# seo-bw-extension

SEO Bandwagon's Chrome extension (Manifest V3, vanilla JS, no bundler, no runtime
dependencies). `README.md` is the full reference; this file is the short version
for working in the repo.

## Layout

- `extension/` — the only thing that ships: `manifest.json`, `lib/`, `src/`.
  Load it unpacked from here, not from the repo root. `npm run zip` packages
  exactly those three, so anything placed elsewhere never reaches the store.
- `preview/` — design harness: the extension's real pages with `stub.js`
  standing in for `chrome.*`. Keep its markup in step when a page changes.
- `themes/` — the two Chrome theme items (Neon Night / Neon Day), separate store
  listings, packaged by `npm run zip:themes`.
- `tests/unit`, `tests/integration` — vitest + jsdom. `tests/e2e` — the
  Playwright canary (weekly + every push to `main`, files an issue on failure).
- `scripts/` — version bump and zip checks. `docs/archive/` — history only.

## Commands

```bash
npm test                 # vitest, all unit + integration
npm run test:e2e         # Playwright canary, needs a display
npm run check:zip        # builds the store zip and checks every referenced file is in it
npm run bump -- patch    # or minor / x.y.z
```

## Versions

Any non-Markdown change under `extension/` bumps the version; CI
(`scripts/check-version-bump.mjs`) fails the PR otherwise. Fixes are `patch`;
a ROADMAP feature-list item is `minor` (1.7.0 shipped the first; the next
one makes 1.8.0). After `npm run bump`, also edit `version_name`'s summary in the
manifest, add the `CHROMEWEBSTORE.md` Version History row and a ROADMAP
changelog section. Full rules: ROADMAP.md → "Versioning policy", README.md →
"Releasing".

## Conventions

- Conventional-commit titles with a scope, phrased as the outcome:
  `fix(gsc): the row icons stay on the Queries tab`. PRs are squash-merged.
- Branches: `feat/`, `fix/`, `chore/`, `docs/`, `release/`.
- A user-facing feature adds its check to `MANUAL_SMOKE_TEST.md` §8 in the same PR.
- `src/lib/*.js` modules use the dual-export pattern (a `globalThis` namespace
  for pages and the service worker, `module.exports` for vitest) — see the top of
  `src/lib/sync-state.js`.

## Hotspots

- `extension/src/background/service-worker.js` (~1200 lines) holds every
  background message handler across several `onMessage` listeners. Add a new
  action next to its feature's existing listener, not in a new listener.
- The list of analyzer files injected into a page is written out in four places:
  `service-worker.js`, `popup/popup.js`, `popup/link-check.js`, and
  `ANALYZER_FILES` in `lib/sbw-data.js`. Change all four together.
- `extension/src/styles/popup.css` is one sheet shared by every page (popup,
  options, both side panels, history).

## Findings

SEO Bandwagon findings, decisions and measurements go to the Obsidian vault
(see the global CLAUDE.md), not into this repo's docs.
