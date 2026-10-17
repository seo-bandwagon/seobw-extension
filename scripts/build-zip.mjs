#!/usr/bin/env node
// SEO Bandwagon — builds the store package, seo-bw-extension.zip, from
// extension/ (manifest.json, lib/, src/), with comments left out.
//
// The source is written to be read, and about 29% of its bytes are comments
// (1.8.0: 241 KB of 824 KB). Users download every byte, so the package drops
// them: JavaScript and CSS go through esbuild's parser with no minification
// (names, line structure and formatting stay readable for store reviewers;
// only comments go and quotes are normalized), and HTML comments are removed.
// Nothing else changes: same files, same paths, same code, except that
// manifest.json loses its "key" line (packageManifest below).
//
// usage: node scripts/build-zip.mjs [out.zip]     (default: seo-bw-extension.zip)
//        KEEP_COMMENTS=1 node scripts/build-zip.mjs   (package the source as is)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'extension');
const ENTRIES = ['manifest.json', 'lib', 'src'];

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

// manifest.json's "key" is the store item's public key: it gives an unpacked
// copy the store ID, so seobandwagon.com/dashboard/api-keys (which messages
// that ID over externally_connectable) can find it, and its settings survive
// loading from another folder. The store assigns the ID itself and reportedly
// rejects an upload carrying "key", so the package drops that one line and
// keeps every other byte. Throws rather than ship a manifest it could not
// clean (a "key" written as the last property, or not on a line of its own).
const KEY_LINE = /^[ \t]*"key": "[^"]*",\n/m;
export function packageManifest(text) {
  const out = text.replace(KEY_LINE, '');
  if ('key' in JSON.parse(out)) {
    throw new Error('manifest.json: "key" must sit on its own line, before the last property');
  }
  return out;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

export function buildZip(outZip, { keepComments = false } = {}) {
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
        const to = path.join(stage, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        const buf = fs.readFileSync(f);
        before += buf.length;
        const stripped = rel === 'manifest.json'
          ? packageManifest(buf.toString('utf8'))
          : keepComments ? null : stripComments(rel, buf.toString('utf8'));
        const out = stripped === null ? buf : Buffer.from(stripped, 'utf8');
        after += out.length;
        fs.writeFileSync(to, out);
      }
    }
    fs.rmSync(outZip, { force: true });
    execFileSync('zip', ['-r', '-q', '-X', outZip, ...ENTRIES], { cwd: stage, stdio: 'inherit' });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return { before, after, zipBytes: fs.statSync(outZip).size };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = path.resolve(REPO, process.argv[2] || 'seo-bw-extension.zip');
  const r = buildZip(out, { keepComments: process.env.KEEP_COMMENTS === '1' });
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`${path.relative(REPO, out)}: ${kb(r.zipBytes)} (files ${kb(r.before)} → ${kb(r.after)} unpacked)`);
}
