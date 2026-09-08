// SEO Bandwagon — the four sub-scores, in one place
//
// The 14 checks behind "Meta / Content / Links / Tech" and the popup's
// "N of M checks" line. This used to live inline in src/popup/popup.js as
// computeSubScores(); it moved here so the themed surfaces can show the same
// numbers without a second copy of the thresholds. A copy is how a surface
// starts quietly disagreeing with the popup about the same page.
//
// Group sizes are derived from the checks themselves (`of` is returned, never
// typed at a call site), so adding a check here changes every surface at once.
//
// Pure: no DOM, no chrome, no network. Dual-export pattern (see src/lib/csv.js):
// attaches to `globalThis.SBWSubScores` when loaded as a classic <script>, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSubScores = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const pct = (passed, total) => (total ? Math.round((passed / total) * 100) : 0);

  /**
   * The four groups for an analyzer result.
   * `[{ k, passed, of, v }]` — `v` is the percentage the popup ring shows,
   * `passed`/`of` are what "N of M checks" is summed from.
   *
   * Content's depth check is deliberately worth a half: 600+ words scores it
   * fully, 300–599 scores half, below 300 scores nothing. That is why
   * `passed` can be fractional and the total is rounded once, at the end.
   */
  function computeSubScores(data) {
    const d = data || {};
    const m = d.meta || {};
    const c = d.content || {};
    const h = d.headings || {};
    const l = d.links || {};
    const t = d.technical || {};
    const img = d.images || {};

    // META — title, description, canonical, Open Graph, schema
    let metaPass = 0;
    if (m.title && m.title.text && m.title.length >= 30 && m.title.length <= 60) metaPass++;
    if (m.description && m.description.text && m.description.length >= 120 && m.description.length <= 160) metaPass++;
    if (m.canonical) metaPass++;
    if (m.openGraph && m.openGraph.title) metaPass++;
    if (m.schema && m.schema.length > 0) metaPass++;

    // CONTENT — depth, readability, single H1
    let contentPass = 0;
    if ((c.wordCount || 0) >= 600) contentPass++;
    else if ((c.wordCount || 0) >= 300) contentPass += 0.5;
    if (c.readability && c.readability.fleschKincaid <= 14) contentPass++;
    if (h.h1 && h.h1.length === 1) contentPass++;

    // LINKS — internal depth, external presence, images with alt
    let linksPass = 0;
    if (((l.internal && l.internal.count) || 0) >= 3) linksPass++;
    if (((l.external && l.external.count) || 0) > 0) linksPass++;
    if (!img.total || ((img.missingAlt && img.missingAlt.count) || 0) === 0) linksPass++;

    // TECH — DOM size, https, no mixed content
    let techPass = 0;
    if ((t.domElements || 0) <= 2000) techPass++;
    if (String(d.url || '').startsWith('https://')) techPass++;
    if (!d.mixedContent || d.mixedContent.mixedCount === 0) techPass++;

    return [
      { k: 'Meta', passed: metaPass, of: 5, v: pct(metaPass, 5) },
      { k: 'Content', passed: contentPass, of: 3, v: pct(contentPass, 3) },
      { k: 'Links', passed: linksPass, of: 3, v: pct(linksPass, 3) },
      { k: 'Tech', passed: techPass, of: 3, v: pct(techPass, 3) }
    ];
  }

  /** `{ passed, of }` across all four groups — the "N of M checks" line. */
  function checkTotals(data) {
    const groups = computeSubScores(data);
    return {
      passed: Math.round(groups.reduce((n, g) => n + g.passed, 0)),
      of: groups.reduce((n, g) => n + g.of, 0)
    };
  }

  return {
    computeSubScores,
    checkTotals
  };
});
