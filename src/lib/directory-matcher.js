// Directory matcher — detects if current URL belongs to a known citation directory

const CURATED_DIRECTORIES = [
  { name: 'Yelp', domain: 'yelp.com' },
  { name: 'Yellow Pages', domain: 'yellowpages.com' },
  { name: 'Better Business Bureau', domain: 'bbb.org' },
  { name: 'Foursquare', domain: 'foursquare.com' },
  { name: 'Facebook', domain: 'facebook.com' },
  { name: 'Apple Maps', domain: 'maps.apple.com' },
  { name: 'Bing Places', domain: 'bing.com' },
  { name: 'MapQuest', domain: 'mapquest.com' },
  { name: 'Superpages', domain: 'superpages.com' },
  { name: 'Citysearch', domain: 'citysearch.com' },
  { name: 'Manta', domain: 'manta.com' },
  { name: 'Angi', domain: 'angi.com' },
  { name: 'Thumbtack', domain: 'thumbtack.com' },
  { name: 'Hotfrog', domain: 'hotfrog.com' },
  { name: 'Chamberofcommerce.com', domain: 'chamberofcommerce.com' },
  { name: 'Brownbook', domain: 'brownbook.net' },
  { name: 'eLocal', domain: 'elocal.com' },
  { name: 'MerchantCircle', domain: 'merchantcircle.com' },
  { name: 'DexKnows', domain: 'dexknows.com' },
  { name: 'Alignable', domain: 'alignable.com' },
  { name: 'Cylex', domain: 'cylex.us.com' },
  { name: 'Tupalo', domain: 'tupalo.com' },
  { name: 'ShowMeLocal', domain: 'showmelocal.com' },
  { name: 'Local.com', domain: 'local.com' },
  { name: 'YellowBot', domain: 'yellowbot.com' },
  { name: 'USCity.net', domain: 'uscity.net' },
  { name: 'Spoke', domain: 'spoke.com' },
  { name: 'Expertise', domain: 'expertise.com' },
  { name: 'Nextdoor', domain: 'nextdoor.com' },
  { name: 'Tripadvisor', domain: 'tripadvisor.com' },
  { name: 'Healthgrades', domain: 'healthgrades.com' },
  { name: 'Avvo', domain: 'avvo.com' },
  { name: 'Zillow', domain: 'zillow.com' },
  { name: 'Realtor.com', domain: 'realtor.com' },
  { name: 'Houzz', domain: 'houzz.com' },
  { name: 'HomeAdvisor', domain: 'homeadvisor.com' },
  { name: 'FindLaw', domain: 'findlaw.com' },
  { name: 'Zocdoc', domain: 'zocdoc.com' },
  { name: 'Vitals', domain: 'vitals.com' },
  { name: 'Cars.com', domain: 'cars.com' }
];

// Additional directories fetched from the API are cached here
let _cachedDirectories = null;
let _cacheTime = 0;
const DIR_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Match a URL against known directories.
 * @param {string} url
 * @returns {{ name: string, domain: string } | null}
 */
function matchDirectory(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const dirs = _cachedDirectories || CURATED_DIRECTORIES;
    return dirs.find(d => hostname === d.domain || hostname.endsWith('.' + d.domain)) || null;
  } catch {
    return null;
  }
}

/**
 * Refresh the directory cache from the CitationForge backend.
 * Falls back to the hardcoded list if the API is unreachable.
 */
async function refreshDirectoryCache() {
  if (_cachedDirectories && (Date.now() - _cacheTime) < DIR_CACHE_TTL) {
    return;
  }
  try {
    const dirs = await cfGetDirectories();
    if (Array.isArray(dirs) && dirs.length > 0) {
      _cachedDirectories = dirs;
      _cacheTime = Date.now();
    }
  } catch {
    // API unreachable — stick with curated list
  }
}
