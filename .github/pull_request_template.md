## Summary

<!-- What changed and why. Link the issue: Closes #N -->

## Checklist

- [ ] Linked issue (`Closes #N`)
- [ ] Title is a Conventional Commit with a scope, phrased as the outcome
- [ ] Version bumped (`npm run bump -- patch|minor`) if `extension/` changed
- [ ] `version_name` summary, `CHROMEWEBSTORE.md` Version History row and ROADMAP changelog section updated
- [ ] `MANUAL_SMOKE_TEST.md` §8 check added for user-facing features
- [ ] `npm test` and `npm run check:zip` pass
