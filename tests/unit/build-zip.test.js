// @vitest-environment node
// The store package (scripts/build-zip.mjs): the same files as extension/,
// with comments left out and the code otherwise intact.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildZip, stripComments } from '../../scripts/build-zip.mjs';

let dir, zip, info;
const read = (p) => execFileSync('unzip', ['-p', zip, p]).toString('utf8');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
  zip = path.join(dir, 'pkg.zip');
  info = buildZip(zip);
}, 60000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('store package', () => {
  it('holds exactly the files of manifest.json, lib/ and src/', () => {
    const entries = execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter((l) => l && !l.endsWith('/')).sort();
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const src = ['manifest.json', ...walk('extension/lib'), ...walk('extension/src')]
      .map((f) => path.relative('extension', path.resolve(f.startsWith('extension') ? f : path.join('extension', f))))
      .filter((f) => !f.endsWith('.DS_Store')).sort();
    expect(entries).toEqual(src);
  });

  it('is smaller than the source, with comments gone and code kept', () => {
    expect(info.after).toBeLessThan(info.before * 0.85);
    const sw = read('src/background/service-worker.js');
    expect(sw).not.toMatch(/^\s*\/\//m);
    expect(sw).toContain('fullpage-proof');          // a port name: code, not a comment
    expect(sw).toContain('serpCollect');
    expect(read('src/popup/popup.html')).not.toContain('<!--');
    expect(read('src/styles/fonts.css')).toMatch(/url\(fonts\/space-grotesk-400-700\.woff2\)/);
  });

  it('leaves the manifest, icons and fonts byte for byte', () => {
    for (const p of ['manifest.json', 'src/icons/icon128.png', 'src/styles/fonts/space-mono-700.woff2']) {
      expect(execFileSync('unzip', ['-p', zip, p]).equals(fs.readFileSync(path.join('extension', p)))).toBe(true);
    }
  });

  it('never touches strings or regular expressions that look like comments', () => {
    const out = stripComments('x.js', "const u = 'https://a.example/b'; // gone\nconst r = /\\/\\/x/; /* gone */\n");
    expect(out).toContain("https://a.example/b");
    expect(out).toContain('/\\/\\/x/');
    expect(out).not.toContain('gone');
  });
});
