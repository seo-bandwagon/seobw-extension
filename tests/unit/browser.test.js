// @vitest-environment node
// src/lib/browser.js (1.13.6): the source holds the Chrome values, the build
// writes another target's, and every page that reads them loads the file
// first.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import chrome from '../../scripts/targets/chrome.mjs';
import edge from '../../scripts/targets/edge.mjs';
import { packageManifest, browserSource } from '../../scripts/build-zip.mjs';

const B = globalThis.SBWBrowser; // tests/setup/browser.js loaded the source
const SRC = 'extension';
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const manifestText = read('manifest.json');

describe('the values', () => {
  it('in the source are the Chrome target\'s', () => {
    expect(B.VALUES).toEqual(chrome.browser);
    expect(B.target).toBe('chrome');
  });

  it('name the same things in every target', () => {
    expect(Object.keys(edge.browser).sort()).toEqual(Object.keys(chrome.browser).sort());
  });

  it('give each target the shortcut its manifest suggests', () => {
    for (const t of [chrome, edge]) {
      const m = JSON.parse(packageManifest(manifestText, t));
      expect(m.commands['analyze-current'].suggested_key, t.target).toEqual(t.browser.shortcut);
    }
  });

  it('ship the new tab only where the manifest overrides it', () => {
    for (const t of [chrome, edge]) {
      const m = JSON.parse(packageManifest(manifestText, t));
      expect(!!(m.chrome_url_overrides && m.chrome_url_overrides.newtab), t.target).toBe(t.browser.newTab);
      expect((m.permissions || []).includes('management'), t.target).toBe(t.browser.newTab);
      expect((m.optional_permissions || []).includes('topSites'), t.target).toBe(t.browser.newTab);
    }
  });

  it('keep Edge off the Chrome Web Store and its themes, and the review prompt off until a listing exists', () => {
    expect(edge.browser.reviewUrl).toBeNull();
    expect(edge.browser.storeUrl).toBeNull();
    expect(edge.browser.themeStoreUrl).toBeNull();
    expect(edge.browser.sitePages).toBe(false);
    expect(JSON.stringify(edge.browser)).not.toMatch(/Chrome|chrome_extension|chromewebstore|Brave|Incognito/);
  });
});

describe('isStorePage', () => {
  it('Chrome: the Web Store, new address and old', () => {
    expect(B.isStorePage('https://chromewebstore.google.com/detail/x/abc')).toBe(true);
    expect(B.isStorePage('https://chrome.google.com/webstore/detail/x')).toBe(true);
    expect(B.isStorePage('https://chrome.google.com/webstore')).toBe(true);
    expect(B.isStorePage('https://chrome.google.com/webstores')).toBe(false);
    expect(B.isStorePage('https://chrome.google.com/')).toBe(false);
    expect(B.isStorePage('https://microsoftedge.microsoft.com/addons/detail/x')).toBe(false);
    expect(B.isStorePage('not a url')).toBe(false);
  });

  it('Edge: Microsoft Edge Add-ons, not the Chrome Web Store', () => {
    const E = B.withValues(edge.browser);
    expect(E.isStorePage('https://microsoftedge.microsoft.com/addons/detail/x/abc')).toBe(true);
    expect(E.isStorePage('https://chromewebstore.google.com/detail/x/abc')).toBe(false);
    expect(E.name).toBe('Microsoft Edge');
  });
});

describe('the build', () => {
  it('writes another target\'s values over the block, and evaluates to them', () => {
    const out = browserSource(read('src/lib/browser.js'), edge.browser);
    const sandbox = { module: { exports: {} } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(out, sandbox);
    expect(JSON.parse(JSON.stringify(sandbox.module.exports.VALUES))).toEqual(edge.browser);
    expect(out).not.toMatch(/"Chrome"|chromewebstore/);
  });

  it('refuses a browser.js without the block', () => {
    expect(() => browserSource('const VALUES = {};', edge.browser)).toThrow(/TARGET VALUES/);
  });
});

// A page or the worker that reads SBWBrowser must load browser.js before it.
describe('every reader loads browser.js first', () => {
  const pages = ['src/popup/popup.html', 'src/options/options.html', 'src/panel/panel.html',
    'src/sidepanel/sidepanel.html', 'src/access/access.html', 'src/newtab/newtab.html',
    'src/history/history.html', 'src/offscreen/offscreen.html'];

  // The local scripts a page loads, in order, and the modules they import.
  function scriptsOf(page) {
    const html = read(page);
    const dir = path.dirname(page);
    const out = [];
    const add = (rel) => {
      const p = path.normalize(path.join(dir, rel));
      if (out.includes(p)) return;
      out.push(p);
      if (!p.endsWith('.js')) return;
      for (const m of read(p).matchAll(/^\s*import\b[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
        const sub = path.normalize(path.join(path.dirname(p), m[1]));
        if (!out.includes(sub)) { out.push(sub); }
      }
    };
    for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) add(m[1]);
    return out;
  }

  for (const page of pages) {
    it(page, () => {
      const scripts = scriptsOf(page);
      const readers = scripts.filter((s) => s !== path.normalize('src/lib/browser.js') && /\bSBWBrowser\b/.test(read(s)));
      if (!readers.length) return;
      const at = scripts.indexOf(path.normalize('src/lib/browser.js'));
      expect(at, `${page} reads SBWBrowser in ${readers.join(', ')} without loading browser.js`).toBeGreaterThanOrEqual(0);
      for (const r of readers) expect(scripts.indexOf(r), `${r} before browser.js`).toBeGreaterThan(at);
    });
  }

  it('the worker imports it first', () => {
    const sw = read('src/background/service-worker.js');
    expect(sw).toMatch(/^importScripts\('\.\.\/lib\/browser\.js', /m);
  });

  // Content scripts don't load it (that would change the Chrome manifest's
  // lists); what they show reads the worker's answer or has a fallback.
  it('no content script reads it without a fallback', () => {
    const m = JSON.parse(manifestText);
    const files = [...new Set(m.content_scripts.flatMap((c) => c.js))];
    expect(files).not.toContain('src/lib/browser.js');
    for (const f of files) {
      const text = read(f);
      for (const hit of text.matchAll(/^.*\bSBWBrowser\b.*$/gm)) {
        expect(hit[0], f).toMatch(/globalThis\.SBWBrowser(?!\.)/);
      }
    }
  });

  it('the source pages hold the Chrome words where the build writes another browser\'s', () => {
    for (const page of pages.concat(['src/options/options.html'])) {
      for (const m of read(page).matchAll(/<span data-browser="([A-Za-z]+)">([^<]*)<\/span>/g)) {
        expect(m[2].replace(/&amp;/g, '&'), `${page} ${m[1]}`).toBe(chrome.browser[m[1]]);
      }
    }
  });
});
