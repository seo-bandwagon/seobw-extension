// Analyze on Google (1.12.0) in a real browser with the extension loaded: the
// page's checks are read from its HTML by the worker's fetch and Chromium's
// offscreen document, and shown under the result; no tab opens, no cookie
// goes with the fetch, robots.txt and llms.txt are read once a site, a
// result Google hides is never fetched, and "Analyze top 10" fills the table.
//
// Nothing leaves the runner. The result pages, their robots.txt and llms.txt
// come from a local server on 127.0.0.1, reached as garden.example (Analyze
// never reads a local address, so the name stands in for a public site);
// a results page in Google's markup
// that links to them is answered at www.google.com/search by the route, and
// Chromium's resolver points every other host nowhere. The extension is a
// copy whose manifest adds <all_urls> to host_permissions (as
// analysis.spec.mjs does), standing in for the access Analyze asks for once;
// the code it runs is the shipped code. SBW_SCREENSHOTS=<dir> also saves the
// checks row and the table.

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION = resolve(__dirname, '..', '..', 'extension');
const PAGES = resolve(__dirname, '..', 'fixtures', 'pages');

// A results page in the shape Google draws one: three results on the local
// server, and one behind Google's /goto redirect with only its site shown.
function resultsPage(base) {
  const result = (path, title, cite) => `<div class="g"><div>
    <a href="${base}${path}"><h3>${title}</h3></a><cite>${cite}</cite>
    <div data-sncf="1">A description long enough for the parser, with more than forty characters in it.</div></div></div>`;
  return `<!doctype html><html><head><title>garden - Google Search</title></head><body>
    <div id="search"><div id="rso">
      ${result('/pages/good-en.html', 'Start a garden', base + ' › guides')}
      ${result('/pages/noindex.html', 'A page asked out of the index', base + ' › noindex')}
      <div class="g"><div><a href="/goto?url=CAEShidden"><h3>A hidden result</h3></a><cite>https://hidden.example › page</cite>
        <div data-sncf="1">A description long enough for the parser, with more than forty characters in it.</div></div></div>
      ${result('/pages/microdata.html', 'Recipes with Microdata', base + ' › recipes')}
    </div></div></body></html>`;
}

function serve(seen) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    seen.push({ path, cookie: req.headers.cookie || null });
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n'); return; }
    if (path === '/llms.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('# Garden guides\n'); return; }
    if (path.startsWith('/pages/')) {
      try {
        const body = readFileSync(join(PAGES, path.slice('/pages/'.length).replace(/[^\w.-]/g, '')));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      } catch (e) { /* 404 below */ }
    }
    res.writeHead(404); res.end();
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

test('Analyze on Google: checks from the HTML, offscreen, no tab, no cookies; Analyze top 10 fills the table', async () => {
  test.setTimeout(120_000);
  const seen = [];
  const server = await serve(seen);
  const base = `http://garden.example:${server.address().port}`;

  const copy = mkdtempSync(join(tmpdir(), 'sbw-ext-'));
  cpSync(EXTENSION, copy, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, '<all_urls>'];
  writeFileSync(join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${copy}`,
      `--load-extension=${copy}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP garden.example 127.0.0.1, MAP * ~NOTFOUND'
    ]
  });
  // A cookie the page fetch must not carry.
  await context.addCookies([{ name: 'session', value: 'secret', url: base }]);

  const googleCalls = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.google.com' && url.pathname === '/search') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: resultsPage(base) });
    }
    if (/(^|\.)google\./.test(url.hostname)) googleCalls.push(url.href);
    return route.continue();
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const page = await context.newPage();
    await page.goto('https://www.google.com/search?q=start+a+garden', { waitUntil: 'load' });
    const bars = page.locator('.sbw-serp-bar');
    await expect(bars).toHaveCount(4);
    // Every tab created from here on, but the welcome tab a first install
    // opens, which can come late.
    await worker.evaluate(() => {
      globalThis.__createdTabs = [];
      chrome.tabs.onCreated.addListener((t) => {
        if (!/seo-chrome-extension\/welcome/.test(t.pendingUrl || t.url || '')) globalThis.__createdTabs.push(t.id);
      });
    });
    const tabsOpened = () => worker.evaluate(() => globalThis.__createdTabs.length);

    await test.step('Analyze: the checks open under the result, read offscreen, and no tab opens', async () => {
      await bars.first().locator('.sbw-serp-analyze').click();
      const row = page.locator('.sbw-serp-check').first();
      await expect(row).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
      await expect(row).toContainText('from the page’s HTML');
      // The saved guide's canonical names its own address, not this local
      // server's, so it rightly reads as pointing elsewhere.
      await expect(row).toContainText('Canonicalpoints elsewhere');
      await expect(row).toContainText('Indexableno: canonical points elsewhere');
      await expect(row).toContainText('AI crawlersblocked: GPTBot');
      await expect(row).toContainText('llms.txtyes');
      await expect(row).toContainText('On-page checklist');
      await expect(row.locator('.sbw-check-item', { hasText: 'Title' }).locator('dd')).toContainText(' px');
      const offscreen = await worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length);
      expect(offscreen).toBe(1);
      expect(await tabsOpened()).toBe(0);
    });

    await test.step('the fetch carried no cookie, and robots.txt was read once', async () => {
      const pageHit = seen.find((s) => s.path === '/pages/good-en.html');
      expect(pageHit).toBeTruthy();
      expect(pageHit.cookie).toBeNull();
      expect(seen.filter((s) => s.path === '/robots.txt')).toHaveLength(1);
    });

    await test.step('a result Google hides asks to sign in to Google or open it, and nothing is fetched for it', async () => {
      await bars.nth(2).locator('.sbw-serp-analyze').click();
      await expect(page.locator('.sbw-serp-check[data-state="hidden"]')).toContainText('Sign in to Google, or open the result');
      expect(googleCalls).toEqual([]);
    });

    await test.step('Analyze top 10 checks the rest, and the table gets their words, schema and checklist', async () => {
      await page.locator('.sbw-serp-tools button', { hasText: 'Analyze top 10' }).click();
      await expect(page.locator('.sbw-serp-check[data-state="done"]')).toHaveCount(3, { timeout: 30_000 });
      await expect(page.locator('.sbw-serp-check', { hasText: 'Indexableno: noindex' })).toHaveCount(1);
      await expect(page.locator('[data-role="analyze-line"]')).toContainText('3 of 4 checked from their HTML; 1 hidden by Google');
      const table = page.locator('[data-role="table"] table');
      const headers = await table.locator('thead th').allTextContents();
      const words = headers.indexOf('Words');
      const firstWords = await table.locator('tbody tr').first().locator('td, th').nth(words).textContent();
      expect(Number(firstWords.replace(/[^\d.]/g, ''))).toBeGreaterThan(0);
      expect(seen.filter((s) => s.path === '/robots.txt')).toHaveLength(1);
      expect(await tabsOpened()).toBe(0);
    });

    if (process.env.SBW_SCREENSHOTS) {
      await test.step('screenshots: the checks row and the table (for the PR, not the store)', async () => {
        mkdirSync(process.env.SBW_SCREENSHOTS, { recursive: true });
        await page.addStyleTag({ content: 'body{font-family:Arial,sans-serif;font-size:14px;color:#1f1f1f;margin:0} #search{width:760px;margin:20px 0 0 40px} h3{font-size:20px;font-weight:400;color:#1a0dab;margin:6px 0 3px} cite{color:#4d5156;font-style:normal;font-size:12px} [data-sncf]{color:#4d5156} .sbw-serp-tools{width:760px;margin-left:40px}' });
        await page.waitForTimeout(300);
        await page.locator('.sbw-serp-check').first().screenshot({ path: join(process.env.SBW_SCREENSHOTS, 'checks-row.png') });
        await page.locator('[data-group="table"]').screenshot({ path: join(process.env.SBW_SCREENSHOTS, 'table.png') });
      });
    }

    expect(googleCalls).toEqual([]);
  } finally {
    await context.close();
    server.close();
    rmSync(copy, { recursive: true, force: true });
  }
});
