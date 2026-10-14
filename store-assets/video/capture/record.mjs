// Records the demo video's screen scenes (STORYBOARD.md scenes 2-6 and 8)
// from the real extension in headless Chromium: the page and the real action
// popup are captured as timestamped frames through CDP screencast, and every
// click, URL change and popup open/close is logged, so build.mjs can composite
// them under a drawn browser toolbar at 1920x1080. Nothing is mocked except
// the blank spreadsheet scene 6 pastes into (a local page; the final cut uses
// a real spreadsheet).
// usage: OUT=/tmp/shoot EXT=/path/to/extension-copy node record.mjs [s2 s3 ...]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT; const EXT = process.env.EXT;
const CHROME = process.env.CHROME || '/usr/bin/chromium';
// Page area under an 80 px toolbar: 1920x1000 device pixels, laid out at 1.5x
// so the page and the popup are large enough to read in a 1080p video.
const SCALE = 1.5;
const VIEW = { width: 1280, height: 667, deviceScaleFactor: SCALE };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, ignoreDefaultArgs: ['--enable-automation'],
  userDataDir: path.join(OUT, 'profile-' + Date.now()), enableExtensions: [EXT], defaultViewport: VIEW,
  args: [`--window-size=${VIEW.width},${VIEW.height}`, '--lang=en-US', `--user-agent=${UA}`,
    '--disable-blink-features=AutomationControlled', '--no-first-run', '--hide-scrollbars',
    // Screencast frames follow the real device scale, not the emulated one; a
    // large virtual screen keeps the popup from being clipped to fit it.
    `--force-device-scale-factor=${SCALE}`, '--screen-info={0,0 3840x2160}'],
});
const swT = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/service-worker.js'));
const sw = await swT.worker();
const EXT_ID = new URL(swT.url()).host;
await sw.evaluate(() => chrome.storage.local.set({ bwThemeMode: 'dark' }));
await sleep(1500);
for (const pg of await browser.pages()) if (/welcome\?ref=install/.test(pg.url())) await pg.close();

// ---------- recording helpers ----------
class Scene {
  constructor(name) {
    this.name = name; this.dir = path.join(OUT, name); fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true }); this.events = []; this.t0 = null; this.streams = [];
  }
  now() { return (Date.now() - this.t0) / 1000; }
  mark(name, extra = {}) { this.events.push({ t: this.now(), name, ...extra }); }
  async stream(page, kind) {
    const idx = this.streams.length; const sdir = path.join(this.dir, `${kind}-${idx}`); fs.mkdirSync(sdir);
    const cdp = await page.createCDPSession(); const frames = []; let n = 0;
    cdp.on('Page.screencastFrame', async (f) => {
      const file = `${String(n++).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(sdir, file), Buffer.from(f.data, 'base64'));
      frames.push({ t: this.now(), file });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    const size = await page.evaluate(() => ({ w: Math.round(innerWidth * devicePixelRatio), h: Math.round(innerHeight * devicePixelRatio), dpr: devicePixelRatio,
      shell: document.querySelector('.page-popup')?.getBoundingClientRect().width }));
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: size.w, maxHeight: size.h, everyNthFrame: 1 });
    const s = { kind, dir: `${kind}-${idx}`, start: this.now(), end: null, size, frames, cdp };
    this.streams.push(s); return s;
  }
  async stop(s) { s.end = this.now(); await s.cdp.send('Page.stopScreencast').catch(() => {}); }
  save() {
    const json = { name: this.name, scale: SCALE, events: this.events, streams: this.streams.map(({ cdp, ...s }) => s), duration: this.now() };
    fs.writeFileSync(path.join(this.dir, 'scene.json'), JSON.stringify(json, null, 1));
    console.log(`${this.name}: ${json.duration.toFixed(1)} s, ${json.streams.map((s) => `${s.dir} ${s.frames.length}f`).join(', ')}`);
  }
}

async function newTab(url) {
  const page = await browser.newPage(); await page.setViewport(VIEW);
  await page.goto(url, { waitUntil: 'load', timeout: 45000 }); await sleep(1500);
  // Decline seobandwagon.com's cookie banner before recording, so it isn't in frame.
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^reject$/i.test(x.textContent.trim())); if (b) b.click(); });
  await sleep(400); return page;
}
// The toolbar icon "click": logged for build.mjs to draw, then the real popup opens.
async function openPopup(sc, page) {
  await page.bringToFront();
  sc.mark('click', { on: 'toolbar-icon' }); await sleep(250);
  await sw.evaluate(() => chrome.action.openPopup());
  const t = await browser.waitForTarget((t) => t.url().startsWith(`chrome-extension://${EXT_ID}/src/popup/popup.html`));
  const p = await t.asPage();
  // Headless gives the popup a fixed window wider than its 500 px shell and
  // ignores the device scale there: record it at 1x and let build.mjs crop it
  // to the shell and scale it to match the page.
  await p.waitForSelector('.page-popup');
  const s = await sc.stream(p, 'popup'); sc.mark('popup-open', { stream: s.dir, size: s.size });
  return { p, s };
}
async function closePopup(sc, pop) { await sc.stop(pop.s); sc.mark('popup-close', { stream: pop.s.dir }); await pop.p.close().catch(() => {}); }
async function clickIn(sc, page, sel, on, stream) {
  const el = await page.waitForSelector(sel, { visible: true, timeout: 20000 });
  await el.evaluate((e) => e.scrollIntoView({ block: 'nearest' })); await sleep(200);
  const b = await el.boundingBox();
  sc.mark('click', { on, stream, x: b.x + b.width / 2, y: b.y + b.height / 2 }); await sleep(250);
  await el.click();
}
async function openSection(p, name) {
  await p.evaluate((name) => {
    document.querySelectorAll('#content .section.open').forEach((s) => s.querySelector('.section-header').click());
    const s = document.querySelector(`[data-section="${name}"]`); s.querySelector('.section-header').click();
    document.getElementById('tab-seo').scrollTo({ top: s.offsetTop - 40, behavior: 'smooth' });
  }, name);
  await sleep(900);
}
async function smoothScroll(page, to, ms = 1200) {
  await page.evaluate(async (to, ms) => {
    const from = scrollY, t0 = performance.now();
    await new Promise((r) => { const step = (t) => { const k = Math.min(1, (t - t0) / ms); scrollTo(0, from + (to - from) * (1 - Math.cos(k * Math.PI)) / 2); k < 1 ? requestAnimationFrame(step) : r(); }; requestAnimationFrame(step); });
  }, to, ms);
}
async function shoot(name, url, body) {
  if (want.length && !want.includes(name)) return;
  const sc = new Scene(name);
  const page = await newTab(url);
  sc.t0 = Date.now(); sc.mark('url', { url: page.url(), title: await page.title() });
  const ps = await sc.stream(page, 'page'); await sleep(1200);
  try { await body(sc, page); } finally { await sleep(600); await sc.stop(ps); for (const s of sc.streams) if (s.end == null) await sc.stop(s); sc.save(); await page.close().catch(() => {}); }
}

// ---------- scenes ----------
await shoot('s2-analysis', 'https://seobandwagon.com/', async (sc, page) => {
  const pop = await openPopup(sc, page); await sleep(2600);
  await openSection(pop.p, 'issues'); await sleep(1400);
  await openSection(pop.p, 'headings'); await sleep(900);
  await clickIn(sc, pop.p, '[data-section="headings"] .highlight-btn[data-type="headings"]', 'popup', pop.s.dir);
  await sleep(2500);
  await closePopup(sc, pop); await smoothScroll(page, 700, 1600); await sleep(1500);
});

await shoot('s3-link-check', 'https://seobandwagon.com/seo-chrome-extension', async (sc, page) => {
  let pop = await openPopup(sc, page); await sleep(2200);
  await openSection(pop.p, 'link-check');
  await clickIn(sc, pop.p, '#lcCheckBtn', 'popup', pop.s.dir);
  await pop.p.waitForSelector('#lcExportBtn', { timeout: 120000 }); await sleep(1500);
  await clickIn(sc, pop.p, '#lcHighlightBtn', 'popup', pop.s.dir); await sleep(800);
  await closePopup(sc, pop);
  await page.evaluate(() => document.querySelector('a[href*="nicklaunches.com"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(2500);
  pop = await openPopup(sc, page); await sleep(1800);
  await openSection(pop.p, 'link-check'); await sleep(2200);
  await closePopup(sc, pop);
});

await shoot('s4-indexability', 'http://seobandwagon.com/seo-chrome-extension', async (sc, page) => {
  const pop = await openPopup(sc, page); await sleep(2200);
  await openSection(pop.p, 'indexability'); await sleep(2600);
  await openSection(pop.p, 'render'); await sleep(700);
  await clickIn(sc, pop.p, '#rcCompareBtn', 'popup', pop.s.dir); await sleep(4500);
  await closePopup(sc, pop);
});

await shoot('s5-structured-data', 'https://seobandwagon.com/seo-chrome-extension', async (sc, page) => {
  const pop = await openPopup(sc, page); await sleep(2200);
  await openSection(pop.p, 'schema'); await sleep(2200);
  await pop.p.evaluate(() => document.getElementById('tab-seo').scrollBy({ top: 220, behavior: 'smooth' })); await sleep(2200);
  await closePopup(sc, pop);
});

await shoot('s6-google', 'https://www.google.com/search?q=best+crm+for+nonprofits&gl=us&hl=en&pws=0', async (sc, page) => {
  if (/unusual traffic|\/sorry\//i.test(await page.evaluate(() => document.body.innerText + location.href))) throw new Error('Google bot wall');
  await browser.defaultBrowserContext().overridePermissions('https://www.google.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await page.waitForSelector('.sbw-serp-bar'); await sleep(1500);
  await smoothScroll(page, 260, 1400); await sleep(1200);
  const tbY = await page.evaluate(() => document.querySelector('.sbw-serp-tools').getBoundingClientRect().top + scrollY);
  await smoothScroll(page, Math.max(0, tbY - 520), 1800); await sleep(600);
  const btn = async (label) => (await page.evaluateHandle((l) => [...document.querySelectorAll('.sbw-serp-tools button')].find((b) => b.textContent.startsWith(l)), label)).asElement();
  const click = async (label) => { const b = await btn(label); const bb = await b.boundingBox(); sc.mark('click', { on: 'page', x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }); await sleep(250); await b.click(); await sleep(900); return page.evaluate(() => navigator.clipboard.readText()); };
  const results = await click('Copy results');
  const paa = await click('Copy PAA');
  console.log(`  copied ${results.split('\n').length} result lines, ${paa.split('\n').filter(Boolean).length} PAA lines`);
  // a blank spreadsheet (local page) receives the paste
  const sheet = fs.readFileSync(new URL('./sheet.html', import.meta.url), 'utf8');
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(sheet)); await sleep(500);
  sc.mark('url', { url: 'Untitled spreadsheet', title: 'Untitled spreadsheet' });
  await sleep(1000);
  sc.mark('click', { on: 'page', x: 120, y: 130 });
  await page.evaluate((t) => window.pasteRows(t), results); await sleep(2200);
  await page.evaluate((t) => window.pasteList(t), paa); await sleep(2400);
});

await shoot('s8-privacy', 'https://seobandwagon.com/seo-chrome-extension', async (sc, page) => {
  const pop = await openPopup(sc, page); await sleep(2000);
  await pop.p.evaluate(() => { const c = document.getElementById('tab-seo'); c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }); }); await sleep(1600);
  const lbl = await pop.p.$('#dataToggle'); const bb = await lbl.boundingBox();
  sc.mark('click', { on: 'popup', stream: pop.s.dir, x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, ring: 'hover' }); await sleep(2000);
  await pop.p.evaluate(() => document.getElementById('tab-seo').scrollTo({ top: 0, behavior: 'smooth' })); await sleep(1800);
  await closePopup(sc, pop);
});

await browser.close();
