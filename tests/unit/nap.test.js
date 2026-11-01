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
