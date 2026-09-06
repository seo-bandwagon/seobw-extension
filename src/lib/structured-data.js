// SEO Bandwagon — pure structured-data (JSON-LD / microdata / RDFa)
// extraction + validation logic
//
// The old analyzeSchemaValidation() in src/content/analyzer.js only looked
// at JSON-LD and only checked a handful of required fields per type. This
// module adds the other two structured-data syntaxes the DOM actually
// carries (WHATWG microdata, basic RDFa Lite), a much larger required/
// recommended property table, specific field-shape problems (bad dates,
// non-URL images, missing offers price, etc.), and rich-result "eligible
// for" reporting.
//
// No DOM dependency in the JSON-LD path (it takes raw script text, same
// shape the content script hands it); extractMicrodata()/extractRdfa() do
// walk a real DOM (a `Document` or `Element` — the content script passes
// `document`), which is why they're only exercised against JSDOM in tests,
// same as src/lib/dom-extraction.js at the repo root.
//
// The required/recommended tables and each type's `sourceUrl` are derived
// from schema.org (https://schema.org, CC BY-SA 3.0) type/property
// definitions and Google Search Central's structured-data documentation
// (https://developers.google.com/search/docs/appearance/structured-data,
// CC BY 4.0) — see src/lib/credits.js, which reads SOURCE_URLS below to
// build the popup's "About & credits" panel (the ledger's binding
// attribution rule).
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSchema` when loaded as a classic <script>, and exports via
// CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSchema = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  /* ============================================================
   * JSON-LD extraction
   * ============================================================ */

  // scripts: array of raw <script type="application/ld+json"> text
  // contents (the content script reads .textContent for each one — no DOM
  // dependency here, same reasoning as src/lib/hreflang.js's
  // extractHreflangFromHtml operating on a raw string).
  function extractJsonLd(scripts) {
    const out = [];
    (scripts || []).forEach(raw => {
      if (typeof raw !== 'string') return;
      const text = raw.trim();
      if (!text) return;

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        out.push({ source: 'json-ld', error: e.message, snippet: text.slice(0, 140) });
        return;
      }

      const topContext = parsed && typeof parsed === 'object' ? parsed['@context'] : undefined;
      let roots;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed['@graph'])) {
        roots = parsed['@graph'];
      } else if (Array.isArray(parsed)) {
        roots = parsed;
      } else {
        roots = [parsed];
      }

      roots.forEach(node => {
        if (!node || typeof node !== 'object') return;
        const type = Array.isArray(node['@type']) ? node['@type'][0] : node['@type'];
        out.push({
          type,
          source: 'json-ld',
          context: node['@context'] || topContext,
          properties: node
        });
      });
    });
    return out;
  }

  /* ============================================================
   * Shared property-collection helper
   *
   * Both microdata (itemscope boundary) and RDFa (typeof boundary) use the
   * same walk shape: collect every descendant that carries the property
   * attribute, recursing through plain wrapper elements but NOT through a
   * nested item's own subtree (that nested item's element itself still
   * counts as one property value of the outer item — its children don't).
   * ============================================================ */

  function collectPropertyElements(root, boundaryAttr, propAttr) {
    const results = [];
    function crawl(node) {
      const children = node && node.children ? Array.from(node.children) : [];
      children.forEach(child => {
        if (!child.hasAttribute(boundaryAttr)) {
          crawl(child);
        }
        if (child.hasAttribute(propAttr)) {
          results.push(child);
        }
      });
    }
    crawl(root);
    return results;
  }

  function addProp(properties, name, value) {
    if (!name) return;
    if (properties[name] === undefined) {
      properties[name] = value;
    } else if (Array.isArray(properties[name])) {
      properties[name].push(value);
    } else {
      properties[name] = [properties[name], value];
    }
  }

  // Last non-empty path segment of a type URL/URI ("https://schema.org/
  // Product" -> "Product"), tolerant of a trailing slash and of the
  // itemtype/typeof attribute carrying more than one space-separated value
  // (only the first is used, matching how a page overwhelmingly declares
  // one primary type).
  function lastPathSegment(value) {
    if (!value) return undefined;
    const first = value.trim().split(/\s+/)[0];
    if (!first) return undefined;
    const cleaned = first.replace(/\/+$/, '');
    const parts = cleaned.split('/');
    return parts[parts.length - 1] || undefined;
  }

  /* ============================================================
   * Microdata extraction (WHATWG HTML microdata)
   * ============================================================ */

  function microdataValue(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'meta') return el.getAttribute('content') || '';
    if (['audio', 'embed', 'iframe', 'img', 'source', 'track', 'video'].indexOf(tag) !== -1) {
      return el.getAttribute('src') || '';
    }
    if (['a', 'area', 'link'].indexOf(tag) !== -1) return el.getAttribute('href') || '';
    if (tag === 'object') return el.getAttribute('data') || '';
    if (tag === 'data' || tag === 'meter') return el.getAttribute('value') || '';
    if (tag === 'time') return el.getAttribute('datetime') || (el.textContent || '').trim();
    return (el.textContent || '').trim();
  }

  function walkMicrodataItem(el) {
    const type = lastPathSegment(el.getAttribute('itemtype'));
    const properties = {};
    collectPropertyElements(el, 'itemscope', 'itemprop').forEach(propEl => {
      const names = (propEl.getAttribute('itemprop') || '').split(/\s+/).filter(Boolean);
      const value = propEl.hasAttribute('itemscope') ? walkMicrodataItem(propEl) : microdataValue(propEl);
      names.forEach(name => addProp(properties, name, value));
    });
    return { type, source: 'microdata', properties };
  }

  // root: a Document or Element (content script passes `document`).
  function extractMicrodata(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    // Per the microdata spec, a "top-level" item is an [itemscope] element
    // that does NOT itself carry itemprop — one that does is a nested
    // item, already picked up as a property value by its owner's own walk.
    return Array.from(root.querySelectorAll('[itemscope]'))
      .filter(el => !el.hasAttribute('itemprop'))
      .map(walkMicrodataItem);
  }

  /* ============================================================
   * RDFa extraction (basic RDFa Lite only — property/typeof/resource/
   * href/content; no full CURIE prefix resolution beyond a leading
   * "prefix:" being stripped down to its local name)
   * ============================================================ */

  function rdfaTypeName(typeofAttr) {
    if (!typeofAttr) return undefined;
    const first = typeofAttr.trim().split(/\s+/)[0];
    if (!first) return undefined;
    if (first.indexOf(':') !== -1) {
      const parts = first.split(':');
      return parts[parts.length - 1] || first;
    }
    return lastPathSegment(first) || first;
  }

  function rdfaValue(el) {
    if (el.hasAttribute('content')) return el.getAttribute('content');
    if (el.hasAttribute('resource')) return el.getAttribute('resource');
    if (el.hasAttribute('href')) return el.getAttribute('href');
    return (el.textContent || '').trim();
  }

  function walkRdfaItem(el) {
    const type = rdfaTypeName(el.getAttribute('typeof'));
    const vocab = el.getAttribute('vocab') || undefined;
    const properties = {};
    collectPropertyElements(el, 'typeof', 'property').forEach(propEl => {
      const names = (propEl.getAttribute('property') || '').split(/\s+/).filter(Boolean);
      const value = propEl.hasAttribute('typeof') ? walkRdfaItem(propEl) : rdfaValue(propEl);
      names.forEach(name => addProp(properties, name, value));
    });
    return { type, source: 'rdfa', context: vocab, properties };
  }

  function extractRdfa(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    // Same "not itself a property of an ancestor" top-level rule as
    // microdata above, mirrored onto RDFa's own attributes: an element
    // carrying both `typeof` and `property` is a nested item embedded as a
    // property value, not a second top-level item.
    return Array.from(root.querySelectorAll('[typeof]'))
      .filter(el => !el.hasAttribute('property'))
      .map(walkRdfaItem);
  }

  /* ============================================================
   * Required / recommended property tables
   *
   * Each entry's sourceUrl is either the Google Search Central
   * structured-data feature page (for the rich-result-eligible types) or
   * the schema.org type page (for everything else) it was derived from —
   * this is exactly what src/lib/credits.js lists in the popup's
   * "About & credits" panel. A subtype (`alias`) resolves to its parent's
   * required/recommended/sourceUrl rather than repeating them.
   * ============================================================ */

  const GOOGLE_DOCS = 'https://developers.google.com/search/docs/appearance/structured-data/';
  const SCHEMA_ORG = 'https://schema.org/';

  const TYPE_SPECS = {
    Article: {
      required: ['headline', 'image', 'datePublished', 'author'],
      recommended: ['dateModified', 'publisher'],
      sourceUrl: GOOGLE_DOCS + 'article'
    },
    NewsArticle: { alias: 'Article' },
    BlogPosting: { alias: 'Article' },

    Product: {
      required: ['name', 'image', 'offers'],
      recommended: ['brand', 'sku', 'review', 'aggregateRating'],
      sourceUrl: GOOGLE_DOCS + 'product'
    },

    LocalBusiness: {
      required: ['name', 'address', 'telephone'],
      recommended: ['image', 'priceRange', 'openingHoursSpecification', 'geo'],
      sourceUrl: GOOGLE_DOCS + 'local-business'
    },
    Restaurant: { alias: 'LocalBusiness' },
    Store: { alias: 'LocalBusiness' },
    MedicalBusiness: { alias: 'LocalBusiness' },
    Attorney: { alias: 'LocalBusiness' },
    Dentist: { alias: 'LocalBusiness' },
    AutoRepair: { alias: 'LocalBusiness' },
    HomeAndConstructionBusiness: { alias: 'LocalBusiness' },
    ProfessionalService: { alias: 'LocalBusiness' },
    FoodEstablishment: { alias: 'LocalBusiness' },
    Hotel: { alias: 'LocalBusiness' },

    Organization: {
      required: ['name', 'url', 'logo'],
      recommended: ['sameAs', 'contactPoint'],
      sourceUrl: GOOGLE_DOCS + 'logo'
    },

    Person: {
      required: ['name'],
      recommended: ['jobTitle', 'url', 'image'],
      sourceUrl: SCHEMA_ORG + 'Person'
    },

    BreadcrumbList: {
      required: ['itemListElement'],
      recommended: [],
      sourceUrl: GOOGLE_DOCS + 'breadcrumb'
    },

    FAQPage: {
      required: ['mainEntity'],
      recommended: [],
      sourceUrl: GOOGLE_DOCS + 'faqpage'
    },

    HowTo: {
      required: ['name', 'step'],
      recommended: ['image', 'totalTime', 'estimatedCost'],
      sourceUrl: GOOGLE_DOCS + 'how-to'
    },

    Recipe: {
      required: ['name', 'recipeIngredient', 'recipeInstructions'],
      recommended: ['image', 'author', 'datePublished', 'prepTime', 'cookTime', 'recipeYield', 'nutrition'],
      sourceUrl: GOOGLE_DOCS + 'recipe'
    },

    Event: {
      required: ['name', 'startDate', 'location'],
      recommended: ['endDate', 'image', 'offers', 'performer'],
      sourceUrl: GOOGLE_DOCS + 'event'
    },

    VideoObject: {
      required: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
      recommended: ['duration', 'contentUrl', 'embedUrl'],
      sourceUrl: GOOGLE_DOCS + 'video'
    },

    Review: {
      required: ['itemReviewed', 'reviewRating', 'author'],
      recommended: ['datePublished'],
      sourceUrl: GOOGLE_DOCS + 'review-snippet'
    },
    AggregateRating: {
      required: ['ratingValue', 'itemReviewed'],
      recommended: ['reviewCount', 'bestRating'],
      sourceUrl: GOOGLE_DOCS + 'review-snippet'
    },

    WebSite: {
      required: ['name', 'url'],
      recommended: ['potentialAction'],
      sourceUrl: GOOGLE_DOCS + 'sitelinks-searchbox'
    },

    WebPage: {
      required: ['name'],
      recommended: ['description', 'breadcrumb'],
      sourceUrl: SCHEMA_ORG + 'WebPage'
    },

    JobPosting: {
      required: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'],
      recommended: ['validThrough', 'employmentType', 'baseSalary'],
      sourceUrl: GOOGLE_DOCS + 'job-posting'
    }
  };

  function resolveSpec(type) {
    if (!type) return null;
    const spec = TYPE_SPECS[type];
    if (!spec) return null;
    return spec.alias ? TYPE_SPECS[spec.alias] : spec;
  }

  function isKnownType(type) {
    return !!TYPE_SPECS[type];
  }

  const REQUIRED = {};
  const RECOMMENDED = {};
  const SOURCE_URLS = {};
  Object.keys(TYPE_SPECS).forEach(type => {
    const spec = resolveSpec(type);
    if (!spec) return;
    REQUIRED[type] = spec.required;
    RECOMMENDED[type] = spec.recommended;
    SOURCE_URLS[type] = spec.sourceUrl;
  });

  // Rich-result feature name (the brief's "Eligible for" wording) each type
  // — and its subtypes/aliases — maps to. Order here is also
  // ELIGIBLE_ORDER's order below, so `eligible` reports in a stable,
  // predictable sequence.
  const RICH_RESULT_FEATURES = {
    Article: 'Article', NewsArticle: 'Article', BlogPosting: 'Article',
    Product: 'Product',
    FAQPage: 'FAQ',
    HowTo: 'HowTo',
    Recipe: 'Recipe',
    Event: 'Event',
    VideoObject: 'Video',
    BreadcrumbList: 'Breadcrumb',
    LocalBusiness: 'LocalBusiness', Restaurant: 'LocalBusiness', Store: 'LocalBusiness',
    MedicalBusiness: 'LocalBusiness', Attorney: 'LocalBusiness', Dentist: 'LocalBusiness',
    AutoRepair: 'LocalBusiness', HomeAndConstructionBusiness: 'LocalBusiness',
    ProfessionalService: 'LocalBusiness', FoodEstablishment: 'LocalBusiness', Hotel: 'LocalBusiness',
    JobPosting: 'JobPosting'
  };
  const ELIGIBLE_ORDER = ['Article', 'Product', 'FAQ', 'HowTo', 'Recipe', 'Event', 'Video', 'Breadcrumb', 'LocalBusiness', 'JobPosting'];

  /* ============================================================
   * validateItem / validateAll
   * ============================================================ */

  function hasValue(v) {
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  }

  function toArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
  }

  // A nested value can arrive two shapes: our own extractor's item wrapper
  // ({ type, source, properties }, from a nested microdata itemscope or
  // RDFa typeof) or a plain nested object straight out of JSON-LD. Either
  // way, hand back a plain { propName: value } map to read sub-fields off.
  function nestedProps(v) {
    if (!v || typeof v !== 'object') return null;
    if (v.properties && typeof v.properties === 'object') return v.properties;
    return v;
  }

  function nestedType(v) {
    if (!v || typeof v !== 'object') return undefined;
    if (v.properties && v.type) return v.type;
    return v['@type'];
  }

  function isUrlString(s) {
    return typeof s === 'string' && /^(https?:)?\/\/|^\/|^data:/i.test(s.trim());
  }

  const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

  function checkOffers(properties, problems) {
    const first = Array.isArray(properties.offers) ? properties.offers[0] : properties.offers;
    const offers = nestedProps(first);
    if (!offers) return;
    if (!hasValue(offers.price)) problems.push('offers missing price');
    if (!hasValue(offers.priceCurrency)) problems.push('offers missing priceCurrency');
  }

  function checkDatePublished(properties, problems) {
    const v = properties.datePublished;
    if (hasValue(v) && typeof v === 'string' && !ISO_8601_RE.test(v.trim())) {
      problems.push('datePublished not ISO 8601');
    }
  }

  function checkImage(properties, problems) {
    if (!hasValue(properties.image)) return;
    const values = toArray(properties.image);
    const allValid = values.every(v => {
      if (isUrlString(v)) return true;
      if (nestedType(v) === 'ImageObject') return true;
      const props = nestedProps(v);
      return !!(props && isUrlString(props.url));
    });
    if (!allValid) problems.push('image not a URL or ImageObject');
  }

  function checkBreadcrumb(type, properties, problems) {
    if (type !== 'BreadcrumbList') return;
    const items = toArray(properties.itemListElement);
    if (!items.length) return;
    const missing = items.some(li => {
      const props = nestedProps(li);
      return !hasValue(props ? props.position : undefined);
    });
    if (missing) problems.push('BreadcrumbList item missing position');
  }

  function checkFaq(type, properties, problems) {
    if (type !== 'FAQPage') return;
    const entities = toArray(properties.mainEntity);
    if (!entities.length) return;
    const missing = entities.some(q => {
      const props = nestedProps(q);
      return !hasValue(props ? props.acceptedAnswer : undefined);
    });
    if (missing) problems.push('FAQPage mainEntity missing acceptedAnswer');
  }

  // item: { type, source, properties } — one extracted (not-yet-validated)
  // structured-data item, from extractJsonLd/extractMicrodata/extractRdfa.
  // Returns { type, source, required: { missing, present }, recommended:
  // { missing }, problems }, plus the original `properties` passed through
  // (not in the brief's four-field list, but the popup's "Copy JSON-LD"
  // button needs the raw data and re-deriving it would mean carrying the
  // whole item around a second time).
  function validateItem(item) {
    const type = item && item.type;
    const source = item && item.source;
    const properties = (item && item.properties) || {};
    const spec = resolveSpec(type);
    const required = spec ? spec.required : [];
    const recommended = spec ? spec.recommended : [];

    const missingRequired = required.filter(f => !hasValue(properties[f]));
    const presentRequired = required.filter(f => hasValue(properties[f]));
    const missingRecommended = recommended.filter(f => !hasValue(properties[f]));

    const problems = [];
    if (type && !isKnownType(type)) problems.push(`Unknown type: ${type}`);
    checkOffers(properties, problems);
    checkDatePublished(properties, problems);
    checkImage(properties, problems);
    checkBreadcrumb(type, properties, problems);
    checkFaq(type, properties, problems);

    return {
      type,
      source,
      required: { missing: missingRequired, present: presentRequired },
      recommended: { missing: missingRecommended },
      problems,
      properties
    };
  }

  function featureFor(type) {
    return RICH_RESULT_FEATURES[type];
  }

  // items: the concatenation of extractJsonLd/extractMicrodata/extractRdfa
  // output (parse-error entries and real items mixed together, exactly as
  // the content script hands it over — see analyzer.js's
  // analyzeSchemaValidation()).
  function validateAll(items) {
    const validated = [];
    const byType = {};
    const bySource = {};
    let withErrors = 0;

    (items || []).forEach(entry => {
      if (!entry) return;
      if (entry.source) bySource[entry.source] = (bySource[entry.source] || 0) + 1;

      if (entry.error) {
        validated.push({ source: entry.source, error: entry.error, snippet: entry.snippet });
        withErrors++;
        return;
      }

      const v = validateItem(entry);
      validated.push(v);
      if (v.type) byType[v.type] = (byType[v.type] || 0) + 1;
      if (v.required.missing.length || v.problems.length) withErrors++;
    });

    const eligible = ELIGIBLE_ORDER.filter(feature =>
      validated.some(v => !v.error && featureFor(v.type) === feature && v.required.missing.length === 0)
    );

    return {
      items: validated,
      counts: { byType, bySource, withErrors },
      eligible
    };
  }

  return {
    extractJsonLd,
    extractMicrodata,
    extractRdfa,
    REQUIRED,
    RECOMMENDED,
    SOURCE_URLS,
    validateItem,
    validateAll
  };
});
