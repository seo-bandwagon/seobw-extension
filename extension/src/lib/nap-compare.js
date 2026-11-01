// NAP (Name, Address, Phone) comparison — ported from scanner_agent.py
//
// Dual-export pattern (see src/lib/citations-ui.js / src/lib/api.js):
// attaches to `globalThis.SBWNap` when loaded as a classic <script> (the
// popup's Citations tab), and exports via CommonJS when loaded by Vitest /
// Node. `computeNapMatchScore` also stays a global, the name the tab has
// always called.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWNap = api;
    globalThis.computeNapMatchScore = api.computeNapMatchScore;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  /**
   * Levenshtein distance between two strings.
   * Returns a ratio 0.0–1.0 (1.0 = identical), matching thefuzz.fuzz.ratio behavior.
   */
  function levenshteinRatio(a, b) {
    if (a === b) return 1.0;
    if (!a.length || !b.length) return 0.0;

    const matrix = [];
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[a.length][b.length];
    const maxLen = Math.max(a.length, b.length);
    return (maxLen - distance) / maxLen;
  }

  /**
   * Normalize a phone number to digits only for comparison.
   * Simplified from scanner_agent.py (no phonenumbers lib — US-centric).
   */
  function normalizePhone(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    // Strip leading country code '1' if 11 digits
    if (digits.length === 11 && digits[0] === '1') {
      digits = digits.slice(1);
    }
    return digits;
  }

  /**
   * Normalize an address for fuzzy comparison.
   * Mirrors scanner_agent.py _normalize_address.
   */
  function normalizeAddress(address) {
    if (!address) return '';
    let addr = address.toLowerCase().trim();

    const replacements = {
      'street': 'st', 'avenue': 'ave', 'boulevard': 'blvd',
      'drive': 'dr', 'road': 'rd', 'lane': 'ln',
      'court': 'ct', 'suite': 'ste', 'apartment': 'apt',
      'north': 'n', 'south': 's', 'east': 'e', 'west': 'w'
    };

    for (const [full, abbr] of Object.entries(replacements)) {
      addr = addr.replaceAll(full, abbr);
    }

    addr = addr.replace(/[.,#]/g, '');
    addr = addr.replace(/\s+/g, ' ').trim();
    return addr;
  }

  /**
   * A website as the host people type: no scheme, no `www.`, no path, query
   * or trailing slash, lower case. '' when there is no usable address.
   * 1.10.3: the comparison kept `https://` (and the path), so a master record
   * of "https://example.com" never matched a listing showing "example.com".
   */
  function websiteHost(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    // Another scheme ("mailto:", "tel:", "javascript:") is not a website; a
    // bare host may still carry a port ("example.com:8080").
    if (/^[a-z][a-z0-9+.-]*:(?!\/\/|\d)/i.test(raw)) return '';
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw);
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch (e) {
      return '';
    }
  }

  /**
   * Compute a 0.0–1.0 NAP match score between canonical and found business data.
   * Weights: name=30%, address=30%, phone=30%, website=10%
   *
   * `compared.website` is false when either side has no website, in which
   * case the website counts as neutral (0.5).
   *
   * @param {Object} canonical - { name, address, phone, website }
   * @param {Object} found - { name, address, phone, website }
   * @returns {{ total: number, breakdown: Object, compared: { website: boolean } }}
   */
  function computeNapMatchScore(canonical, found) {
    const breakdown = {};

    // Name (fuzzy)
    if (found.name) {
      breakdown.name = levenshteinRatio(
        canonical.name.toLowerCase(),
        found.name.toLowerCase()
      );
    } else {
      breakdown.name = 0.0;
    }

    // Address (normalized fuzzy)
    if (found.address) {
      breakdown.address = levenshteinRatio(
        normalizeAddress(canonical.address),
        normalizeAddress(found.address)
      );
    } else {
      breakdown.address = 0.0;
    }

    // Phone (exact after normalization)
    if (found.phone) {
      const canonPhone = normalizePhone(canonical.phone);
      const foundPhone = normalizePhone(found.phone);
      breakdown.phone = (canonPhone && foundPhone && canonPhone === foundPhone) ? 1.0 : 0.0;
    } else {
      breakdown.phone = 0.0;
    }

    // Website: the same host is a match, whatever the scheme or page.
    const canonWeb = websiteHost(canonical.website);
    const foundWeb = websiteHost(found.website);
    const websiteCompared = !!(canonWeb && foundWeb);
    if (websiteCompared) {
      breakdown.website = (canonWeb === foundWeb) ? 1.0 : levenshteinRatio(canonWeb, foundWeb);
    } else {
      breakdown.website = 0.5; // neutral if no website to compare
    }

    const total = (
      breakdown.name * 0.30 +
      breakdown.address * 0.30 +
      breakdown.phone * 0.30 +
      breakdown.website * 0.10
    );

    return {
      total: Math.round(total * 1000) / 1000,
      breakdown,
      compared: { website: websiteCompared }
    };
  }

  return {
    levenshteinRatio,
    normalizePhone,
    normalizeAddress,
    websiteHost,
    computeNapMatchScore
  };
});
