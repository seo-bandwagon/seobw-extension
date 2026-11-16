// Search Console's row icons on the Queries tab, in a real browser with the
// extension loaded (1.13.8, #158: "we also have to refresh the query page to
// get our icons to show up").
//
// Search Console is a single-page app: it is opened at one address and moves
// to the Performance report with history.pushState, and Chromium injects a
// manifest content script only when a document loads at an address its
// matches cover. So the icons depend on the page Search Console was opened
// on. This spec opens it the ways people do:
//
//   1. at the overview, /search-console?resource_id=… (where the extension's
//      own Search Console links land), then Performance in the page;
//   2. at a signed-in second account's overview, /u/1/search-console?…;
//   3. on a direct Performance link;
//   4. after switching property in the page;
//   5. with Search Console already open at an install or an update (the
//      second test).
//
// Nothing reaches Google: Chromium's resolver is pointed nowhere, and the
// route below serves a stand-in for Search Console at its real addresses
// (the same markup the unit tests use: tabs, then the report table) and
// aborts everything else. Install warnings are measured with
// getPermissionWarningsByManifest: the host stays search.google.com.

import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXTENSION = path.resolve('extension');

// The stand-in Search Console. It renders from location, and moves between
// views with history.pushState, as the real one does.
const APP = `
  const prefix = () => (/^\\/u\\/\\d+\\//.exec(location.pathname) || ['/'])[0];
  const rid = () => new URLSearchParams(location.search).get('resource_id') || 'sc-domain:example.com';
  function go(p) { history.pushState({}, '', p); render(); }
  function render() {
    const app = document.getElementById('app');
    const perf = /\\/performance\\/search-analytics/.test(location.pathname);
    const pages = new URLSearchParams(location.search).get('tab') === 'pages';
    app.innerHTML = '';
    const nav = document.createElement('nav');
    nav.innerHTML = '<a id="nav-overview" href="#">Overview</a> <a id="nav-performance" href="#">Performance</a>' +
      ' <a id="nav-property" href="#">Switch to example.org</a>';
    app.appendChild(nav);
    nav.querySelector('#nav-overview').onclick = (e) => { e.preventDefault(); go(prefix() + 'search-console?resource_id=' + encodeURIComponent(rid())); };
    nav.querySelector('#nav-performance').onclick = (e) => { e.preventDefault(); go(prefix() + 'search-console/performance/search-analytics?resource_id=' + encodeURIComponent(rid())); };
    nav.querySelector('#nav-property').onclick = (e) => { e.preventDefault(); go(prefix() + 'search-console?resource_id=' + encodeURIComponent('sc-domain:example.org')); };
    if (!perf) {
      const h = document.createElement('h1');
      h.textContent = 'Overview';
      app.appendChild(h);
      return;
    }
    const tabs = document.createElement('div');
    tabs.innerHTML = '<div role="tab" id="tab-queries" aria-selected="' + !pages + '">Queries</div>' +
      '<div role="tab" id="tab-pages" aria-selected="' + pages + '">Pages</div>';
    app.appendChild(tabs);
    const base = location.pathname + '?resource_id=' + encodeURIComponent(rid());
    tabs.querySelector('#tab-queries').onclick = () => go(base);
    tabs.querySelector('#tab-pages').onclick = () => go(base + '&tab=pages');
    const table = document.createElement('table');
    table.innerHTML = pages
      ? '<thead><tr><th>Top pages</th><th>Clicks</th></tr></thead><tbody><tr><td>https://example.com/a/</td><td>120</td></tr></tbody>'
      : '<thead><tr><th>Top queries</th><th>Clicks</th></tr></thead><tbody><tr><td>roofing repair denver</td><td>1,230</td></tr><tr><td>plumber tacoma</td><td>500</td></tr></tbody>';
    app.appendChild(table);
  }
  window.addEventListener('popstate', render);
  render();
`;
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Search Console</title></head>
<body><div id="app"></div><script>${APP}</script></body></html>`;

async function launch(extensionDir) {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND'
    ]
  });
  const searches = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    if (url.origin === 'https://search.google.com' && /^\/(u\/\d+\/)?search-console(\/|$)/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    }
    if (url.origin === 'https://www.google.com' && url.pathname === '/search') {
      searches.push(url.searchParams.get('q'));
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Google</title>' });
    }
    return route.abort();
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return { context, sw, searches };
}

const icons = (page) => page.locator('tbody tr td .seo-bw-gsc-actions');

test('Search Console: the Queries tab gets its icons without a reload, wherever Search Console was opened', async () => {
  test.setTimeout(120_000);
  // A copy, so the update step can reload it without touching the repo.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-gsc-e2e-'));
  const copy = path.join(dir, 'extension');
  fs.cpSync(EXTENSION, copy, { recursive: true });
  const { context, sw, searches } = await launch(copy);
  try {
    await test.step('opened at the overview, then Performance in the page', async () => {
      const page = await context.newPage();
      await page.goto('https://search.google.com/search-console?resource_id=sc-domain%3Aexample.com');
      await expect(page.locator('h1')).toHaveText('Overview');
      await page.click('#nav-performance');
      await expect(page).toHaveURL(/\/search-console\/performance\/search-analytics\?/);
      await expect(icons(page)).toHaveCount(2);
      // And only on Queries: Pages takes them away, Queries brings them back.
      await page.click('#tab-pages');
      await expect(page.locator('.seo-bw-gsc-actions')).toHaveCount(0);
      await page.click('#tab-queries');
      await expect(icons(page)).toHaveCount(2);
      await page.close();
    });

    await test.step("opened at a second account's overview (/u/1/), then Performance", async () => {
      const page = await context.newPage();
      await page.goto('https://search.google.com/u/1/search-console?resource_id=sc-domain%3Aexample.com');
      await page.click('#nav-performance');
      await expect(page).toHaveURL(/\/u\/1\/search-console\/performance\//);
      await expect(icons(page)).toHaveCount(2);
      await page.close();
    });

    await test.step('opened on a direct Performance link', async () => {
      const page = await context.newPage();
      await page.goto('https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Aexample.com');
      await expect(icons(page)).toHaveCount(2);
      await page.close();
    });

    await test.step('after switching property in the page', async () => {
      const page = await context.newPage();
      await page.goto('https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Aexample.com');
      await expect(icons(page)).toHaveCount(2);
      await page.click('#nav-property');
      await expect(page).toHaveURL(/resource_id=sc-domain%3Aexample\.org/);
      await page.click('#nav-performance');
      await expect(icons(page)).toHaveCount(2);
      await page.close();
    });

    await test.step('no new install warning: the host stays search.google.com', async () => {
      const id = new URL(sw.url()).host;
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/src/options/options.html`);
      const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8'));
      // 1.13.7's: the old match, and no search.google.com host permission.
      const before = structuredClone(manifest);
      before.content_scripts[0].matches = ['https://search.google.com/search-console/*'];
      before.host_permissions = before.host_permissions.filter((h) => !h.startsWith('https://search.google.com/'));
      const warn = (m) => page.evaluate((t) => chrome.management.getPermissionWarningsByManifest(t), JSON.stringify(m));
      const [now, then] = [await warn(manifest), await warn(before)];
      console.log('install warnings, 1.13.8:', JSON.stringify(now));
      expect(now).toEqual(then);
      const hosts = [...manifest.content_scripts[0].matches, ...manifest.host_permissions.filter((h) => h.includes('google'))];
      expect(hosts.every((m) => m.startsWith('https://search.google.com/'))).toBe(true);
      await page.close();
    });
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Chromium injects nothing into tabs that were open before an install or an
// update, and a reload of an extension loaded with --load-extension unloads
// it for good in Playwright's Chromium (tried: no worker comes back). So a
// copy whose Search Console script matches nothing stands in for those
// tabs: they load with no runner, as a tab opened before the install has,
// and the worker's onInstalled step (SBWGscTabs.injectOpenTabs) is run in
// the worker itself.
test('Search Console already open at an install or an update gets its icons without a reload', async () => {
  test.setTimeout(90_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-gsc-e2e-'));
  const copy = path.join(dir, 'extension');
  fs.cpSync(EXTENSION, copy, { recursive: true });
  const manifestPath = path.join(copy, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.content_scripts[0].matches = ['https://search.google.com/no-such-page/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const { context, sw, searches } = await launch(copy);
  try {
    const overview = await context.newPage();
    await overview.goto('https://search.google.com/search-console?resource_id=sc-domain%3Aexample.com');
    const report = await context.newPage();
    await report.goto('https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Aexample.com');
    await report.waitForSelector('tbody tr');
    // No manifest runner here, so every icon below comes from injectOpenTabs:
    // the worker's own onInstalled run, if it came after these tabs loaded,
    // or the call below.

    const injected = await sw.evaluate(() => SBWGscTabs.injectOpenTabs(chrome));
    expect(injected).toBe(2);
    // Twice is harmless: a tab with a live runner keeps it.
    expect(await sw.evaluate(() => SBWGscTabs.injectOpenTabs(chrome))).toBe(2);

    await expect(icons(report)).toHaveCount(2);
    await expect(report.locator('tbody tr:first-child .seo-bw-gsc-actions')).toHaveCount(1);
    const opened = context.waitForEvent('page', { timeout: 10_000 });
    await icons(report).first().locator('.seo-bw-gsc-icon-search').click();
    await (await opened).waitForLoadState();
    await expect.poll(() => searches).toContain('roofing repair denver');
    // Pages, then Queries, in the page: the injected runner follows the tabs.
    await report.click('#tab-pages');
    await expect(report.locator('.seo-bw-gsc-actions')).toHaveCount(0);
    await report.click('#tab-queries');
    await expect(icons(report)).toHaveCount(2);

    // The tab that was on the overview: Performance in the page.
    await overview.bringToFront();
    await overview.click('#nav-performance');
    await expect(icons(overview)).toHaveCount(2);
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
