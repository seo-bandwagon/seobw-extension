// Scripts that run inside a web page (the manifest's content scripts and every
// file the extension injects with chrome.scripting.executeScript) never link
// to an extension page. Chrome blocks a navigation from a web origin to an
// extension resource unless the manifest lists it as web-accessible, and the
// user lands on "This page has been blocked by Chrome" (ERR_BLOCKED_BY_CLIENT).
// That is what the SERP overlay's "Connect your account" did until 1.8.2: its
// href was chrome.runtime.getURL('src/options/options.html').
//
// The manifest also makes nothing web-accessible: a web-accessible resource
// lets any site probe for the extension and fingerprint its users. An extension
// page is opened from a web page through the worker (chrome.runtime.
// openOptionsPage, chrome.tabs.create), and a link to our site goes to the site.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const EXT = path.resolve(__dirname, '../../extension');
const manifest = JSON.parse(readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Paths relative to extension/, as the manifest and executeScript name them.
function webPageScripts() {
  const files = new Set();
  for (const entry of manifest.content_scripts || []) {
    for (const js of entry.js || []) files.add(js);
  }
  for (const file of walk(path.join(EXT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:files\s*:|ANALYZER_FILES\s*=)\s*\[([^\]]*)\]/g)) {
      for (const p of m[1].matchAll(/['"]([^'"]+\.js)['"]/g)) files.add(p[1]);
    }
  }
  return [...files].sort();
}

describe('scripts that run in a web page', () => {
  const scripts = webPageScripts();

  it('found them', () => {
    expect(scripts).toContain('src/overlay/serp-overlay.js');
    expect(scripts).toContain('src/content/analyzer.js');
    expect(scripts).toContain('src/content/page-scroller.js');
    scripts.forEach((s) => expect(statSync(path.join(EXT, s)).isFile()).toBe(true));
  });

  it('never build a URL to an extension page', () => {
    const offenders = [];
    for (const s of scripts) {
      const text = readFileSync(path.join(EXT, s), 'utf8');
      for (const m of text.matchAll(/chrome\.runtime\.getURL\([^)]*\)|chrome-extension:\/\//g)) {
        offenders.push(`${s}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('manifest', () => {
  it('makes nothing web-accessible', () => {
    expect(manifest.web_accessible_resources).toBeUndefined();
  });
});
