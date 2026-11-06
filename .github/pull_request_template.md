## Summary

<!-- What changed and why. -->

<!-- One "Closes #N" line for every issue this PR finishes, including each
     ROADMAP.md item it checks off that carries an issue number. The
     "Issues closed" check fails without them. -->

## Checklist

- [ ] `Closes #N` for every issue this PR finishes (the "Issues closed" check reads the ROADMAP items it checks off)
- [ ] Title is a Conventional Commit with a scope, phrased as the outcome
- [ ] Version bumped (`npm run bump -- patch|minor`) if `extension/` changed
- [ ] `version_name` summary, `CHROMEWEBSTORE.md` Version History row and ROADMAP changelog section updated
- [ ] `MANUAL_SMOKE_TEST.md` §8 check added for user-facing features
- [ ] `npm test` and `npm run check:zip` pass
