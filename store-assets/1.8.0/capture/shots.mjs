// Raw UI captures for the 1.8.0 store screenshots: the real extension (a copy
// of extension/ with <all_urls> standing in for the optional grant) in
// Chromium, real public pages, the real action popup (chrome.action.openPopup)
// and side panel. Writes PNGs to $RAW for compose.mjs.
// usage: RAW=/tmp/raw EXT=/path/to/extension-copy node shots.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const RAW = process.env.RAW; const EXT = process.env.EXT;
const CHROME = process.env.CHROME || '/usr/bin/chromium';
fs.mkdirSync(RAW, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, ignoreDefaultArgs: ['--enable-automation'],
  userDataDir: path.join(RAW, 'profile-' + Date.now()), enableExtensions: [EXT], defaultViewport: null,
  args: ['--window-size=1280,800', '--lang=en-US', `--user-agent=${UA}`, '--disable-blink-features=AutomationControlled', '--no-first-run'],
});
const swT = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/service-worker.js'));
const sw = await swT.worker();
const id = new URL(swT.url()).host;
const setTheme = (m) => sw.evaluate((m) => chrome.storage.local.set({ bwThemeMode: m }), m);

async function popupOn(page) {
  await page.bringToFront();
  await sw.evaluate(() => chrome.action.openPopup());
  const t = await browser.waitForTarget((t) => t.url().startsWith(`chrome-extension://${id}/src/popup/popup.html`));
  const p = await t.asPage(); await sleep(5000); return p;
}
async function openSection(p, name) {
  await p.evaluate((name) => {
    document.querySelectorAll('#content .section.open').forEach((s) => s.querySelector('.section-header').click());
    const s = document.querySelector(`[data-section="${name}"]`); s.querySelector('.section-header').click();
  }, name);
  await sleep(1200);
}
async function scrollTo(p, name) {
  await p.evaluate((name) => { const s = document.querySelector(`[data-section="${name}"]`); document.getElementById('tab-seo').scrollTop = s.offsetTop - 40; }, name);
  await sleep(400);
}
const shotPopup = (p, f) => p.screenshot({ path: path.join(RAW, f) });

try {
  await setTheme('dark');
  // close the welcome tab a fresh install opens
  for (const pg of await browser.pages()) if (/welcome\?ref=install/.test(pg.url())) await pg.close();
  const page = (await browser.pages())[0] || await browser.newPage();

  // 1. analysis: seobandwagon.com home
  await page.goto('https://seobandwagon.com/', { waitUntil: 'load' }); await sleep(2000);
  let p = await popupOn(page);
  await openSection(p, 'issues');
  await shotPopup(p, 'analysis-ui.png'); await p.close();

  // 2. link check: product page (Web Store links read "Can't check")
  await page.goto('https://seobandwagon.com/seo-chrome-extension', { waitUntil: 'load' }); await sleep(2000);
  p = await popupOn(page);
  await openSection(p, 'link-check'); await p.waitForSelector('#lcCheckBtn'); await p.click('#lcCheckBtn');
  await p.waitForSelector('#lcExportBtn', { timeout: 120000 }); await sleep(500);
  await p.evaluate(() => { document.querySelector('.lc-group[data-class="ok"]')?.classList.remove('open'); });
  await scrollTo(p, 'link-check');
  await shotPopup(p, 'lc-ui.png'); await p.close();

  // 3. indexability: http:// address, so the redirect chain has a hop
  await page.goto('http://seobandwagon.com/seo-chrome-extension', { waitUntil: 'load' }); await sleep(2000);
  p = await popupOn(page);
  await openSection(p, 'indexability'); await scrollTo(p, 'indexability');
  await shotPopup(p, 'ix-ui.png'); await p.close();

  // 4. Google results, signed out
  // A query outside SEO, so no competitor's name or logo can appear in frame
  // (CHROMEWEBSTORE.md, Screenshot Notes); the 1.6.1 set used the same one.
  const q = 'https://www.google.com/search?q=best+crm+for+nonprofits&gl=us&hl=en&pws=0';
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(q, { waitUntil: 'networkidle2' });
  if (/unusual traffic|\/sorry\//i.test(await page.evaluate(() => document.body.innerText + location.href))) throw new Error('Google bot wall');
  await page.waitForSelector('.sbw-serp-bar'); await sleep(2500);
  // results with their bars
  const first = await page.evaluate(() => { const r = document.querySelector('#rso').getBoundingClientRect(); return { x: Math.max(0, r.x - 20), y: r.y + scrollY - 10 }; });
  await page.screenshot({ path: path.join(RAW, 'serp-results.png'), clip: { x: first.x, y: first.y, width: 760, height: 380 }, captureBeyondViewport: true });
  // 1.8.0 (#45): add pages 1-3 the way a person does, one click each, with
  // Google's own Next link in between and a pause to read.
  const clickCollect = async (label) => {
    const h = await page.evaluateHandle((l) => [...document.querySelectorAll('.sbw-serp-collect button, .sbw-serp-collect a')].find((x) => x.textContent.startsWith(l)), label);
    const el = h.asElement(); if (!el) throw new Error('no ' + label);
    await el.evaluate((x) => x.scrollIntoView({ block: 'center' })); await el.click();
  };
  for (let n = 1; n <= 3; n++) {
    await page.waitForSelector('.sbw-serp-collect'); await sleep(1500);
    await clickCollect(`Add page ${n}`); await sleep(1800); // past the "Added" flash
    if (n < 3) { await sleep(2500); const nav = page.waitForNavigation({ waitUntil: 'load' }); await clickCollect('Next page →'); await nav; }
  }
  // the toolbar below the results, with the collection line
  const tb = await page.evaluate(() => { const r = document.querySelector('.sbw-serp-tools').getBoundingClientRect(); return { x: Math.max(0, r.x - 12), y: r.y + scrollY - 12, w: Math.min(r.width + 24, 760), h: r.height + 24 }; });
  await page.screenshot({ path: path.join(RAW, 'serp-toolbar.png'), clip: { x: tb.x, y: tb.y, width: tb.w, height: tb.h }, captureBeyondViewport: true });
  p = await popupOn(page);
  await p.screenshot({ path: path.join(RAW, 'serp-popup.png'), clip: { x: 0, y: 0, width: (await p.evaluate(() => innerWidth)), height: 260 } });
  await p.close();

  // 5. page-checks panel, Night and Day (opened from the side panel with a click gesture)
  await page.goto('https://seobandwagon.com/seo-chrome-extension', { waitUntil: 'load' }); await sleep(2000);
  for (const mode of ['dark', 'light']) {
    await setTheme(mode);
    const pp = await popupOn(page);
    const win = await sw.evaluate(() => chrome.windows.getLastFocused().then((w) => w.id));
    await pp.evaluate((w) => { const b = document.createElement('button'); b.id = '__sp'; b.onclick = () => chrome.sidePanel.open({ windowId: w }); document.body.prepend(b); }, win);
    await pp.click('#__sp').catch(() => {}); await sleep(2500);
    const spT = await browser.waitForTarget((t) => /\/src\/(sidepanel\/sidepanel|panel\/panel)\.html/.test(t.url()));
    let sp = await spT.asPage(); await sleep(2000);
    if (/sidepanel\.html/.test(spT.url())) {
      await sp.click('#spPageChecks').catch(() => {}); await sleep(3500);
      sp = await (await browser.waitForTarget((t) => t.url().includes('/src/panel/panel.html'))).asPage(); await sleep(2500);
    }
    await sp.setViewport({ width: 400, height: 760 }); await sleep(800);
    await sp.screenshot({ path: path.join(RAW, `panel-${mode === 'dark' ? 'night' : 'day'}-ui.png`) });
    await sp.close().catch(() => {});
  }
  await setTheme('dark');
  console.log('raw captures:', fs.readdirSync(RAW).filter((f) => f.endsWith('.png')).join(', '));
} finally { await browser.close(); }
