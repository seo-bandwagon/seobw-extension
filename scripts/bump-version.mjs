#!/usr/bin/env node
// SEO Bandwagon — bump the extension version everywhere it is written.
//
// Usage: npm run bump -- patch | minor | major | x.y.z
//
// Patch for fixes and small edits, minor for a feature from ROADMAP.md's
// feature list, major almost never (see ROADMAP.md, "Versioning policy").
// Writes the manifest (version + the number leading version_name),
// package.json, package-lock.json, ROADMAP.md's "Current version" line and README.md's "Version" line.
// It does not write the CHROMEWEBSTORE.md Version History row or the ROADMAP
// changelog — those need words, and tests/unit/version.test.js fails until the
// history row exists.

import { readVersions, bumpVersion, writeVersion } from './version-lib.mjs';

const level = process.argv[2];
if (!level) {
  console.error('usage: npm run bump -- patch | minor | major | x.y.z');
  process.exit(2);
}

const current = readVersions().manifest;
let next;
try {
  next = bumpVersion(current, level);
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

const changed = writeVersion(next);
console.log(`${current} → ${next}`);
for (const f of changed) console.log(`  wrote ${f}`);
console.log('Next: edit version_name\'s summary, add the CHROMEWEBSTORE.md Version History row and the ROADMAP.md changelog section.');
