const { chromium } = require('/Users/kylealm/Projects/seo-bw-extension/node_modules/@playwright/test');
const fs = require('fs'); const path = require('path');
const S = process.env.S; const EXT = path.join(S, 'ext');
const [,, fixture, q, out, scrollY = '0'] = process.argv;
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(S, 'profile-serp-' + Date.now()), {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const html = fs.readFileSync(fixture, 'utf8');
  const ASSETS = process.env.ASSETS;
  await ctx.route(/https:\/\/www\.google\.com\/search.*/, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  if (ASSETS) await ctx.route(/https:\/\/www\.google\.com\/[^?]*_files\/.*/, (r) => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split('_files/')[1]);
    const f = path.join(ASSETS, name);
    if (fs.existsSync(f)) return r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: /\.css$|m=/.test(name) ? 'text/css' : undefined });
    return r.abort();
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  // The saved page was saved with the extension running, so it already holds
  // one copy of the overlay. Remove it before the content script adds its own.
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[class^="sbw-"], [class*=" sbw-"]').forEach((e) => e.remove());
  }));
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('https://www.google.com/search?q=' + encodeURIComponent(q) + '&hl=en&gl=us', { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  console.log('sbw nodes', await page.evaluate(() => document.querySelectorAll('[class^="sbw-"], [class*=" sbw-"]').length));
  // Hide the saver's Google account avatar and anything else account-bound.
  await page.addStyleTag({ content: 'a[aria-label*="Google Account"], a[href*="accounts.google.com/SignOutOptions"], img[src*="googleusercontent.com/a/"], #gb a[aria-label*="@"] { visibility: hidden !important; }' });
  console.log('sbw first', await page.evaluate(() => [...document.querySelectorAll('[class^="sbw-"], [class*=" sbw-"]')].filter((e) => /toolbar|tools|export|actions/.test(e.className)).slice(0, 6).map((e) => e.className + '@' + Math.round(e.getBoundingClientRect().top + scrollY) + ':' + e.textContent.trim().slice(0, 50)).join('\n')));
  console.log('avatars', await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.top < 80 && r.left > 1100 && getComputedStyle(i).visibility !== 'hidden'; }).map((i) => i.src.slice(0, 60)).join(' ')));
  await page.evaluate((y) => window.scrollTo(0, +y), scrollY); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(S, out + '.png') });
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
