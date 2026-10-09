// Unit tests for the seobandwagon.com link builder (src/lib/site-links.js):
// every page the extension opens on our site carries the same three UTM tags,
// with the surface it was opened from as utm_campaign, so GA4 can attribute
// the visit; and the install handler opens the welcome page on a first
// install only, never on an update.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

await import('../../extension/src/lib/site-links.js');
const SBWSiteLinks = globalThis.SBWSiteLinks;

const params = (url) => Object.fromEntries(new URL(url).searchParams);

describe('SBWSiteLinks namespace', () => {
  it('attaches to globalThis.SBWSiteLinks', () => {
    expect(SBWSiteLinks).toBeTruthy();
    expect(typeof SBWSiteLinks.siteUrl).toBe('function');
  });
});

describe('siteUrl', () => {
  it('tags a dashboard path with source, medium and the surface as campaign', () => {
    const url = SBWSiteLinks.siteUrl('https://seobandwagon.com', '/dashboard/citations', 'citations_tab');
    expect(url).toBe('https://seobandwagon.com/dashboard/citations'
      + '?utm_source=chrome_extension&utm_medium=extension&utm_campaign=citations_tab');
  });

  it('keeps the origin it is given (staging, localhost)', () => {
    expect(SBWSiteLinks.siteUrl('http://localhost:3000', '/dashboard/api-keys', 'options'))
      .toMatch(/^http:\/\/localhost:3000\/dashboard\/api-keys\?utm_source=chrome_extension&/);
  });

  it('keeps a query the path already has', () => {
    expect(params(SBWSiteLinks.siteUrl('https://seobandwagon.com', '/captures?tab=all', 'options')))
      .toEqual({ tab: 'all', utm_source: 'chrome_extension', utm_medium: 'extension', utm_campaign: 'options' });
  });

  it('accepts every named surface and refuses an unknown one', () => {
    for (const surface of ['popup', 'options', 'citations_tab', 'side_panel', 'install', 'uninstall']) {
      expect(SBWSiteLinks.SURFACES).toContain(surface);
      expect(params(SBWSiteLinks.siteUrl('https://seobandwagon.com', '/', surface)).utm_campaign).toBe(surface);
    }
    expect(() => SBWSiteLinks.siteUrl('https://seobandwagon.com', '/', 'Popup')).toThrow();
    expect(() => SBWSiteLinks.siteUrl('https://seobandwagon.com', '/', undefined)).toThrow();
  });
});

describe('welcomeUrl / uninstallUrl', () => {
  it('points the welcome tab at the production welcome page, ref=install first', () => {
    expect(SBWSiteLinks.welcomeUrl()).toBe('https://seobandwagon.com/seo-chrome-extension/welcome'
      + '?ref=install&utm_source=chrome_extension&utm_medium=extension&utm_campaign=install');
  });

  it('points the uninstall survey at the production page with the version and nothing else', () => {
    const url = SBWSiteLinks.uninstallUrl('1.7.4');
    expect(url).toBe('https://seobandwagon.com/seo-chrome-extension/uninstalled'
      + '?ref=uninstall&v=1.7.4&utm_source=chrome_extension&utm_medium=extension&utm_campaign=uninstall');
    // setUninstallURL rejects a URL over 1023 characters.
    expect(url.length).toBeLessThanOrEqual(1023);
  });

  it('leaves the version out when there is none', () => {
    expect(params(SBWSiteLinks.uninstallUrl())).not.toHaveProperty('v');
  });
});

describe('installActions', () => {
  it('opens the welcome page on a first install', () => {
    expect(SBWSiteLinks.installActions('install', '1.7.4')).toEqual({
      welcomeUrl: SBWSiteLinks.welcomeUrl(),
      uninstallUrl: SBWSiteLinks.uninstallUrl('1.7.4'),
    });
  });

  it('never opens a tab on an update, a Chrome update or a shared-module update', () => {
    for (const reason of ['update', 'chrome_update', 'shared_module_update', undefined]) {
      const actions = SBWSiteLinks.installActions(reason, '1.7.4');
      expect(actions.welcomeUrl).toBeNull();
      // The survey URL is still set, so people who update from a version
      // without it get it too.
      expect(actions.uninstallUrl).toBe(SBWSiteLinks.uninstallUrl('1.7.4'));
    }
  });
});

// Every link to our site that ships in extension/src, HTML or script, is
// tagged: a static href carries the three tags, and a link opened from script
// goes through siteUrl() rather than gluing a path onto an origin.
describe('links to seobandwagon.com in the shipped pages', () => {
  const SRC = path.resolve(__dirname, '../../extension/src');
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(html|js)$/.test(name)) files.push(full);
    }
  })(SRC);

  it('found the pages to check', () => {
    expect(files.some(f => f.endsWith('popup.html'))).toBe(true);
    expect(files.some(f => f.endsWith('sidepanel.js'))).toBe(true);
  });

  it('tags every static href to seobandwagon.com', () => {
    const untagged = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/href="(https:\/\/seobandwagon\.com[^"]*)"/g)) {
        const url = m[1].replace(/&amp;/g, '&');
        const p = params(url);
        if (p.utm_source !== 'chrome_extension' || p.utm_medium !== 'extension'
          || !SBWSiteLinks.SURFACES.includes(p.utm_campaign)) {
          untagged.push(`${path.relative(SRC, file)}: ${m[1]}`);
        }
      }
    }
    expect(untagged).toEqual([]);
  });

  // tool-links.js builds third-party URLs from the analysed page's own
  // origin (its sitemap.xml, robots.txt), which is not our site, so this
  // looks only for our paths and for openDashboardPath's old `origin + path`.
  it('opens no dashboard path by gluing it onto an origin', () => {
    const glued = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(\$\{origin\}|origin\s*\+\s*['"`])\/(dashboard|captures|privacy)|origin\s*\+\s*path\b/g)) {
        glued.push(`${path.relative(SRC, file)}: ${m[0]}`);
      }
    }
    expect(glued).toEqual([]);
  });
});
