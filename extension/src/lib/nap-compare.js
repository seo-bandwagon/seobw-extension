// NAP (Name, Address, Phone) comparison — ported from scanner_agent.py

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
 * Compute a 0.0–1.0 NAP match score between canonical and found business data.
 * Weights: name=30%, address=30%, phone=30%, website=10%
 *
 * @param {Object} canonical - { name, address, phone, website }
 * @param {Object} found - { name, address, phone, website }
 * @returns {{ total: number, breakdown: Object }}
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

  // Website
  if (found.website && canonical.website) {
    const canonWeb = canonical.website.toLowerCase().replace(/\/+$/, '').replace('www.', '');
    const foundWeb = found.website.toLowerCase().replace(/\/+$/, '').replace('www.', '');
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
    breakdown
  };
}
