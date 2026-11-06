// @vitest-environment node
// The Microsoft Edge Add-ons package (1.13.6): `npm run zip -- --target edge`.
// Built here from extension/ and read back from the zip, as the store gets it.
//
// Microsoft Edge Add-ons developer policy 1.1.2: the extension "must not
// reference other browsers". The scan below reads every text file in the
// package, comments esbuild keeps included, so no Chrome, Chrome Web Store or
// Incognito reaches a user, a reviewer or a "view source".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { buildZip, parseArgs, defaultZipName, mergePatch } from '../../scripts/build-zip.mjs';
import { checkPackage } from '../../scripts/check-zip-manifest.mjs';
import edge from '../../scripts/targets/edge.mjs';

let dir, edgeZip, chromeZip;
const entries = (zip) => execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter((l) => l && !l.endsWith('/'));
const read = (zip, p) => execFileSync('unzip', ['-p', zip, p]).toString('utf8');
const TEXT = /\.(js|mjs|css|html|json|txt|md|svg)$/;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'targets-test-'));
  edgeZip = path.join(dir, 'edge.zip');
  chromeZip = path.join(dir, 'chrome.zip');
  buildZip(edgeZip, { target: 'edge' });
  buildZip(chromeZip, { target: 'chrome' });
}, 120000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the Edge package names no other browser', () => {
  // "Chrome/125.0.0.0" stays: it is part of the crawlers' own user agents
  // (Googlebot's, Bingbot's) that View as sends, not a word to the user.
  const OTHER_BROWSER = /\bChrome\b(?!\/\d)|Chrome Web Store|chromewebstore|chrome\.google\.com\/webstore|\bIncognito\b|\bBrave\b|chrome_extension/;

  it('in any text file', () => {
    const hits = [];
    for (const p of entries(edgeZip).filter((e) => TEXT.test(e))) {
      read(edgeZip, p).split('\n').forEach((line, i) => {
        const m = line.match(OTHER_BROWSER);
        if (m) hits.push(`${p}:${i + 1}: …${line.slice(Math.max(0, m.index - 40), m.index + 40)}…`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('while the Chrome package keeps its words (the scan would see them)', () => {
    expect(read(chromeZip, 'src/options/options.html')).toMatch(/Rate it on the <span data-browser="storeName">Chrome Web Store<\/span>/);
    expect(read(chromeZip, 'src/lib/browser.js')).toMatch(/Chrome Web Store/);
  });

  it('says Microsoft Edge where Chrome said Chrome', () => {
    const options = read(edgeZip, 'src/options/options.html');
    expect(options).toContain('<span data-browser="name">Microsoft Edge</span> must allow SEO Bandwagon in private windows: Allow in <span data-browser="privateWindow">InPrivate</span>');
    expect(options).toContain('<em><span data-browser="connectButton">Connect extension</span></em>');
    expect(read(edgeZip, 'src/access/access.html')).toContain('No tab opens. <span data-browser="name">Microsoft Edge</span> lets the extension read pages');
  });

  it('tags static links to seobandwagon.com edge_extension', () => {
    for (const p of entries(edgeZip).filter((e) => e.endsWith('.html'))) {
      for (const m of read(edgeZip, p).matchAll(/href="(https:\/\/seobandwagon\.com[^"]*)"/g)) {
        expect(new URL(m[1].replace(/&amp;/g, '&')).searchParams.get('utm_source'), `${p} ${m[1]}`).toBe('edge_extension');
      }
    }
  });

  it('carries browser.js with the Edge values', () => {
    const sandbox = { module: { exports: {} } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read(edgeZip, 'src/lib/browser.js'), sandbox);
    expect(JSON.parse(JSON.stringify(sandbox.module.exports.VALUES))).toEqual(edge.browser);
  });
});

describe('the Edge manifest', () => {
  let m, c;
  beforeAll(() => {
    m = JSON.parse(read(edgeZip, 'manifest.json'));
    c = JSON.parse(read(chromeZip, 'manifest.json'));
  });

  it('is the Chrome one less the new tab, its permissions and Ctrl+Shift+S, and nothing else', () => {
    expect(m).not.toHaveProperty('key');
    expect(m).not.toHaveProperty('chrome_url_overrides');
    expect(m.permissions).not.toContain('management');
    // topSites and search were optional, for the new tab's extras only.
    expect(m).not.toHaveProperty('optional_permissions');
    expect(m.commands['analyze-current'].suggested_key).toEqual({ default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' });
    const back = mergePatch(m, {});
    back.chrome_url_overrides = c.chrome_url_overrides;
    back.permissions = c.permissions;
    back.optional_permissions = c.optional_permissions;
    back.commands = c.commands;
    expect(back).toEqual(c);
    expect(c.optional_permissions).toEqual(['topSites', 'search']);
    expect(m.permissions).toEqual(c.permissions.filter((p) => p !== 'management'));
  });

  it('keeps externally_connectable and the Connect bridge', () => {
    expect(m.externally_connectable).toEqual({ matches: ['https://seobandwagon.com/*'] });
    expect(m.content_scripts).toContainEqual({
      matches: ['https://seobandwagon.com/dashboard/api-keys*', 'https://seobandwagon.com/seo-chrome-extension/welcome*'],
      js: ['src/content/site-bridge.js'],
      run_at: 'document_start',
      all_frames: false
    });
  });

  it('passes the package check, and the Chrome one does too', () => {
    expect(checkPackage(edgeZip, 'edge').problems).toEqual([]);
    expect(checkPackage(chromeZip, 'chrome').problems).toEqual([]);
  });

  it('fails the package check as the Edge target when it is the Chrome package', () => {
    expect(checkPackage(chromeZip, 'edge').problems).toEqual([
      'the edge manifest still has "chrome_url_overrides"',
      'the edge manifest still asks for "management"',
      'the edge manifest still asks for "topSites"',
      'the edge manifest still asks for "search"'
    ]);
  });
});

describe('the Edge files', () => {
  it('leave out the new tab page, which no Edge manifest entry reaches', () => {
    expect(entries(edgeZip).some((e) => e.startsWith('src/newtab/'))).toBe(false);
    expect(entries(chromeZip).some((e) => e.startsWith('src/newtab/'))).toBe(true);
  });

  it('are otherwise the Chrome package\'s files', () => {
    const chromeFiles = entries(chromeZip).filter((e) => !e.startsWith('src/newtab/')).sort();
    expect(entries(edgeZip).sort()).toEqual(chromeFiles);
  });
});

describe('npm run zip -- --target', () => {
  it('defaults to chrome and seo-bw-extension.zip, so Release and check:zip keep working', () => {
    expect(parseArgs([])).toEqual({ target: 'chrome', out: 'seo-bw-extension.zip' });
    expect(parseArgs(['--target', 'edge'])).toEqual({ target: 'edge', out: 'seo-bw-extension-edge.zip' });
    expect(parseArgs(['--target=edge', 'x.zip'])).toEqual({ target: 'edge', out: 'x.zip' });
    expect(parseArgs(['out.zip'])).toEqual({ target: 'chrome', out: 'out.zip' });
    expect(defaultZipName('edge')).toBe('seo-bw-extension-edge.zip');
    expect(() => parseArgs(['--target', 'firefox'])).toThrow(/Unknown target/);
  });

  it('merges an overlay as a JSON merge patch', () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 }, e: [1] }, { a: null, b: { c: null, x: 1 }, e: [2] }))
      .toEqual({ b: { d: 3, x: 1 }, e: [2] });
  });
});

describe('release.yml', () => {
  const yml = fs.readFileSync('.github/workflows/release.yml', 'utf8');
  it('attaches the Chrome zip under the name store-submit.yml downloads, and the Edge zip beside it', () => {
    expect(yml).toContain('seo-bw-extension-$VERSION.zip');
    expect(yml).toContain('seo-bw-extension-edge-$VERSION.zip');
    expect(fs.readFileSync('.github/workflows/store-submit.yml', 'utf8')).toContain('--pattern "seo-bw-extension-$VERSION.zip"');
  });
});
