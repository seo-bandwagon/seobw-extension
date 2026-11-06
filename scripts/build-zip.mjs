#!/usr/bin/env node
// SEO Bandwagon — builds a store package from extension/ (manifest.json,
// lib/, src/), with comments left out, for one store: Chrome (the default)
// or Microsoft Edge.
//
// The source is written to be read, and about 29% of its bytes are comments
// (1.8.0: 241 KB of 824 KB). Users download every byte, so the package drops
// them: JavaScript and CSS go through esbuild's parser with no minification
// (names, line structure and formatting stay readable for store reviewers;
// only comments go and quotes are normalized), and HTML comments are removed.
// Nothing else changes for Chrome: same files, same paths, same code, except
// that manifest.json loses its "key" line (packageManifest below).
//
// Targets (1.13.6): scripts/targets/<target>.mjs is the overlay. The Chrome
// one is empty. Any other target also gets, before comments go:
//   - manifest.json: the overlay's JSON merge patch, its dropped permissions;
//   - src/lib/browser.js: the target's browser values written over the block
//     between "BEGIN TARGET VALUES" and "END TARGET VALUES";
//   - every .html file: the text of each <span data-browser="key"> set to the
//     value of `key`, and utm_source=chrome_extension on static links made the
//     target's utm_source;
//   - the overlay's `leaveOut` paths left out.
//
// usage: node scripts/build-zip.mjs [--target chrome|edge] [out.zip]
//        (default out: seo-bw-extension.zip, or seo-bw-extension-<target>.zip)
//        KEEP_COMMENTS=1 node scripts/build-zip.mjs   (package the source as is)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';
import chrome from './targets/chrome.mjs';
import edge from './targets/edge.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'extension');
const ENTRIES = ['manifest.json', 'lib', 'src'];

export const TARGETS = Object.freeze({ chrome, edge });

export function targetOf(name = 'chrome') {
  const t = TARGETS[name];
  if (!t) throw new Error(`Unknown target "${name}": use ${Object.keys(TARGETS).join(' or ')}`);
  return t;
}

// The default package name for a target, as `npm run zip` writes it.
export function defaultZipName(name = 'chrome') {
  return name === 'chrome' ? 'seo-bw-extension.zip' : `seo-bw-extension-${name}.zip`;
}

export function stripComments(file, text) {
  if (file.endsWith('.js') || file.endsWith('.mjs')) {
    return transformSync(text, { loader: 'js', legalComments: 'none', charset: 'utf8' }).code;
  }
  if (file.endsWith('.css')) {
    return transformSync(text, { loader: 'css', legalComments: 'none', charset: 'utf8' }).code;
  }
  if (file.endsWith('.html')) {
    return text.replace(/<!--[\s\S]*?-->\n?/g, '');
  }
  return null; // copied as is
}

// JSON merge patch (RFC 7396): objects merge, null removes, anything else
// (arrays included) replaces.
export function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

// manifest.json's "key" is the store item's public key: it gives an unpacked
// copy the store ID, so seobandwagon.com/dashboard/api-keys (which messages
// that ID over externally_connectable) can find it, and its settings survive
// loading from another folder. The store assigns the ID itself and reportedly
// rejects an upload carrying "key", so the package drops that one line and,
// for Chrome, keeps every other byte. Throws rather than ship a manifest it
// could not clean (a "key" written as the last property, or not on a line of
// its own). Another target's manifest is the overlay applied to the rest,
// written back with two-space indents.
const KEY_LINE = /^[ \t]*"key": "[^"]*",\n/m;
export function packageManifest(text, target = chrome) {
  const out = text.replace(KEY_LINE, '');
  if ('key' in JSON.parse(out)) {
    throw new Error('manifest.json: "key" must sit on its own line, before the last property');
  }
  const drop = target.dropPermissions || [];
  if (!Object.keys(target.manifest || {}).length && !drop.length) return out;
  const m = mergePatch(JSON.parse(out), target.manifest || {});
  for (const field of ['permissions', 'optional_permissions']) {
    if (!Array.isArray(m[field])) continue;
    m[field] = m[field].filter((p) => !drop.includes(p));
    if (!m[field].length) delete m[field];
  }
  return JSON.stringify(m, null, 2) + '\n';
}

// src/lib/browser.js with the target's values. Throws if the block is gone,
// so a package can't ship with another browser's values.
const VALUES_BLOCK = /^([ \t]*)\/\/ BEGIN TARGET VALUES\n[\s\S]*?^[ \t]*\/\/ END TARGET VALUES\n/m;
export function browserSource(text, values) {
  if (!VALUES_BLOCK.test(text)) throw new Error('src/lib/browser.js: the TARGET VALUES block is missing');
  return text.replace(VALUES_BLOCK, (_, indent) => {
    const json = JSON.stringify(values, null, 2).split('\n').join('\n' + indent);
    return `${indent}// BEGIN TARGET VALUES\n${indent}const VALUES = ${json};\n${indent}// END TARGET VALUES\n`;
  });
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// An .html file with the target's words: each <span data-browser="key"> gets
// the value of `key` as its text, and static links to seobandwagon.com carry
// the target's utm_source. Throws on a key the values don't have.
export function pageSource(text, values) {
  return text
    .replace(/(<span data-browser="([A-Za-z]+)">)[^<]*(<\/span>)/g, (_, open, key, close) => {
      if (typeof values[key] !== 'string') throw new Error(`data-browser="${key}" has no text value`);
      return open + escapeHtml(values[key]) + close;
    })
    .replace(/utm_source=chrome_extension\b/g, `utm_source=${values.utmSource}`);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

// The packaged bytes of one source file for a target, or null to copy it as is.
function packaged(rel, text, target, keepComments) {
  if (rel === 'manifest.json') return packageManifest(text, target);
  let out = text;
  if (target !== chrome) {
    if (rel === path.join('src', 'lib', 'browser.js')) out = browserSource(out, target.browser);
    if (rel.endsWith('.html')) out = pageSource(out, target.browser);
  }
  if (keepComments) return out === text ? null : out;
  return stripComments(rel, out) ?? (out === text ? null : out);
}

export function buildZip(outZip, { keepComments = false, target = 'chrome' } = {}) {
  const t = typeof target === 'string' ? targetOf(target) : target;
  const leaveOut = (t.leaveOut || []).map((p) => path.normalize(p));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-zip-'));
  let before = 0;
  let after = 0;
  try {
    for (const entry of ENTRIES) {
      const from = path.join(SRC, entry);
      const files = fs.statSync(from).isDirectory() ? walk(from) : [from];
      for (const f of files) {
        if (path.basename(f) === '.DS_Store') continue;
        const rel = path.relative(SRC, f);
        if (leaveOut.some((p) => rel === p || rel.startsWith(p.endsWith(path.sep) ? p : p + path.sep))) continue;
        const to = path.join(stage, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        const buf = fs.readFileSync(f);
        before += buf.length;
        const text = /\.(js|mjs|css|html|json)$/.test(rel) ? buf.toString('utf8') : null;
        const out = text === null ? null : packaged(rel, text, t, keepComments);
        const bytes = out === null ? buf : Buffer.from(out, 'utf8');
        after += bytes.length;
        fs.writeFileSync(to, bytes);
      }
    }
    fs.rmSync(outZip, { force: true });
    execFileSync('zip', ['-r', '-q', '-X', outZip, ...ENTRIES], { cwd: stage, stdio: 'inherit' });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return { before, after, zipBytes: fs.statSync(outZip).size };
}

// --target edge, --target=edge; the first other argument is the zip's path.
export function parseArgs(argv) {
  let target = 'chrome';
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') target = argv[++i];
    else if (a.startsWith('--target=')) target = a.slice('--target='.length);
    else if (!out) out = a;
  }
  targetOf(target);
  return { target, out: out || defaultZipName(target) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { target, out: name } = parseArgs(process.argv.slice(2));
  const out = path.resolve(REPO, name);
  const r = buildZip(out, { keepComments: process.env.KEEP_COMMENTS === '1', target });
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`${path.relative(REPO, out)} (${target}): ${kb(r.zipBytes)} (files ${kb(r.before)} → ${kb(r.after)} unpacked)`);
}
