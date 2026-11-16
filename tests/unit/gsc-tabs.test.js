// 1.13.8 (#158): Search Console tabs already open at an install or update
// get the runner from the worker (src/lib/gsc-tabs.js), and the manifest's
// content script matches the overview, where Search Console opens.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

await import('../../extension/src/lib/gsc-tabs.js');
const T = globalThis.SBWGscTabs;
const manifest = JSON.parse(fs.readFileSync(path.resolve('extension/manifest.json'), 'utf8'));
const entry = manifest.content_scripts.find((cs) => cs.js.includes('src/content/gsc-serp.js'));

// Chrome's match-pattern rule for a path: `*` is any run of characters, and
// the path is matched with the query string.
function matches(pattern, url) {
  const m = /^(https):\/\/([^/]+)(\/.*)$/.exec(pattern);
  const u = new URL(url);
  if (u.protocol !== m[1] + ':' || u.host !== m[2]) return false;
  const re = new RegExp('^' + m[3].split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(u.pathname + u.search);
}

describe('the Search Console content script', () => {
  it("is the worker's list: the same matches and files, in order", () => {
    expect(entry.matches).toEqual(T.MATCHES);
    expect(entry.js).toEqual(T.FILES);
  });

  it('runs on the overview, a report, and a second account, and nowhere else on the host', () => {
    const on = (url) => T.MATCHES.some((p) => matches(p, url));
    expect(on('https://search.google.com/search-console?resource_id=sc-domain%3Aexample.com')).toBe(true);
    expect(on('https://search.google.com/search-console')).toBe(true);
    expect(on('https://search.google.com/search-console/performance/search-analytics?resource_id=x')).toBe(true);
    expect(on('https://search.google.com/u/1/search-console?resource_id=x')).toBe(true);
    expect(on('https://search.google.com/u/2/search-console/performance/search-analytics?resource_id=x')).toBe(true);
    expect(on('https://search.google.com/test/rich-results')).toBe(false);
    expect(on('https://www.google.com/search-console')).toBe(false);
    // 1.13.7's pattern missed the overview: the cause of #158.
    expect(matches('https://search.google.com/search-console/*', 'https://search.google.com/search-console?resource_id=x')).toBe(false);
  });

  it('the worker may script the host (host_permissions), so open tabs can be injected', () => {
    expect(manifest.host_permissions).toContain('https://search.google.com/*');
  });
});

describe('injectOpenTabs', () => {
  it('injects the files into every open Search Console tab, skipping discarded tabs and refusals', async () => {
    const executeScript = vi.fn(async ({ target }) => {
      if (target.tabId === 3) throw new Error('Frame with ID 0 is showing error page');
      return [];
    });
    const query = vi.fn(async () => [{ id: 1 }, { id: 2, discarded: true }, { id: 3 }, { id: 4 }]);
    const n = await T.injectOpenTabs({ tabs: { query }, scripting: { executeScript } });
    expect(query).toHaveBeenCalledWith({ url: T.MATCHES });
    expect(executeScript.mock.calls.map(([a]) => a)).toEqual([
      { target: { tabId: 1 }, files: T.FILES },
      { target: { tabId: 3 }, files: T.FILES },
      { target: { tabId: 4 }, files: T.FILES }
    ]);
    expect(n).toBe(2);
  });

  it('does nothing without the APIs, or when the query fails', async () => {
    expect(await T.injectOpenTabs({})).toBe(0);
    expect(await T.injectOpenTabs({ tabs: { query: async () => { throw new Error('x'); } }, scripting: {} })).toBe(0);
  });
});

describe('the worker', () => {
  const sw = fs.readFileSync(path.resolve('extension/src/background/service-worker.js'), 'utf8');
  it('loads gsc-tabs.js and injects on install and update', () => {
    expect(sw).toMatch(/importScripts\([^)]*'\.\.\/lib\/gsc-tabs\.js'/);
    expect(sw).toMatch(/onInstalled\.addListener\(\(details\) => \{\s*if \(details && details\.reason === 'chrome_update'\) return;\s*SBWGscTabs\.injectOpenTabs\(chrome\)/);
  });
  it("follows in-page navigation on a second account's /u/N/ addresses too", () => {
    expect(sw).toContain("{ hostEquals: 'search.google.com', pathContains: '/search-console' }");
  });
});
