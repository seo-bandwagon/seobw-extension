// Assembles the demo video rough cut from record.mjs's scenes:
// draws a browser toolbar (tab, address, the extension's icon) above each
// page, overlays the real popup under the icon while it's open, marks clicks
// with a ring, adds the storyboard's lower-third caption and (rough cut only)
// the voiceover line as a subtitle, fits each scene to its storyboard slot,
// renders the title and end cards, and concatenates to one 1920x1080 MP4 with
// a WebVTT file of the voiceover lines.
// usage: SHOOT=/tmp/shoot OUT=/tmp/cut node build.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REPO || path.resolve(HERE, '../../..');
const SHOOT = process.env.SHOOT; const OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });
const W = 1920, H = 1080, BAR = 80, FPS = 30;
const POP = { right: 16, top: BAR - 4 };
const ICON = { x: W - 44, y: 58 }; // centre of the toolbar extension icon

// Storyboard slots (STORYBOARD.md). Scene 7 needs the test account: not in this cut.
const SCENES = [
  { id: 's1', card: 'title', slot: 5, caption: 'SEO BANDWAGON · ON-PAGE SEO IN ONE CLICK', vo: "Every page has something holding it back. Here's how to find it in one click." },
  { id: 's2-analysis', slot: 11, caption: 'Score, issues and every check behind them', vo: 'Click the SEO Bandwagon icon and you get a score, the issues it found, and every check behind them: headings, links, images, speed and more.' },
  { id: 's3-link-check', slot: 11, caption: 'Every link checked. Keeps going if you close the popup', vo: 'Check every link on the page. Broken ones light up where they sit, and the check keeps running even if you close the popup.' },
  { id: 's4-indexability', slot: 10, caption: 'Indexable? Redirects? What scripts changed?', vo: 'See whether search engines may index a page, the redirects that led there, and what changed after scripts ran.' },
  { id: 's5-structured-data', slot: 8, caption: 'Structured data, checked by type', vo: 'Structured data is checked against what each type needs, so you know which rich results a page qualifies for.' },
  { id: 's6-google', slot: 12, caption: 'On Google itself: copy or export the results', vo: 'On Google itself, each result gets a bar, and one click copies the results or the People Also Ask questions, or exports them to a spreadsheet.' },
  { id: 's8-privacy', slot: 6, caption: 'Free. No account needed for the checks', vo: 'No account is needed for the checks, and signed out, nothing is sent.' },
  { id: 's9', card: 'end', slot: 5, caption: 'FREE ON THE CHROME WEB STORE', vo: 'SEO Bandwagon. Free on the Chrome Web Store.' },
];

const FD = path.join(REPO, 'extension/src/styles/fonts/');
const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(FD + f).toString('base64');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(REPO, 'extension/src/icons/icon48.png')).toString('base64');
const FONTS = `@font-face{font-family:Bebas;src:url(${font('bebas-neue-400.woff2')})}
@font-face{font-family:Grotesk;src:url(${font('space-grotesk-400-700.woff2')});font-weight:400 700}
@font-face{font-family:Mono;src:url(${font('space-mono-700.woff2')});font-weight:700}
*{margin:0;box-sizing:border-box}`;
const BRAND_BG = 'background:radial-gradient(120% 90% at 85% 10%,#1a0a3a 0%,#000022 55%,#000011 100%)';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

// ---------- stills (toolbar, captions, cards, ring) ----------
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true });
const pg = await browser.newPage();
async function still(file, w, h, html, transparent = false) {
  await pg.setViewport({ width: w, height: h });
  await pg.setContent(`<style>${FONTS}</style>${html}`); await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: path.join(OUT, file), omitBackground: transparent });
  return path.join(OUT, file);
}
const toolbar = (url, title) => still(`toolbar-${Buffer.from(url).toString('base64url').slice(-24)}.png`, W, BAR, `
  <body style="width:${W}px;height:${BAR}px;background:#1f1f2b;font-family:Arial,Helvetica,sans-serif">
  <div style="height:36px;background:#14141c;display:flex;align-items:flex-end;padding-left:12px">
    <div style="height:30px;width:280px;background:#1f1f2b;border-radius:8px 8px 0 0;color:#e8e8ee;font-size:13px;display:flex;align-items:center;padding:0 12px;overflow:hidden;white-space:nowrap">${esc(title).slice(0, 34)}</div></div>
  <div style="height:44px;display:flex;align-items:center;gap:12px;padding:0 14px">
    <span style="color:#9aa0a6;font-size:18px;letter-spacing:6px">‹ › ⟳</span>
    <div style="flex:1;height:32px;border-radius:16px;background:#2d2d3a;color:#e8e8ee;font-size:15px;display:flex;align-items:center;padding:0 16px">${esc(url.replace(/^https?:\/\//, ''))}</div>
    <img src="${icon}" style="width:26px;height:26px;margin:0 4px 0 6px"></div></body>`);
const ring = await still('ring.png', 90, 90, `<body style="width:90px;height:90px;background:transparent;display:grid;place-items:center">
  <div style="width:62px;height:62px;border-radius:50%;border:5px solid #F53796;box-shadow:0 0 0 6px rgba(245,55,150,.25)"></div></body>`, true);
async function caption(s) {
  return still(`caption-${s.id}.png`, W, H, `<body style="width:${W}px;height:${H}px;background:transparent;font-family:Grotesk;position:relative">
    <div style="position:absolute;left:56px;bottom:${s.card ? 140 : 118}px;background:rgba(0,0,34,.88);border-left:6px solid #F53796;padding:14px 22px;border-radius:4px">
      <div style="font-family:Bebas;font-size:40px;letter-spacing:.02em;color:#f5f5f5">${esc(s.caption)}</div></div>
    <div style="position:absolute;left:0;right:0;bottom:26px;text-align:center"><span style="background:rgba(0,0,0,.72);color:#fff;font-size:24px;padding:6px 14px;border-radius:4px;line-height:1.5">${esc(s.vo)}</span></div>
    <div style="position:absolute;left:20px;top:${BAR + 12}px;font-family:Mono;font-size:13px;letter-spacing:.14em;color:rgba(255,255,255,.55)">ROUGH CUT · NO VOICE YET</div></body>`, true);
}
async function card(s) {
  const big = s.card === 'title'
    ? `<div style="font-family:Mono;font-size:22px;letter-spacing:.18em;color:#F53796;display:flex;align-items:center;gap:16px"><span style="width:52px;height:52px;border-radius:10px;background:#F53796;color:#000022;font-family:Bebas;font-size:30px;display:grid;place-items:center">SB</span>SEO BANDWAGON</div>
       <h1 style="font-family:Bebas;font-weight:400;font-size:150px;line-height:.92;margin-top:26px">On-page SEO<br><span style="color:#F53796">in one click</span></h1>`
    : `<div style="font-family:Mono;font-size:22px;letter-spacing:.18em;color:#F53796;display:flex;align-items:center;gap:16px"><span style="width:52px;height:52px;border-radius:10px;background:#F53796;color:#000022;font-family:Bebas;font-size:30px;display:grid;place-items:center">SB</span>SEO BANDWAGON</div>
       <h1 style="font-family:Bebas;font-weight:400;font-size:132px;line-height:.92;margin-top:26px">Free on the<br><span style="color:#F53796">Chrome Web Store</span></h1>
       <p style="font-size:30px;color:rgba(245,245,245,.8);margin-top:28px">seobandwagon.com/seo-chrome-extension</p>`;
  return still(`card-${s.card}.png`, W, H, `<body style="width:${W}px;height:${H}px;${BRAND_BG};color:#f5f5f5;font-family:Grotesk;position:relative">
    <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(245,55,150,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(245,55,150,.07) 1px,transparent 1px);background-size:48px 48px"></div>
    <div style="position:absolute;left:150px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center">${big}</div></body>`);
}

// ---------- per-scene clips ----------
// Screencast frames arrive only when something changes, at irregular times:
// resample them to a constant 30 fps by linking, for every output frame, the
// latest captured frame (the concat demuxer rounds short image durations up).
function streamVideo(sceneDir, s, outFile) {
  const seq = outFile + '.seq'; fs.rmSync(seq, { recursive: true, force: true }); fs.mkdirSync(seq);
  const n = Math.max(1, Math.round((s.end - s.start) * FPS)); let j = 0;
  for (let i = 0; i < n; i++) {
    const t = s.start + i / FPS;
    while (j + 1 < s.frames.length && s.frames[j + 1].t <= t) j++;
    fs.symlinkSync(path.join(sceneDir, s.dir, s.frames[j].file), path.join(seq, String(i).padStart(6, '0') + '.jpg'));
  }
  ff(['-framerate', String(FPS), '-i', path.join(seq, '%06d.jpg'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', outFile]);
  fs.rmSync(seq, { recursive: true, force: true });
  return outFile;
}
const ENC = ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

async function screenScene(s) {
  const dir = path.join(SHOOT, s.id); const sc = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
  const D = sc.duration;
  const inputs = []; const filters = []; let cur = 'base';
  const add = (args) => { inputs.push(...args); return inputs.filter((a) => a === '-i').length - 1; };
  filters.push(`color=c=#0b0b12:s=${W}x${H}:r=${FPS}:d=${D.toFixed(3)}[base]`);
  // toolbars, one per address shown
  const urls = sc.events.filter((e) => e.name === 'url');
  for (let i = 0; i < urls.length; i++) {
    const a = urls[i].t, b = i + 1 < urls.length ? urls[i + 1].t : D;
    const k = add(['-loop', '1', '-t', D.toFixed(3), '-i', await toolbar(urls[i].url, urls[i].title || urls[i].url)]);
    filters.push(`[${cur}][${k}:v]overlay=0:0:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[v${k}]`); cur = `v${k}`;
  }
  // page and popups
  const pops = {};
  for (const st of sc.streams) {
    const vid = streamVideo(dir, st, path.join(OUT, `${s.id}-${st.dir}.mp4`));
    const k = add(['-i', vid]);
    if (st.kind === 'page') {
      filters.push(`[${k}:v]setpts=PTS-STARTPTS+${st.start.toFixed(3)}/TB[p${k}]`, `[${cur}][p${k}]overlay=0:${BAR}:eof_action=repeat[v${k}]`);
    } else {
      // Crop to the popup shell and bring it to the page's scale (see record.mjs).
      const z = (sc.scale || 1) / (st.size.dpr || 1), cw = Math.round((st.size.shell || st.size.w / (st.size.dpr || 1)) * (st.size.dpr || 1));
      const pw = Math.round(cw * z), x = W - pw - POP.right, y = POP.top; pops[st.dir] = { x, y, cz: (st.size.dpr || 1) * z }; // clicks: CSS px → video px
      filters.push(`[${k}:v]crop=${cw}:ih:0:0,scale=${pw}:-2:flags=lanczos,setpts=PTS-STARTPTS+${st.start.toFixed(3)}/TB[p${k}]`,
        `[${cur}][p${k}]overlay=${x}:${y}:eof_action=pass:enable='between(t,${st.start.toFixed(3)},${st.end.toFixed(3)})'[v${k}]`);
    }
    cur = `v${k}`;
  }
  // click rings
  const k1 = sc.scale || 1; // clicks are logged in CSS pixels
  for (const e of sc.events.filter((e) => e.name === 'click')) {
    let x, y;
    if (e.on === 'toolbar-icon') ({ x, y } = ICON);
    else if (e.on === 'popup') { const p = pops[e.stream] || { x: W - 900, y: POP.top }; x = p.x + e.x * (p.cz || k1); y = p.y + e.y * (p.cz || k1); }
    else { x = e.x * k1; y = BAR + e.y * k1; }
    const k = add(['-loop', '1', '-t', D.toFixed(3), '-i', ring]);
    filters.push(`[${cur}][${k}:v]overlay=${Math.round(x - 45)}:${Math.round(y - 45)}:enable='between(t,${e.t.toFixed(3)},${(e.t + 0.7).toFixed(3)})'[v${k}]`); cur = `v${k}`;
  }
  // caption, then fit to the slot
  const kc = add(['-loop', '1', '-t', D.toFixed(3), '-i', await caption(s)]);
  filters.push(`[${cur}][${kc}:v]overlay=0:0,scale=in_range=pc:out_range=tv,format=yuv420p[vc]`);
  const f = D / s.slot;
  filters.push(f > 1 ? `[vc]setpts=PTS/${f.toFixed(4)},fps=${FPS}[out]` : `[vc]tpad=stop_mode=clone:stop_duration=${(s.slot - D).toFixed(3)}[out]`);
  const out = path.join(OUT, `clip-${s.id}.mp4`);
  ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-t', String(s.slot), ...ENC, '-an', out]);
  console.log(`${s.id}: ${D.toFixed(1)} s recorded → ${s.slot} s (×${f.toFixed(2)})`);
  return out;
}
async function cardScene(s) {
  const out = path.join(OUT, `clip-${s.id}.mp4`);
  ff(['-loop', '1', '-t', String(s.slot), '-i', await card(s), '-loop', '1', '-t', String(s.slot), '-i', await caption(s),
    '-filter_complex', `[0:v][1:v]overlay=0:0,fade=t=in:st=0:d=0.4,fade=t=out:st=${s.slot - 0.4}:d=0.4[out]`, '-map', '[out]', ...ENC, '-an', out]);
  console.log(`${s.id}: card ${s.slot} s`); return out;
}

const clips = [];
for (const s of SCENES) clips.push(s.card ? await cardScene(s) : await screenScene(s));
await browser.close();

fs.writeFileSync(path.join(OUT, 'clips.txt'), clips.map((c) => `file '${c}'`).join('\n') + '\n');
const final = path.join(OUT, 'seobw-demo-rough-cut.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'clips.txt'), '-c', 'copy', '-movflags', '+faststart', final]);

// WebVTT of the voiceover lines at their scene slots (re-timed to the recorded voice later)
let t = 0; const ts = (x) => new Date(x * 1000).toISOString().slice(11, 23);
const vtt = ['WEBVTT', ''];
for (const s of SCENES) { vtt.push(`${ts(t + 0.2)} --> ${ts(t + s.slot - 0.2)}`, s.vo, ''); t += s.slot; }
fs.writeFileSync(path.join(OUT, 'seobw-demo-rough-cut.en.vtt'), vtt.join('\n'));
console.log(`rough cut: ${final} (${t} s)`);
