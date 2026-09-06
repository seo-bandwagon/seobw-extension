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

  // Fix round 1, MINOR 11: some pages wrap a JSON-LD script body in an HTML
  // comment or a CDATA marker (a holdover from XHTML-strict templates, or a
  // defensive habit carried over from inline <script> blocks) — strip a
  // *wrapping* one before JSON.parse, the same "don't choke on markup noise
  // around otherwise-valid content" reasoning as src/lib/hreflang.js's HTML
  // comment stripping. Iterative because a page can nest both forms
  // ("//<![CDATA[\n<!-- {...} -->\n//]]>"); each pass strips one layer of
  // leading/trailing noise until nothing more comes off.
  function stripJsonLdWrapper(text) {
    let t = text;
    let prev;
    do {
      prev = t;
      t = t
        .replace(/^\/\/\s*/, '')
        .replace(/^<!\[CDATA\[/i, '')
        .replace(/^<!--/, '')
        .trim()
        .replace(/-->\s*$/, '')
        .replace(/\]\]>\s*$/i, '')
        .replace(/\/\/\s*$/, '')
        .trim();
    } while (t !== prev);
    return t;
  }

  // Fix round 1, IMPORTANT 3: a @graph member can itself be an array (some
  // generators wrap a batch of nodes one level deeper) or can itself carry
  // its own @graph (a page composing multiple JSON-LD documents' worth of
  // nodes into one). Recurse through both shapes. A node with neither a
  // declared @type nor any own properties (e.g. a bare `{ "@graph": [...] }`
  // wrapper, once its @graph is peeled off) is skipped outright — pushing it
  // would produce a phantom `{ type: undefined }` item with nothing in it.
  function flattenJsonLdNode(node, topContext, out) {
    if (Array.isArray(node)) {
      node.forEach(child => flattenJsonLdNode(child, topContext, out));
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node['@graph'])) {
      flattenJsonLdNode(node['@graph'], node['@context'] || topContext, out);
      return;
    }
    const rawType = node['@type'];
    const hasType = rawType !== undefined;
    const ownKeys = Object.keys(node).filter(k => k !== '@context' && k !== '@graph');
    if (!hasType && ownKeys.length === 0) return;
    const type = Array.isArray(rawType) ? rawType[0] : rawType;
    out.push({
      type,
      source: 'json-ld',
      context: node['@context'] || topContext,
      properties: node
    });
  }

  // scripts: array of raw <script type="application/ld+json"> text
  // contents (the content script reads .textContent for each one — no DOM
  // dependency here, same reasoning as src/lib/hreflang.js's
  // extractHreflangFromHtml operating on a raw string).
  function extractJsonLd(scripts) {
    const out = [];
    (scripts || []).forEach(raw => {
      if (typeof raw !== 'string') return;
      const text = stripJsonLdWrapper(raw.trim());
      if (!text) return;

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        out.push({ source: 'json-ld', error: e.message, snippet: text.slice(0, 140) });
        return;
      }

      const topContext = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed['@context'] : undefined;
      flattenJsonLdNode(parsed, topContext, out);
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

  // Fix round 1, IMPORTANT 7: for URL-bearing attributes, prefer the
  // resolving DOM IDL property (`el.href`/`el.src`) over the raw attribute
  // — the IDL property resolves a relative value against the document's own
  // base URL (respecting a <base href> too), where `getAttribute` hands
  // back the attribute text verbatim. Fall back to the attribute only when
  // the property isn't there at all (a detached/foreign node in some test
  // harness) rather than when it's merely falsy-empty, since an empty IDL
  // href is itself the correct resolved value for `href=""`.
  function resolvingAttr(el, idlProp, attrName) {
    if (typeof el[idlProp] === 'string') return el[idlProp];
    return el.getAttribute(attrName) || '';
  }

  function microdataValue(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'meta') return el.getAttribute('content') || '';
    if (['audio', 'embed', 'iframe', 'img', 'source', 'track', 'video'].indexOf(tag) !== -1) {
      return resolvingAttr(el, 'src', 'src');
    }
    if (['a', 'area', 'link'].indexOf(tag) !== -1) return resolvingAttr(el, 'href', 'href');
    if (tag === 'object') return el.getAttribute('data') || '';
    if (tag === 'data' || tag === 'meter') return el.getAttribute('value') || '';
    if (tag === 'time') return el.getAttribute('datetime') || (el.textContent || '').trim();
    return (el.textContent || '').trim();
  }

  // Fix round 1, IMPORTANT 6: the microdata spec treats every id listed in
  // an item's `itemref` attribute as if that element (and, unless it's
  // itself a nested item boundary, its subtree) were a child of the item —
  // wherever in the document it actually sits. `visited` is threaded through
  // the whole walk (shared across itemref hops and nested itemscopes) so a
  // cyclic itemref (A refs B, B refs A) terminates instead of recursing
  // forever; it also means the same id is never resolved twice within one
  // top-level item's walk.
  function collectItemrefElements(el, visited) {
    const raw = el.getAttribute('itemref');
    if (!raw) return [];
    const doc = el.ownerDocument || (el.nodeType === 9 ? el : null);
    if (!doc || typeof doc.getElementById !== 'function') return [];
    const results = [];
    raw.split(/\s+/).filter(Boolean).forEach(id => {
      if (visited.has(id)) return;
      visited.add(id);
      const ref = doc.getElementById(id);
      if (!ref) return;
      if (ref.hasAttribute('itemprop')) results.push(ref);
      if (!ref.hasAttribute('itemscope')) {
        results.push(...collectPropertyElements(ref, 'itemscope', 'itemprop'));
      }
    });
    return results;
  }

  function walkMicrodataItem(el, visited) {
    visited = visited || new Set();
    const type = lastPathSegment(el.getAttribute('itemtype'));
    const properties = {};
    const propEls = collectPropertyElements(el, 'itemscope', 'itemprop')
      .concat(collectItemrefElements(el, visited));
    propEls.forEach(propEl => {
      const names = (propEl.getAttribute('itemprop') || '').split(/\s+/).filter(Boolean);
      const value = propEl.hasAttribute('itemscope') ? walkMicrodataItem(propEl, visited) : microdataValue(propEl);
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
      .map(el => walkMicrodataItem(el));
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

  // Fix round 1, CRITICAL 1a/1c: every schema.org LocalBusiness subtype we
  // recognize — the ones the brief calls out by name plus the rest of
  // https://schema.org/LocalBusiness's own subtype tree, generously
  // (written from schema.org hierarchy knowledge, not fetched). Every name
  // here gets `alias: 'LocalBusiness'` in TYPE_SPECS (so it inherits the
  // LocalBusiness required/recommended/sourceUrl and rich-result mapping)
  // AND a CORE_TYPES membership, built below — one array, two consumers, so
  // adding a subtype here is the only edit needed to recognize it in both
  // places.
  const LOCAL_BUSINESS_SUBTYPES = [
    // re-review 2026-09-06: the 8 subtypes missing vs the live vocabulary
    'Notary', 'PhysiciansOffice', 'StadiumOrArena', 'VacationRental', 'AutomatedTeller', 'Bakery', 'BarOrPub', 'IndividualPhysician',
    // explicitly named in the brief
    'Restaurant', 'Store', 'MedicalBusiness', 'Attorney', 'Dentist', 'AutoRepair',
    'HomeAndConstructionBusiness', 'ProfessionalService', 'FoodEstablishment', 'Hotel',
    'Plumber', 'Electrician', 'HVACBusiness', 'RoofingContractor', 'Locksmith', 'MovingCompany',
     'HousePainter', 'GeneralContractor', 'Physician', 'LegalService', 'RealEstateAgent',
    'HealthAndBeautyBusiness', 'FinancialService', 'LodgingBusiness', 'EntertainmentBusiness',
    'SportsActivityLocation', 'TravelAgency', 'ChildCare', 'DryCleaningOrLaundry', 'EmergencyService',
    'EmploymentAgency', 'InternetCafe', 'Library', 'RadioStation', 'RecyclingCenter', 'SelfStorage',
    'ShoppingCenter', 'TelevisionStation', 'TouristInformationCenter', 'AnimalShelter',
    'ArchiveOrganization', 'AutomotiveBusiness', 'GovernmentOffice',
    // the rest of schema.org/LocalBusiness's own subtype tree (generous, not exhaustive)
    'AccountingService', 'AdultEntertainment', 'AmusementPark', 'ArtGallery', 'AutoBodyShop',
    'AutoDealer', 'AutoPartsStore', 'AutoRental', 'AutoWash', 'BankOrCreditUnion', 'BeautySalon',
    'BedAndBreakfast', 'BikeStore', 'BookStore', 'BowlingAlley', 'Brewery', 'CafeOrCoffeeShop',
    'Campground', 'Casino', 'ClothingStore', 'CommunityHealth', 'ComedyClub', 'ComputerStore',
    'ConvenienceStore', 'CovidTestingFacility', 'DaySpa', 'DepartmentStore', 'Distillery',
    'DryCleaningOrLaundry', 'ElectronicsStore', 'Dermatology', 'DietNutrition', 'Emergency',
    'ExerciseGym', 'FastFoodRestaurant', 'FireStation', 'Florist', 'FurnitureStore', 'GardenStore',
    'GasStation', 'Geriatric', 'GolfCourse', 'GroceryStore', 'Gynecologic', 'HairSalon',
    'HardwareStore', 'HealthClub', 'HobbyShop', 'HomeGoodsStore', 'Hospital', 'Hostel',
    'IceCreamShop', 'InsuranceAgency', 'JewelryStore', 'LiquorStore', 'MedicalClinic',
    'MensClothingStore', 'Midwifery', 'MobilePhoneStore', 'Motel', 'MotorcycleDealer',
    'MotorcycleRepair', 'MovieRentalStore', 'MovieTheater', 'MusicStore', 'NailSalon',
    'NightClub', 'Nursing', 'Obstetric', 'Oncologic', 'Optician', 'Optometric', 'OfficeEquipmentStore',
    'Otolaryngologic', 'OutletStore', 'PawnShop', 'Pediatric', 'Pharmacy', 'Physiotherapy',
    'PlasticSurgery', 'Podiatric', 'PoliceStation', 'PostOffice', 'PrimaryCare', 'Psychiatric',
    'PublicHealth', 'PublicSwimmingPool', 'PetStore', 'Resort', 'ShoeStore', 'SkiResort',
    'SportingGoodsStore', 'SportsClub', 'TattooParlor', 'TennisComplex', 'TireShop', 'ToyStore',
    'Urologic', 'VeterinaryCare', 'Winery', 'WholesaleStore', ];

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

    // Fix round 1, CRITICAL 2a: the old `/logo` doc page now redirects to
    // `/organization` — point at the live URL directly.
    Organization: {
      required: ['name', 'url', 'logo'],
      recommended: ['sameAs', 'contactPoint'],
      sourceUrl: GOOGLE_DOCS + 'organization'
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

    // Fix round 1, CRITICAL 2b: FAQ and How-to rich results are
    // discontinued (Google Search Central updates: FAQ removed 2026-05/06,
    // How-to removed) — FAQPage/HowTo stay here as valid, checkable markup
    // (sourceUrl now schema.org, not the retired Google feature doc) but are
    // removed from RICH_RESULT_FEATURES/ELIGIBLE_ORDER below, so a complete
    // item never appears in `eligible`.
    FAQPage: {
      required: ['mainEntity'],
      recommended: [],
      sourceUrl: SCHEMA_ORG + 'FAQPage'
    },

    HowTo: {
      required: ['name', 'step'],
      recommended: ['image', 'totalTime', 'estimatedCost'],
      sourceUrl: SCHEMA_ORG + 'HowTo'
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

    // Fix round 1, CRITICAL 2c: sitelinks search box is discontinued —
    // `potentialAction` dropped from recommended, sourceUrl moved to
    // schema.org (WebSite itself is not a retired rich result, it's simply
    // never something Google Search Central documented as one beyond the
    // search-box feature this required set predates).
    WebSite: {
      required: ['name', 'url'],
      recommended: [],
      sourceUrl: SCHEMA_ORG + 'WebSite'
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

  // Fix round 1, CRITICAL 1c: build every LocalBusiness subtype's alias
  // entry from the one array above instead of hand-listing ~10 of them —
  // `Plumber`, `HVACBusiness`, etc. now all resolve to LocalBusiness's
  // required/recommended/sourceUrl the same way `Restaurant` always did.
  LOCAL_BUSINESS_SUBTYPES.forEach(t => {
    if (!TYPE_SPECS[t]) TYPE_SPECS[t] = { alias: 'LocalBusiness' };
  });

  // Fix round 1, CRITICAL 1a: the schema.org core-type name oracle. This is
  // NOT "types we have a required-property list for" (TYPE_SPECS, above) —
  // it's the much larger set of names that are real schema.org types,
  // whether or not we happen to validate their properties yet. A type
  // missing from TYPE_SPECS but present here (e.g. `Service`) gets a `note`
  // instead of an `Unknown type` problem; a type missing from BOTH (e.g. a
  // typo, or a made-up type) is the only case that's actually "Unknown
  // type". Name-only, no URLs — schema.org's own CC BY-SA already covers
  // this list via the credits panel's license entry, not a per-name credit.
  // Generous rather than exhaustive (per the fix brief: "a few hundred
  // names"), grouped roughly along the Thing hierarchy's five main
  // branches (CreativeWork, Organization, Person, Place, Event/Action/
  // Intangible/Product).
  const CORE_TYPES = new Set([
    'Thing',

    // ---- CreativeWork subtree ----
    'CreativeWork', 'Article', 'NewsArticle', 'BlogPosting', 'Report', 'TechArticle', 'SocialMediaPosting',
    'AdvertiserContentArticle', 'OpinionNewsArticle', 'ReviewNewsArticle', 'SatiricalArticle', 'ScholarlyArticle',
    'MedicalScholarlyArticle', 'Blog', 'Book', 'Audiobook', 'Movie', 'MusicComposition', 'MusicPlaylist',
    'MusicAlbum', 'MusicRecording', 'Painting', 'Photograph', 'Sculpture', 'VisualArtwork', 'CoverArt',
    'WebPage', 'WebSite', 'AboutPage', 'CheckoutPage', 'CollectionPage', 'MediaGallery', 'ImageGallery',
    'VideoGallery', 'ContactPage', 'FAQPage', 'QAPage', 'ItemPage', 'MedicalWebPage', 'ProfilePage',
    'RealEstateListing', 'SearchResultsPage', 'Recipe', 'Review', 'ClaimReview', 'CriticReview',
    'EmployerReview', 'UserReview', 'Course', 'HowTo', 'Dataset', 'DataCatalog', 'Diet', 'DigitalDocument',
    'NoteDigitalDocument', 'PresentationDigitalDocument', 'SpreadsheetDigitalDocument',
    'TextDigitalDocument', 'Episode', 'Season', 'Series', 'TVSeries', 'RadioSeries', 'VideoGameSeries',
    'BookSeries', 'Periodical', 'ComicSeries', 'Newspaper',  'PodcastEpisode', 'PodcastSeries',
    'Game', 'VideoGame', 'Guide', 'HowToStep', 'HowToSection', 'HowToDirection', 'HowToTip', 'HowToSupply',
    'HowToTool', 'ImageObject', 'Barcode', 'MediaObject', 'AudioObject', 'VideoObject', 'DataFeed',
    'CompleteDataFeed', 'Map', 'Menu', 'MenuSection', 'MenuItem', 'Message', 'EmailMessage', 'PublicationIssue',
    'ComicIssue', 'PublicationVolume', 'Comment', 'Answer', 'Question',  'WebPageElement',
    'SiteNavigationElement', 'Table', 'WPAdBlock', 'WPFooter', 'WPHeader', 'WPSideBar', 'WebApplication',
    'SoftwareApplication', 'MobileApplication', 'VideoGameClip',  'ShortStory', 'Poster',
    'Statement', 'Certification', 'ArchiveComponent', 'DefinedTerm', 'DefinedTermSet', 'CategoryCodeSet',
    'CategoryCode', 'Chapter', 'ClaimReview', 'Code', 'Conversation', 'Clip', 'MovieClip', 'RadioClip',
    'TVClip', 'CreativeWorkSeason', 'CreativeWorkSeries', 'ExercisePlan', 'Legislation', 'LegislationObject',
    'MathSolver', 'Painting', 'Play',  'ShortStory', 'SpecialAnnouncement', 'Manuscript',

    // ---- Organization subtree ----
    'Organization', 'Airline', 'Consortium', 'Corporation', 'EducationalOrganization', 'CollegeOrUniversity',
    'ElementarySchool', 'HighSchool', 'MiddleSchool', 'Preschool', 'School', 'FundingScheme',
    'GovernmentOrganization', 'LibrarySystem', 'MedicalOrganization', 'Hospital', 'Pharmacy',
    'NGO', 'NewsMediaOrganization', 'OnlineBusiness', 'OnlineStore', 'PerformingGroup', 'DanceGroup',
    'MusicGroup', 'TheaterGroup', 'Project', 'FundingAgency', 'ResearchProject', 'SearchRescueOrganization',
    'SportsOrganization', 'SportsTeam', 'WorkersUnion',

    // ---- LocalBusiness (see LOCAL_BUSINESS_SUBTYPES above; merged in below) ----
    'LocalBusiness', 'CivicStructure',

    // ---- Person ----
    'Person', 'PerformingGroup',

    // ---- Place subtree ----
    'Place', 'Accommodation', 'Apartment', 'CampingPitch', 'House', 'SingleFamilyResidence', 'Room',
    'HotelRoom', 'MeetingRoom', 'ApartmentComplex', 'GatedResidenceCommunity', 'AdministrativeArea',
    'City', 'Country', 'State', 'SchoolDistrict', 'Airport', 'Aquarium', 'Beach', 'BoatTerminal',
    'Bridge', 'BusStation', 'BusStop', 'Cemetery', 'Crematorium', 'EventVenue', 'FireStation',
    'GovernmentBuilding', 'CityHall', 'Courthouse', 'DefenceEstablishment', 'Embassy',
    'LegislativeBuilding', 'Museum', 'MusicVenue', 'Park', 'ParkingFacility', 'PerformingArtsTheater',
    'PlaceOfWorship', 'BuddhistTemple', 'Church', 'CatholicChurch', 'HinduTemple', 'Mosque', 'Synagogue',
    'Playground', 'PoliceStation', 'PublicToilet', 'RVPark', 'StadiumOrArena', 'SubwayStation',
    'TaxiStand', 'TrainStation',  'Zoo', 'Residence', 'LandmarksOrHistoricalBuildings',
    'GeoCoordinates', 'GeoShape', 'GeoCircle', 'Landform', 'BodyOfWater', 'Canal', 'LakeBodyOfWater',
    'OceanBodyOfWater', 'Pond', 'Reservoir', 'RiverBodyOfWater', 'SeaBodyOfWater', 'Waterfall', 'Continent',
    'Mountain',  'Volcano', 'TouristAttraction', 'TouristDestination', 'TouristTrip',
    

    // ---- Product / commerce ----
    'Product', 'ProductModel', 'ProductGroup', 'ProductCollection', 'SomeProducts', 'Vehicle', 'Car',
    'Motorcycle', 'BusOrCoach', 'MotorizedBicycle', 'IndividualProduct', 'Offer', 'AggregateOffer',
    'Demand', 'Service', 'BroadcastService', 'CableOrSatelliteService', 'FinancialProduct',
    'BankAccount', 'DepositAccount', 'InvestmentOrDeposit', 'InvestmentFund', 'LoanOrCredit',
    'CreditCard', 'MortgageLoan', 'PaymentCard', 'PaymentService', 'Trip', 'BoatTrip', 'BusTrip',
    'Flight', 'TrainTrip', 'FoodService', 'BikeStore', 'Brand', 'ContactPoint', 'PostalAddress',
    'Rating', 'AggregateRating', 'MonetaryAmount', 'MonetaryAmountDistribution', 'QuantitativeValue',
    'QuantitativeValueDistribution', 'OpeningHoursSpecification', 'PropertyValue', 'PropertyValueSpecification',
    'StructuredValue', 'Duration', 'Schedule', 'ProgramMembership', 'MerchantReturnPolicy',
    'MerchantReturnPolicySeasonalOverride', 'ShippingDeliveryTime', 'ShippingRateSettings',
    'ShippingConditions', 'ShippingService',  'WarrantyPromise', 'WarrantyScope',
    'TypeAndQuantityNode', 'UnitPriceSpecification', 'PriceSpecification', 'CompoundPriceSpecification',
    'ItemList', 'ListItem', 'BreadcrumbList', 'HowToItem', 'Audience', 'BusinessAudience', 'EducationalAudience',
    'MedicalAudience', 'PeopleAudience', 'Researcher', 'Occupation', 'OccupationalExperienceRequirements',
    'JobPosting', 'EducationalOccupationalCredential', 'EducationalOccupationalProgram', 'WorkBasedProgram',
    'Class', 'Property', 'Enumeration', 'Language', 'ComputerLanguage', 'GenderType', 'BusinessEntityType',
    'BusinessFunction', 'DayOfWeek', 'ItemAvailability', 'OfferItemCondition', 'PaymentMethod', 'PaymentStatusType',
    'PhysicalActivityCategory', 'RefundTypeEnumeration', 'ReturnFeesEnumeration', 'ReturnMethodEnumeration',
    'DeliveryMethod', 'MeasurementTypeEnumeration', 'BedType', 'DriveWheelConfigurationValue',
    'SteeringPositionValue', 'SizeSpecification', 'BodyMeasurementTypeEnumeration', 'MedicalEnumeration',

    // ---- Event subtree ----
    'Event', 'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance', 'DanceEvent',
    'DeliveryEvent', 'EducationEvent', 'EventSeries', 'ExhibitionEvent', 'Festival', 'FoodEvent',
    'Hackathon', 'LiteraryEvent', 'MusicEvent', 'PublicationEvent', 'BroadcastEvent', 'OnDemandEvent',
    'SaleEvent', 'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent',
    'UserInteraction', 'UserBlocks', 'UserCheckins', 'UserComments', 'UserDownloads', 'UserLikes',
    'UserPageVisits', 'UserPlays', 'UserPlusOnes', 'UserTweets',

    // ---- Action subtree ----
    'Action', 'AchieveAction', 'LoseAction', 'TieAction', 'WinAction', 'AssessAction', 'ChooseAction',
    'VoteAction', 'IgnoreAction', 'ReactAction', 'AgreeAction', 'DisagreeAction', 'DislikeAction',
    'EndorseAction', 'LikeAction', 'WantAction', 'ReviewAction', 'ConsumeAction', 'EatAction',
    'DrinkAction', 'InstallAction', 'ListenAction', 'PlayGameAction', 'ReadAction', 'UseAction',
    'ViewAction', 'WatchAction', 'CreateAction', 'CookAction', 'DrawAction', 'FilmAction', 'PaintAction',
    'PhotographAction', 'WriteAction', 'FindAction', 'DiscoverAction', 'TrackAction', 'InteractAction',
    'BefriendAction', 'CommunicateAction', 'AskAction', 'CheckInAction', 'CheckOutAction', 'CommentAction',
    'InformAction', 'ConfirmAction', 'RsvpAction', 'InviteAction', 'ReplyAction', 'ShareAction',
    'FollowAction', 'JoinAction', 'LeaveAction', 'MarryAction', 'RegisterAction', 'SubscribeAction',
    'UnRegisterAction', 'MoveAction', 'ArriveAction', 'DepartAction', 'TravelAction', 'OrganizeAction',
    'AllocateAction', 'AcceptAction', 'AssignAction', 'AuthorizeAction', 'RejectAction', 'ApplyAction',
     'PlanAction', 'CancelAction', 'ReserveAction', 'ScheduleAction', 'PlayAction',
    'ExerciseAction', 'PerformAction', 'SearchAction', 'BuyAction', 'DonateAction', 'OrderAction',
    'PayAction', 'PreOrderAction', 'QuoteAction', 'RentAction', 'SellAction', 'TipAction', 'TradeAction',
    'TransferAction', 'BorrowAction', 'DownloadAction', 'GiveAction', 'LendAction', 'MoneyTransfer',
    'ReceiveAction', 'ReturnAction', 'SendAction', 'TakeAction', 'UpdateAction', 'AddAction',
    'InsertAction', 'AppendAction', 'PrependAction', 'DeleteAction', 'ReplaceAction'
  ]);

  // Merge in the LocalBusiness subtypes and every TYPE_SPECS key — every
  // type we ship a required/recommended list for is, tautologically, a
  // recognized schema.org type, so this also guarantees CORE_TYPES can
  // never fall behind TYPE_SPECS (a type added to one without the other
  // would otherwise silently start reporting "Unknown type").
  LOCAL_BUSINESS_SUBTYPES.forEach(t => CORE_TYPES.add(t));
  Object.keys(TYPE_SPECS).forEach(t => CORE_TYPES.add(t));

  // Fix round 1, CRITICAL 1b: strip a "schema:" CURIE prefix or a full
  // schema.org URL down to the bare type name before any lookup — a type
  // written as `https://schema.org/Person` or `schema:Person` is exactly as
  // valid as `Person`, just spelled out longhand.
  function normalizeTypeName(type) {
    if (!type || typeof type !== 'string') return type;
    let t = type.trim();
    t = t.replace(/^https?:\/\/schema\.org\//i, '');
    t = t.replace(/^schema:/i, '');
    return t;
  }

  function resolveSpec(type) {
    if (!type) return null;
    const spec = TYPE_SPECS[type];
    if (!spec) return null;
    return spec.alias ? TYPE_SPECS[spec.alias] : spec;
  }

  // Fix round 1, CRITICAL 1b: "known to schema.org" (CORE_TYPES) is a
  // strictly larger set than "we have a required-property spec for it"
  // (TYPE_SPECS) — see the CORE_TYPES comment above. isKnownType is what
  // drives the `Unknown type` problem; resolveSpec (above) is what drives
  // required/recommended/sourceUrl and is allowed to come back empty for a
  // perfectly well-known type.
  function isKnownType(type) {
    return CORE_TYPES.has(type);
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
  // predictable sequence. Fix round 1, CRITICAL 2b: FAQ and HowTo removed —
  // Google no longer shows either rich result, so no `@type` should ever
  // map to one here (FAQPage/HowTo remain fully validated via TYPE_SPECS
  // above; they're just never "eligible").
  const RICH_RESULT_FEATURES = {
    Article: 'Article', NewsArticle: 'Article', BlogPosting: 'Article',
    Product: 'Product',
    Recipe: 'Recipe',
    Event: 'Event',
    VideoObject: 'Video',
    BreadcrumbList: 'Breadcrumb',
    JobPosting: 'JobPosting'
  };
  LOCAL_BUSINESS_SUBTYPES.forEach(t => { RICH_RESULT_FEATURES[t] = 'LocalBusiness'; });
  RICH_RESULT_FEATURES.LocalBusiness = 'LocalBusiness';
  const ELIGIBLE_ORDER = ['Article', 'Product', 'Recipe', 'Event', 'Video', 'Breadcrumb', 'LocalBusiness', 'JobPosting'];

  // Fix round 1, CRITICAL 2b: types whose markup is still fully validated
  // but whose rich result Google has retired — the popup renders a muted
  // "valid markup, no rich result" note for these instead of counting them
  // toward Eligible for (see validateItem's `retiredRichResult` field).
  const RETIRED_RICH_RESULT_TYPES = { FAQPage: true, HowTo: true };

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

  // Fix round 1, MINOR 10: accept a bare year or year-month (both valid
  // ISO 8601 date representations, and common for datePublished on older
  // content) as well as a full date/datetime. Any value that specifies a
  // day gets a sanity check — a string can match the shape
  // (`\d{4}-\d{2}-\d{2}`) and still name a calendar date that doesn't exist
  // (2026-02-30). Number.isNaN(Date.parse(v)) alone doesn't catch that: V8's
  // Date.parse *rolls over* an out-of-range day (2026-02-30 silently becomes
  // 2026-03-02) rather than returning NaN, so isValidCalendarDate below
  // re-derives the date from its own year/month/day and checks nothing
  // rolled over — Date.parse's NaN case is kept as a first, cheap check for
  // anything else that's simply unparseable. A bare year or year-month has
  // no day to be invalid, so both checks are skipped entirely.
  const ISO_8601_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/;
  const ISO_8601_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

  function isValidCalendarDate(year, month, day) {
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  }

  function isIso8601(v) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (!ISO_8601_RE.test(s)) return false;
    const dayMatch = s.match(ISO_8601_DAY_RE);
    if (dayMatch) {
      if (Number.isNaN(Date.parse(s))) return false;
      const [, y, mo, d] = dayMatch;
      if (!isValidCalendarDate(Number(y), Number(mo), Number(d))) return false;
    }
    return true;
  }

  // Fix round 1, IMPORTANT 4: iterate every offer (not just the first),
  // distinguish AggregateOffer's lowPrice/priceCurrency requirement from a
  // plain Offer's price/priceCurrency one, treat a `priceSpecification` as
  // satisfying "priced" the same as a bare `price` would, and emit one
  // indexed message per offending offer (no de-duped/blanket "offers
  // missing price" that can't tell you which one).
  function checkOffers(properties, problems) {
    const offers = toArray(properties.offers);
    offers.forEach((raw, idx) => {
      const props = nestedProps(raw);
      if (!props) return;
      const label = `offers[${idx}]`;
      if (nestedType(raw) === 'AggregateOffer') {
        if (!hasValue(props.lowPrice)) problems.push(`${label} missing lowPrice`);
        if (!hasValue(props.priceCurrency)) problems.push(`${label} missing priceCurrency`);
        return;
      }
      const priced = hasValue(props.price) || hasValue(props.priceSpecification);
      if (!priced) problems.push(`${label} missing price`);
      if (!hasValue(props.priceCurrency)) problems.push(`${label} missing priceCurrency`);
    });
  }

  function checkDatePublished(properties, problems) {
    const v = properties.datePublished;
    if (hasValue(v) && typeof v === 'string' && !isIso8601(v)) {
      problems.push('datePublished not an ISO 8601 date');
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
  // options.nested (fix round 1, MINOR 13): true when this item is being
  // validated as the value of another item's property rather than as its
  // own top-level structured-data block — currently unused by any caller
  // (nothing in this module re-validates a nested value on its own yet),
  // but wired through now so a future caller doing that doesn't also have
  // to re-derive the AggregateRating special case below.
  // Returns { type, source, required: { missing, present }, recommended:
  // { missing }, problems, note?, retiredRichResult }, plus the original
  // `properties` passed through (not in the brief's four-field list, but
  // the popup's "Copy JSON-LD" button needs the raw data and re-deriving it
  // would mean carrying the whole item around a second time).
  function validateItem(item, options) {
    const opts = options || {};
    const rawType = item && item.type;
    const type = normalizeTypeName(rawType);
    const source = item && item.source;
    const properties = (item && item.properties) || {};
    const spec = resolveSpec(type);

    // Fix round 1, MINOR 13: itemReviewed only makes sense to require when
    // an AggregateRating stands alone — nested inside the very entity it
    // rates (the overwhelmingly common real-world shape), the entity is
    // already implicit.
    let required = spec ? spec.required.slice() : [];
    if (type === 'AggregateRating' && opts.nested) {
      required = required.filter(f => f !== 'itemReviewed');
    }
    const recommended = spec ? spec.recommended : [];

    const missingRequired = required.filter(f => !hasValue(properties[f]));
    const presentRequired = required.filter(f => hasValue(properties[f]));
    const missingRecommended = recommended.filter(f => !hasValue(properties[f]));

    const problems = [];
    // Fix round 1, CRITICAL 1b: "Unknown type" now means "not a real
    // schema.org type" (CORE_TYPES), not "we don't validate this type's
    // properties" (TYPE_SPECS/spec) — a known type with no spec gets a
    // `note` below instead.
    if (type && !isKnownType(type)) problems.push(`Unknown type: ${type}`);
    checkOffers(properties, problems);
    checkDatePublished(properties, problems);
    checkImage(properties, problems);
    checkBreadcrumb(type, properties, problems);
    checkFaq(type, properties, problems);

    const result = {
      type,
      source,
      required: { missing: missingRequired, present: presentRequired },
      recommended: { missing: missingRecommended },
      problems,
      properties
    };

    if (type && isKnownType(type) && !spec) {
      result.note = 'No required-property list for this type';
    }

    // Fix round 1, CRITICAL 2b: a complete FAQPage/HowTo item is valid
    // markup that Google no longer turns into a rich result — flagged here
    // so the popup can render that distinction instead of silently omitting
    // it from Eligible for with no explanation.
    result.retiredRichResult = !!(RETIRED_RICH_RESULT_TYPES[type] && missingRequired.length === 0);

    return result;
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

  // Fix round 1, IMPORTANT 5: strip every item's raw `properties` (property
  // NAMES already surface via required/recommended chip lists and CSV
  // export — VALUES are what must never leave the device via a synced
  // capture) before the result is handed to autoSaveCapture/autoSaveLocal.
  // Shallow per item — required/recommended/problems/note/retiredRichResult
  // all pass through untouched — and non-destructive: it returns a new
  // object, so the in-memory copy the popup renders from (and that "Copy
  // JSON-LD" reads `properties` off) is never mutated.
  function stripForStorage(result) {
    if (!result || !Array.isArray(result.items)) return result;
    return Object.assign({}, result, {
      items: result.items.map(item => {
        if (!item || typeof item !== 'object') return item;
        const rest = Object.assign({}, item);
        delete rest.properties;
        return rest;
      })
    });
  }

  return {
    extractJsonLd,
    extractMicrodata,
    extractRdfa,
    REQUIRED,
    RECOMMENDED,
    SOURCE_URLS,
    validateItem,
    validateAll,
    stripForStorage
  };
});
