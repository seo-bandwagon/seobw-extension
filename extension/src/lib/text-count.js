// SEO Bandwagon — "Count words & characters" (1.13.8)
//
// The right-click menu's count of the selected text. Until 1.13.8 the worker
// injected the whole analyzer and asked it for the top frame's selection, so
// a selection in a frame or in a text box counted nothing, and the injected
// analyzer then showed a word-count tooltip on every selection on that page.
// The worker now reads the selection where the menu was opened
// (readSelection, injected into that frame) and counts it here.
//
// Words are counted as the page analysis counts them (lib/content-analysis.js
// getWords: letters, marks and digits of every script; Chinese, Japanese,
// Thai and the like split with Intl.Segmenter), so a selection in any
// language counts. tests/unit/text-count.test.js holds the two together.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') globalThis.SBWTextCount = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(function () {
  'use strict';

  const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-.][\p{L}\p{M}\p{N}]+|(?<=\p{N}),\p{N}+)*/gu;
  const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
  let segmenter;

  function wordCount(text) {
    let n = 0;
    (String(text || '').match(WORD_RE) || []).forEach((token) => {
      if (!UNSPACED.test(token)) { n++; return; }
      if (segmenter === undefined) {
        try { segmenter = new Intl.Segmenter(undefined, { granularity: 'word' }); } catch (e) { segmenter = null; }
      }
      if (!segmenter) { n += token.length; return; }
      for (const s of segmenter.segment(token)) if (s.isWordLike) n++;
    });
    return n;
  }

  // { characters, charactersNoSpaces, words, sentences, readingTimeMin }
  function countText(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    const words = wordCount(cleaned);
    return {
      characters: cleaned.length,
      charactersNoSpaces: cleaned.replace(/\s/g, '').length,
      words,
      sentences: cleaned ? (cleaned.match(/[.!?。！？؟।]+(\s|$)/g) || []).length : 0,
      readingTimeMin: Math.max(1, Math.ceil(words / 238))
    };
  }

  // Injected into the frame the menu was opened in, so it must stand alone.
  // A selection inside a text box isn't part of the page's selection.
  function readSelection() {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && typeof el.selectionStart === 'number' && el.selectionEnd > el.selectionStart) {
      try { return String(el.value).slice(el.selectionStart, el.selectionEnd); } catch (e) { /* not a text input */ }
    }
    const sel = window.getSelection && window.getSelection();
    return sel ? sel.toString() : '';
  }

  return { countText, wordCount, readSelection };
});
