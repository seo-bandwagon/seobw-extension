// SEO Bandwagon — pure hreflang validation logic
//
// analyzer.js's old analyzeHreflang() only checked presence, x-default, and
// self-reference. This module adds tag validity (1.13.8: the ISO 639-1 and
// ISO 3166-1 codes Google reads, in any case; a tag in unusual casing is a
// note, not an issue), duplicate/shared-URL detection
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

  // 1.13.8: the codes Google reads (Search Central, "Tell Google about
  // localized versions of your page"): "Only language codes listed in ISO
  // 639-1 and region codes listed in ISO 3166-1 Alpha 2 are supported", a
  // script may be given in ISO 15924 (zh-Hant), and "The hreflang value is
  // case-insensitive". Until 1.13.8 this checked the shape only, in exact
  // case: valid lowercase en-gb was a red error and en-UK passed.
  // tests/unit/hreflang.test.js holds the tables to their sizes (183 and 249).
  const ISO_639_1 = new Set(('aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu').split(' '));
  const ISO_3166_1 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));
  // Codes people write for a language or a country that isn't its code.
  // Each key is in neither table, so a valid code is never "corrected".
  const LANGUAGE_FIXES = { iw: 'he', in: 'id', ji: 'yi', jp: 'ja', cz: 'cs', dk: 'da', gr: 'el', ua: 'uk', cn: 'zh', vn: 'vi', sp: 'es', ge: 'ka' };
  const REGION_FIXES = { UK: 'GB' };
  // Reserved codes Google says have no effect ("using EU, UN, or UK in
  // hreflang annotations doesn't have an effect on Google Search").
  const RESERVED_REGIONS = new Set(['EU', 'UN']);

  // The shape of a tag hreflang uses: a 2-3 letter language, an optional
  // 4-letter script, an optional 2-letter or 3-digit region; any case.
  const SHAPE_RE = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?$/i;

  // A shaped tag in its usual casing: language lowercase, script Title-case,
  // region uppercase (case doesn't matter to Google; the usual form reads
  // easier and is what the standards print).
  function usualCase(raw) {
    return raw.split('-').map((p, i) => {
      if (i === 0) return p.toLowerCase();
      if (p.length === 4) return p[0].toUpperCase() + p.slice(1).toLowerCase();
      return p.toUpperCase();
    }).join('-');
  }

  function splitParsed(usualTag) {
    const parts = usualTag.split('-');
    const language = parts[0];
    let script, region;
    let idx = 1;
    if (parts[idx] && /^[A-Z][a-z]{3}$/.test(parts[idx])) { script = parts[idx]; idx++; }
    if (parts[idx] && /^([A-Z]{2}|[0-9]{3})$/.test(parts[idx])) { region = parts[idx]; idx++; }
    return { language, script, region };
  }

  // What is wrong with a shaped tag's codes, for Google, or null.
  // { reason, suggestion? } — the suggestion is the whole corrected tag.
  function codeProblem(parts) {
    const { language, script, region } = parts;
    const rebuild = (lang, reg) => [lang, script, reg].filter(Boolean).join('-');
    if (!ISO_639_1.has(language)) {
      const fix = LANGUAGE_FIXES[language];
      if (fix) return { reason: `${language} is not a language code (use ${fix})`, suggestion: rebuild(fix, region && (REGION_FIXES[region] || region)) };
      if (language.length === 3) return { reason: `${language} is not a two-letter ISO 639-1 language code, the only kind Google reads` };
      // A country alone ("You can't specify the country code by itself").
      if (!region && !script && ISO_3166_1.has(language.toUpperCase())) return { reason: `${language.toUpperCase()} is a country code: a tag starts with a language, as in en-${language.toUpperCase()}` };
      return { reason: `${language} is not an ISO 639-1 language code` };
    }
    if (region) {
      if (/^[0-9]{3}$/.test(region)) return { reason: `${region} is a UN M49 area; Google reads only two-letter ISO 3166-1 country codes` };
      if (REGION_FIXES[region]) return { reason: `${region} is not a country code (use ${REGION_FIXES[region]})`, suggestion: rebuild(language, REGION_FIXES[region]) };
      if (RESERVED_REGIONS.has(region)) return { reason: `${region} is reserved and has no effect in Google Search` };
      if (!ISO_3166_1.has(region)) return { reason: `${region} is not an ISO 3166-1 country code` };
    }
    return null;
  }

  // { valid, xDefault, language?, script?, region?, casing?, suggestion?, reason? }
  // `valid` is what Google reads. `casing` (1.13.8: information, not an
  // error) is set when a valid tag isn't in its usual casing, with the usual
  // form in `suggestion`; an invalid tag carries `reason`, and `suggestion`
  // when the fix is known (en-UK: use en-GB).
  function parseLangTag(tag) {
    const raw = tag === null || tag === undefined ? '' : String(tag).trim();
    if (raw.toLowerCase() === 'x-default') {
      return raw === 'x-default'
        ? { valid: true, xDefault: true }
        : { valid: true, xDefault: true, casing: true, suggestion: 'x-default' };
    }
    if (!SHAPE_RE.test(raw)) {
      return { valid: false, xDefault: false, reason: /^[a-z]{2}$/i.test(raw.split(/[-_]/)[1] || '') && raw.includes('_') ? 'use a hyphen, not an underscore' : 'not a language tag' };
    }
    const usual = usualCase(raw);
    const parts = splitParsed(usual);
    const problem = codeProblem(parts);
    if (problem) return Object.assign({ valid: false, xDefault: false }, parts, problem);
    const out = Object.assign({ valid: true, xDefault: false }, parts);
    if (usual !== raw) { out.casing = true; out.suggestion = usual; }
    return out;
  }

  // #92: query parameters that only say how a visitor arrived. A page opened
  // from a newsletter or an ad carries them, and the page it is stays the same
  // page: comparisons drop them. Kept identical to TRACKING_PARAMS in
  // src/lib/redirect-chain.js (a test checks).
  const TRACKING_PARAMS = /^(utm_[a-z_]+|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|srsltid)$/i;

  function dropTrackingParams(u) {
    [...u.searchParams.keys()].forEach(k => { if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k); });
  }

  // normalizeUrl() without tracking parameters: what "the same page" means
  // when comparing the page with its own and its alternates' entries.
  function comparableUrl(href, base) {
    const n = normalizeUrl(href, base);
    if (!n) return null;
    const u = new URL(n);
    dropTrackingParams(u);
    return u.toString();
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
    const pageNorm = comparableUrl(pageUrl);
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
    // 1.13.8: information, not issues: a valid tag in unusual casing.
    const notes = [];

    const outEntries = list.map(raw => {
      const lang = raw && raw.lang;
      const href = raw && raw.href;
      const tag = parseLangTag(lang);
      const url = normalizeUrl(href, pageUrl);
      const issues = [];
      let note = null;

      if (!tag.valid) {
        const why = tag.reason ? `: ${tag.reason}` : '';
        issues.push(`Invalid hreflang tag "${lang}"${why}`);
        tagSetIssues.push(`Invalid hreflang tag: ${lang}${tag.reason ? ` (${tag.reason})` : ''}`);
      } else if (tag.casing) {
        note = `Written "${lang}": Google reads it in any case; usually written ${tag.suggestion}`;
        notes.push(note);
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

      const entry = { lang, url, valid: tag.valid && !!url, issues, xDefault: !!tag.xDefault };
      if (note) entry.note = note;
      // The tag as Google compares it, for duplicates: case doesn't count.
      entry.key = tag.valid ? (tag.xDefault ? 'x-default' : usualCase(String(lang).trim())) : lang;
      return entry;
    });

    const setIssues = [];

    const nonEmpty = outEntries.length > 0;
    if (nonEmpty && !outEntries.some(e => e.xDefault)) {
      setIssues.push('Missing x-default hreflang');
    }
    if (nonEmpty && !outEntries.some(e => e.url && pageNorm && comparableUrl(e.url) === pageNorm)) {
      setIssues.push('Missing self-referencing hreflang');
    }

    // Duplicate language tags. 1.13.8: compared as Google compares them,
    // in any case, so en-GB and en-gb on two URLs are one tag twice.
    const langCounts = new Map();
    outEntries.forEach(e => {
      if (e.lang === undefined || e.lang === null) return;
      const k = e.key;
      const prev = langCounts.get(k) || { count: 0, written: [] };
      prev.count += 1;
      if (!prev.written.includes(e.lang)) prev.written.push(e.lang);
      langCounts.set(k, prev);
    });
    langCounts.forEach((v, k) => {
      if (v.count > 1) setIssues.push(`Duplicate hreflang tag: ${v.written.length > 1 ? v.written.join(', ') : k}`);
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
      entries: outEntries.map(({ xDefault, key, ...rest }) => rest),
      issues: setIssues,
      notes
    };
  }

  function decodeEntities(s) {
    if (!s) return s;
    return s.replace(/&(amp|quot|apos|lt|gt|#38|#x26);/gi, (m, e) => ({
      amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#38': '&', '#x26': '&'
    })[e.toLowerCase()]);
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
      // #92: raw HTML carries `&` in an href as `&amp;`.
      const href = decodeEntities(getAttr(tag, 'href'));
      if (!href) continue;
      const url = normalizeUrl(href, effectiveBase);
      entries.push({ lang: hreflang, href, url });
    }
    return entries;
  }

  // 1.13.8: whether an alternate can be indexed, from its own head: its
  // robots and googlebot metas (noindex or none) and its canonical. An
  // alternate Google won't index can't carry the annotation, and one whose
  // canonical points elsewhere sends Google there. `baseUrl` is where the
  // alternate ended up. { noindex, noindexSource, canonical } (canonical
  // resolved, or null).
  function extractIndexSignalsFromHtml(html, baseUrl) {
    const out = { noindex: false, noindexSource: null, canonical: null };
    if (!html || typeof html !== 'string') return out;
    const clipped = html.slice(0, 256 * 1024);
    const headOpen = clipped.match(/<head[^>]*>/i);
    let head = clipped.slice(headOpen ? headOpen.index + headOpen[0].length : 0);
    const close = head.search(/<\/head>/i);
    if (close !== -1) head = head.slice(0, close);
    else {
      const body = head.search(/<body[^>]*>/i);
      if (body !== -1) head = head.slice(0, body);
    }
    head = head.replace(/<!--[\s\S]*?-->/g, '');
    const metaRe = /<meta\b[^>]*>/gi;
    let m;
    while ((m = metaRe.exec(head))) {
      const name = (getAttr(m[0], 'name') || '').toLowerCase();
      if (name !== 'robots' && name !== 'googlebot') continue;
      const words = (getAttr(m[0], 'content') || '').toLowerCase().split(/[\s,]+/);
      if (!out.noindex && (words.includes('noindex') || words.includes('none'))) {
        out.noindex = true;
        out.noindexSource = name;
      }
    }
    const linkRe = /<link\b[^>]*>/gi;
    while ((m = linkRe.exec(head))) {
      const rel = (getAttr(m[0], 'rel') || '').toLowerCase().split(/\s+/);
      if (!rel.includes('canonical')) continue;
      const href = decodeEntities(getAttr(m[0], 'href'));
      if (href) { out.canonical = normalizeUrl(href, baseUrl); break; }
    }
    return out;
  }

  // Why an alternate the worker fetched can't be indexed, or null: a noindex
  // in its robots or googlebot meta or its X-Robots-Tag, or a canonical that
  // points to another URL.
  function notIndexableReason(rec) {
    if (!rec) return null;
    if (rec.noindex) return `noindex (${rec.noindexSource === 'x-robots-tag' ? 'X-Robots-Tag' : `meta ${rec.noindexSource || 'robots'}`})`;
    const landed = comparableUrl(rec.finalUrl || rec.url);
    const canonical = rec.canonical ? comparableUrl(rec.canonical) : null;
    if (canonical && landed && canonical !== landed) return `canonical points to ${rec.canonical}`;
    return null;
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
    const pageNorm = comparableUrl(pageUrl);
    const map = fetched && typeof fetched.get === 'function' ? fetched : new Map();
    const results = [];
    let checked = 0, ok = 0, missing = 0, unreachable = 0, self = 0, redirected = 0, notIndexableCount = 0;

    (Array.isArray(pageEntries) ? pageEntries : []).forEach(entry => {
      if (!entry || !entry.url) return;
      // #91: the page's own entry (its self-reference, often x-default too)
      // isn't fetched, so it has no record; it's the page itself, not an
      // unreachable alternate.
      if (pageNorm && comparableUrl(entry.url) === pageNorm) {
        self++;
        results.push({ lang: entry.lang, url: entry.url, status: null, returnTag: 'self', selfRefOnAlternate: true });
        return;
      }
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
        .filter(Boolean)
        .map(u => comparableUrl(u));
      const alternateNorm = comparableUrl(base);
      const hasReturn = pageNorm ? urls.some(u => u === pageNorm) : false;
      const selfRefOnAlternate = alternateNorm ? urls.some(u => u === alternateNorm) : false;
      // 1.13.8: an alternate should be the address Google indexes, so one
      // that redirects, or that can't be indexed, is flagged.
      const declaredNorm = comparableUrl(entry.url);
      const redirectsTo = rec.finalUrl && alternateNorm && declaredNorm && alternateNorm !== declaredNorm ? rec.finalUrl : null;
      const notIndexable = notIndexableReason(rec);
      if (redirectsTo) redirected++;
      if (notIndexable) notIndexableCount++;

      if (hasReturn) ok++; else missing++;
      const out = {
        lang: entry.lang,
        url: entry.url,
        status: rec.status,
        returnTag: hasReturn ? 'yes' : 'no',
        selfRefOnAlternate
      };
      if (redirectsTo) out.redirectsTo = redirectsTo;
      if (notIndexable) out.notIndexable = notIndexable;
      results.push(out);
    });

    return { entries: results, summary: { checked, ok, missing, unreachable, self, redirected, notIndexable: notIndexableCount } };
  }

  return {
    ISO_639_1,
    ISO_3166_1,
    parseLangTag,
    extractIndexSignalsFromHtml,
    notIndexableReason,
    normalizeUrl,
    comparableUrl,
    TRACKING_PARAMS,
    validateSet,
    extractHreflangFromHtml,
    reciprocity
  };
});
