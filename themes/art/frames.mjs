// theme_frame / theme_frame_inactive: 64×160 strips in the manifest's frame colours
// (Chrome tiles theme_frame across the window frame; a flat fill matches the `frame` colour).
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const T = {
  'bandwagon-neon-night': { frame: [0, 0, 20], inactive: [0, 0, 12] },
  'bandwagon-neon-day':   { frame: [237, 237, 236], inactive: [228, 228, 227] },
};
const b = await chromium.launch(); const p = await b.newPage();
for (const [folder, c] of Object.entries(T)) for (const [name, rgb] of [['theme_frame', c.frame], ['theme_frame_inactive', c.inactive]]) {
  const url = await p.evaluate((rgb) => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 160; const x = cv.getContext('2d'); x.fillStyle = `rgb(${rgb})`; x.fillRect(0, 0, 64, 160); return cv.toDataURL('image/png'); }, rgb);
  writeFileSync(`themes/${folder}/images/${name}.png`, Buffer.from(url.split(',')[1], 'base64')); console.log(folder, name, 'rgb(' + rgb + ')');
}
await b.close();
