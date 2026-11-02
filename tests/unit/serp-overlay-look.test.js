// The overlay's look (1.11.0, src/overlay/serp-overlay.css): every text
// colour of each look meets WCAG AA (4.5:1) on its ground, Bandwagon Pink is
// never the ground behind text, and nothing styles Google's own elements.
// The tokens are read from the stylesheet itself, so a changed colour is
// checked here before it ships.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../extension/src/overlay/serp-overlay.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function rgb(value) {
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  return null;
}

const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
function lum(c) {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function tokens(selectorStart) {
  const block = css.split('}').find((b) => b.trim().startsWith(selectorStart));
  return Object.fromEntries([...block.matchAll(/--(sbw-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const base = tokens('.sbw-serp-bar,\n.sbw-serp-analysis');
const LOOKS = {
  dark: { tokens: base, grounds: [null] },
  light: { tokens: Object.assign({}, base, tokens('.sbw-serp-bar[data-sbw-look="light"]')), grounds: [null] },
  // Match Google is transparent: it sits on Google's own ground.
  'google-light': { tokens: Object.assign({}, base, tokens('.sbw-serp-bar[data-sbw-look="google-light"]')), grounds: ['#FFFFFF'] },
  'google-dark': { tokens: Object.assign({}, base, tokens('.sbw-serp-bar[data-sbw-look="google-dark"]')), grounds: ['#1F1F1F', '#202124'] }
};

describe('every look meets WCAG AA', () => {
  Object.entries(LOOKS).forEach(([name, look]) => {
    look.grounds.forEach((groundHex) => {
      const ground = groundHex ? rgb(groundHex).slice(0, 3) : rgb(look.tokens['sbw-surface']).slice(0, 3);
      ['sbw-ink', 'sbw-muted', 'sbw-accent-text'].forEach((token) => {
        it(`${name}${groundHex ? ' on ' + groundHex : ''}: ${token} is at least 4.5:1`, () => {
          const fg = over(rgb(look.tokens[token]), ground);
          expect(contrast(fg, ground)).toBeGreaterThanOrEqual(4.5);
        });
      });
    });
  });

  it('the Analyze label is the text colour on the bar\'s own ground, not white on pink (3.3:1 in 1.10.x)', () => {
    const rule = /\n\.sbw-serp-analyze\s*\{([^}]*)\}/.exec(css)[1];
    expect(rule).toMatch(/color:\s*var\(--sbw-ink\)/);
    expect(rule).toMatch(/background:\s*transparent/);
  });
});

describe('the brand and Google\'s page', () => {
  it('never puts Bandwagon Pink behind text', () => {
    const backgrounds = [...css.matchAll(/background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1]);
    backgrounds.forEach((b) => {
      expect(b).not.toMatch(/var\(--sbw-accent\)|#F53796|#FF4AA5/i);
    });
  });

  it('styles only its own elements: every selector starts with one of ours, and nothing is !important', () => {
    expect(css).not.toMatch(/!important/);
    const selectors = css.replace(/@media[^{]*\{/g, '').split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
    selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).forEach((s) => {
      expect(s).toMatch(/^\.sbw-/);
    });
  });

  it('keeps every token on our own elements, never on :root', () => {
    expect(css).not.toMatch(/(^|[\s,}])(:root|html|body)\s*\{/);
  });
});
