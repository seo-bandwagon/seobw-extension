// SEO Bandwagon — version helpers shared by bump-version.mjs,
// check-version-bump.mjs and tests/unit/version.test.js.
//
// The version lives in four places: extension/manifest.json (`version` and the
// leading number of `version_name`), package.json, package-lock.json (top level
// and packages[""]), and the "Current version" line of ROADMAP.md. Until
// 2026-09-24 only the manifest was bumped, and package.json / the lockfile sat
// at 1.5.0 / 1.4.0 while the manifest said 1.6.0. Every writer here edits the
// text in place (a regex on the one line) rather than re-serialising JSON, so
// formatting and escapes such as package.json's — survive.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FILES = {
  manifest: 'extension/manifest.json',
  pkg: 'package.json',
  lock: 'package-lock.json',
  roadmap: 'ROADMAP.md',
  store: 'CHROMEWEBSTORE.md',
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v) {
  const m = SEMVER.exec(String(v || '').trim());
  if (!m) throw new Error(`not a three-part version: ${JSON.stringify(v)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** level: 'patch' | 'minor' | 'major', or an explicit x.y.z. */
export function bumpVersion(current, level) {
  if (SEMVER.test(String(level))) {
    if (compareVersions(level, current) <= 0) {
      throw new Error(`${level} is not higher than ${current}`);
    }
    return level;
  }
  const [maj, min, pat] = parseVersion(current);
  if (level === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  if (level === 'major') return `${maj + 1}.0.0`;
  throw new Error(`level must be patch, minor, major or x.y.z, got ${JSON.stringify(level)}`);
}

/**
 * Does this set of changed paths need a version bump? Anything under
 * extension/ ships in the zip, except Markdown, which the zip never reads.
 * Docs, tests, preview/, scripts/ and themes/ do not ship in the extension.
 */
export function needsBump(changedPaths) {
  return changedPaths.some((p) => p.startsWith('extension/') && !p.endsWith('.md'));
}

// ---- reading ---------------------------------------------------------------

export function read(rel, repo = REPO) {
  return readFileSync(path.join(repo, rel), 'utf8');
}

/** Every place the version is written, as found on disk. */
export function readVersions(repo = REPO) {
  const manifest = JSON.parse(read(FILES.manifest, repo));
  const pkg = JSON.parse(read(FILES.pkg, repo));
  const lock = JSON.parse(read(FILES.lock, repo));
  const roadmap = /\*\*Current version: (\d+\.\d+\.\d+)\*\*/.exec(read(FILES.roadmap, repo));
  const nameLead = /^(\d+\.\d+\.\d+)\b/.exec(manifest.version_name || '');
  return {
    manifest: manifest.version,
    versionName: nameLead ? nameLead[1] : null,
    pkg: pkg.version,
    lock: lock.version,
    lockRoot: lock.packages && lock.packages[''] ? lock.packages[''].version : null,
    roadmap: roadmap ? roadmap[1] : null,
  };
}

/** Versions listed in CHROMEWEBSTORE.md's Version History table. */
export function storeHistoryVersions(repo = REPO) {
  const text = read(FILES.store, repo);
  const start = text.indexOf('## Version History');
  if (start < 0) return [];
  const section = text.slice(start).split(/\n## /)[0];
  const out = [];
  for (const line of section.split('\n')) {
    const m = /^\|\s*(\d+\.\d+\.\d+)\s*\|/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

// ---- writing ---------------------------------------------------------------

function replaceOnce(text, re, replacement, label) {
  if (!re.test(text)) throw new Error(`could not find the version in ${label}`);
  return text.replace(re, replacement);
}

/** Write `next` to all four files. Returns the list of files changed. */
export function writeVersion(next, repo = REPO) {
  parseVersion(next);
  const edits = [
    [FILES.manifest, (t) => {
      t = replaceOnce(t, /("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`, FILES.manifest);
      return t.replace(/("version_name"\s*:\s*")\d+\.\d+\.\d+/, `$1${next}`);
    }],
    [FILES.pkg, (t) => replaceOnce(t, /^(  "version"\s*:\s*")\d+\.\d+\.\d+(")/m, `$1${next}$2`, FILES.pkg)],
    [FILES.lock, (t) => {
      // Top-level "version", then the one inside packages[""] — the first two
      // occurrences in the file, both at fixed indentation.
      t = replaceOnce(t, /^(  "version"\s*:\s*")\d+\.\d+\.\d+(")/m, `$1${next}$2`, FILES.lock);
      return replaceOnce(t, /(\n    "": \{\n(?:      .*\n)*?      "version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`, `${FILES.lock} packages[""]`);
    }],
    [FILES.roadmap, (t) => replaceOnce(t, /(\*\*Current version: )\d+\.\d+\.\d+(\*\*)/, `$1${next}$2`, FILES.roadmap)],
  ];
  const changed = [];
  for (const [rel, edit] of edits) {
    const file = path.join(repo, rel);
    const before = readFileSync(file, 'utf8');
    const after = edit(before);
    if (after !== before) {
      writeFileSync(file, after);
      changed.push(rel);
    }
  }
  return changed;
}
