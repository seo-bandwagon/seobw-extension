// 1.13.8: "Count words & characters" counts the selection (src/lib/text-count.js).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

await import('../../extension/src/lib/text-count.js');
const T = globalThis.SBWTextCount;
const require = createRequire(import.meta.url);
const A = require('../../extension/lib/content-analysis.js');

describe('countText', () => {
  it('counts words, characters and sentences', () => {
    expect(T.countText('  Roof repair in Denver.  Call today!  ')).toEqual({ characters: 34, charactersNoSpaces: 29, words: 6, sentences: 2, readingTimeMin: 1 });
    expect(T.countText('')).toEqual({ characters: 0, charactersNoSpaces: 0, words: 0, sentences: 0, readingTimeMin: 1 });
  });

  it('counts words as the page analysis does, in any language', () => {
    const samples = [
      "Don't e-mail the U.S office about $5.99 or 1,000 units.",
      'Ремонт крыши в Денвере — звоните сегодня',
      '東京で屋根の修理をします',
      'บริการซ่อมหลังคา',
      'roofing — 🏠 ✓ repair'
    ];
    samples.forEach((s) => expect(T.wordCount(s)).toBe(A.getWords(A.cleanText(s)).length));
    expect(T.wordCount('東京で屋根の修理をします')).toBeGreaterThan(1);
  });
});

describe('readSelection', () => {
  it('reads the page selection', () => {
    document.body.innerHTML = '<p id="p">Roof repair in Denver</p>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    expect(T.readSelection()).toBe('Roof repair in Denver');
  });

  it('reads a selection inside a text box, which the page selection leaves out', () => {
    document.body.innerHTML = '<textarea id="t">one two three four</textarea>';
    const t = document.getElementById('t');
    t.focus();
    t.setSelectionRange(4, 13);
    expect(T.readSelection()).toBe('two three');
  });
});
