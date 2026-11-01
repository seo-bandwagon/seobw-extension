// SEO Bandwagon — NAP extraction from a directory listing
//
// Reads a business's name, address, phone and website from the page the
// popup's Citations tab is checking: JSON-LD first, then Microdata, then the
// page's visible text. src/content/nap-extractor.js injects this file and
// answers the tab's `extractNap` message with extractNap(document, location).
//
// 1.10.3:
// - Every schema.org LocalBusiness and Organization subtype counts, so a
//   Dentist, Plumber or Attorney listing is read from its structured data
//   (until then only nine type names were, matched as substrings, and a
//   `"@type": ["Dentist", ...]` array never matched at all).
// - The website is the business's own, never the directory's: on a listing,
//   the JSON-LD `url`, the Microdata `url` and the fallback were the
//   directory's own page, so the website never matched. A link to the page's
//   own site counts only when it forwards to another site (Yelp's
//   `/biz_redir?url=...`). Nothing found is '' (not compared), not a guess.
//
// Dual-export pattern (see src/lib/citations-ui.js / src/lib/api.js):
// attaches to `globalThis.SBWNapExtract` when loaded as a classic script, and
// exports via CommonJS when loaded by Vitest / Node. Reads the DOM it is
// given, sends nothing.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWNapExtract = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const ADDRESS_RE = /\d{1,5}\s+[\w\s.]+(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|dr(?:ive)?|rd|road|ln|lane|ct|court|way|pl(?:ace)?|cir(?:cle)?)[.,]?\s+[\w\s]+,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/gi;

  // schema.org's LocalBusiness and Organization trees (schema.org 29.x),
  // every level, so a listing typed with the narrowest type still counts.
  const BUSINESS_TYPES = new Set([
    'Organization', 'LocalBusiness', 'Corporation', 'NGO', 'OnlineBusiness', 'OnlineStore',
    'ProfessionalService', 'MedicalOrganization', 'EducationalOrganization', 'SportsOrganization',
    'NewsMediaOrganization', 'PerformingGroup', 'Airline', 'Consortium', 'FundingScheme',
    'GovernmentOrganization', 'LibrarySystem', 'ResearchOrganization', 'WorkersUnion',
    'AnimalShelter', 'ArchiveOrganization', 'ChildCare', 'DryCleaningOrLaundry',
    'EmploymentAgency', 'InternetCafe', 'Library', 'RadioStation', 'RealEstateAgent',
    'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'TelevisionStation',
    'TouristInformationCenter', 'TravelAgency', 'GovernmentOffice', 'PostOffice',
    // AutomotiveBusiness
    'AutomotiveBusiness', 'AutoBodyShop', 'AutoDealer', 'AutoPartsStore', 'AutoRental',
    'AutoRepair', 'AutoWash', 'GasStation', 'MotorcycleDealer', 'MotorcycleRepair',
    // EmergencyService
    'EmergencyService', 'FireStation', 'Hospital', 'PoliceStation',
    // EntertainmentBusiness
    'EntertainmentBusiness', 'AdultEntertainment', 'AmusementPark', 'ArtGallery', 'Casino',
    'ComedyClub', 'MovieTheater', 'NightClub',
    // FinancialService
    'FinancialService', 'AccountingService', 'AutomatedTeller', 'BankOrCreditUnion', 'InsuranceAgency',
    // FoodEstablishment
    'FoodEstablishment', 'Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery',
    'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery',
    // HealthAndBeautyBusiness
    'HealthAndBeautyBusiness', 'BeautySalon', 'DaySpa', 'HairSalon', 'HealthClub', 'NailSalon',
    'TattooParlor',
    // HomeAndConstructionBusiness
    'HomeAndConstructionBusiness', 'Electrician', 'GeneralContractor', 'HVACBusiness',
    'HousePainter', 'Locksmith', 'MovingCompany', 'Plumber', 'RoofingContractor',
    // LegalService
    'LegalService', 'Attorney', 'Notary',
    // LodgingBusiness
    'LodgingBusiness', 'BedAndBreakfast', 'Campground', 'Hostel', 'Hotel', 'Motel', 'Resort',
    'SkiResort', 'VacationRental',
    // MedicalBusiness and MedicalOrganization
    'MedicalBusiness', 'CommunityHealth', 'Dentist', 'Dermatology', 'DietNutrition', 'Emergency',
    'Geriatric', 'Gynecologic', 'MedicalClinic', 'CovidTestingFacility', 'Midwifery', 'Nursing',
    'Obstetric', 'Oncologic', 'Optician', 'Optometric', 'Otolaryngologic', 'Pediatric', 'Pharmacy',
    'Physician', 'IndividualPhysician', 'PhysiciansOffice', 'Physiotherapy', 'PlasticSurgery',
    'Podiatric', 'PrimaryCare', 'Psychiatric', 'PublicHealth', 'DiagnosticLab', 'VeterinaryCare',
    // SportsActivityLocation
    'SportsActivityLocation', 'BowlingAlley', 'ExerciseGym', 'GolfCourse', 'PublicSwimmingPool',
    'SportsClub', 'StadiumOrArena', 'TennisComplex',
    // Store
    'Store', 'BikeStore', 'BookStore', 'ClothingStore', 'ComputerStore', 'ConvenienceStore',
    'DepartmentStore', 'ElectronicsStore', 'Florist', 'FurnitureStore', 'GardenStore',
    'GroceryStore', 'HardwareStore', 'HobbyShop', 'HomeGoodsStore', 'JewelryStore', 'LiquorStore',
    'MensClothingStore', 'MobilePhoneStore', 'MovieRentalStore', 'MusicStore',
    'OfficeEquipmentStore', 'OutletStore', 'PawnShop', 'PetStore', 'ShoeStore',
    'SportingGoodsStore', 'TireShop', 'ToyStore', 'WholesaleStore'
  ]);

  // Query parameters a directory's "visit website" redirector carries the
  // business's address in.
  const REDIRECT_PARAMS = ['url', 'u', 'q', 'to', 'target', 'dest', 'destination', 'redirect', 'redirect_url', 'website', 'link', 'href'];

  // A link that says it is the business's website.
  const WEBSITE_LABEL_RE = /\b(?:website|web ?site|visit (?:the )?(?:web)?site|homepage|home page)\b/i;
  // Link text that is itself an address: "joesplumbing.com", "www.joes.co.uk/denver".
  const BARE_DOMAIN_RE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i;

  // A type name as written in JSON-LD or Microdata: "Dentist",
  // "schema:Dentist" or "https://schema.org/Dentist" all read "Dentist".
  function typeName(t) {
    return String(t || '').trim().replace(/^.*[/#:]/, '');
  }

  function typesOf(node) {
    const t = node && node['@type'];
    return (Array.isArray(t) ? t : [t]).map(typeName).filter(Boolean);
  }

  function isBusinessType(name) {
    return BUSINESS_TYPES.has(typeName(name));
  }

  function isBusinessNode(node) {
    return !!node && typeof node === 'object' && typesOf(node).some(isBusinessType);
  }

  // Every node in the page's JSON-LD: top-level objects, arrays and @graph
  // members, in page order.
  function jsonLdNodes(doc) {
    const out = [];
    const visit = (v, depth) => {
      if (!v || depth > 3) return;
      if (Array.isArray(v)) { v.forEach(x => visit(x, depth + 1)); return; }
      if (typeof v !== 'object') return;
      out.push(v);
      if (v['@graph']) visit(v['@graph'], depth + 1);
      if (v.mainEntity) visit(v.mainEntity, depth + 1);
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try { visit(JSON.parse(script.textContent), 0); } catch (e) { /* malformed JSON-LD, skip */ }
    });
    return out;
  }

  // The part of a host two sites share when they are the same site:
  // "biz.yelp.com" and "www.yelp.com" are both "yelp.com"; "shop.example.co.uk"
  // is "example.co.uk".
  function siteOf(host) {
    const labels = String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '').split('.').filter(Boolean);
    if (labels.length <= 2) return labels.join('.');
    const last = labels[labels.length - 1];
    const second = labels[labels.length - 2];
    const keep = last.length === 2 && second.length <= 3 ? 3 : 2;
    return labels.slice(-keep).join('.');
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  function isWebUrl(url) {
    try { return /^https?:$/.test(new URL(url).protocol); } catch (e) { return false; }
  }

  // An http(s) address on another site than the page's, or ''. A link on the
  // page's own site counts when it forwards to another one in its query.
  function offSite(raw, pageUrl) {
    if (!raw) return '';
    let url;
    try { url = new URL(String(raw).trim(), pageUrl); } catch (e) { return ''; }
    if (!/^https?:$/.test(url.protocol)) return '';
    const pageSite = siteOf(hostOf(pageUrl));
    if (siteOf(url.hostname) !== pageSite) return url.href;
    for (const name of REDIRECT_PARAMS) {
      const v = url.searchParams.get(name);
      if (!v) continue;
      const target = /^https?:\/\//i.test(v) ? v : (BARE_DOMAIN_RE.test(v) ? 'https://' + v : '');
      if (target && isWebUrl(target) && siteOf(hostOf(target)) !== pageSite) return new URL(target).href;
    }
    return '';
  }

  // The first of the candidates that is another site's address.
  function firstOffSite(candidates, pageUrl) {
    for (const c of candidates) {
      const hit = offSite(c, pageUrl);
      if (hit) return hit;
    }
    return '';
  }

  // The business's website as the page links it: a link labelled as the
  // website (its text, title or aria-label), else a link whose text is an
  // address, on another site than the directory's.
  function websiteFromLinks(doc, pageUrl, scope) {
    const links = Array.from((scope || doc).querySelectorAll('a[href]'));
    const label = a => [a.textContent, a.getAttribute('title'), a.getAttribute('aria-label')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const labelled = links.filter(a => WEBSITE_LABEL_RE.test(label(a)) || a.getAttribute('itemprop') === 'url');
    const bare = links.filter(a => BARE_DOMAIN_RE.test((a.textContent || '').trim()));
    return firstOffSite(labelled.concat(bare).map(a => a.getAttribute('href')), pageUrl);
  }

  // A JSON-LD node's own website: its url, when on another site. Not sameAs,
  // which lists social profiles rather than the website.
  function nodeWebsite(node, pageUrl) {
    return typeof node.url === 'string' ? offSite(node.url, pageUrl) : '';
  }

  // The listing's business among the page's nodes: one with an address or a
  // phone, else one whose own url is another site. The directory's own
  // Organization node (its name and logo, often first on the page) is
  // neither, so a page that has only that falls through to Microdata and the
  // page's text instead of reading the directory's name as the listing's.
  function listingNode(nodes, pageUrl) {
    const businesses = nodes.filter(isBusinessNode);
    return businesses.find(n => n.address || n.telephone) ||
      businesses.find(n => nodeWebsite(n, pageUrl)) || null;
  }

  function addressText(addr) {
    if (!addr) return '';
    if (typeof addr === 'string') return addr.trim();
    if (Array.isArray(addr)) return addressText(addr[0]);
    return [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
      .filter(Boolean).join(', ');
  }

  function extractFromJsonLd(doc, pageUrl) {
    const node = listingNode(jsonLdNodes(doc), pageUrl);
    if (!node) return null;
    const phone = Array.isArray(node.telephone) ? node.telephone[0] : node.telephone;
    return {
      name: typeof node.name === 'string' ? node.name.trim() : '',
      address: addressText(node.address),
      phone: phone ? String(phone).trim() : '',
      website: nodeWebsite(node, pageUrl) || websiteFromLinks(doc, pageUrl),
      source: 'json-ld'
    };
  }

  function extractFromMicrodata(doc, pageUrl) {
    const scope = Array.from(doc.querySelectorAll('[itemscope][itemtype]'))
      .find(el => (el.getAttribute('itemtype') || '').split(/\s+/).some(isBusinessType));
    if (!scope) return null;

    const getProp = (prop) => {
      const el = scope.querySelector(`[itemprop="${prop}"]`);
      if (!el) return '';
      return (el.getAttribute('content') || el.getAttribute('href') || el.textContent || '').trim();
    };

    const name = getProp('name');
    if (!name) return null;

    const address = [getProp('streetAddress'), getProp('addressLocality'), getProp('addressRegion'), getProp('postalCode')]
      .filter(Boolean).join(', ');

    return {
      name,
      address,
      phone: getProp('telephone'),
      website: offSite(getProp('url'), pageUrl) || websiteFromLinks(doc, pageUrl, scope) || websiteFromLinks(doc, pageUrl),
      source: 'microdata'
    };
  }

  function extractHeuristic(doc, pageUrl) {
    const result = { name: '', address: '', phone: '', website: '', source: 'heuristic' };

    // Business name: first <h1>, or og:title, or document title
    const h1 = doc.querySelector('h1');
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    result.name = (h1?.textContent || ogTitle?.getAttribute('content') || doc.title || '').trim();
    // Clean up common suffixes
    result.name = result.name.replace(/\s*[-|–—]\s*.+$/, '').trim();

    const bodyText = (doc.body && (doc.body.innerText || doc.body.textContent)) || '';
    const phones = bodyText.match(PHONE_RE);
    if (phones && phones.length > 0) result.phone = phones[0].trim();
    const addresses = bodyText.match(ADDRESS_RE);
    if (addresses && addresses.length > 0) result.address = addresses[0].trim();

    // Only return if we found at least a name and one other field
    if (!(result.name && (result.phone || result.address))) return null;
    result.website = websiteFromLinks(doc, pageUrl);
    return result;
  }

  /** Structured data first, then the page's text. */
  function extractNap(doc, pageUrl) {
    return extractFromJsonLd(doc, pageUrl) || extractFromMicrodata(doc, pageUrl) || extractHeuristic(doc, pageUrl);
  }

  return {
    BUSINESS_TYPES,
    typesOf,
    isBusinessType,
    isBusinessNode,
    jsonLdNodes,
    siteOf,
    offSite,
    websiteFromLinks,
    extractNap
  };
});
