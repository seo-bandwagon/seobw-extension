#!/usr/bin/env node
// SEO Bandwagon — release check: does a built store package actually contain
// every local file the shipped extension can reach, and is its manifest the
// target's?
//
// Scope (deliberately narrow — see task-8-brief.md section A): every local
// path referenced by the packaged manifest.json itself, plus every local
// <script src>/<link href> in the six HTML entry points (popup, options,
// history, sidepanel, panel, access), plus the relative `import ... from`
// graph of any ES module those pages load (panel.js imports theme-sync.js).
// This does NOT walk chrome.scripting.executeScript file lists inside
// service-worker.js/popup.js (e.g. lib/content-analysis.js,
// lib/dom-extraction.js, src/content/analyzer.js) — those are a separate,
// already-covered injection path, not something a browser loads from the
// manifest or an HTML shell.
//
// 1.13.6: everything is read from the package, not from extension/, since a
// target's manifest and pages differ from the source (scripts/targets/).
//
// Usage: node scripts/check-zip-manifest.mjs
//          builds every target (scripts/build-zip.mjs) into a temporary
//          folder and checks each; what `npm run check:zip` runs.
//        node scripts/check-zip-manifest.mjs <zipfile> [--target chrome|edge]
//          checks a zip that already exists (default target chrome).
// Exits non-zero and prints every problem if a package falls short.
//
// Dual-purpose by design, not dual-export — this is a standalone Node CLI
// script, never loaded by the extension itself, so no globalThis/module
// export dance is needed here (contrast src/lib/*.js).

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGETS, targetOf, buildZip } from './build-zip.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HTML_ENTRY_POINTS = [
  'src/popup/popup.html',
  'src/options/options.html',
  'src/history/history.html',
  'src/sidepanel/sidepanel.html',
  'src/panel/panel.html',
  'src/access/access.html'
];

function isLocal(ref) {
  if (!ref) return false;
  if (/^(https?:)?\/\//i.test(ref)) return false; // absolute/protocol-relative URL
  if (ref.startsWith('#')) return false; // in-page anchor
  if (ref.startsWith('mailto:')) return false;
  if (ref.startsWith('data:')) return false;
  return true;
}

function collectFromManifest(manifest) {
  const refs = new Set();
  const addIfLocal = (v) => { if (typeof v === 'string' && isLocal(v)) refs.add(v); };

  Object.values(manifest.icons || {}).forEach(addIfLocal);
  if (manifest.action) {
    Object.values(manifest.action.default_icon || {}).forEach(addIfLocal);
    addIfLocal(manifest.action.default_popup);
  }
  addIfLocal(manifest.options_page);
  if (manifest.background) addIfLocal(manifest.background.service_worker);
  if (manifest.side_panel) addIfLocal(manifest.side_panel.default_path);
  Object.values(manifest.chrome_url_overrides || {}).forEach(addIfLocal);

  (manifest.content_scripts || []).forEach((cs) => {
    (cs.js || []).forEach(addIfLocal);
    (cs.css || []).forEach(addIfLocal);
  });

  (manifest.web_accessible_resources || []).forEach((war) => {
    (war.resources || []).forEach(addIfLocal);
  });

  // These are manifest-root-relative already (that's how Chrome resolves
  // them), so no dirname resolution needed — just normalize.
  return [...refs].map((r) => path.normalize(r));
}

// Static relative imports of an ES module, followed recursively. Bare
// specifiers and URLs are skipped (the extension has neither), as are dynamic
// import() calls.
function collectImports(absJsPath, seen = new Set()) {
  if (seen.has(absJsPath) || !existsSync(absJsPath)) return seen;
  seen.add(absJsPath);
  const js = readFileSync(absJsPath, 'utf8');
  const importRe = /^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
  let m;
  while ((m = importRe.exec(js))) {
    collectImports(path.resolve(path.dirname(absJsPath), m[1] || m[2]), seen);
  }
  return seen;
}

// Every local reference of one page, relative to the package root. A page
// the package lacks adds nothing here; it is reported missing on its own.
function collectFromHtml(root, relHtmlPath) {
  const absHtmlPath = path.join(root, relHtmlPath);
  if (!existsSync(absHtmlPath)) return [];
  const html = readFileSync(absHtmlPath, 'utf8');
  const refs = new Set();
  const attrRe = /\b(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = attrRe.exec(html))) {
    if (isLocal(m[1])) refs.add(path.relative(root, path.resolve(path.dirname(absHtmlPath), m[1])));
  }
  const moduleRe = /<script\b[^>]*\btype\s*=\s*"module"[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  while ((m = moduleRe.exec(html))) {
    if (!isLocal(m[1])) continue;
    for (const abs of collectImports(path.resolve(path.dirname(absHtmlPath), m[1]))) {
      refs.add(path.relative(root, abs));
    }
  }
  return [...refs];
}

// The problems with one package, as lines; empty when it passes.
export function checkPackage(zipPath, targetName = 'chrome') {
  const target = targetOf(targetName);
  const root = mkdtempSync(path.join(os.tmpdir(), 'sbw-check-'));
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', root]);
    const listing = new Set(
      execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
        .split('\n').map((l) => l.trim()).filter((l) => l && !l.endsWith('/')).map((l) => path.normalize(l))
    );
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const required = new Set([
      'manifest.json',
      ...HTML_ENTRY_POINTS.map((p) => path.normalize(p)),
      ...collectFromManifest(manifest),
      ...HTML_ENTRY_POINTS.flatMap((p) => collectFromHtml(root, p))
    ]);
    const problems = [...required].filter((r) => !listing.has(r)).sort()
      .map((r) => `missing from the package: ${r}`);

    // The store assigns the item's ID and reportedly rejects an upload whose
    // manifest carries "key" (scripts/build-zip.mjs's packageManifest drops it).
    if ('key' in manifest) problems.push('the packaged manifest.json carries "key"; a store package must not');
    // The target's overlay took: what it removes is gone.
    for (const [k, v] of Object.entries(target.manifest || {})) {
      if (v === null && k in manifest) problems.push(`the ${targetName} manifest still has "${k}"`);
    }
    for (const p of target.dropPermissions || []) {
      if ([...(manifest.permissions || []), ...(manifest.optional_permissions || [])].includes(p)) {
        problems.push(`the ${targetName} manifest still asks for "${p}"`);
      }
    }
    return { files: listing.size, checked: required.size, problems };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function report(label, { files, checked, problems }) {
  console.log(`check-zip-manifest: ${label}: ${files} files, ${checked} referenced paths checked`);
  problems.forEach((p) => console.error(`check-zip-manifest: FAIL (${label}) — ${p}`));
  return problems.length === 0;
}

function main(argv) {
  const ti = argv.indexOf('--target');
  const targetName = ti >= 0 ? argv[ti + 1] : 'chrome';
  const zipArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--target');

  if (zipArg) {
    const zip = path.resolve(REPO, zipArg);
    if (!existsSync(zip)) {
      console.error(`check-zip-manifest: ${path.relative(REPO, zip)} does not exist — run \`npm run zip\` first.`);
      return 1;
    }
    return report(`${path.relative(REPO, zip)} (${targetName})`, checkPackage(zip, targetName)) ? 0 : 1;
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), 'sbw-zips-'));
  try {
    let ok = true;
    for (const name of Object.keys(TARGETS)) {
      const zip = path.join(dir, `${name}.zip`);
      buildZip(zip, { target: name });
      ok = report(name, checkPackage(zip, name)) && ok;
    }
    if (ok) console.log('check-zip-manifest: OK — in every target, every referenced file is present, the manifest carries no "key", and the overlay took.');
    return ok ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main(process.argv.slice(2)));
}
