// SEO Bandwagon — one Google result's page checks, from its HTML (1.12.0)
//
// Analyze on Google (owner, 2026-11-01: "Stay on Google") opens a row under
// the result with that page's checks. The worker fetches the page's HTML
// (without the user's cookies) and this turns the parsed Document into the
// row: the same analyzer the popup runs (SEOBWAnalysis.analyzeDocument, which
// 1.10.4 made work on a parsed document), the same structured-data and
// hreflang readers, Google's title and description widths in pixels
// (SBWSerpPreview), plus what only the fetch knows: the status, where it
// redirected, and the X-Robots-Tag header. It runs in the offscreen document
// on Chrome and Edge, and in the background page on Firefox.
//
// It is the page's HTML, not the page as a browser draws it: no scripts run,
// so a page built by JavaScript reads thin here; "Full report" opens it for
// the rendered analysis.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWPageRow` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWPageRow = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const g = globalThis;

  // Directives that carry a value after a colon; any other "name:" starts
  // the directives of a crawler ("googlebot: noindex").
  const VALUE_DIRECTIVES = ['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after'];

  function noindexHeader(headers) {
    const value = String((headers && headers['x-robots-tag']) || '').toLowerCase();
    let agent = null;
    let noindex = false;
    value.split(',').forEach((raw) => {
      let token = raw.trim();
      const m = /^([a-z0-9_-]+)\s*:\s*(.*)$/.exec(token);
      if (m && !VALUE_DIRECTIVES.includes(m[1])) {
        agent = m[1];
        token = m[2].trim();
      }
      if ((token === 'noindex' || token === 'none') && (!agent || agent === 'googlebot')) noindex = true;
    });
    return noindex;
  }

  // The page's address without tracking parameters (srsltid=, utm_…), as
  // Google links many results: its canonical names the page without them,
  // which is the page itself, not "elsewhere".
  function withoutTracking(url) {
    try {
      const u = new URL(url);
      [...u.searchParams.keys()].forEach((k) => {
        if (/^(utm_[a-z_]+|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|yclid|srsltid|_ga|_gl|mc_cid|mc_eid)$/i.test(k)) u.searchParams.delete(k);
      });
      u.hash = '';
      return u.href;
    } catch (e) {
      return url;
    }
  }

  /**
   * Whether search engines may index the page, and why not:
   * `{ ok, reasons: [...] }`. Reasons: a status other than 2xx, the robots
   * or googlebot meta, the X-Robots-Tag header, a canonical elsewhere (which
   * asks Google to index that page instead).
   */
  function indexable(meta, fetchInfo) {
    const reasons = [];
    const status = fetchInfo && fetchInfo.status;
    if (typeof status === 'number' && (status < 200 || status > 299)) reasons.push(`status ${status}`);
    if (meta && meta.noindex) reasons.push(`noindex in the ${meta.noindexSource || 'robots'} meta`);
    if (noindexHeader(fetchInfo && fetchInfo.headers)) reasons.push('noindex in the X-Robots-Tag header');
    if (meta && meta.canonicalTarget === 'elsewhere') reasons.push('canonical points elsewhere');
    return { ok: reasons.length === 0, reasons };
  }

  function schemaTypes(doc) {
    const S = g.SBWSchema;
    if (!S) return [];
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent);
    let items = [];
    try {
      items = [].concat(S.extractJsonLd(scripts), S.extractMicrodata(doc), S.extractRdfa(doc));
    } catch (e) { items = []; }
    const types = [];
    items.forEach((item) => {
      const t = item && (item.type || (item['@type']));
      [].concat(t || []).forEach((name) => {
        const n = String(name).replace(/^https?:\/\/schema\.org\//, '');
        if (n && !types.includes(n)) types.push(n);
      });
    });
    return types;
  }

  function hreflang(doc, url) {
    const raw = Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))
      .map((el) => ({ lang: el.getAttribute('hreflang'), href: el.getAttribute('href') }));
    if (!raw.length) return { count: 0, issues: [] };
    if (!g.SBWHreflang) return { count: raw.length, issues: [] };
    const v = g.SBWHreflang.validateSet(raw, url);
    return { count: raw.length, issues: (v.issues || []).slice(0, 5) };
  }

  /**
   * The row for a fetched page. `doc` is the parsed HTML with a <base href>
   * of the page's final address; `fetchInfo` is
   * `{ url, finalUrl, status, redirected, headers, ms }`; `site` is
   * `{ robots: { found, blocked, allowed }, llms: { found } }` or absent.
   */
  function fromDocument(doc, fetchInfo, site) {
    const A = g.SEOBWAnalysis;
    const X = g.SEOBWExtraction;
    const P = g.SBWSerpPreview;
    const url = (fetchInfo && (fetchInfo.finalUrl || fetchInfo.url)) || doc.URL || '';
    const analysis = A.analyzeDocument(doc, null, X, withoutTracking(url)).data;
    const meta = analysis.meta;
    const title = meta.title.text || '';
    const description = meta.description.text || '';
    const titleFit = P ? P.title(title) : { width: null, cut: false };
    const descFit = P ? P.description(description) : { width: null, cut: false };
    const h1s = (analysis.headings && analysis.headings.h1) || [];
    const tech = X.detectTechStack ? X.detectTechStack(doc, null).map((t) => t.name) : [];
    const score = analysis.seoScore || {};
    return {
      url: (fetchInfo && fetchInfo.url) || url,
      finalUrl: url,
      status: fetchInfo ? fetchInfo.status : null,
      redirected: !!(fetchInfo && fetchInfo.redirected),
      title: { text: title, chars: Array.from(title).length, px: titleFit.width, cut: titleFit.cut, count: meta.title.count },
      description: { text: description, chars: Array.from(description).length, px: descFit.width, cut: descFit.cut, count: meta.description.count },
      h1: { count: h1s.length, first: String(h1s[0] || '').slice(0, 200) },
      words: analysis.content.wordCount,
      language: (analysis.content.language && analysis.content.language.code) || meta.lang || null,
      schema: schemaTypes(doc),
      canonical: { href: meta.canonical || null, target: meta.canonicalTarget || null, count: meta.canonicalCount || 0 },
      indexable: indexable(meta, fetchInfo),
      hreflang: hreflang(doc, url),
      tech: tech.slice(0, 8),
      robots: site && site.robots ? site.robots : null,
      llms: site && site.llms ? site.llms : null,
      checklist: {
        score: typeof score.score === 'number' ? score.score : null,
        grade: score.grade || '',
        issues: Array.isArray(score.issues) ? score.issues.length : 0,
        top: Array.isArray(score.issues) ? score.issues.slice(0, 3) : []
      },
      source: 'html'
    };
  }

  /**
   * Parses `html` as the page at `url`, with a <base> so links resolve to
   * it. A page's own relative <base href="/"> (Angular's) is resolved
   * against the page, not against the document doing the parsing.
   */
  function parse(html, url) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const own = doc.querySelector('base[href]');
    if (own) {
      let href = url;
      try { href = new URL(own.getAttribute('href'), url).href; } catch (e) { /* keep the page's address */ }
      own.setAttribute('href', href);
    } else {
      const base = doc.createElement('base');
      base.setAttribute('href', url);
      (doc.head || doc.documentElement).prepend(base);
    }
    return doc;
  }

  return { fromDocument, parse, indexable, noindexHeader, schemaTypes, withoutTracking };
});
