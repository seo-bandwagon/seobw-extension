// src/lib/panels.js (1.13.10): the one way to open either panel, with
// sidePanel.open() called inside the click (no await before it).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

await import('../../extension/src/lib/panels.js');
const P = globalThis.SBWPanels;

function api() {
  const calls = [];
  return {
    calls,
    sidePanel: {
      setOptions: vi.fn((o) => { calls.push(['setOptions', o]); return Promise.resolve(); }),
      open: vi.fn((o) => { calls.push(['open', o]); return Promise.resolve(); })
    }
  };
}

describe('openPanel', () => {
  it('sets this tab\'s panel, then opens it, both before it returns', () => {
    const c = api();
    const done = P.openPanel('citations', 5, c);
    expect(c.calls).toEqual([
      ['setOptions', { tabId: 5, path: 'src/sidepanel/sidepanel.html', enabled: true }],
      ['open', { tabId: 5 }]
    ]);
    return expect(done).resolves.toBe(true);
  });

  it('opens the checks panel for anything else', async () => {
    const c = api();
    await P.openPanel('nope', 5, c);
    expect(c.calls[0][1].path).toBe('src/panel/panel.html');
  });

  it('is false when either call is refused, or throws, or there is no tab or side panel', async () => {
    const c = api();
    c.sidePanel.open = vi.fn(() => Promise.reject(new Error('may only be called in response to a user gesture')));
    expect(await P.openPanel('checks', 5, c)).toBe(false);
    c.sidePanel.open = vi.fn(() => { throw new Error('sync'); });
    expect(await P.openPanel('checks', 5, c)).toBe(false);
    expect(await P.openPanel('checks', undefined, api())).toBe(false);
    expect(await P.openPanel('checks', 5, {})).toBe(false);
  });
});

describe('the pages', () => {
  const read = (p) => fs.readFileSync(p, 'utf8');
  it('both panels load it before their own code', () => {
    for (const [page, own] of [['extension/src/panel/panel.html', 'panel.js'], ['extension/src/sidepanel/sidepanel.html', 'sidepanel.js']]) {
      const html = read(page);
      expect(html.indexOf('src="../lib/panels.js"'), page).toBeGreaterThan(-1);
      expect(html.indexOf('src="../lib/panels.js"'), page).toBeLessThan(html.indexOf(`src="${own}"`));
    }
  });

  it('nothing else calls sidePanel.open or setOptions (comments name them as "open()")', () => {
    const hits = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) return walk(p);
      if (p.endsWith('.js') && p !== 'extension/src/lib/panels.js' && /sidePanel\.(open|setOptions)\(\{/.test(read(p))) hits.push(p);
    });
    walk('extension');
    expect(hits).toEqual([]);
  });

  it("Citations' Page checks button opens it in the click, with the tab it already holds", () => {
    const sp = read('extension/src/sidepanel/sidepanel.js');
    const handler = /getElementById\('spPageChecks'\)\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/.exec(sp)[1];
    expect(handler).toContain("SBWPanels.openPanel('checks', spTabId)");
    expect(handler).not.toMatch(/\bawait\b|tabs\.query/);
  });
});
