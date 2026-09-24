#!/usr/bin/env node
// SEO Bandwagon — CI check: a pull request that changes what ships must raise
// the version.
//
// Usage: node scripts/check-version-bump.mjs [base-ref]   (default origin/main)
//
// "What ships" is anything under extension/ except Markdown (see needsBump in
// version-lib.mjs). Seven PRs changed extension/ after 1.6.0 without a bump
// (#13 through #22, Sep 2026); this is what stops the eighth.

import { execFileSync } from 'node:child_process';
import { REPO, FILES, readVersions, compareVersions, needsBump } from './version-lib.mjs';

const base = process.argv[2] || 'origin/main';
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });

const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
if (!needsBump(changed)) {
  console.log(`No shipped files changed against ${base}; no version bump needed.`);
  process.exit(0);
}

const baseVersion = JSON.parse(git('show', `${base}:${FILES.manifest}`)).version;
const headVersion = readVersions().manifest;

if (compareVersions(headVersion, baseVersion) > 0) {
  console.log(`Version ${baseVersion} → ${headVersion}. OK.`);
  process.exit(0);
}

const shipped = changed.filter((p) => needsBump([p]));
console.error(`extension/ changed but the version is still ${headVersion} (${base} has ${baseVersion}).`);
console.error('Shipped files changed:');
for (const p of shipped) console.error(`  ${p}`);
console.error('Run `npm run bump -- patch` for a fix, `-- minor` for a roadmap feature.');
process.exit(1);
