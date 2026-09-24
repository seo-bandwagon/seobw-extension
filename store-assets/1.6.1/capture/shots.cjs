const { chromium } = require('/Users/kylealm/Projects/seo-bw-extension/node_modules/@playwright/test');
const path = require('path');
const S = process.env.S; const EXT = path.join(S, 'ext');
const [,, target = 'https://seobandwagon.com/', out = 'probe', theme = 'dark', action = ''] = process.argv;
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(S, 'profile-' + Date.now()), {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  await sw.evaluate((t) => chrome.storage.local.set({ bwThemeMode: t }), theme);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(target, { waitUntil: 'load' }); await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(S, out + '-page.png') });
  const targetUrl = page.url();
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: action.startsWith('panel') ? 400 : 500, height: action.startsWith('panel') ? 760 : 800 });
  // Shim: the popup asks for "the active tab"; opened as a tab, that would be
  // itself. Point it at the page tab. Everything else runs for real.
  await pop.addInitScript((u) => {
    const real = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q, cb) => {
      const p = (q && q.active) ? real({}).then((ts) => ts.filter((t) => t.url === u).slice(0, 1)) : real(q);
      if (cb) { p.then(cb); return; } return p;
    };
  }, targetUrl);
  pop.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text()); });
  pop.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const which = action.startsWith('panel') ? 'src/panel/panel.html' : 'src/popup/popup.html';
  await pop.goto(`chrome-extension://${id}/${which}`); await pop.waitForTimeout(5000);
  if (process.env.DUMP) console.log('SECTIONS', await pop.evaluate(() => [...document.querySelectorAll('#content .section-header')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).join(' | ') + ' || LC=' + typeof SBWLinkCheck + '/' + typeof SBWLinkCheckUI));
  const SECTION = process.env.SECTION, CLICK = process.env.CLICK, WAIT = +(process.env.WAIT || 0);
  if (SECTION) {
    await pop.evaluate((re) => {
      const secs = [...document.querySelectorAll('#content .section')];
      secs.forEach((s) => { if (s.classList.contains('open')) s.querySelector('.section-header').click(); });
      const s = secs.find((x) => new RegExp(re, 'i').test(x.querySelector('.section-header').textContent));
      s.querySelector('.section-header').click();
      document.getElementById('tab-seo').scrollTop = s.offsetTop - 8;
    }, SECTION);
    await pop.waitForTimeout(1500);
  }
  if (CLICK) { await pop.click(CLICK).catch((e) => console.log('click failed', e.message)); await pop.waitForTimeout(WAIT); }
  if (SECTION) await pop.evaluate((re) => {
    const s = [...document.querySelectorAll('#content .section')].find((x) => new RegExp(re, 'i').test(x.querySelector('.section-header').textContent));
    document.getElementById('tab-seo').scrollTop = s.offsetTop - 8;
  }, SECTION);
  const box = await pop.evaluate(() => { const r = document.body.getBoundingClientRect(); const f = document.querySelector('footer, .footer, .popup-footer'); return { w: Math.ceil(r.width), h: Math.ceil(f ? f.getBoundingClientRect().bottom : document.documentElement.scrollHeight) }; });
  console.log('body', JSON.stringify(box));
  await pop.screenshot({ path: path.join(S, out + '-ui.png'), clip: { x: 0, y: 0, width: Math.min(box.w, 500), height: Math.min(box.h, 760) } });
  console.log(await pop.evaluate(() => document.getElementById('tab-seo') ? document.getElementById('tab-seo').innerText.slice(0, 600) : document.body.innerText.slice(0,600)));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
