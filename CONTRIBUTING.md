# Contributing

See `README.md` for setup and `CLAUDE.md` for repo layout.

- Branches: `feat/`, `fix/`, `chore/`, `docs/`, `release/`.
- PR titles: Conventional Commits with a scope, phrased as the outcome, e.g.
  `fix(gsc): the row icons stay on the Queries tab`. PRs are squash-merged.
- Any non-Markdown change under `extension/` must bump the version
  (`npm run bump -- patch|minor`); CI fails otherwise. Also update the manifest
  `version_name`, the `CHROMEWEBSTORE.md` Version History and the ROADMAP changelog.
- User-facing features add a check to `MANUAL_SMOKE_TEST.md` §8.
- Run `npm test` and `npm run check:zip` before opening a PR.
- Link an issue with `Closes #N`.
