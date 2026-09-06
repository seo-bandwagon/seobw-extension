// SEO Bandwagon — pure hreflang validation logic
//
// analyzer.js's old analyzeHreflang() only checked presence, x-default, and
// self-reference. This module adds tag-grammar validity (BCP 47 canonical
// form, case-sensitive, with a soft "casing" distinction for an otherwise
// correct tag typed in the wrong case), duplicate/shared-URL detection
// within a declared set, extracting <link rel="alternate" hreflang> tags out
// of raw HTML (for the return-tag fetch below), and interpreting a batch of
// fetched alternates for reciprocity — does every alternate link back to
// this page?
//
// No fetch/chrome dependency here — the background service worker
// (src/background/service-worker.js) owns the actual alternate-page
// fetches (gated on the optional <all_urls> permission, see src/lib/perms.js)
// and hands this module the raw results to interpret.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWHreflang` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWHreflang = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // BCP 47 canonical form for what hreflang actually uses: a 2-3 letter
  // language, an optional 4-letter Title-case script, and an optional
  // region — either a 2-letter ISO 3166-1 code (uppercase) or a 3-digit
  // UN M49 area code (e.g. "419" for Latin America). Case-sensitive on
  // purpose (see parseLangTag below for the softer casing-only path).
  const CANONICAL_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

  function splitParsed(canonicalTag) {
    const parts = canonicalTag.split('-');
    const language = parts[0];
    let script, region;
    let idx = 1;
    if (parts[idx] && /^[A-Z][a-z]{3}$/.test(parts[idx])) { script = parts[idx]; idx++; }
    if (parts[idx] && /^([A-Z]{2}|[0-9]{3})$/.test(parts[idx])) { region = parts[idx]; idx++; }
    return { language, script, region };
  }

  // Best-effort re-casing of `raw` into BCP 47 canonical casing (language
  // lowercase, script Title-case, region uppercase/digits) so a tag that's
  // only WRONG IN CASE — "EN-us" instead of "en-US" — can be told apart from
  // one that's structurally broken ("en_US", a bogus subtag length). Returns
  // null the moment any subtag can't be a case-only fix of something valid.
  function recanonicalize(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const parts = raw.split('-');
    if (!parts.length || !parts[0]) return null;
    const out = [parts[0].toLowerCase()];
    if (!/^[a-z]{2,3}$/.test(out[0])) return null;
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (/^[a-zA-Z]{4}$/.test(p)) {
        out.push(p[0].toUpperCase() + p.slice(1).toLowerCase());
      } else if (/^[a-zA-Z]{2}$/.test(p)) {
        out.push(p.toUpperCase());
      } else if (/^[0-9]{3}$/.test(p)) {
        out.push(p);
      } else {
        return null;
      }
    }
    return out.join('-');
  }

  // { valid, language, script?, region?, xDefault, casing? }. `casing` is
  // only present (and true) when the tag is invalid as typed but would be
  // valid under BCP 47 canonical casing — a softer defect than a
  // structurally invalid tag (missing hyphen, bogus subtag, etc).
  function parseLangTag(tag) {
    const raw = tag === null || tag === undefined ? '' : String(tag);
    if (raw === 'x-default') {
      return { valid: true, xDefault: true };
    }
    if (CANONICAL_RE.test(raw)) {
      return Object.assign({ valid: true, xDefault: false }, splitParsed(raw));
    }
    const recanon = recanonicalize(raw);
    if (recanon && recanon !== raw && CANONICAL_RE.test(recanon)) {
      // `suggestion` carries the corrected tag string itself (not just its
      // parsed parts) so callers can say "use en-US" without having to
      // reassemble language/script/region back into a tag.
      return Object.assign({ valid: false, casing: true, xDefault: false, suggestion: recanon }, splitParsed(recanon));
    }
    return { valid: false, xDefault: false };
  }

  // Absolute URL with the fragment stripped; null if `href` can't be
  // resolved (against `base`, when given — a relative href with no base is
  // unparsable, matching new URL()'s own behavior).
  function normalizeUrl(href, base) {
    if (!href) return null;
    try {
      const u = base ? new URL(href, base) : new URL(href);
      u.hash = '';
      return u.toString();
    } catch (e) {
      return null;
    }
  }

  function isAbsolute(href) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(href || ''));
  }

  function protocolOf(url) {
    try { return new URL(url).protocol; } catch (e) { return null; }
  }

  // entries: [{ lang, href }] → { entries: [{ lang, url, valid, issues }], issues }
  function validateSet(entries, pageUrl) {
    const list = Array.isArray(entries) ? entries : [];
    const pageNorm = normalizeUrl(pageUrl);
    const pageProtocol = protocolOf(pageUrl);

    // Set-level chip text is built alongside each entry's own issues below —
    // a casing defect and a structurally invalid tag get visibly different
    // chip text (`Non-canonical casing: "EN-us" (use en-US)` vs
    // `Invalid hreflang tag: en_US`) rather than collapsing to one generic
    // "invalid" message, since the fix for one is "just fix the case" and
    // the fix for the other is "this isn't a language tag at all".
    const tagSetIssues = [];
    const relativeSetIssues = [];
    const protocolSetIssues = [];

    const outEntries = list.map(raw => {
      const lang = raw && raw.lang;
      const href = raw && raw.href;
      const tag = parseLangTag(lang);
      const url = normalizeUrl(href, pageUrl);
      const issues = [];

      if (!tag.valid) {
        if (tag.casing) {
          issues.push(`Non-canonical casing for "${lang}" (use ${tag.suggestion})`);
          tagSetIssues.push(`Non-canonical casing: "${lang}" (use ${tag.suggestion})`);
        } else {
          issues.push(`Invalid hreflang tag "${lang}"`);
          tagSetIssues.push(`Invalid hreflang tag: ${lang}`);
        }
      }
      if (!url) {
        issues.push('Unresolvable href');
      } else {
        if (!isAbsolute(href)) {
          issues.push('Relative href');
          relativeSetIssues.push(`Relative href for hreflang "${lang}"`);
        }
        const proto = protocolOf(url);
        if (pageProtocol && proto && proto !== pageProtocol) {
          issues.push('Protocol differs from page');
          protocolSetIssues.push(`Protocol differs from page for hreflang "${lang}"`);
        }
      }

      return { lang, url, valid: tag.valid && !!url, issues, xDefault: !!tag.xDefault };
    });

    const setIssues = [];

    const nonEmpty = outEntries.length > 0;
    if (nonEmpty && !outEntries.some(e => e.xDefault)) {
      setIssues.push('Missing x-default hreflang');
    }
    if (nonEmpty && !outEntries.some(e => e.url && pageNorm && e.url === pageNorm)) {
      setIssues.push('Missing self-referencing hreflang');
    }

    // Duplicate language tags — same raw `lang` string (case-sensitive;
    // that's the whole tag as declared) appearing more than once.
    const langCounts = new Map();
    outEntries.forEach(e => {
      if (e.lang === undefined || e.lang === null) return;
      langCounts.set(e.lang, (langCounts.get(e.lang) || 0) + 1);
    });
    langCounts.forEach((count, lang) => {
      if (count > 1) setIssues.push(`Duplicate hreflang tag: ${lang}`);
    });

    // Same URL declared under multiple tags — informational, not an error.
    // x-default legitimately pointing at the same URL as a language variant
    // (very common — the default page usually IS one of the variants) is
    // excluded here so that normal, correct hreflang sets don't get flagged;
    // two actual language tags sharing a URL is still usually a mistake.
    const urlCounts = new Map();
    outEntries.forEach(e => {
      if (!e.url || e.xDefault) return;
      urlCounts.set(e.url, (urlCounts.get(e.url) || 0) + 1);
    });
    urlCounts.forEach((count, url) => {
      if (count > 1) setIssues.push(`Same URL declared under multiple hreflang tags: ${url}`);
    });

    setIssues.push(...tagSetIssues, ...relativeSetIssues, ...protocolSetIssues);

    return {
      entries: outEntries.map(({ xDefault, ...rest }) => rest),
      issues: setIssues
    };
  }

  // Pulls attr="value" / attr='value' / attr=value out of one <link ...> tag
  // string, case-insensitively and independent of attribute order.
  function getAttr(tag, name) {
    const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    const m = tag.match(re);
    if (!m) return null;
    return m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
  }

  // [{ lang, href, url }] from <link rel="alternate" hreflang="…" href="…">
  // found in the first 256 KB of `html`'s <head> — attribute order/quoting
  // agnostic, body-placed links ignored. No DOM parser dependency (this runs
  // in the background service worker, which has no `document`).
  //
  // `baseUrl` is the page's own URL (the worker passes `res.url`, i.e. the
  // URL AFTER following redirects, not whatever was originally requested) —
  // used both to resolve a `<base href>` found in the head and, combined
  // with that base, to resolve every relative `href` into an absolute `url`
  // returned alongside the raw `href`.
  function extractHreflangFromHtml(html, baseUrl) {
    if (!html || typeof html !== 'string') return [];
    const clipped = html.slice(0, 256 * 1024);

    // Locate the <head>...</head> span. A real, complete document has a
    // literal </head>; a truncated fetch (hit the 256 KB cap mid-head) or a
    // malformed one (head never closed) doesn't. In that case, fall back to
    // everything up to the first <body (a still-truncated document at least
    // stops there), or — if there's no <body> either — everything that's
    // left, so a genuinely cut-off response still yields whatever <link>
    // tags appeared before the cut instead of silently finding nothing.
    const headOpenMatch = clipped.match(/<head[^>]*>/i);
    const headStart = headOpenMatch ? headOpenMatch.index + headOpenMatch[0].length : 0;
    const afterHeadOpen = clipped.slice(headStart);
    const headCloseIdx = afterHeadOpen.search(/<\/head>/i);
    let headHtml;
    if (headCloseIdx !== -1) {
      headHtml = afterHeadOpen.slice(0, headCloseIdx);
    } else {
      const bodyIdx = afterHeadOpen.search(/<body[^>]*>/i);
      headHtml = bodyIdx !== -1 ? afterHeadOpen.slice(0, bodyIdx) : afterHeadOpen;
    }

    // Strip HTML comments before scanning — a commented-out <link> (left
    // behind mid-edit, or a debugging toggle) is not a live hreflang tag.
    headHtml = headHtml.replace(/<!--[\s\S]*?-->/g, '');

    // Honor a <base href> in the head, resolved against baseUrl — it changes
    // what every relative href in the document actually points to.
    let effectiveBase = baseUrl;
    const baseTagMatch = headHtml.match(/<base\b[^>]*>/i);
    if (baseTagMatch) {
      const baseHref = getAttr(baseTagMatch[0], 'href');
      if (baseHref) {
        const resolvedBase = normalizeUrl(baseHref, baseUrl);
        if (resolvedBase) effectiveBase = resolvedBase;
      }
    }

    const entries = [];
    const linkTagRe = /<link\b[^>]*>/gi;
    let m;
    while ((m = linkTagRe.exec(headHtml))) {
      const tag = m[0];
      const rel = getAttr(tag, 'rel');
      if (!rel || !rel.toLowerCase().split(/\s+/).includes('alternate')) continue;
      const hreflang = getAttr(tag, 'hreflang');
      if (!hreflang) continue;
      const href = getAttr(tag, 'href');
      if (!href) continue;
      const url = normalizeUrl(href, effectiveBase);
      entries.push({ lang: hreflang, href, url });
    }
    return entries;
  }

  // pageEntries: [{ lang, url }] (the page's OWN declared alternates, i.e.
  // SBWHreflang.validateSet(...).entries with a resolvable url). fetched:
  // Map<url, { status, finalUrl?, entries: [{lang,href,url?}],
  // linkHeaderEntries: [...] }> (worker's checkHreflangAlternates reply,
  // keyed by the alternate URL AS DECLARED on the page, pre-redirect).
  //
  // For each alternate: 'unreachable' when it was never fetched (dropped by
  // the 50-URL cap) or came back with no usable status (0, or >=400); 'yes'
  // when its own declared set (HTML <link> tags + Link header entries)
  // contains a URL matching this page; 'no' otherwise.
  function reciprocity(pageUrl, pageEntries, fetched) {
    const pageNorm = normalizeUrl(pageUrl);
    const map = fetched && typeof fetched.get === 'function' ? fetched : new Map();
    const results = [];
    let checked = 0, ok = 0, missing = 0, unreachable = 0;

    (Array.isArray(pageEntries) ? pageEntries : []).forEach(entry => {
      if (!entry || !entry.url) return;
      checked++;
      const rec = map.get(entry.url);

      if (!rec || rec.status === null || rec.status === undefined || rec.status === 0 || rec.status >= 400) {
        unreachable++;
        results.push({
          lang: entry.lang,
          url: entry.url,
          status: rec && rec.status !== undefined ? rec.status : null,
          returnTag: 'unreachable',
          selfRefOnAlternate: false
        });
        return;
      }

      // A relative return link on the alternate page resolves against
      // wherever that page actually ended up (its finalUrl, after any
      // redirect), not the pre-redirect URL this page originally declared
      // for it — those can be different directories entirely. `rec.entries`
      // (from extractHreflangFromHtml) already carries a pre-resolved `url`
      // for each HTML <link> when one was resolvable, computed against the
      // alternate's own finalUrl (and its own <base href>, if any); that's
      // used as-is when present, since re-resolving it here against a
      // different base would only make it wrong again. Only a bare href (no
      // pre-resolved url — e.g. a hand-built fixture) or a Link-header
      // entry (whose url per RFC 8288 may itself be relative) falls back to
      // resolving against `base` here.
      const base = rec.finalUrl || rec.url || entry.url;
      const combined = [].concat(rec.entries || [], rec.linkHeaderEntries || []);
      const urls = combined
        .map(e => {
          if (!e) return null;
          if (e.href !== undefined) return e.url || normalizeUrl(e.href, base);
          return normalizeUrl(e.url, base);
        })
        .filter(Boolean);
      const alternateNorm = normalizeUrl(base);
      const hasReturn = pageNorm ? urls.some(u => u === pageNorm) : false;
      const selfRefOnAlternate = alternateNorm ? urls.some(u => u === alternateNorm) : false;

      if (hasReturn) ok++; else missing++;
      results.push({
        lang: entry.lang,
        url: entry.url,
        status: rec.status,
        returnTag: hasReturn ? 'yes' : 'no',
        selfRefOnAlternate
      });
    });

    return { entries: results, summary: { checked, ok, missing, unreachable } };
  }

  return {
    parseLangTag,
    normalizeUrl,
    validateSet,
    extractHreflangFromHtml,
    reciprocity
  };
});
