// The Citations tab's NAP check (1.10.3): src/lib/nap-extract.js reads a
// directory listing, src/lib/nap-compare.js scores it against the business's
// record. The listings below are small hand-built pages in the shapes the
// directories use: JSON-LD with a schema.org subtype, Microdata, and plain
// text, each on the directory's own host with the business's website linked
// directly or through the directory's redirector.

import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/nap-extract.js');
await import('../../extension/src/lib/nap-compare.js');
const X = globalThis.SBWNapExtract;
const N = globalThis.SBWNap;

function page(html) {
  return new DOMParser().parseFromString(`<!doctype html><html><head><title>Listing</title></head><body>${html}</body></html>`, 'text/html');
}

function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

const YELP = 'https://www.yelp.com/biz/northside-dental-austin';

describe('JSON-LD: schema.org subtypes are businesses', () => {
  it('a Dentist listing is read from its structured data', () => {
    const doc = page(ld({
      '@context': 'https://schema.org', '@type': 'Dentist', name: 'Northside Dental',
      url: YELP, telephone: '(512) 555-0142',
      address: { '@type': 'PostalAddress', streetAddress: '100 Main St', addressLocality: 'Austin', addressRegion: 'TX', postalCode: '78701' }
    }) + `<a href="https://www.yelp.com/biz_redir?url=https%3A%2F%2Fnorthsidedental.com%2F&amp;src=biz">Business website</a>`);
    expect(X.extractNap(doc, YELP)).toEqual({
      name: 'Northside Dental',
      address: '100 Main St, Austin, TX, 78701',
      phone: '(512) 555-0142',
      website: 'https://northsidedental.com/',
      source: 'json-ld'
    });
  });

  it('a type array, prefixed type names and a node inside @graph all count', () => {
    expect(X.isBusinessNode({ '@type': ['LocalBusiness', 'Plumber'] })).toBe(true);
    expect(X.isBusinessNode({ '@type': 'https://schema.org/Plumber' })).toBe(true);
    expect(X.isBusinessNode({ '@type': 'schema:Attorney' })).toBe(true);
    expect(X.isBusinessNode({ '@type': 'WebPage' })).toBe(false);
    expect(X.isBusinessNode({ '@type': 'Person' })).toBe(false);

    const url = 'https://www.yellowpages.com/austin-tx/mip/joes-plumbing-123';
    const doc = page(ld({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Yellow Pages', url: 'https://www.yellowpages.com/', logo: 'x.png' },
        { '@type': 'WebPage', name: 'Joe\'s Plumbing - Austin' },
        { '@type': ['LocalBusiness', 'Plumber'], name: 'Joe\'s Plumbing', url: 'https://joesplumbing.com', telephone: '512-555-0100', address: '22 Oak Ave, Austin, TX 78702' }
      ]
    }));
    expect(X.extractNap(doc, url)).toMatchObject({
      name: 'Joe\'s Plumbing', phone: '512-555-0100', address: '22 Oak Ave, Austin, TX 78702', website: 'https://joesplumbing.com/', source: 'json-ld'
    });
  });

  it('the 1.10.2 type list missed every one of these', () => {
    const OLD = ['LocalBusiness', 'Organization', 'Restaurant', 'Store', 'MedicalBusiness', 'LegalService', 'ProfessionalService', 'AutomotiveBusiness', 'FinancialService'];
    for (const t of ['Dentist', 'Plumber', 'Attorney', 'HVACBusiness', 'Electrician', 'RoofingContractor', 'BeautySalon', 'Physician']) {
      expect(OLD.some((o) => t.includes(o)), t).toBe(false);
      expect(X.isBusinessType(t), t).toBe(true);
    }
  });

  it('a page whose only node is the directory\'s own Organization is not read as the listing', () => {
    const doc = page(ld({ '@type': 'Organization', name: 'Yelp', url: 'https://www.yelp.com/' }) + '<h1>Northside Dental</h1><p>Call (512) 555-0142</p>');
    expect(X.extractNap(doc, YELP)).toMatchObject({ name: 'Northside Dental', source: 'heuristic' });
  });
});

// MapQuest's listing pages (read 2026-11-16). The directory's own Organization
// comes first and carries its head office's address, so "the first business
// node with an address or a phone" picked it: 1.13.5's Check NAP read SEO
// Bandwagon's MapQuest listing as "MapQuest, 4235 Redwood Ave., Marina Del Rey"
// and scored it 19% against the business. The three JSON-LD blocks and the
// website button are MapQuest's own markup, trimmed to the fields read here.
const MAPQUEST = 'https://www.mapquest.com/us/washington/seo-bandwagon-282884477';
const MAPQUEST_ORG = {
  '@context': 'https://schema.org', '@id': 'https://www.mapquest.com/#organization', '@type': 'Organization',
  name: 'MapQuest', url: 'https://www.mapquest.com/', logo: 'https://static.mqcdn.com/yogi-cdn/yogi/graphics/mq-logo-full.svg',
  address: { '@type': 'PostalAddress', streetAddress: '4235 Redwood Ave.', addressLocality: 'Marina Del Rey', addressRegion: 'CA', postalCode: '90066', addressCountry: 'United States' }
};
const MAPQUEST_SITE = { '@context': 'https://schema.org', '@id': 'https://www.mapquest.com/#website', '@type': 'WebSite', name: 'MapQuest', url: 'https://www.mapquest.com/' };
const MAPQUEST_LISTING = {
  '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': MAPQUEST, name: 'SEO Bandwagon', url: MAPQUEST,
  telephone: '+18665354736', sameAs: 'https://seobandwagon.com/',
  address: { '@type': 'PostalAddress', addressCountry: 'US', addressLocality: 'Seattle', addressRegion: 'WA', postalCode: '98104', streetAddress: '107 Spring Street' }
};
const MAPQUEST_WEB = '<a data-testid="bento-website" aria-label="Visit this location&#x27;s website" target="_blank" href="https://seobandwagon.com/">Web</a>';

describe('the directory\'s own node is never the listing, even with an address (1.13.9)', () => {
  it('MapQuest: its Organization\'s head office is passed over for the listing\'s LocalBusiness', () => {
    const doc = page(ld(MAPQUEST_ORG) + ld(MAPQUEST_SITE) + ld(MAPQUEST_LISTING) + MAPQUEST_WEB);
    expect(X.extractNap(doc, MAPQUEST)).toEqual({
      name: 'SEO Bandwagon',
      address: '107 Spring Street, Seattle, WA, 98104',
      phone: '+18665354736',
      website: 'https://seobandwagon.com/',
      source: 'json-ld'
    });
  });

  it('the directory\'s node is known by a url or @id that is its home page, or by the site\'s own name', () => {
    const names = new Set(['mapquest']);
    expect(X.isDirectoryNode(MAPQUEST_ORG, MAPQUEST, new Set())).toBe(true);
    expect(X.isDirectoryNode({ '@type': 'Organization', '@id': 'https://www.mapquest.com/#organization', name: 'MQ' }, MAPQUEST, new Set())).toBe(true);
    expect(X.isDirectoryNode({ '@type': 'Organization', name: 'MapQuest', address: '1 Main St' }, MAPQUEST, names)).toBe(true);
    expect(X.isDirectoryNode(MAPQUEST_LISTING, MAPQUEST, names)).toBe(false);
    // Another site's home page is the business's own website, not the directory.
    expect(X.isDirectoryNode({ '@type': 'Dentist', name: 'Northside Dental', url: 'https://northsidedental.com/' }, YELP, new Set(['yelp']))).toBe(false);
  });

  it('the site\'s name comes from its WebSite node or og:site_name', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head><meta property="og:site_name" content="Yelp"></head><body>' + ld(MAPQUEST_SITE) + '</body></html>', 'text/html');
    expect([...X.siteNames(doc, X.jsonLdNodes(doc))].sort()).toEqual(['mapquest', 'yelp']);
  });

  it('a directory named only by og:site_name, with its address and no url, is passed over too', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head><meta property="og:site_name" content="Yelp"></head><body>' +
      ld({ '@type': 'Organization', name: 'Yelp', address: '350 Mission St, San Francisco, CA 94105' }) +
      ld({ '@type': 'Dentist', name: 'Northside Dental', url: YELP, telephone: '(512) 555-0142' }) + '</body></html>', 'text/html');
    expect(X.extractNap(doc, YELP)).toMatchObject({ name: 'Northside Dental', phone: '(512) 555-0142', address: '', source: 'json-ld' });
  });

  it('a business\'s own website, whose only node is its Organization at its home page, is still read', () => {
    const own = 'https://northsidedental.com/contact';
    const doc = page(ld({ '@type': 'Organization', name: 'Northside Dental', url: 'https://northsidedental.com/', telephone: '(512) 555-0142', address: '100 Main St, Austin, TX 78701' }));
    expect(X.extractNap(doc, own)).toMatchObject({ name: 'Northside Dental', phone: '(512) 555-0142', address: '100 Main St, Austin, TX 78701', source: 'json-ld' });
  });
});

describe('the website is the business\'s own, never the directory\'s', () => {
  it('a listing\'s JSON-LD url that is the directory page is not its website', () => {
    const doc = page(ld({ '@type': 'Dentist', name: 'Northside Dental', url: YELP, telephone: '(512) 555-0142' }));
    const nap = X.extractNap(doc, YELP);
    expect(nap.website).toBe('');
    expect(nap.website).not.toBe(YELP); // 1.10.2 read this URL as the business's website
  });

  it('Microdata: a Plumber itemtype counts, and its url itemprop on the directory is skipped for the linked address', () => {
    const url = 'https://www.manta.com/c/m1x2/joes-plumbing';
    const doc = page(`
      <div itemscope itemtype="https://schema.org/Plumber">
        <h1 itemprop="name">Joe's Plumbing</h1>
        <a itemprop="url" href="${url}">Profile</a>
        <span itemprop="telephone">512-555-0100</span>
        <span itemprop="streetAddress">22 Oak Ave</span>
        <span itemprop="addressLocality">Austin</span>
        <a href="https://joesplumbing.com/?utm_source=manta" rel="nofollow">joesplumbing.com</a>
      </div>`);
    expect(X.extractNap(doc, url)).toMatchObject({
      name: 'Joe\'s Plumbing', phone: '512-555-0100', address: '22 Oak Ave, Austin',
      website: 'https://joesplumbing.com/?utm_source=manta', source: 'microdata'
    });
  });

  it('plain text: a "Visit website" link counts; the page\'s own address never does', () => {
    const url = 'https://www.bbb.org/us/tx/austin/profile/plumber/joes-plumbing-0825';
    const withLink = page(`<h1>Joe's Plumbing | BBB</h1><p>22 Oak Ave Austin, TX 78702</p><p>(512) 555-0100</p>
      <a href="/us/tx/austin/category/plumber">More plumbers</a>
      <a href="https://www.joesplumbing.com" title="Visit Website">Visit Website</a>`);
    expect(X.extractNap(withLink, url)).toMatchObject({ name: 'Joe\'s Plumbing', phone: '(512) 555-0100', website: 'https://www.joesplumbing.com/', source: 'heuristic' });

    const without = page(`<h1>Joe's Plumbing</h1><p>(512) 555-0100</p><a href="/us/tx/austin">Austin</a><a href="https://www.facebook.com/bbb">Facebook</a>`);
    expect(X.extractNap(without, url).website).toBe('');
  });

  it('offSite: another site is kept, the directory\'s own pages only when they forward elsewhere', () => {
    expect(X.offSite('https://example.com/a', YELP)).toBe('https://example.com/a');
    expect(X.offSite('/biz/other', YELP)).toBe('');
    expect(X.offSite('https://m.yelp.com/biz/x', YELP)).toBe('');
    expect(X.offSite('/biz_redir?url=https%3A%2F%2Fexample.com&x=1', YELP)).toBe('https://example.com/');
    expect(X.offSite('/biz_redir?url=example.com', YELP)).toBe('https://example.com/');
    expect(X.offSite('/biz_redir?url=https%3A%2F%2Fwww.yelp.com%2Fx', YELP)).toBe('');
    expect(X.offSite('mailto:info@example.com', YELP)).toBe('');
    expect(X.offSite('javascript:void(0)', YELP)).toBe('');
  });

  it('siteOf groups a site\'s hosts, country second levels included', () => {
    expect(X.siteOf('www.yelp.com')).toBe('yelp.com');
    expect(X.siteOf('biz.yelp.com')).toBe('yelp.com');
    expect(X.siteOf('shop.example.co.uk')).toBe('example.co.uk');
  });
});

describe('nap-compare: the website comparison drops the scheme (1.10.3)', () => {
  const record = { name: 'Northside Dental', address: '100 Main St, Austin, TX, 78701', phone: '512-555-0142', website: 'https://northsidedental.com' };

  it('websiteHost is the host people type', () => {
    expect(N.websiteHost('https://www.NorthsideDental.com/contact/?utm=x')).toBe('northsidedental.com');
    expect(N.websiteHost('northsidedental.com')).toBe('northsidedental.com');
    expect(N.websiteHost('http://northsidedental.com.')).toBe('northsidedental.com');
    expect(N.websiteHost('')).toBe('');
    expect(N.websiteHost('mailto:x@y.com')).toBe('');
  });

  it('a listing that shows the address without https:// matches the record', () => {
    const score = N.computeNapMatchScore(record, { ...record, website: 'northsidedental.com' });
    expect(score.breakdown.website).toBe(1);
    expect(score.compared.website).toBe(true);
    expect(score.total).toBe(1);
  });

  it('the 1.10.2 comparison kept https:// and scored that below a match', () => {
    const old = (a, b) => {
      const x = a.toLowerCase().replace(/\/+$/, '').replace('www.', '');
      const y = b.toLowerCase().replace(/\/+$/, '').replace('www.', '');
      return x === y ? 1 : N.levenshteinRatio(x, y);
    };
    expect(old(record.website, 'northsidedental.com')).toBeLessThan(0.8);
  });

  it('a different site scores low; no website on either side is neutral and not compared', () => {
    const other = N.computeNapMatchScore(record, { ...record, website: 'https://www.yelp.com/biz/northside-dental-austin' });
    expect(other.breakdown.website).toBeLessThan(0.5);

    const none = N.computeNapMatchScore({ ...record, website: '' }, { ...record, website: 'northsidedental.com' });
    expect(none.compared.website).toBe(false);
    expect(none.breakdown.website).toBe(0.5);

    const notListed = N.computeNapMatchScore(record, { ...record, website: '' });
    expect(notListed.compared.website).toBe(false);
  });

  it('keeps the global the Citations tab calls', () => {
    expect(globalThis.computeNapMatchScore).toBe(N.computeNapMatchScore);
  });
});
