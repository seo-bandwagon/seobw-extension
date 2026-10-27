// The Night / Day / Auto switch (.sp-appearance) on each page that has one.
// popup.css gives it display:inline-flex, and any author `display` beats the
// browser's own [hidden] { display: none }, so until 1.9.6 the new tab's
// `hidden` (set when Neon Night or Neon Day decides the page's look) left a
// dead switch on screen. jsdom's getComputedStyle lets [hidden] win anyway and
// can't see this, so the test resolves `display` from the page's own sheets by
// importance, specificity and order, the way Chrome resolves author rules.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../../extension/src');

// [page, the switch's id, the page's own sheets after popup.css]
const PAGES = [
  ['newtab/newtab.html', 'ntAppearance', ['newtab/newtab.css']],
  ['sidepanel/sidepanel.html', 'spAppearance', []],
  ['panel/panel.html', 'pnAppearance', ['panel/panel.css']],
  ['options/options.html', 'optAppearance', []],
];

// jsdom builds style sheets only for the window's own document, so the page's
// body moves there and its <link>ed sheets come in as <style>.
function load(page, sheets) {
  const parsed = new DOMParser().parseFromString(readFileSync(path.join(SRC, page), 'utf8'), 'text/html');
  parsed.querySelectorAll('script').forEach((n) => n.remove());
  document.head.replaceChildren(...['styles/popup.css', ...sheets].map((f) => {
    const style = document.createElement('style');
    style.textContent = readFileSync(path.join(SRC, f), 'utf8');
    return style;
  }));
  document.body.replaceChildren(...[...parsed.body.childNodes].map((n) => document.adoptNode(n)));
  return document;
}

const specificity = (sel) => [
  (sel.match(/#[\w-]+/g) || []).length,
  (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length,
  (sel.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length,
];

// Compares [important, ids, classes, types, order] left to right.
function beats(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// The `display` the element's author rules give it, or null when none set one
// (then the browser's own sheet decides, and [hidden] hides it).
function authorDisplay(doc, el) {
  let best = null;
  let order = 0;
  for (const sheet of doc.styleSheets) {
    for (const rule of sheet.cssRules) {
      order++;
      const value = rule.style?.getPropertyValue('display');
      if (!value) continue;
      const rank = [rule.style.getPropertyPriority('display') === 'important' ? 1 : 0];
      for (const sel of rule.selectorText.split(',')) {
        let hit = false;
        try { hit = el.matches(sel); } catch { /* a selector jsdom can't parse */ }
        if (!hit) continue;
        const key = [...rank, ...specificity(sel.trim()), order];
        if (!best || beats(key, best.key)) best = { key, value };
      }
    }
  }
  return best && best.value;
}

describe('the appearance switch', () => {
  it.each(PAGES)('%s shows it, and hides it when hidden is set', (page, id, sheets) => {
    const doc = load(page, sheets);
    const el = doc.getElementById(id);
    expect(el.hidden).toBe(false);
    expect(authorDisplay(doc, el)).toBe('inline-flex');
    el.hidden = true;
    expect(authorDisplay(doc, el)).toBe('none');
  });
});
