// Renders both NTP wallpapers (3840×1250) with headless Chromium via Playwright.
// Usage: node themes/art/render.mjs [seed]   — default seed 20260906 (documented in themes/README.md)
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const seed = Number(process.argv[2] || 20260906);
const src = readFileSync(path.join(here, 'render-city.js'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: src });
for (const [pal, folder] of [['night', 'bandwagon-neon-night'], ['day', 'bandwagon-neon-day']]) {
  const dataUrl = await page.evaluate(([pal, seed]) => {
    const createCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const c = draw(createCanvas, 3840, 1250, PAL[pal], seed);
    return c.toDataURL('image/png');
  }, [pal, seed]);
  const out = path.join(root, folder, 'images', 'ntp_background.png');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(folder, 'ntp_background.png', (readFileSync(out).length / 1024).toFixed(0) + ' KB');
}
await browser.close();
