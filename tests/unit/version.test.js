// Version bookkeeping — every place the version is written must agree, and
// the store file must have a row for it. Until 2026-09-24 the manifest said
// 1.6.0 while package.json said 1.5.0 and package-lock.json 1.4.0.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REPO, FILES, parseVersion, compareVersions, bumpVersion, needsBump,
  readVersions, storeHistoryVersions, writeVersion,
} from '../../scripts/version-lib.mjs';

describe('the version on main', () => {
  const v = readVersions();

  it('is the same in the manifest, version_name, package.json, the lockfile, ROADMAP and README', () => {
    expect(v.versionName).toBe(v.manifest);
    expect(v.pkg).toBe(v.manifest);
    expect(v.lock).toBe(v.manifest);
    expect(v.lockRoot).toBe(v.manifest);
    expect(v.roadmap).toBe(v.manifest);
    expect(v.readme).toBe(v.manifest);
  });

  it('has a CHROMEWEBSTORE.md Version History row', () => {
    expect(storeHistoryVersions()).toContain(v.manifest);
  });

  it('is the newest row in the Version History table', () => {
    const rows = storeHistoryVersions();
    const newest = rows.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
    expect(newest).toBe(v.manifest);
  });
});

describe('compareVersions / bumpVersion', () => {
  it('orders numerically, not as strings', () => {
    expect(compareVersions('1.6.10', '1.6.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.6.1', '1.6.1')).toBe(0);
    expect(compareVersions('1.6.0', '1.6.1')).toBeLessThan(0);
  });

  it('bumps each digit and resets the ones after it', () => {
    expect(bumpVersion('1.6.0', 'patch')).toBe('1.6.1');
    expect(bumpVersion('1.6.3', 'minor')).toBe('1.7.0');
    expect(bumpVersion('1.6.3', 'major')).toBe('2.0.0');
  });

  it('accepts an explicit higher version and refuses a lower or equal one', () => {
    expect(bumpVersion('1.6.0', '1.6.5')).toBe('1.6.5');
    expect(() => bumpVersion('1.6.1', '1.6.1')).toThrow();
    expect(() => bumpVersion('1.6.1', '1.5.9')).toThrow();
  });

  it('rejects anything that is not three numbers', () => {
    expect(() => parseVersion('1.6')).toThrow();
    expect(() => parseVersion('v1.6.0')).toThrow();
    expect(() => bumpVersion('1.6.0', 'hotfix')).toThrow();
  });
});

describe('needsBump', () => {
  it('is true when a shipped file under extension/ changed', () => {
    expect(needsBump(['extension/src/lib/serp.js'])).toBe(true);
    expect(needsBump(['README.md', 'extension/manifest.json'])).toBe(true);
    expect(needsBump(['extension/src/styles/popup.css'])).toBe(true);
  });

  it('is false for docs, tests, preview, scripts and themes', () => {
    expect(needsBump([
      'README.md', 'ROADMAP.md', 'CHROMEWEBSTORE.md', 'docs/CWS-LISTING.md',
      'tests/unit/serp.test.js', 'preview/verify.html', 'scripts/bump-version.mjs',
      'themes/bandwagon-neon-day/manifest.json', 'extension/README.md',
    ])).toBe(false);
  });
});

describe('writeVersion', () => {
  // Run against a copy of the five real files, so the regexes are tested on
  // the formatting they will actually meet.
  function copyRepo() {
    const dir = mkdtempSync(path.join(tmpdir(), 'sbw-version-'));
    mkdirSync(path.join(dir, 'extension'));
    for (const rel of [FILES.manifest, FILES.pkg, FILES.lock, FILES.roadmap, FILES.readme, FILES.store]) {
      cpSync(path.join(REPO, rel), path.join(dir, rel));
    }
    return dir;
  }

  it('changes exactly the five files and nothing else in them', () => {
    const dir = copyRepo();
    const before = readVersions(dir).manifest;
    const next = bumpVersion(before, 'patch');
    const originals = Object.fromEntries(
      [FILES.manifest, FILES.pkg, FILES.lock, FILES.roadmap, FILES.readme].map((f) => [f, readFileSync(path.join(dir, f), 'utf8')]),
    );

    const changed = writeVersion(next, dir);
    expect(changed.sort()).toEqual([FILES.manifest, FILES.pkg, FILES.lock, FILES.roadmap, FILES.readme].sort());

    const after = readVersions(dir);
    expect(after).toEqual({ manifest: next, versionName: next, pkg: next, lock: next, lockRoot: next, roadmap: next, readme: next });

    // Only the version string moved: swapping it back restores each file byte
    // for byte (package.json keeps its — escape, the lockfile keeps its
    // dependency versions).
    for (const [f, orig] of Object.entries(originals)) {
      const now = readFileSync(path.join(dir, f), 'utf8');
      expect(now.split(next).join(before)).toBe(orig);
    }
  });

  it('leaves dependency versions in the lockfile alone', () => {
    const dir = copyRepo();
    const lockBefore = JSON.parse(readFileSync(path.join(dir, FILES.lock), 'utf8'));
    writeVersion(bumpVersion(readVersions(dir).manifest, 'minor'), dir);
    const lockAfter = JSON.parse(readFileSync(path.join(dir, FILES.lock), 'utf8'));
    for (const [k, pkg] of Object.entries(lockBefore.packages)) {
      if (k === '') continue;
      expect(lockAfter.packages[k].version).toBe(pkg.version);
    }
  });

  it('refuses a file where the version line is missing', () => {
    const dir = copyRepo();
    writeFileSync(path.join(dir, FILES.roadmap), '# no version line here\n');
    expect(() => writeVersion('9.9.9', dir)).toThrow(/ROADMAP/);
  });
});
