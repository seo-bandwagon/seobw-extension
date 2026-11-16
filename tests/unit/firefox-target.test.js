// @vitest-environment node
// The Firefox package (1.13.10): `npm run zip -- --target firefox`. Built
// here from extension/ and read back from the zip, as addons.mozilla.org
// (AMO) would get it. `web-ext lint` runs on the same package in CI
// (`npm run lint:firefox`); these check what the overlay is meant to do.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { buildZip, mergePatch } from '../../scripts/build-zip.mjs';
import { checkPackage } from '../../scripts/check-zip-manifest.mjs';
import firefox, { workerScripts } from '../../scripts/targets/firefox.mjs';
import GOOGLE_DOMAINS from '../../scripts/targets/google-domains.mjs';

const require = createRequire(import.meta.url);
const Consent = require('../../extension/src/lib/consent.js');

let dir, ffZip, chromeZip, m, c;
const entries = (zip) => execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter((l) => l && !l.endsWith('/'));
const readBuf = (zip, p) => execFileSync('unzip', ['-p', zip, p], { maxBuffer: 64 * 1024 * 1024 });
const read = (zip, p) => readBuf(zip, p).toString('utf8');
const source = (p) => fs.readFileSync(path.join('extension', p));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firefox-test-'));
  ffZip = path.join(dir, 'firefox.zip');
  chromeZip = path.join(dir, 'chrome.zip');
  const r = buildZip(ffZip, { target: 'firefox' });
  expect(r.keepComments).toBe(true);
  buildZip(chromeZip, { target: 'chrome' });
  m = JSON.parse(read(ffZip, 'manifest.json'));
  c = JSON.parse(read(chromeZip, 'manifest.json'));
}, 120000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the Firefox manifest', () => {
  it('runs the worker as a background page: every file it imports, in order, then the worker', () => {
    const worker = source('src/background/service-worker.js').toString('utf8');
    expect(m.background).toEqual({ scripts: workerScripts(worker) });
    expect(m.background.scripts[0]).toBe('src/lib/browser.js');
    expect(m.background.scripts.at(-1)).toBe('src/background/service-worker.js');
    // the analyzer the background page reads Analyze's pages with (1.12.0)
    expect(m.background.scripts).toContain('lib/content-analysis.js');
    expect(m.background.scripts).toContain('src/lib/page-row.js');
    const files = new Set(entries(ffZip));
    m.background.scripts.forEach((f) => expect(files.has(f), f).toBe(true));
  });

  it('names its own add-on ID, Firefox 140, and no data collected without a yes', () => {
    expect(m.browser_specific_settings.gecko.id).toMatch(/^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/);
    expect(m.browser_specific_settings.gecko.strict_min_version).toBe('140.0');
    expect(m.browser_specific_settings.gecko).not.toHaveProperty('gecko_android');
    expect(m.browser_specific_settings.gecko.data_collection_permissions.required).toEqual(['none']);
  });

  it("asks as optional data exactly the categories src/lib/consent.js's flows ask Firefox for", () => {
    const optional = m.browser_specific_settings.gecko.data_collection_permissions.optional;
    expect(optional).toEqual([...Consent.FIREFOX_CATEGORIES]);
    const used = new Set(Object.values(Consent.FLOWS).flatMap((f) => f.firefox));
    expect([...used].sort()).toEqual([...optional].sort());
  });

  it('grants every Google search domain at install, while the overlay still runs on its thirty', () => {
    expect(GOOGLE_DOMAINS).toHaveLength(187);
    expect(new Set(GOOGLE_DOMAINS).size).toBe(187);
    GOOGLE_DOMAINS.forEach((h) => expect(h).toMatch(/^www\.google\.[a-z]{2,3}(\.[a-z]{2})?$/));
    expect(m.host_permissions).toEqual([...c.host_permissions, ...GOOGLE_DOMAINS.map((h) => `https://${h}/*`)]);
    const overlay = m.content_scripts.find((cs) => cs.js.includes('src/overlay/serp-overlay.js'));
    expect(overlay.matches).toHaveLength(30);
    for (const match of overlay.matches) {
      expect(GOOGLE_DOMAINS, match).toContain(new URL(match.replace('*', '')).hostname);
    }
    expect(m.content_scripts).toEqual(c.content_scripts);
  });

  it('suggests Alt+Shift+S, since Ctrl+Shift+S is Firefox\'s Screenshot', () => {
    expect(m.commands['analyze-current'].suggested_key).toEqual({ default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' });
    expect(firefox.browser.shortcut).toEqual(m.commands['analyze-current'].suggested_key);
  });

  it('is the Chrome one less the new tab, Chrome-only permissions and the worker key, and nothing else', () => {
    expect(m).not.toHaveProperty('key');
    expect(m).not.toHaveProperty('chrome_url_overrides');
    expect(m).not.toHaveProperty('optional_permissions');
    expect(m.permissions).toEqual(c.permissions.filter((p) => !['management', 'sidePanel', 'offscreen'].includes(p)));
    const back = mergePatch(m, {});
    back.chrome_url_overrides = c.chrome_url_overrides;
    back.permissions = c.permissions;
    back.optional_permissions = c.optional_permissions;
    back.commands = c.commands;
    back.background = c.background;
    back.host_permissions = c.host_permissions;
    delete back.browser_specific_settings;
    expect(back).toEqual(c);
  });

  it('passes the package check, and the Chrome package fails it as Firefox', () => {
    expect(checkPackage(ffZip, 'firefox').problems).toEqual([]);
    const wrong = checkPackage(chromeZip, 'firefox').problems;
    expect(wrong).toContain('the firefox manifest still has "chrome_url_overrides"');
    expect(wrong).toContain('the firefox manifest still asks for "sidePanel"');
    expect(wrong).toContain('the firefox manifest lacks the host "https://www.google.ad/*"');
  });
});

describe('the Firefox files', () => {
  it('keep every comment: each file is the source byte for byte, but for the manifest, browser.js and the pages', () => {
    const changed = [];
    for (const p of entries(ffZip)) {
      if (p === 'manifest.json' || p === 'src/lib/browser.js' || p.endsWith('.html')) continue;
      if (!readBuf(ffZip, p).equals(source(p))) changed.push(p);
    }
    expect(changed).toEqual([]);
    expect(read(ffZip, 'src/background/service-worker.js')).toContain('// Chrome and Edge run this file as a service worker');
  });

  it('leave out the new tab page, and are otherwise the Chrome package\'s files', () => {
    expect(entries(ffZip).some((e) => e.startsWith('src/newtab/'))).toBe(false);
    const chromeFiles = entries(chromeZip).filter((e) => !e.startsWith('src/newtab/')).sort();
    expect(entries(ffZip).sort()).toEqual(chromeFiles);
  });

  it('carry browser.js with the Firefox values', () => {
    const sandbox = { module: { exports: {} } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read(ffZip, 'src/lib/browser.js'), sandbox);
    expect(JSON.parse(JSON.stringify(sandbox.module.exports.VALUES))).toEqual(firefox.browser);
  });

  it('say Firefox where Chrome said Chrome, and its own words for private windows', () => {
    const options = read(ffZip, 'src/options/options.html');
    expect(options).toContain('<span data-browser="name">Firefox</span> must allow SEO Bandwagon in private windows: Allow in <span data-browser="privateWindow">Private Windows</span>');
    expect(options).toContain('<em><span data-browser="connectButton">Connect extension</span></em>');
    expect(read(ffZip, 'src/access/access.html')).toContain('No tab opens. <span data-browser="name">Firefox</span> lets the extension read pages');
  });

  it('tag static links to seobandwagon.com firefox_extension', () => {
    for (const p of entries(ffZip).filter((e) => e.endsWith('.html'))) {
      for (const hit of read(ffZip, p).matchAll(/href="(https:\/\/seobandwagon\.com[^"]*)"/g)) {
        expect(new URL(hit[1].replace(/&amp;/g, '&')).searchParams.get('utm_source'), `${p} ${hit[1]}`).toBe('firefox_extension');
      }
    }
  });
});

describe('workerScripts', () => {
  it('reads every importScripts call, as extension paths, once each, in order', () => {
    const src = "if (typeof importScripts === 'function') importScripts('../lib/a.js', '../../lib/b.js');\n" +
      "if (x) {\n  importScripts('../lib/c.js', '../lib/a.js');\n}\n";
    expect(workerScripts(src, 'src/background/w.js')).toEqual(['src/lib/a.js', 'lib/b.js', 'src/lib/c.js', 'src/background/w.js']);
  });

  it('refuses a worker with nothing to read', () => {
    expect(() => workerScripts('// no calls', 'src/background/w.js')).toThrow(/no importScripts/);
  });
});
