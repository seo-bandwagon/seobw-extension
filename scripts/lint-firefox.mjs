#!/usr/bin/env node
// SEO Bandwagon — `web-ext lint` on the Firefox package (1.13.10), as
// addons.mozilla.org's validator will read the upload: builds it with
// scripts/build-zip.mjs (comments kept), unpacks it into a temporary folder,
// and runs Mozilla's web-ext (addons-linter) on that folder. Playwright can't
// load Firefox extensions, so this is the Firefox check CI runs on every PR.
//
// Fails on any lint error; warnings are printed and counted, not failed.
// What the warnings were when this was written (web-ext 10.8.0,
// 2026-11-16): 65, none from the manifest except Android's (the package
// sets no `gecko_android`, so it is for desktop Firefox; the linter still
// measures Android against `strict_min_version` 140, and Firefox for Android
// reads `data_collection_permissions` from 142): 60 assignments to
// innerHTML or outerHTML in the popup and side panel, and the
// Chrome-only sidePanel.setPanelBehavior and offscreen calls the code checks
// for before it makes them.
//
// usage: npm run lint:firefox   (node scripts/lint-firefox.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildZip } from './build-zip.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_EXT = path.join(REPO, 'node_modules', '.bin', 'web-ext');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-firefox-lint-'));
let status = 1;
try {
  const zip = path.join(dir, 'firefox.zip');
  const src = path.join(dir, 'package');
  buildZip(zip, { target: 'firefox' });
  fs.mkdirSync(src);
  execFileSync('unzip', ['-q', zip, '-d', src]);
  const run = spawnSync(WEB_EXT, ['lint', '--source-dir', src, '--output', 'json', '--no-input'], { encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(run.stdout); } catch (e) { /* printed below */ }
  if (!report) {
    process.stderr.write(run.stdout + run.stderr);
    console.error('lint-firefox: web-ext gave no report');
  } else {
    const { errors, warnings, notices } = report.summary;
    for (const kind of ['errors', 'warnings', 'notices']) {
      for (const m of report[kind]) {
        const where = m.file ? ` ${m.file}${m.line ? `:${m.line}` : ''}` : '';
        console.log(`${kind.slice(0, -1).toUpperCase()} ${m.code}${where}: ${m.message}`);
      }
    }
    console.log(`lint-firefox: ${errors} errors, ${warnings} warnings, ${notices} notices (web-ext lint on the Firefox package)`);
    status = errors === 0 && run.status === 0 ? 0 : 1;
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
