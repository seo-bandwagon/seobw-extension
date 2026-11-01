#!/usr/bin/env node
// SEO Bandwagon — release check: does the built zip actually contain every
// local file the shipped extension can reach?
//
// Scope (deliberately narrow — see task-8-brief.md section A): every local
// path referenced by manifest.json itself, plus every local <script src>/
// <link href> in the six HTML entry points (popup, options, history,
// sidepanel, panel, access), plus the relative `import ... from` graph of any ES
// module those pages load (panel.js imports theme-sync.js). This does NOT walk chrome.scripting.executeScript file lists
// inside service-worker.js/popup.js (e.g. lib/content-analysis.js,
// lib/dom-extraction.js, src/content/analyzer.js) — those are a separate,
// already-covered injection path, not something a browser loads from the
// manifest or an HTML shell.
//
// Usage: node scripts/check-zip-manifest.mjs [zipfile]
// Expects the zip to already exist (built by `npm run zip`). Exits non-zero
// and prints every missing path if the zip is short of anything referenced.
//
// Dual-purpose by design, not dual-export — this is a standalone Node CLI
// script, never loaded by the extension itself, so no globalThis/module
// export dance is needed here (contrast src/lib/*.js).

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The shippable extension lives in extension/; the zip is built from inside
// that folder, so entries are relative to it. The zip file itself lands at
// the repo root.
const ROOT = path.join(REPO, 'extension');
const ZIP = path.resolve(REPO, process.argv[2] || 'seo-bw-extension.zip');

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

// Resolve a reference found inside `fromFile` to a path relative to ROOT,
// matching how the zip (built with `zip -r ... manifest.json lib/ src/ ...`
// from inside extension/) stores entries.
function resolveRef(fromFile, ref) {
  const abs = path.resolve(path.dirname(fromFile), ref);
  return path.relative(ROOT, abs);
}

function collectFromManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
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

function collectFromHtml(relHtmlPath) {
  const absHtmlPath = path.join(ROOT, relHtmlPath);
  const html = readFileSync(absHtmlPath, 'utf8');
  const refs = new Set();
  const attrRe = /\b(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = attrRe.exec(html))) {
    const ref = m[1];
    if (isLocal(ref)) refs.add(resolveRef(absHtmlPath, ref));
  }
  const moduleRe = /<script\b[^>]*\btype\s*=\s*"module"[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  while ((m = moduleRe.exec(html))) {
    if (!isLocal(m[1])) continue;
    for (const abs of collectImports(path.resolve(path.dirname(absHtmlPath), m[1]))) {
      refs.add(path.relative(ROOT, abs));
    }
  }
  return [...refs];
}

function zipListing(zipPath) {
  // -Z1: name-only "zipinfo" listing, one entry per line — no fixed-width
  // column parsing to get wrong.
  const out = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => path.normalize(l)));
}

function main() {
  if (!existsSync(ZIP)) {
    console.error(`check-zip-manifest: ${path.relative(ROOT, ZIP)} does not exist — run \`npm run zip\` first.`);
    process.exit(1);
  }

  const manifestRefs = collectFromManifest(path.join(ROOT, 'manifest.json'));
  const htmlRefs = HTML_ENTRY_POINTS.flatMap(collectFromHtml);
  // manifest.json + the five HTML entry points must themselves be in the
  // zip, same as anything they reference.
  const required = new Set([
    'manifest.json',
    ...HTML_ENTRY_POINTS.map((p) => path.normalize(p)),
    ...manifestRefs,
    ...htmlRefs
  ]);

  const listing = zipListing(ZIP);
  const missing = [...required].filter((r) => !listing.has(r)).sort();

  console.log(`check-zip-manifest: ${listing.size} files in ${path.relative(ROOT, ZIP)}, ${required.size} referenced paths checked`);

  if (missing.length) {
    console.error(`check-zip-manifest: FAIL — ${missing.length} referenced file(s) missing from the zip:`);
    missing.forEach((m) => console.error(`  - ${m}`));
    process.exit(1);
  }

  // The store assigns the item's ID and reportedly rejects an upload whose
  // manifest carries "key" (scripts/build-zip.mjs's packageManifest drops it).
  const packaged = JSON.parse(execFileSync('unzip', ['-p', ZIP, 'manifest.json'], { encoding: 'utf8' }));
  if ('key' in packaged) {
    console.error('check-zip-manifest: FAIL — the packaged manifest.json carries "key"; the store package must not.');
    process.exit(1);
  }

  console.log('check-zip-manifest: OK — every referenced file is present, and the manifest carries no "key".');
}

main();
