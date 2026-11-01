// The page analysis in a real browser with the extension loaded (1.10.4): the
// two things jsdom can't show.
//
//   1. Tech stack: the analyzer reads a page's own globals through the
//      service worker's one executeScript with world: 'MAIN'. The content
//      script's isolated world sees none of them, which is why the Facebook
//      Pixel, Nuxt and Vue were never found before 1.10.4.
//   2. Core Web Vitals: a page loaded in a background tab (how Analyze on
//      Google opens one) gets "No data" for LCP, never a wrong number, and a
//      page loaded in front gets one.
//
// Plus a saved page analyzed in the browser, where the text is laid out
// (innerText), to hold its word count and score to the jsdom ones.
//
// Nothing leaves the runner: pages come from a local server on 127.0.0.1 and
// Chromium's resolver points every other host nowhere. The extension is a
// copy whose manifest adds <all_urls> to host_permissions, so the worker can
// script those pages without the toolbar click that grants activeTab; the
// code it runs is the shipped code, unchanged.

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION = resolve(__dirname, '..', '..', 'extension');
const PAGES = resolve(__dirname, '..', 'fixtures', 'pages');

// The files the popup injects before { action: 'analyze' }, from popup.js.
const popupSrc = readFileSync(resolve(EXTENSION, 'src/popup/popup.js'), 'utf8');
const FILES = JSON.parse(/executeScript\(\{\s*target:\s*\{\s*tabId:\s*tab\.id\s*\},\s*files:\s*(\[[^\]]+\])/.exec(popupSrc)[1].replace(/'/g, '"'));

// A page that sets the globals a Pixel, Nuxt, Vue, Tag Manager with a GA4
// tag, and jQuery leave behind. Nothing it names is loaded.
const TECH_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tech probe</title></head>
<body><div id="app"><p>App</p></div>
<script>
  window.fbq = function () {};
  window.__NUXT__ = { state: {} };
  document.getElementById('app').__vue_app__ = { version: '3' };
  window.google_tag_manager = { 'GTM-TEST1': {}, 'G-TEST2': {} };
  window.jQuery = function () {};
</script></body></html>`;

// A page with one large text block to paint.
const LCP_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LCP</title></head>
<body><h1 style="font-size:64px">A heading big enough to be the largest paint</h1>
<p style="font-size:22px">${'Some words to paint on the page. '.repeat(40)}</p></body></html>`;

function serve() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    let body = null;
    if (path === '/tech') body = TECH_PAGE;
    else if (path === '/lcp') body = LCP_PAGE;
    else if (path.startsWith('/pages/')) {
      try { body = readFileSync(join(PAGES, path.slice('/pages/'.length).replace(/[^\w.-]/g, ''))); } catch { body = null; }
    }
    if (body === null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

test('analysis in the browser: the page\'s own globals, and Web Vitals in a background tab', async () => {
  test.setTimeout(120_000);
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;

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
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      // A window behind another (macOS) must still count as visible.
      '--disable-backgrounding-occluded-windows'
    ]
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });

    const tabIdOf = (url) => worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
    const analyze = (tabId) => worker.evaluate(async ({ tabId, files }) => {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      return chrome.tabs.sendMessage(tabId, { action: 'analyze' });
    }, { tabId, files: FILES });

    await test.step('tech stack: found from the page\'s own world, invisible from the isolated one', async () => {
      const page = await context.newPage();
      await page.goto(`${base}/tech`);
      const tabId = await tabIdOf(`${base}/tech`);

      const isolated = await worker.evaluate(async (tabId) => (await chrome.scripting.executeScript({
        target: { tabId },
        func: () => [typeof window.fbq, typeof window.__NUXT__, typeof window.google_tag_manager]
      }))[0].result, tabId);
      expect(isolated).toEqual(['undefined', 'undefined', 'undefined']);

      const data = await analyze(tabId);
      const names = data.techStack.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['Facebook Pixel', 'Nuxt.js', 'Vue.js', 'Google Tag Manager', 'Google Analytics', 'jQuery']));
      expect(data.techStack.find((t) => t.name === 'Google Tag Manager').category).toBe('Tag manager');
      await page.close();
    });

    await test.step('Web Vitals: a page loaded in front gets an LCP', async () => {
      const page = await context.newPage();
      await page.bringToFront();
      await page.goto(`${base}/lcp`);
      await page.waitForTimeout(500);
      const data = await analyze(await tabIdOf(`${base}/lcp`));
      expect(data.webVitals.loadedHidden).toBe(false);
      expect(data.webVitals.lcp).toBeGreaterThan(0);
      expect(data.webVitals.fcp).toBeGreaterThan(0);
      expect(data.webVitals.cls).toBeGreaterThanOrEqual(0);
      expect(data.webVitals.source).toBe('this-visit');
      await page.close();
    });

    await test.step('Web Vitals: the same page in a background tab gets "No data", not a number', async () => {
      const url = `${base}/lcp?background=1`;
      const tabId = await worker.evaluate(async (u) => {
        const tab = await chrome.tabs.create({ url: u, active: false });
        for (let i = 0; i < 100; i++) {
          if ((await chrome.tabs.get(tab.id)).status === 'complete') break;
          await new Promise((r) => setTimeout(r, 100));
        }
        return tab.id;
      }, url);
      const data = await analyze(tabId);
      expect(data.webVitals).toMatchObject({ loadedHidden: true, lcp: null, fcp: null, cls: null });
      expect(data.webVitals.ttfb).toBeGreaterThanOrEqual(0);
      await worker.evaluate((id) => chrome.tabs.remove(id), tabId);
    });

    await test.step('a saved Japanese page, laid out: its words counted, readability not scored', async () => {
      const page = await context.newPage();
      await page.goto(`${base}/pages/non-english-ja.html`);
      const data = await analyze(await tabIdOf(`${base}/pages/non-english-ja.html`));
      expect(data.content.wordCount).toBeGreaterThan(600);
      expect(data.content.readability).toBeNull();
      // Served over http here, so that is its one issue.
      expect(data.seoScore).toMatchObject({ score: 95, issues: ['Not served over HTTPS'] });
      await page.close();
    });
  } finally {
    await context.close();
    server.close();
    rmSync(copy, { recursive: true, force: true });
  }
});
