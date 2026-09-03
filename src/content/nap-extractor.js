// NAP Extractor — injected on demand to extract business NAP data from the current page

(function() {
  // Guard against double-injection
  if (window.__napExtractorLoaded) return;
  window.__napExtractorLoaded = true;

  const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const ADDRESS_RE = /\d{1,5}\s+[\w\s.]+(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|dr(?:ive)?|rd|road|ln|lane|ct|court|way|pl(?:ace)?|cir(?:cle)?)[.,]?\s+[\w\s]+,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/gi;

  /**
   * Extract NAP from JSON-LD structured data (LocalBusiness, Organization, etc.)
   */
  function extractFromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        let data = JSON.parse(script.textContent);
        if (Array.isArray(data)) data = data[0];
        if (data['@graph']) data = data['@graph'].find(
          item => ['LocalBusiness', 'Organization', 'Restaurant', 'Store',
            'MedicalBusiness', 'LegalService', 'ProfessionalService',
            'AutomotiveBusiness', 'FinancialService'
          ].some(t => (item['@type'] || '').includes(t))
        ) || data['@graph'][0];

        const type = data['@type'] || '';
        const businessTypes = ['LocalBusiness', 'Organization', 'Restaurant', 'Store',
          'MedicalBusiness', 'LegalService', 'ProfessionalService',
          'AutomotiveBusiness', 'FinancialService'];

        if (businessTypes.some(t => type.includes(t))) {
          const addr = data.address || {};
          const address = [
            addr.streetAddress,
            addr.addressLocality,
            addr.addressRegion,
            addr.postalCode
          ].filter(Boolean).join(', ');

          return {
            name: data.name || '',
            address: address,
            phone: data.telephone || '',
            website: data.url || '',
            source: 'json-ld'
          };
        }
      } catch (e) {
        // malformed JSON-LD, skip
      }
    }
    return null;
  }

  /**
   * Extract NAP from microdata (itemscope/itemprop)
   */
  function extractFromMicrodata() {
    const scope = document.querySelector('[itemtype*="LocalBusiness"], [itemtype*="Organization"]');
    if (!scope) return null;

    const getProp = (prop) => {
      const el = scope.querySelector(`[itemprop="${prop}"]`);
      return el ? (el.content || el.textContent || '').trim() : '';
    };

    const name = getProp('name');
    if (!name) return null;

    const streetAddress = getProp('streetAddress');
    const locality = getProp('addressLocality');
    const region = getProp('addressRegion');
    const postal = getProp('postalCode');
    const address = [streetAddress, locality, region, postal].filter(Boolean).join(', ');

    return {
      name,
      address,
      phone: getProp('telephone'),
      website: getProp('url') || window.location.href,
      source: 'microdata'
    };
  }

  /**
   * Heuristic fallback: extract from visible page content
   */
  function extractHeuristic() {
    const result = { name: '', address: '', phone: '', website: window.location.href, source: 'heuristic' };

    // Business name: first <h1>, or og:title, or document title
    const h1 = document.querySelector('h1');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    result.name = (h1?.textContent || ogTitle?.content || document.title || '').trim();
    // Clean up common suffixes
    result.name = result.name.replace(/\s*[-|–—]\s*.+$/, '').trim();

    // Phone: find all phone-like patterns in the page body
    const bodyText = document.body?.innerText || '';
    const phones = bodyText.match(PHONE_RE);
    if (phones && phones.length > 0) {
      result.phone = phones[0].trim();
    }

    // Address: look for address patterns
    const addresses = bodyText.match(ADDRESS_RE);
    if (addresses && addresses.length > 0) {
      result.address = addresses[0].trim();
    }

    // Only return if we found at least a name and one other field
    if (result.name && (result.phone || result.address)) {
      return result;
    }
    return null;
  }

  /**
   * Main extraction — tries structured data first, then heuristics
   */
  function extractNap() {
    return extractFromJsonLd() || extractFromMicrodata() || extractHeuristic();
  }

  // Listen for extraction requests from the popup/service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractNap') {
      const nap = extractNap();
      sendResponse(nap || { error: 'Could not extract NAP data from this page' });
    }
  });
})();
