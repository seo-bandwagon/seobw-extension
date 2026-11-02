// The Google search hosts (1.11.0: thirty, twenty of them new). The
// overlay's content script, the popup and the new tab page each name them;
// all three lists must be the manifest's. The twenty new ones were measured
// with getPermissionWarningsByManifest first: the same four install
// warnings, since Chrome names www.google.<any> as www.google.com.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../extension');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const overlay = manifest.content_scripts.find((c) => c.js.includes('src/overlay/serp-overlay.js'));
const hosts = overlay.matches.map((m) => /^https:\/\/([^/]+)\/search\*$/.exec(m)[1]);

function listIn(file) {
  const src = readFileSync(resolve(root, file), 'utf8');
  const body = /const GOOGLE_SERP_HOSTS = new Set\(\[([\s\S]*?)\]\);/.exec(src)[1];
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('Google search hosts', () => {
  it('the overlay runs on thirty Google search hosts, each a www.google host', () => {
    expect(hosts).toHaveLength(30);
    hosts.forEach((h) => expect(h).toMatch(/^www\.google\.[a-z]{2,3}(\.[a-z]{2})?$/));
    expect(new Set(hosts).size).toBe(30);
  });

  it('the overlay loads the figures, settings and table modules before itself', () => {
    expect(overlay.js).toEqual(['src/lib/serp.js', 'src/lib/serp-figures.js', 'src/lib/serp-settings.js', 'src/lib/serp-table.js', 'src/overlay/serp-overlay.js']);
  });

  it.each(['src/popup/popup.js', 'src/lib/sbw-data.js'])('%s names the same hosts as the manifest', (file) => {
    expect(listIn(file).sort()).toEqual([...hosts].sort());
  });

  it('adds no host permission: the hosts are content-script matches only', () => {
    expect(manifest.host_permissions).toEqual(['https://seobandwagon.com/*']);
  });
});
