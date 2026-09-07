// Store listing assets from the artboard's section-07 markup: icon 128, tile 440×280, marquee 1400×560.
// Backgrounds are crops of the rendered wallpaper (centre-bottom, where the skyline sits).
import { chromium } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 1 });
const wall = (m) => 'data:image/png;base64,' + readFileSync(`themes/bandwagon-neon-${m}/images/ntp_background.png`).toString('base64');
const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@400;700&family=Space+Mono:wght@400;700&display=swap">`;
const C = { night: { bg: '#000022', ink: '#F5F5F5', accent: '#F53796', sub: 'rgba(245,245,245,0.75)', tileGrad: 'linear-gradient(180deg, rgba(0,0,34,0.92) 0%, rgba(0,0,34,0.55) 48%, rgba(0,0,34,0.18) 100%)', mqGrad: 'linear-gradient(100deg, rgba(0,0,34,0.94) 0%, rgba(0,0,34,0.72) 42%, rgba(0,0,34,0.10) 82%, rgba(0,0,34,0) 100%)', name: 'Neon Night', tag: 'rgba(245,245,245,0.9)' },
            day:   { bg: '#F5F5F5', ink: '#000022', accent: '#C2185B', sub: 'rgba(0,0,34,0.7)',    tileGrad: 'linear-gradient(180deg, rgba(245,245,245,0.94) 0%, rgba(245,245,245,0.6) 48%, rgba(245,245,245,0.15) 100%)', mqGrad: 'linear-gradient(100deg, rgba(245,245,245,0.96) 0%, rgba(245,245,245,0.78) 42%, rgba(245,245,245,0.12) 82%, rgba(245,245,245,0) 100%)', name: 'Neon Day', tag: 'rgba(0,0,34,0.85)' } };
// Wallpaper 3840×1250, skyline in the bottom 620px. Show the centre of the bottom band, scaled so the crop covers the box.
const bgStyle = (m, w, h) => `position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:${Math.round(3840 * (h / 700))}px; height:auto;`;
async function shot(html, w, h, out) {
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<!doctype html><html><head>${FONTS}<style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}</style></head><body>${html}</body></html>`);
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  await p.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } }); console.log(out);
}
for (const m of ['night', 'day']) {
  const c = C[m], img = wall(m);
  await shot(`<div style="width:440px;height:280px;position:relative;overflow:hidden;background:${c.bg}">
      <img src="${img}" alt="" style="${bgStyle(m, 440, 280)}">
      <div style="position:absolute;inset:0;background:${c.tileGrad}"></div>
      <div style="position:relative;padding:30px 32px;display:flex;flex-direction:column;gap:10px">
        <span style="font-family:'Space Mono',monospace;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${c.accent}">Chrome theme</span>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:52px;letter-spacing:3px;line-height:0.9;color:${c.ink}">${c.name}</span>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:3px;color:${c.sub}">SEO Bandwagon</span></div></div>`, 440, 280, `themes/store/tile-440x280-${m}.png`);
  await shot(`<div style="width:1400px;height:560px;position:relative;overflow:hidden;background:${c.bg}">
      <img src="${img}" alt="" style="${bgStyle(m, 1400, 560)}">
      <div style="position:absolute;inset:0;background:${c.mqGrad}"></div>
      <div style="position:relative;height:100%;padding:0 90px;display:flex;flex-direction:column;justify-content:center;gap:20px;max-width:820px">
        <span style="font-family:'Space Mono',monospace;font-size:14px;letter-spacing:3px;text-transform:uppercase;color:${c.accent}">Chrome theme · SEO Bandwagon</span>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:124px;letter-spacing:5px;line-height:0.86;color:${c.ink}">${c.name}</span>
        <span style="font-family:'Space Grotesk',system-ui,sans-serif;font-size:24px;line-height:1.5;color:${c.tag}">Local SEO that actually works.</span></div></div>`, 1400, 560, `themes/store/marquee-1400x560-${m}.png`);
  // Icon: rounded tile in the surface colour, skyline crop along the bottom, "SB" mark in the accent.
  await shot(`<div style="width:128px;height:128px;position:relative;overflow:hidden;border-radius:24px;background:${c.bg}">
      <img src="${img}" alt="" style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:${Math.round(3840 * (128 / 620))}px">
      <div style="position:absolute;inset:0;background:linear-gradient(180deg, ${c.bg} 0%, ${c.bg}CC 45%, transparent 100%)"></div>
      <div style="position:relative;height:100%;display:flex;align-items:flex-start;justify-content:center;padding-top:22px;font-family:'Bebas Neue',sans-serif;font-size:66px;letter-spacing:4px;line-height:1;color:${c.accent}">SB</div></div>`, 128, 128, `themes/bandwagon-neon-${m}/images/icon-128.png`);
  writeFileSync(`themes/store/icon-128-${m}.png`, readFileSync(`themes/bandwagon-neon-${m}/images/icon-128.png`));
}
await b.close();
