// 1.14.0: the Your data page (src/lib/your-data.js, src/your-data/). It must
// say what the code does: a row for every flow the consent module gates,
// each with the switch every send checks, and the sync storage it describes
// must be the only sync storage the extension writes.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const C = require('../../extension/src/lib/consent.js');
const Y = require('../../extension/src/lib/your-data.js');
const SRC = path.resolve(__dirname, '../../extension/src');
const LIB = path.resolve(__dirname, '../../extension/lib');

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) jsFiles(full, out);
    else if (/\.js$/.test(name)) out.push(full);
  }
  return out;
}

function allText() {
  const rows = [...Y.ON_DEVICE, ...Y.ON_CLICK, ...Y.VISITS, ...Y.KEPT];
  return rows.map((r) => `${r.title} ${r.text} ${r.to || ''}`)
    .concat(Y.flowRows().map((r) => `${r.title} ${r.sends} ${r.why} ${r.to} ${r.switch.label}`))
    .concat(Y.SYNCED.items, [Y.SYNCED.text])
    .join('\n');
}

describe('what is sent: one row per consent flow, with its switch', () => {
  it('has a row for every flow in consent.js, in its words', () => {
    const rows = Y.flowRows();
    expect(rows.map((r) => r.name)).toEqual(Object.keys(C.FLOWS));
    for (const r of rows) {
      expect(r.sends).toBe(C.FLOWS[r.name].sends);
      expect(r.why).toBe(C.FLOWS[r.name].why);
      expect(r.to).toMatch(/seobandwagon\.com/);
      expect(Y.SWITCHES[r.name]).toBeDefined();
    }
  });

  it('gives each flow the switch its sends check', () => {
    // Saved analyses: the "Send analyses" switch, the one consent.js reads.
    expect(Y.SWITCHES.captureSync.kind).toBe('dataCollection');
    expect(C.FLOWS.captureSync.chromeSwitch.key).toBe('dataCollection');
    // Every flow accepted with a specific action: its own yes in consent.js.
    for (const [name, flow] of Object.entries(C.FLOWS)) {
      if (flow.acceptedBy === 'action') expect(Y.SWITCHES[name].kind).toBe('consent');
    }
  });

  it('names the click-only sends and the two pages the extension opens', () => {
    expect(Y.ON_CLICK.map((r) => r.id)).toEqual(['citation', 'outlet', 'key']);
    expect(Y.ON_CLICK.find((r) => r.id === 'citation').text).toMatch(/Never the screenshot/);
    expect(Y.VISITS.map((r) => r.id)).toEqual(['welcome', 'survey']);
  });
});

describe('what seobandwagon.com keeps, as seobandwagon.com/privacy says', () => {
  it('says how long each is kept', () => {
    const kept = Object.fromEntries(Y.KEPT.map((r) => [r.id, r.text]));
    expect(kept.captures).toMatch(/until you ask us to delete them at info@seobandwagon\.com/);
    expect(kept.figures).toMatch(/30 days/);
    expect(kept.figures).toMatch(/without who asked/);
    expect(kept.keywords).toMatch(/30 days, then deleted/);
    expect(kept.study).toMatch(/study code/);
  });
});

describe('what the browser syncs', () => {
  it('is the key and the API address: the only two values the extension writes to storage.sync', () => {
    expect(Y.SYNCED.items).toHaveLength(2);
    const keys = new Set();
    for (const file of jsFiles(SRC).concat(jsFiles(LIB))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/storage\.sync\.set\(\s*\{\s*([A-Za-z_$][\w$]*)\s*[:,}]/g)) keys.add(m[1]);
      expect(text).not.toMatch(/storage\.sync\.set\(\s*[^{\s]/);
    }
    expect([...keys].sort()).toEqual(['apiKey', 'apiUrl']);
  });
});

describe('the words', () => {
  it('name no browser, so every package can show them', () => {
    expect(allText()).not.toMatch(/\b(Chrome|Firefox|Edge|Safari)\b/);
  });

  it('are American English', () => {
    expect(allText()).not.toMatch(/\b(colour|behaviour|recognis|organis|optimis|favour|honour|centre|licence\b)/i);
  });

  it('the page loads what it draws with, and the privacy link is tagged', () => {
    const html = readFileSync(path.join(SRC, 'your-data/your-data.html'), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts.indexOf('../lib/consent.js')).toBeLessThan(scripts.indexOf('../lib/your-data.js'));
    expect(scripts.indexOf('../lib/api.js')).toBeLessThan(scripts.indexOf('your-data.js'));
    expect(scripts[scripts.length - 1]).toBe('your-data.js');
    expect(html).toMatch(/href="https:\/\/seobandwagon\.com\/privacy\?utm_source=chrome_extension&amp;utm_medium=extension&amp;utm_campaign=your_data"/);
  });

  it('is linked from the popup footer, Settings, the guide and About', () => {
    const popup = readFileSync(path.join(SRC, 'popup/popup.html'), 'utf8');
    const options = readFileSync(path.join(SRC, 'options/options.html'), 'utf8');
    const guide = readFileSync(path.join(SRC, 'popup/guide.js'), 'utf8');
    const about = readFileSync(path.join(SRC, 'popup/structured-data.js'), 'utf8');
    for (const text of [popup, options, about]) expect(text).toContain('href="../your-data/your-data.html"');
    expect(guide).toContain("'../your-data/your-data.html'");
  });
});
