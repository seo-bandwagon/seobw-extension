// Lays the raw captures (shots.mjs) on the 1280x800 brand frame, plus the two
// promo tiles. Same frame as store-assets/1.6.1/capture/compose.cjs; fonts are
// the ones bundled in extension/src/styles/fonts/.
// usage: RAW=/tmp/raw OUT=store-assets/1.7.7 node compose.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = process.env.RAW; const OUT = process.env.OUT || path.join(REPO, 'store-assets/1.7.7');
const FD = path.join(REPO, 'extension/src/styles/fonts/');
const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(FD + f).toString('base64');
const img = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(RAW, f)).toString('base64');
const css = `
@font-face{font-family:Bebas;src:url(${font('bebas-neue-400.woff2')})}
@font-face{font-family:Grotesk;src:url(${font('space-grotesk-400-700.woff2')});font-weight:400 700}
@font-face{font-family:Mono;src:url(${font('space-mono-700.woff2')});font-weight:700}
*{margin:0;box-sizing:border-box}
body{width:WIDTHpx;height:HEIGHTpx;overflow:hidden;background:radial-gradient(120% 90% at 85% 10%,#1a0a3a 0%,#000022 55%,#000011 100%);color:#f5f5f5;font-family:Grotesk}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(245,55,150,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(245,55,150,.07) 1px,transparent 1px);background-size:40px 40px;mask-image:linear-gradient(90deg,transparent,#000 60%)}
.text{position:absolute;left:64px;top:0;bottom:0;width:var(--tw);display:flex;flex-direction:column;justify-content:center;gap:18px}
.eyebrow{font-family:Mono;font-weight:700;font-size:15px;letter-spacing:.18em;color:#F53796;display:flex;align-items:center;gap:12px}
.mark{width:34px;height:34px;border-radius:7px;background:#F53796;color:#000022;font-family:Bebas;font-size:20px;display:grid;place-items:center;letter-spacing:0}
h1{font-family:Bebas;font-weight:400;font-size:var(--h);line-height:.95;letter-spacing:.01em}
h1 em{font-style:normal;color:#F53796}
p{font-size:20px;line-height:1.45;color:rgba(245,245,245,.78);max-width:var(--tw)}
.free{font-family:Mono;font-weight:700;font-size:13px;letter-spacing:.14em;color:#000022;background:#F53796;align-self:flex-start;padding:6px 10px;border-radius:4px}
.shots{position:absolute;right:var(--r);top:0;bottom:0;display:flex;align-items:center;gap:24px}
.stack{display:flex;flex-direction:column;align-items:flex-end;gap:18px}
.shots img{display:block;border-radius:12px;border:1px solid rgba(245,55,150,.35);box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 6px rgba(245,55,150,.06)}
`;
const im = (f, h, w) => `<img src="${img(f)}" style="${h ? `height:${h}px` : `width:${w}px`}">`;
const shots = [
  { f: '1-analysis', imgs: im('analysis-ui.png', 560), h1: 'Score any page in <em>one click</em>', p: 'A 0 to 100 score with four sub-scores and the issues it found, with every check behind them. No account needed.' },
  { f: '2-link-check', imgs: im('lc-ui.png', 540), tw: 430, h1: 'Check every <em>link</em> on the page', p: 'Groups each link by outcome and highlights broken ones on the page. A check keeps running when the popup closes, and links Chrome won’t let it open read “Can’t check”.' },
  { f: '3-indexability', imgs: im('ix-ui.png', 560), h1: 'See what a <em>crawler</em> sees', p: 'Redirect chain, response headers, X-Robots-Tag and an indexability verdict, for this page or any address you trace.' },
  { f: '4-serp-overlay', imgs: `<div class="stack">${im('serp-results.png', null, 660)}${im('serp-toolbar.png', null, 560)}</div>`, tw: 410, h1: 'Stats on Google’s <em>own results</em>', p: 'A bar under each organic result. Copy the results or the People Also Ask questions in one click, or export them with each result’s description and breadcrumb.' },
  { f: '5-night-day', imgs: im('panel-night-ui.png', 700) + im('panel-day-ui.png', 700), tw: 380, r: 48, h1: '<em>Night</em> or <em>Day</em>', p: 'The page-checks panel, popup and settings follow your choice, with two matching Chrome themes.' },
];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true });
try {
  const pg = await browser.newPage(); await pg.setViewport({ width: 1280, height: 800 });
  for (const s of shots) {
    const html = `<style>${css.replace('WIDTH', 1280).replace('HEIGHT', 800)}</style><body style="--tw:${s.tw || 460}px;--h:${s.h || 76}px;--r:${s.r || 72}px"><div class="grid"></div>
      <div class="text"><div class="eyebrow"><span class="mark">SB</span>SEO BANDWAGON</div><h1>${s.h1}</h1><p>${s.p}</p><span class="free">FREE CHROME EXTENSION</span></div>
      <div class="shots">${s.imgs}</div></body>`;
    await pg.setContent(html); await pg.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 300));
    await pg.screenshot({ path: path.join(OUT, `screenshot-${s.f}-1280x800.png`) });
  }
  const tiles = [
    { f: 'tile-440x280', w: 440, h: 280, html: `<div class="text" style="left:32px;width:380px;gap:12px"><div class="eyebrow" style="font-size:12px"><span class="mark">SB</span>SEO BANDWAGON</div><h1 style="font-size:48px">On-page SEO in <em>one click</em></h1><span class="free" style="font-size:11px">FREE · NO ACCOUNT</span></div>` },
    { f: 'marquee-1400x560', w: 1400, h: 560, html: `<div class="text" style="width:430px"><div class="eyebrow"><span class="mark">SB</span>SEO BANDWAGON</div><h1 style="font-size:80px">On-page SEO <em>in one click</em></h1><p style="font-size:19px;max-width:430px">Scores the page, checks every link, and shows what crawlers and Google’s results see. Free, no account.</p></div><div class="shots" style="right:56px">${im('analysis-ui.png', 360)}${im('lc-ui.png', 360)}</div>` },
  ];
  for (const t of tiles) {
    await pg.setViewport({ width: t.w, height: t.h });
    await pg.setContent(`<style>${css.replace('WIDTH', t.w).replace('HEIGHT', t.h)}</style><body style="--tw:560px;--h:76px;--r:72px"><div class="grid"></div>${t.html}</body>`);
    await pg.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 300));
    await pg.screenshot({ path: path.join(OUT, `promo-${t.f}.png`) });
  }
  console.log('composed:', fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).join(', '));
} finally { await browser.close(); }
