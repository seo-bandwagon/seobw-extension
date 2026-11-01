// Unit tests for the pure SERP-overlay logic (src/lib/serp.js).
//
// Covers organic-vs-ad extraction, PAA extraction, the uule test vector
// from the brief, and the search-URL builder. No chrome/fetch here — the
// content script (src/overlay/serp-overlay.js) owns the DOM wiring and
// worker bridge.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWSerp` rather than an ESM default export.
await import('../../extension/src/lib/serp.js');
const SBWSerp = globalThis.SBWSerp;

// Fix round 1, item 13: pins SBWSerp's formula-injection guard against
// SBWCsv's (src/lib/csv.js) — both must treat the same hostile/plain
// prefixes identically.
await import('../../extension/src/lib/csv.js');
const SBWCsv = globalThis.SBWCsv;

function parseFragment(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return dom.window.document;
}

describe('SBWSerp namespace', () => {
  it('attaches to globalThis.SBWSerp', () => {
    expect(SBWSerp).toBeTruthy();
    ['bareDomain', 'parseResults', 'parsePaa', 'resultsToCsv', 'paaToText', 'uule', 'buildSearchUrl']
      .forEach(fn => expect(typeof SBWSerp[fn]).toBe('function'));
    expect(Array.isArray(SBWSerp.PRESET_LOCATIONS)).toBe(true);
  });
});

/* ---------- bareDomain ---------- */

describe('bareDomain', () => {
  it('lowercases and strips a leading www.', () => {
    expect(SBWSerp.bareDomain('https://WWW.Example.com/page')).toBe('example.com');
  });

  it('returns the host as-is when there is no www. prefix', () => {
    expect(SBWSerp.bareDomain('https://blog.example.com/post')).toBe('blog.example.com');
  });

  it('returns null for non-http(s) schemes', () => {
    expect(SBWSerp.bareDomain('mailto:a@example.com')).toBeNull();
    expect(SBWSerp.bareDomain('javascript:void(0)')).toBeNull();
  });

  it('returns null for garbage/relative input', () => {
    expect(SBWSerp.bareDomain('/relative/path')).toBeNull();
    expect(SBWSerp.bareDomain('')).toBeNull();
    expect(SBWSerp.bareDomain(null)).toBeNull();
  });

  it('returns null for google.com internal links', () => {
    expect(SBWSerp.bareDomain('https://www.google.com/search?q=x')).toBeNull();
    expect(SBWSerp.bareDomain('https://accounts.google.com/signin')).toBeNull();
  });

  it('returns null for internal links on other Google TLDs the overlay also runs on', () => {
    expect(SBWSerp.bareDomain('https://www.google.co.uk/preferences')).toBeNull();
    expect(SBWSerp.bareDomain('https://www.google.de/search?q=x')).toBeNull();
  });

  // Issue #42: until 1.7.5 every *.google.* host was treated as internal,
  // including support.google.de here, so Google's own properties never
  // appeared as results. They are organic results like any other site.
  it('keeps Google properties that rank as organic results (#42)', () => {
    expect(SBWSerp.bareDomain('https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj'))
      .toBe('chromewebstore.google.com');
    expect(SBWSerp.bareDomain('https://search.google.com/search-console/about')).toBe('search.google.com');
    expect(SBWSerp.bareDomain('https://developers.google.com/search/docs')).toBe('developers.google.com');
    expect(SBWSerp.bareDomain('https://support.google.de/websearch')).toBe('support.google.de');
    expect(SBWSerp.bareDomain('https://play.google.com/store/apps')).toBe('play.google.com');
    expect(SBWSerp.bareDomain('https://www.google.com/chrome/')).toBe('google.com');
  });

  it('still treats Google navigation as internal on every search host (#42)', () => {
    [
      'https://www.google.com/',
      'https://www.google.com/url?q=https://example.com',
      'https://www.google.com/goto?url=CAES',
      'https://www.google.com/imgres?imgurl=x',
      'https://www.google.com/maps/place/x',
      'https://google.com/intl/en/policies/',
      'https://maps.google.com/',
      'https://consent.google.com/ml',
      'https://policies.google.com/privacy'
    ].forEach((u) => expect(SBWSerp.bareDomain(u)).toBeNull());
  });

  it('does not false-positive on an unrelated domain containing "google"', () => {
    expect(SBWSerp.bareDomain('https://mygoogle.com/page')).toBe('mygoogle.com');
  });
});

/* ---------- parseResults / parsePaa ---------- */

const FIXTURE_SERP = `
  <div id="search">
    <div id="tads">
      <div data-text-ad="1">
        <div>
          <a href="https://ad-sponsor.example/landing"><h3>Sponsored Widget Deals</h3></a>
          <div>Buy widgets now, ad copy here.</div>
        </div>
      </div>
    </div>
    <div class="g">
      <div>
        <a href="https://www.first-result.example/page-one">
          <h3>First Organic Result</h3>
        </a>
        <div>This is the snippet text for the first organic result.</div>
      </div>
    </div>
    <div class="g">
      <div>
        <a href="https://second-result.example/page-two">
          <h3>Second Organic Result</h3>
        </a>
        <div>Snippet for the second result goes here.</div>
      </div>
    </div>
    <div id="bottomads">
      <div data-text-ad="1">
        <div>
          <a href="https://bottom-ad.example/landing"><h3>Bottom Ad Result</h3></a>
        </div>
      </div>
    </div>
    <div data-q="How do widgets work?">How do widgets work?</div>
    <div jsname="xyz" role="button">What is the best widget?</div>
  </div>
`;

describe('parseResults', () => {
  it('extracts organic results, excluding ad blocks', () => {
    const doc = parseFragment(FIXTURE_SERP);
    const rows = SBWSerp.parseResults(doc);
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.domain)).toEqual(['first-result.example', 'second-result.example']);
    expect(rows[0].title).toBe('First Organic Result');
    expect(rows[0].position).toBe(1);
    expect(rows[1].position).toBe(2);
  });

  it('never includes a result whose anchor is inside [data-text-ad]/#tads/#bottomads', () => {
    const doc = parseFragment(FIXTURE_SERP);
    const rows = SBWSerp.parseResults(doc);
    expect(rows.some(r => r.domain === 'ad-sponsor.example')).toBe(false);
    expect(rows.some(r => r.domain === 'bottom-ad.example')).toBe(false);
  });

  it('dedupes by URL', () => {
    const doc = parseFragment(`
      <div class="g"><div><a href="https://dup.example/x"><h3>One</h3></a><cite>dup.example</cite></div></div>
      <div class="g"><div><a href="https://dup.example/x"><h3>One again</h3></a><cite>dup.example</cite></div></div>
    `);
    const rows = SBWSerp.parseResults(doc);
    expect(rows.length).toBe(1);
  });

  it('extracts a snippet when the block has extra text', () => {
    const doc = parseFragment(FIXTURE_SERP);
    const rows = SBWSerp.parseResults(doc);
    expect(rows[0].snippet).toMatch(/snippet text for the first/i);
  });

  it('returns [] for a root with no h3s', () => {
    const doc = parseFragment('<div>nothing here</div>');
    expect(SBWSerp.parseResults(doc)).toEqual([]);
  });
});

describe('parsePaa', () => {
  it('extracts People-also-ask questions from [data-q] and [jsname][role="button"]', () => {
    const doc = parseFragment(FIXTURE_SERP);
    const questions = SBWSerp.parsePaa(doc);
    expect(questions).toEqual([
      'How do widgets work?',
      'What is the best widget?'
    ]);
  });

  it('dedupes identical question text', () => {
    const doc = parseFragment(`
      <div data-q="Same question?">Same question?</div>
      <div data-q="Same question?">Same question?</div>
    `);
    expect(SBWSerp.parsePaa(doc)).toEqual(['Same question?']);
  });

  it('returns [] when there are no PAA blocks', () => {
    const doc = parseFragment('<div>no paa here</div>');
    expect(SBWSerp.parsePaa(doc)).toEqual([]);
  });
});

/* ---------- fix round 1, item 1: organic-only scoping ---------- */

describe('parseResults — organic-only scoping (fix round 1, item 1)', () => {
  // Reviewer's fixture: AI Overview with 2 citations, a video carousel with
  // 2 items, a Top stories block with 2 items, a shopping unit, and ONE
  // real organic result. Every non-organic h3 must be rejected.
  const NON_ORGANIC_FIXTURE = `
    <div id="search">
      <div data-attrid="AI Overview">
        <div><a href="https://ai-cite-one.example/a"><h3>AI Citation One</h3></a></div>
        <div><a href="https://ai-cite-two.example/b"><h3>AI Citation Two</h3></a></div>
      </div>
      <g-scrolling-carousel aria-label="Videos">
        <div><a href="https://video-one.example/a"><h3>Video One</h3></a></div>
        <div><a href="https://video-two.example/a"><h3>Video Two</h3></a></div>
      </g-scrolling-carousel>
      <div aria-label="Top stories">
        <div><a href="https://story-one.example/a"><h3>Top Story One</h3></a></div>
        <div><a href="https://story-two.example/a"><h3>Top Story Two</h3></a></div>
      </div>
      <div data-pla="1">
        <div><a href="https://shopping-item.example/a"><h3>Shopping Item</h3></a></div>
      </div>
      <div class="g">
        <div>
          <a href="https://the-only-organic.example/page"><h3>The Only Organic Result</h3></a>
          <div>This snippet has more than forty characters so it clears the qualifying-content gate.</div>
        </div>
      </div>
    </div>
  `;

  it('rejects AI Overview citations, video/Top-stories carousels and a shopping unit, keeping only the one real result', () => {
    const doc = parseFragment(NON_ORGANIC_FIXTURE);
    const rows = SBWSerp.parseResults(doc);
    expect(rows.length).toBe(1);
    expect(rows[0].position).toBe(1);
    expect(rows[0].domain).toBe('the-only-organic.example');
  });

  it('requires a cite or a >=40-char snippet — a bare title-only block is rejected', () => {
    const doc = parseFragment(`
      <div class="g"><div><a href="https://bare-title.example/a"><h3>Bare Title Only</h3></a></div></div>
    `);
    expect(SBWSerp.parseResults(doc)).toEqual([]);
  });

  it('falls back to scanning the whole root when neither #rso nor #search exists', () => {
    const doc = parseFragment(`
      <div class="g"><div><a href="https://no-wrapper.example/a"><h3>No Wrapper</h3></a><cite>no-wrapper.example</cite></div></div>
    `);
    const rows = SBWSerp.parseResults(doc);
    expect(rows.length).toBe(1);
    expect(rows[0].domain).toBe('no-wrapper.example');
  });
});

/* ---------- fix round 1, item 2: sitelinks containment dedupe ---------- */

describe('parseResults — sitelinks containment dedupe (fix round 1, item 2)', () => {
  it('counts a result with nested sitelink h3s once, not once per sitelink', () => {
    const doc = parseFragment(`
      <div class="g">
        <div class="yuRUbf">
          <a href="https://sitelinks-parent.example/main"><h3>Main sitelinks Result</h3></a>
        </div>
        <div class="cite-line"><cite>sitelinks-parent.example</cite></div>
        <div class="sitelinks-wrapper">
          <div class="sitelink"><a href="https://sitelinks-parent.example/sub-a"><h3>Sub A</h3></a></div>
          <div class="sitelink"><a href="https://sitelinks-parent.example/sub-b"><h3>Sub B</h3></a></div>
        </div>
      </div>
    `);
    const rows = SBWSerp.parseResults(doc);
    expect(rows.length).toBe(1);
    expect(rows[0].domain).toBe('sitelinks-parent.example');
  });
});

/* ---------- fix round 1, item 3: expanded ad exclusion ---------- */

describe('parseResults — expanded ad/sponsored exclusion (fix round 1, item 3)', () => {
  it('excludes a [data-pla] shopping unit', () => {
    const doc = parseFragment(`
      <div data-pla="1">
        <div>
          <a href="https://shopping-only.example/a"><h3>Shopping Only</h3></a>
          <div>Enough snippet text here to pass forty characters easily, if it mattered at all.</div>
        </div>
      </div>
    `);
    expect(SBWSerp.parseResults(doc)).toEqual([]);
  });

  it('excludes a block whose own leading text reads "Sponsored", even without a recognized ad container', () => {
    // The "Sponsored" label sits inside the SAME block findBlock resolves
    // (a sibling of the anchor, not an outer wrapper) — the title
    // deliberately does NOT itself start with "Sponsored", so a pass here
    // can only be the leading-text label check, not a title coincidence.
    const doc = parseFragment(`
      <div class="g">
        <div>
          <span>Sponsored</span>
          <a href="https://sponsored-lookalike.example/a"><h3>Widget Retailer HQ</h3></a>
          <div>This snippet also has enough characters to pass the qualifying content gate for testing.</div>
        </div>
      </div>
    `);
    expect(SBWSerp.parseResults(doc)).toEqual([]);
  });

  it('excludes a block whose leading text reads "Ad ·"', () => {
    const doc = parseFragment(`
      <div class="g">
        <div>
          <span>Ad&nbsp;&middot;</span>
          <a href="https://ad-dot-lookalike.example/a"><h3>Widget Retailer HQ</h3></a>
          <div>This snippet also has enough characters to pass the qualifying content gate for testing.</div>
        </div>
      </div>
    `);
    expect(SBWSerp.parseResults(doc)).toEqual([]);
  });
});

/* ---------- fix round 1, item 7: PAA chrome-button filter ---------- */

describe('parsePaa — chrome-button filter (fix round 1, item 7)', () => {
  it('excludes short/non-question [jsname][role="button"] chrome buttons like Tools/All filters/Feedback', () => {
    const doc = parseFragment(`
      <div data-q="Real question one?">Real question one?</div>
      <button jsname="a1" role="button">Tools</button>
      <button jsname="a2" role="button">All filters</button>
      <button jsname="a3" role="button">Feedback</button>
      <div jsname="a4" role="button">Is this actually a question that qualifies?</div>
    `);
    expect(SBWSerp.parsePaa(doc)).toEqual([
      'Real question one?',
      'Is this actually a question that qualifies?'
    ]);
  });
});

/* ---------- resultsToCsv / paaToText ---------- */

describe('resultsToCsv', () => {
  it('writes position/url/domain/title columns with a header row', () => {
    const csv = SBWSerp.resultsToCsv([
      { position: 1, url: 'https://example.com/a', domain: 'example.com', title: 'A Title' }
    ]);
    expect(csv).toContain('Position,URL,Domain,Title');
    expect(csv).toContain('1,https://example.com/a,example.com,A Title');
  });

  it('guards against formula injection in a hostile title', () => {
    const csv = SBWSerp.resultsToCsv([
      { position: 1, url: 'https://example.com/a', domain: 'example.com', title: '=HYPERLINK("x")' }
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
  });
});

describe('paaToText', () => {
  it('joins questions with newlines, trimming and dropping empties', () => {
    expect(SBWSerp.paaToText([' Q1? ', '', 'Q2?'])).toBe('Q1?\nQ2?');
  });

  it('returns "" for no questions', () => {
    expect(SBWSerp.paaToText([])).toBe('');
    expect(SBWSerp.paaToText(undefined)).toBe('');
  });
});

/* ---------- uule ---------- */

describe('uule', () => {
  it('matches the brief\'s test vector', () => {
    expect(SBWSerp.uule('New York,New York,United States'))
      .toBe('w+CAIQICIfTmV3IFlvcmssTmV3IFlvcmssVW5pdGVkIFN0YXRlcw');
  });

  it('has no base64 padding characters', () => {
    expect(SBWSerp.uule('Seattle,Washington,United States')).not.toMatch(/=/);
  });
});

/* ---------- buildSearchUrl ---------- */

describe('buildSearchUrl', () => {
  it('omits empty params and defaults to www.google.com', () => {
    const url = SBWSerp.buildSearchUrl({ q: 'plumbers near me' });
    expect(url).toBe('https://www.google.com/search?q=plumbers+near+me');
  });

  it('includes gl/hl/uule when provided, and never num (#45)', () => {
    const url = SBWSerp.buildSearchUrl({ q: 'x', gl: 'us', hl: 'en', uule: 'ABC', num: 20 });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('gl')).toBe('us');
    expect(parsed.searchParams.get('hl')).toBe('en');
    expect(parsed.searchParams.get('uule')).toBe('ABC');
    // Google ignores &num= (tested 2026-10-13); it is no longer emitted.
    expect(parsed.searchParams.has('num')).toBe(false);
  });

  it('adds pws=0 only when personalization-off is requested', () => {
    const off = new URL(SBWSerp.buildSearchUrl({ q: 'x', pws: true }));
    expect(off.searchParams.get('pws')).toBe('0');
    const untouched = new URL(SBWSerp.buildSearchUrl({ q: 'x' }));
    expect(untouched.searchParams.has('pws')).toBe(false);
  });

  it('supports a non-default domain (other Google TLDs)', () => {
    const url = SBWSerp.buildSearchUrl({ q: 'x', domain: 'www.google.co.uk' });
    expect(url.startsWith('https://www.google.co.uk/search')).toBe(true);
  });

  // Fix round 1, item 12
  it('treats pws: 0 (the number zero) as "personalization off" too, not as falsy/omit', () => {
    const url = new URL(SBWSerp.buildSearchUrl({ q: 'x', pws: 0 }));
    expect(url.searchParams.get('pws')).toBe('0');
  });
});

/* ---------- PRESET_LOCATIONS ---------- */

describe('PRESET_LOCATIONS', () => {
  it('has all 54 metros with a label and canonical name', () => {
    expect(SBWSerp.PRESET_LOCATIONS.length).toBe(54);
    SBWSerp.PRESET_LOCATIONS.forEach((loc) => {
      expect(typeof loc.label).toBe('string');
      expect(typeof loc.canonical).toBe('string');
      expect(loc.canonical.endsWith(',United States')).toBe(true);
    });
  });

  it('expands the 2-letter state code to a full name in the canonical form', () => {
    const seattle = SBWSerp.PRESET_LOCATIONS.find(l => l.label === 'Seattle, WA');
    expect(seattle.canonical).toBe('Seattle,Washington,United States');
  });

  it('canonicalizes the Washington DMV metro label to a real place name', () => {
    const dc = SBWSerp.PRESET_LOCATIONS.find(l => l.label === 'Washington DMV, DC');
    expect(dc.canonical).toBe('Washington,District of Columbia,United States');
  });
});

/* ---------- fix round 1, item 13: guard parity with SBWCsv ---------- */

describe('formula-injection guard — parity with SBWCsv (fix round 1, item 13)', () => {
  it('guards a hostile/plain value identically to SBWCsv\'s own cell guard', () => {
    ['=x', '+x', '-x', '@x', '\tx', '\rx', 'plain'].forEach((value) => {
      // Isolate SBWSerp's guarded Title cell by index rather than by string
      // offset — the column list grew on 2026-09-16 when the snippet and the
      // search context were added, and a fixed prefix length silently
      // stopped pointing at Title.
      const serpCsv = SBWSerp.resultsToCsv([{ title: value }], {});
      const header = serpCsv.replace(/^\uFEFF/, '').split('\r\n')[0].split(',');
      const titleIndex = header.indexOf('Title');
      expect(titleIndex).toBeGreaterThan(-1);
      const serpCell = serpCsv.split('\r\n')[1].split(',')[titleIndex];

      // SBWCsv.toCsv with a single column isolates its own guarded cell the
      // same way — one data line, nothing else in it.
      const genericCsv = SBWCsv.toCsv([{ v: value }], [{ key: 'v', label: 'V' }]);
      const genericCell = genericCsv.split('\r\n')[1];

      expect(serpCell).toBe(genericCell);
    });
  });
});

describe('searchContext + export completeness', () => {
  it('reads the whole search context out of the results URL', () => {
    const ctx = SBWSerp.searchContext({ search: '?q=nonprofit+salaries&gl=us&hl=en&uule=w+CAIQ&start=20' });
    expect(ctx).toMatchObject({
      query: 'nonprofit salaries',
      country: 'us',
      language: 'en',
      location: 'w CAIQ',
      page: 3,
    });
    expect(ctx.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults to page 1 and empty strings rather than undefined', () => {
    const ctx = SBWSerp.searchContext({ search: '' });
    expect(ctx).toMatchObject({ query: '', country: '', language: '', location: '', page: 1 });
    expect(SBWSerp.searchContext(null).page).toBe(1);
    expect(SBWSerp.searchContext({ search: '?start=notanumber' }).page).toBe(1);
  });

  it('the CSV carries the snippet — it was extracted and then dropped until 2026-09-16', () => {
    const doc = parseFragment(
      '<div id="search"><div><a href="https://example.com/a"><h3>A title</h3></a>' +
      '<div>A real description long enough to qualify as a snippet for this result.</div></div></div>'
    );
    const rows = SBWSerp.parseResults(doc);
    expect(rows).toHaveLength(1);
    expect(rows[0].snippet).toContain('A real description');

    const csv = SBWSerp.resultsToCsv(rows, SBWSerp.searchContext({ search: '?q=test' }));
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    ['Query', 'Position', 'URL', 'Domain', 'Title', 'Snippet'].forEach((col) =>
      expect(header.split(',')).toContain(col));
    expect(csv).toContain('A real description');
    expect(csv).toContain('test');
  });

  it('writes the context on every row so files concatenate', () => {
    const rows = [
      { position: 1, url: 'https://a.com/', domain: 'a.com', title: 'A' },
      { position: 2, url: 'https://b.com/', domain: 'b.com', title: 'B' },
    ];
    const csv = SBWSerp.resultsToCsv(rows, { query: 'q', country: 'us', page: 1, capturedAt: 'Z' });
    const body = csv.replace(/^﻿/, '').trim().split('\r\n').slice(1);
    expect(body).toHaveLength(2);
    body.forEach((line) => expect(line.startsWith('q,')).toBe(true));
    // A row with no snippet still emits every column, empty — count against
    // the header rather than a literal, so adding a field never breaks this.
    const headerCols = csv.replace(/^\uFEFF/, '').split('\r\n')[0].split(',').length;
    expect(body[0].split(',').length).toBe(headerCols);
  });

  it('still guards formula injection in the new columns', () => {
    const rows = [{ position: 1, url: 'https://a.com/', domain: 'a.com', title: 'T', snippet: '=SUM(A1)' }];
    const csv = SBWSerp.resultsToCsv(rows, { query: '+evil', capturedAt: 'Z', page: 1 });
    expect(csv).not.toContain(',=SUM(A1)');
    expect(csv).not.toContain(',+evil');
  });
});

/* ---------- real Google markup, not a hand-written fixture ---------- */

describe('parseResults against a real saved SERP', () => {
  // tests/fixtures/serp-google-site-query.html is genuine Google output from
  // 2026-09-16. Every other fixture in this file is hand-written, which is how
  // the snippet bug below survived: invented markup put the description where
  // the parser was already looking.
  const realDoc = () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(
      path.join(__dirname, '../fixtures/serp-google-site-query.html'), 'utf8');
    return new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  };

  it('extracts the real description, not the site name or the button label', () => {
    const rows = SBWSerp.parseResults(realDoc());
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // The bug: until 2026-09-16 this returned "Philanthropy.org" or
    // "Philanthropy.orgAbout this result" — the description lives in a
    // SIBLING element the parser never reached.
    rows.forEach((r) => {
      expect(r.snippet).toBeTruthy();
      expect(r.snippet).not.toBe('Philanthropy.org');
      expect(r.snippet).not.toMatch(/About this result/);
      expect(r.snippet.length).toBeGreaterThan(40);
    });
    expect(rows[0].snippet).toMatch(/philanthropy\.org is where serious thinkers/i);
  });

  it('captures the site name, display URL and breadcrumb Google renders', () => {
    const rows = SBWSerp.parseResults(realDoc());
    expect(rows[0].siteName).toBe('Philanthropy.org');
    expect(rows[0].displayUrl).toBe('https://philanthropy.org');
    expect(rows[0].breadcrumb).toMatch(/Home/);
    // The breadcrumb renders inside <cite>, so the display URL must not repeat it.
    expect(rows[0].displayUrl).not.toMatch(/Home/);
  });

  it('reads the total result count off the page', () => {
    const ctx = SBWSerp.searchContext({ search: '?q=x' }, realDoc());
    expect(ctx.resultStats).toMatch(/results/);
  });

  it('every captured field reaches the CSV', () => {
    const doc = realDoc();
    const rows = SBWSerp.parseResults(doc);
    const csv = SBWSerp.resultsToCsv(rows, SBWSerp.searchContext({ search: '?q=site:philanthropy.org' }, doc));
    expect(csv).toContain('Site name,Display URL,Breadcrumb');
    expect(csv).toContain('Result stats');
    expect(csv).toMatch(/serious thinkers/);
    expect(csv).toContain('site:philanthropy.org');
  });

  it('ignores this extension\'s own injected overlay', () => {
    const doc = realDoc();
    const first = doc.querySelector('#rso h3').closest('div');
    const ours = doc.createElement('span');
    ours.className = 'sbw-serp-bar';
    ours.textContent = 'SBW INJECTED TEXT';
    first.appendChild(ours);
    const rows = SBWSerp.parseResults(doc);
    rows.forEach((r) => expect(r.snippet).not.toMatch(/SBW INJECTED TEXT/));
  });
});

describe('a real commercial SERP — dates, ratings, PAA, related searches', () => {
  // tests/fixtures/serp-google-commercial-query.html: "best crm for nonprofits",
  // saved 2026-09-16. The site: fixture has none of these features, which is
  // why two real pages are kept rather than one.
  const realDoc = () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(
      path.join(__dirname, '../fixtures/serp-google-commercial-query.html'), 'utf8');
    return new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  };

  it('reads every organic result in page order', () => {
    // Pinned in 1.9.3 so sitelink handling can't merge or drop one.
    expect(SBWSerp.parseResults(realDoc()).map((r) => r.domain)).toEqual([
      'reddit.com', 'salesforce.com', 'doublethedonation.com',
      'givebutter.com', 'kindsight.io', 'virtuous.org'
    ]);
  });

  it('splits Google\'s date stamp out of the description', () => {
    const rows = SBWSerp.parseResults(realDoc());
    const dated = rows.filter((r) => r.date);
    expect(dated.length).toBeGreaterThanOrEqual(2);
    dated.forEach((r) => {
      // The stamp must leave the snippet, not sit at the front of it.
      expect(r.snippet.startsWith(r.date)).toBe(false);
      expect(r.snippet).not.toMatch(/^\s*—/);
    });
    expect(rows.find((r) => r.domain === 'kindsight.io').date).toBe('Mar 28, 2025');
  });

  it('handles both absolute and relative date stamps', () => {
    expect(SBWSerp.splitDatePrefix('Mar 28, 2025 — Discover the best.'))
      .toEqual({ date: 'Mar 28, 2025', rest: 'Discover the best.' });
    expect(SBWSerp.splitDatePrefix('6 days ago — A nonprofit CRM.'))
      .toEqual({ date: '6 days ago', rest: 'A nonprofit CRM.' });
    // An em dash inside prose is not a date stamp.
    expect(SBWSerp.splitDatePrefix('Donor tools — and more').date).toBe('');
  });

  it('reads a star rating off its aria-label', () => {
    const rows = SBWSerp.parseResults(realDoc());
    const rated = rows.filter((r) => r.rating);
    expect(rated.length).toBeGreaterThanOrEqual(1);
    expect(rated[0].rating).toBe('5.0/5');
  });

  it('never leaks an inline script into a snippet', () => {
    // One result's description came back as "(function(){window.sn=…" until
    // script/style were added to the strip list.
    SBWSerp.parseResults(realDoc()).forEach((r) => {
      expect(r.snippet || '').not.toMatch(/function\s*\(|window\.|\{|\}/);
    });
  });

  it('excludes the search itself from People also ask', () => {
    // [data-q] is not PAA-only: Google stamps the query with it too, so
    // "best crm for nonprofits" was exported as a question.
    const questions = SBWSerp.parsePaa(realDoc());
    expect(questions.length).toBeGreaterThanOrEqual(3);
    questions.forEach((q) => expect(q.endsWith('?')).toBe(true));
    expect(questions).not.toContain('best crm for nonprofits');
  });

  it('collects related searches without the pagination controls', () => {
    const related = SBWSerp.parseRelatedSearches(realDoc());
    expect(related.length).toBeGreaterThanOrEqual(5);
    expect(related).toContain('Best CRM for small nonprofits');
    ['Next', 'Previous', 'More results'].forEach((chrome) =>
      expect(related).not.toContain(chrome));
  });

  it('carries the page-level fields into the export', () => {
    const doc = realDoc();
    const ctx = SBWSerp.searchContext({ search: '?q=best+crm+for+nonprofits' }, doc);
    expect(ctx.resultStats).toMatch(/About [\d,]+ results/);
    expect(ctx.relatedSearches).toContain('|');
    expect(ctx.paa).toMatch(/\?/);

    const csv = SBWSerp.resultsToCsv(SBWSerp.parseResults(doc), ctx);
    const header = csv.replace(/^﻿/, '').split('\r\n')[0].split(',');
    ['Date', 'Rating', 'Result stats', 'Related searches', 'People also ask']
      .forEach((col) => expect(header).toContain(col));
  });
});

/* ---------- Google's redirect links (/goto, /url) — issue #41 ---------- */

describe('a real signed-out SERP whose results link through /goto (issue #41)', () => {
  // tests/fixtures/serp-google-goto-links.html: "seo stats chrome", saved
  // 2026-10-12 signed out. Google links its own properties directly and every
  // other site through an opaque /goto?url= token, so the destination is only
  // in the <cite> breadcrumb (or the site name). Until 1.7.5 the parser
  // required a[href^="http"] and found none of the third-party results.
  const realDoc = () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(
      path.join(__dirname, '../fixtures/serp-google-goto-links.html'), 'utf8');
    return new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://www.google.com/search?q=seo+stats+chrome' }).window.document;
  };

  it('reads every organic result in page order, Google properties included (#41, #42)', () => {
    // 1.7.4 read 0 of these 9: the four Google properties were dropped as
    // "internal" (#42) and the five other sites hid behind /goto (#41).
    expect(SBWSerp.parseResults(realDoc()).map((r) => r.domain)).toEqual([
      'chromewebstore.google.com',
      'chromewebstore.google.com',
      'search.google.com',
      'rankmath.com',
      'detailed.com',
      'developers.google.com',
      'seobolt.io',
      'reddit.com',
      'open-seo-statsformerly-pagerank-status.en.softonic.com'
    ]);
  });

  it('gives a Chrome Web Store result its exact listing URL (#42)', () => {
    const [first] = SBWSerp.parseResults(realDoc());
    expect(first.url).toMatch(/^https:\/\/chromewebstore\.google\.com\/detail\//);
    expect(first.urlResolved).toBeUndefined();
    expect(first.position).toBe(1);
  });

  it('keeps every third-party result, in page order', () => {
    const rows = SBWSerp.parseResults(realDoc());
    const third = rows.filter((r) => !/google\.com$/.test(r.domain));
    expect(third.map((r) => r.domain)).toEqual([
      'rankmath.com',
      'detailed.com',
      'seobolt.io',
      'reddit.com',
      'open-seo-statsformerly-pagerank-status.en.softonic.com'
    ]);
  });

  it('reads the origin from the breadcrumb and says it is only the origin', () => {
    const rank = SBWSerp.parseResults(realDoc()).find((r) => r.domain === 'rankmath.com');
    expect(rank.url).toBe('https://rankmath.com/');
    expect(rank.urlResolved).toBe(false);
    expect(rank.title).toMatch(/Best SEO Chrome Extensions/);
    expect(rank.snippet.length).toBeGreaterThan(40);
  });

  it('maps a forum result with no URL breadcrumb by its site name', () => {
    // cite reads "10+ comments · 3 years ago"; the site name is "Reddit · r/…"
    const reddit = SBWSerp.parseResults(realDoc()).find((r) => r.domain === 'reddit.com');
    expect(reddit).toBeTruthy();
    expect(reddit.urlResolved).toBe(false);
  });

  it('keeps the Google redirect as the link to open', () => {
    const rank = SBWSerp.parseResults(realDoc()).find((r) => r.domain === 'rankmath.com');
    expect(rank._href).toMatch(/^https:\/\/www\.google\.com\/goto\?url=/);
    // non-enumerable: never reaches the CSV or clipboard
    expect(Object.keys(rank)).not.toContain('_href');
  });

  it('exports the origin, not the opaque token', () => {
    const doc = realDoc();
    const csv = SBWSerp.resultsToCsv(SBWSerp.parseResults(doc), SBWSerp.searchContext({ search: '?q=seo+stats+chrome' }, doc));
    expect(csv).toContain('https://rankmath.com/');
    expect(csv).not.toContain('/goto?url=');
  });
});

describe('a real SERP with LinkedIn, Instagram and Facebook profiles (1.9.2)', () => {
  // tests/fixtures/serp-google-social-profiles.html: "seo bandwagon", saved
  // from Brave on 2026-10-21 and cut down to #rso (scripts, styles, comments,
  // images and an account email removed). That load was signed in, so its
  // links are direct. Signed out, the same results link through /goto tokens
  // (an export at 15:07 UTC that day held only origins), and the profiles show
  // "LinkedIn · SEO Bandwagon" over "200+ followers" with no URL breadcrumb.
  const realDoc = ({ goto = false, rpos = true, fixture = 'serp-google-social-profiles.html' } = {}) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../fixtures', fixture), 'utf8');
    const doc = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://www.google.com/search?q=seo+bandwagon' }).window.document;
    if (goto) {
      let n = 0;
      doc.querySelectorAll('#rso a[href^="http"]').forEach((a) => {
        if (!/(^|\.)google\.[a-z.]+$/.test(new URL(a.href).hostname)) a.setAttribute('href', `/goto?url=CAES${++n}`);
      });
    }
    // The 2026-09-16 commercial page has no data-rpos at all.
    if (!rpos) doc.querySelectorAll('[data-rpos]').forEach((el) => el.removeAttribute('data-rpos'));
    return doc;
  };

  it('counts the sitelinks under result 1 as part of it when the links are direct (1.9.3)', () => {
    // 1.9.2 read 11 rows here: seobandwagon.com seven times (five sitelinks
    // and the AI Overview's heading), so LinkedIn sat at 8 instead of 2.
    // DataForSEO also counts sitelinks as part of result 1.
    const rows = SBWSerp.parseResults(realDoc());
    expect(rows.map((r) => [r.position, r.domain])).toEqual([
      [1, 'seobandwagon.com'],
      [2, 'linkedin.com'],
      [3, 'yelp.com'],
      [4, 'instagram.com'],
      [5, 'facebook.com']
    ]);
    expect(rows[0].url).toBe('https://seobandwagon.com/');
  });

  it('still does when Google leaves out data-rpos (1.9.3)', () => {
    expect(SBWSerp.parseResults(realDoc({ rpos: false })).map((r) => r.domain)).toEqual([
      'seobandwagon.com', 'linkedin.com', 'yelp.com', 'instagram.com', 'facebook.com'
    ]);
  });

  it('leaves out the AI Overview, which sits inside #rso when signed in (1.9.3)', () => {
    // Its heading has no link, so it borrowed the answer's first citation
    // (seobandwagon.com/pricing). Moved to another site, that citation can't
    // pass for a sitelink of result 1.
    const doc = realDoc();
    const heading = [...doc.querySelectorAll('#rso h3')].find((h) => /^AI Mode reply/.test(h.textContent));
    heading.parentElement.querySelectorAll('a[href^="http"]').forEach((a) => a.setAttribute('href', 'https://ontoplist.com/seo-bandwagon'));
    const rows = SBWSerp.parseResults(doc);
    expect(rows.find((r) => /AI Mode/.test(r.title))).toBeUndefined();
    expect(rows.map((r) => r.domain)).toEqual([
      'seobandwagon.com', 'linkedin.com', 'yelp.com', 'instagram.com', 'facebook.com'
    ]);
  });

  it('keeps a real second result on the same site as result 1 (1.9.3)', () => {
    [true, false].forEach((rpos) => {
      const rows = SBWSerp.parseResults(realDoc({ rpos, fixture: 'serp-google-site-query.html' }));
      expect(rows.map((r) => [r.position, r.url])).toEqual([
        [1, 'https://philanthropy.org/990/nonprofits/religion/'],
        [2, 'https://philanthropy.org/990/nonprofits/hospitals/']
      ]);
    });
  });

  it('keeps the profiles in page order when results link through /goto', () => {
    // 1.9.1 kept 2 of these 5 (seobandwagon.com, yelp.com).
    const rows = SBWSerp.parseResults(realDoc({ goto: true }));
    expect(rows.map((r) => [r.position, r.domain])).toEqual([
      [1, 'seobandwagon.com'],
      [2, 'linkedin.com'],
      [3, 'yelp.com'],
      [4, 'instagram.com'],
      [5, 'facebook.com']
    ]);
    expect(rows.filter((r) => /linkedin|instagram|facebook/.test(r.domain)).every((r) => r.urlResolved === false)).toBe(true);
  });

  it('keeps them, with their full URLs, when the links are direct', () => {
    const rows = SBWSerp.parseResults(realDoc());
    const social = rows.filter((r) => /linkedin|instagram|facebook/.test(r.domain));
    expect(social.map((r) => r.domain)).toEqual(['linkedin.com', 'instagram.com', 'facebook.com']);
    expect(social[0].url).toBe('https://www.linkedin.com/company/seo-bandwagon');
  });
});

describe('resolving Google redirect links (issue #41)', () => {
  const block = (href, extra = '') => `
    <div class="g"><div>
      <a href="${href}"><h3>A result title</h3></a>
      ${extra}
      <div class="VwiC3b">A description long enough to count as a real snippet for this result.</div>
    </div></div>`;
  const parse = (html) => SBWSerp.parseResults(
    new JSDOM(`<!doctype html><body><div id="rso">${html}</div></body>`, { url: 'https://www.google.com/search?q=x' }).window.document);

  it('takes the destination straight from /url?q=', () => {
    const [row] = parse(block('/url?q=https://example.com/page&sa=U'));
    expect(row.url).toBe('https://example.com/page');
    expect(row.domain).toBe('example.com');
    expect(row.urlResolved).toBeUndefined();
  });

  it('takes the destination from data-curl when Google provides it', () => {
    const [row] = parse(block('/goto?url=CAESabc', '<div data-curl="https://www.youtube.com/watch?v=abc"></div><cite>YouTube · Channel</cite>'));
    expect(row.url).toBe('https://www.youtube.com/watch?v=abc');
    expect(row.urlResolved).toBeUndefined();
  });

  it('takes no host from a breadcrumb Google cut short: the result is an unknown site', () => {
    for (const cut of ['https://some-very-long-host-name.exa…', 'https://some-very-long-host-name.exa...']) {
      const [row] = parse(block('/goto?url=CAESabc', `<cite>${cut}</cite>`));
      expect(row).toMatchObject({ position: 1, url: '', domain: '', siteUnknown: true, displayUrl: cut });
    }
  });

  // 1.10.2: until then a result like this was dropped, and every result after
  // it moved up one position.
  it('keeps a /goto result it cannot place in its slot, without guessing a site', () => {
    const rows = parse(
      block('/goto?url=CAESabc', '<cite>10+ comments · 3 years ago</cite>') +
      block('/goto?url=CAESdef', '<cite>https://example.com › blog</cite>'));
    expect(rows.map((r) => [r.position, r.domain, !!r.siteUnknown])).toEqual([[1, '', true], [2, 'example.com', false]]);
    expect(rows[0].url).toBe('');
    expect(rows[0].urlResolved).toBeUndefined();
    expect(rows[0]._href).toBe('https://www.google.com/goto?url=CAESabc');
  });

  it('still drops an unplaceable link with neither a URL line nor a site name, as a signed-out sitelink is', () => {
    expect(parse(block('/goto?url=CAESabc'))).toEqual([]);
  });

  it('says in the export which rows have their URL, their site only, or neither', () => {
    const rows = parse(
      block('https://example.com/page') +
      block('/goto?url=CAESdef', '<cite>https://example.org › blog</cite>') +
      block('/goto?url=CAESabc', '<cite>10+ comments · 3 years ago</cite>'));
    const csv = SBWSerp.resultsToCsv(rows, SBWSerp.searchContext({ search: '?q=x' }));
    const [header, ...lines] = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    const at = header.split(',').indexOf('URL known');
    expect(lines.map((l) => l.split(',')[at])).toEqual(['yes', 'site only', 'no']);
  });

  // Signed out, Google shows a social profile as "LinkedIn · SEO Bandwagon"
  // over "200+ followers", with no URL breadcrumb. Seen live on 2026-10-21 for
  // "seo bandwagon": LinkedIn second on the page, and missing from the export,
  // as were Facebook and Instagram, so every later position moved up.
  it.each([
    ['LinkedIn · SEO Bandwagon', '200+ followers', 'linkedin.com'],
    ['Facebook · SEO Bandwagon', '120 followers', 'facebook.com'],
    ['Instagram · seobandwagon', '40+ followers', 'instagram.com'],
    ['TikTok · SEO Bandwagon', '1K+ followers', 'tiktok.com'],
    ['Pinterest · SEO Bandwagon', '20 followers', 'pinterest.com']
  ])('maps a social profile with no URL breadcrumb by its site name (%s)', (siteName, cite, domain) => {
    const [row] = parse(block('/goto?url=CAESprofile', `<span class="VuuXrf">${siteName}</span><cite>${cite}</cite>`));
    expect(row).toBeTruthy();
    expect(row.domain).toBe(domain);
    expect(row.url).toBe(`https://${domain}/`);
    expect(row.urlResolved).toBe(false);
  });

  it('keeps a social profile in its place, so later results keep their positions', () => {
    const rows = parse(
      block('/goto?url=CAESone', '<cite>https://seobandwagon.com</cite>') +
      block('/goto?url=CAEStwo', '<span class="VuuXrf">LinkedIn · SEO Bandwagon</span><cite>200+ followers</cite>') +
      block('/goto?url=CAESthree', '<cite>https://www.inc.com › profile › SEO-Bandwagon</cite>'));
    expect(rows.map((r) => [r.position, r.domain])).toEqual([
      [1, 'seobandwagon.com'],
      [2, 'linkedin.com'],
      [3, 'inc.com']
    ]);
  });

  it('guesses no site from a name that is not one known site; the result keeps its slot', () => {
    const [row] = parse(block('/goto?url=CAESabc', '<span class="VuuXrf">Acme Profiles · SEO Bandwagon</span><cite>200+ followers</cite>'));
    expect(row).toMatchObject({ position: 1, domain: '', siteUnknown: true, siteName: 'Acme Profiles · SEO Bandwagon' });
  });

  it('does not merge two different pages on one site known only by origin', () => {
    const rows = parse(
      block('/goto?url=CAESone', '<cite>https://example.com › blog</cite>') +
      block('/goto?url=CAEStwo', '<cite>https://example.com › docs</cite>'));
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(rows.every((r) => r.url === 'https://example.com/')).toBe(true);
  });

  it('still dedupes the same /goto link', () => {
    const one = block('/goto?url=CAESsame', '<cite>https://example.com › blog</cite>');
    expect(parse(one + one).length).toBe(1);
  });
});

/* ---------- #45: approximate absolute position ---------- */

describe('absolute position (approx.) column (#45)', () => {
  const rows = [{ position: 1, url: 'https://a.example/', domain: 'a.example', title: 'A' },
                { position: 2, url: 'https://b.example/', domain: 'b.example', title: 'B' }];

  it('counts 10 for each earlier page nobody added to Collect', () => {
    const ctx = SBWSerp.searchContext({ search: '?q=x&start=20' });
    expect(ctx.start).toBe(20);
    expect(ctx.page).toBe(3);
    expect(SBWSerp.absolutePosition(rows[1], ctx)).toBe(22);
    expect(SBWSerp.absolutePosition(rows[0], SBWSerp.searchContext({ search: '?q=x' }))).toBe(1);
  });

  // 1.10.2: until then it was always `start` + position, wrong whenever a
  // page held other than 10 organic results.
  it('counts the organic results of the earlier pages when they were added', () => {
    const ctx = Object.assign(SBWSerp.searchContext({ search: '?q=x&start=10' }), { earlierOrganic: 6 });
    expect(rows.map((r) => SBWSerp.absolutePosition(r, ctx))).toEqual([7, 8]);
    expect(SBWSerp.absolutePosition({ position: 3, absoluteApprox: 15 }, ctx)).toBe(15);
  });

  it('is appended after the earlier columns, so existing column positions don\'t move', () => {
    const csv = SBWSerp.resultsToCsv(rows, SBWSerp.searchContext({ search: '?q=x&start=10' }));
    const [header, first, second] = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    const cols = header.split(',');
    expect(cols.slice(-6)).toEqual(['Absolute position (approx.)', 'Absolute position', 'Collection notes',
      'Position counting everything', 'URL known', 'Place name']);
    expect(cols.slice(0, 3)).toEqual(['Query', 'Position', 'URL']);
    expect(first.split(',').at(-6)).toBe('11');
    expect(second.split(',').at(-6)).toBe('12');
  });

  it('on page 1 the exact absolute position is the position (#45)', () => {
    const csv = SBWSerp.resultsToCsv(rows, SBWSerp.searchContext({ search: '?q=x' }));
    const [, first, second] = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect([first.split(',').at(-5), second.split(',').at(-5)]).toEqual(['1', '2']);
  });
});

describe('ads are matched by whole-word aria-labels (#94)', () => {
  const result = (domain) => `<div class="g"><div><a href="https://${domain}/x"><h3>A result on ${domain}</h3></a><cite>${domain}</cite></div></div>`;

  it('keeps results under a container labelled "Downloads", "Threads" or "Leads"', () => {
    const doc = parseFragment(`
      <div aria-label="Downloads">${result('one.example')}</div>
      <div aria-label="Threads">${result('two.example')}</div>
      <div aria-label="Leads and more">${result('three.example')}</div>`);
    expect(SBWSerp.parseResults(doc).map(r => r.domain)).toEqual(['one.example', 'two.example', 'three.example']);
  });

  it('still drops results under "Ads", "Sponsored" and "Sponsored results"', () => {
    const doc = parseFragment(`
      <div aria-label="Ads">${result('ad1.example')}</div>
      <div aria-label="Sponsored results">${result('ad2.example')}</div>
      <section aria-label="Downloads"><div aria-label="sponsored">${result('ad3.example')}</div></section>
      ${result('organic.example')}`);
    expect(SBWSerp.parseResults(doc).map(r => r.domain)).toEqual(['organic.example']);
  });
});

/* ---------- 1.10.2: the right numbers on the Google results page ---------- */

describe('People also ask is never a result (1.10.2)', () => {
  // An expanded question shows its answer's source as an h3 with a link, a
  // URL line and a snippet: everything a result has. Built after Google's
  // People also ask markup: the block is [jsname="yEVEwb"] with
  // [data-initq], each question a .related-question-pair.
  const result = (domain, n) => `<div class="MjjYud"><div class="g"><div>
      <a href="https://${domain}/page"><h3>Result ${n}</h3></a><cite>https://${domain}</cite>
      <div class="VwiC3b">A description long enough to count as a real snippet for this result.</div></div></div></div>`;
  const paa = (expanded) => `<div class="MjjYud"><div jsname="yEVEwb" data-initq="widgets">
      <div role="heading" aria-level="2"><span>People also ask</span></div>
      <div class="related-question-pair" data-q="How do widgets work?"><div role="button">How do widgets work?</div>
        ${expanded ? `<div><div class="g"><a href="https://answer-source.example/widgets"><h3>How widgets work, explained</h3></a>
          <cite>https://answer-source.example › widgets</cite>
          <div class="VwiC3b">Widgets work by turning one thing into another thing, which is the long answer.</div></div></div>` : ''}
      </div></div></div>`;
  const parse = (html) => SBWSerp.parseResults(
    new JSDOM(`<!doctype html><body><div id="search"><div id="rso">${html}</div></div></body>`).window.document);

  it('reads the same results with a question open as with it closed', () => {
    const closed = parse(result('one.example', 1) + paa(false) + result('two.example', 2));
    const open = parse(result('one.example', 1) + paa(true) + result('two.example', 2));
    expect(open.map((r) => [r.position, r.domain])).toEqual([[1, 'one.example'], [2, 'two.example']]);
    expect(open.map((r) => r.position)).toEqual(closed.map((r) => r.position));
  });

  it('counts the People also ask block itself in the position counting everything', () => {
    const rows = parse(result('one.example', 1) + paa(true) + result('two.example', 2));
    expect(rows.map((r) => r.pagePosition)).toEqual([1, 3]);
  });
});

describe('the position counting everything on the page (1.10.2)', () => {
  const result = (domain) => `<div class="MjjYud"><div class="g"><div>
      <a href="https://${domain}/page"><h3>A result on ${domain}</h3></a><cite>https://${domain}</cite>
      <div class="VwiC3b">A description long enough to count as a real snippet for this result.</div></div></div></div>`;
  const ad = (n) => `<div data-text-ad="1"><a href="https://ad${n}.example/"><h3>Ad ${n}</h3></a><div>Ad copy for an advertiser here.</div></div>`;
  const doc = (body) => new JSDOM(`<!doctype html><body>${body}</body>`).window.document;

  it('counts each ad above the results, and none below', () => {
    const rows = SBWSerp.parseResults(doc(`<div id="tads">${ad(1)}${ad(2)}</div>
      <div id="search"><div id="rso">${result('one.example')}${result('two.example')}
      <div id="bottomads">${ad(3)}</div></div></div>`));
    expect(rows.map((r) => [r.position, r.pagePosition])).toEqual([[1, 3], [2, 4]]);
  });

  it('counts a feature block between results, and skips empty spacers and hidden headings', () => {
    const rows = SBWSerp.parseResults(doc(`<div id="search"><h1>Search Results</h1><div id="rso">
      ${result('one.example')}<div class="MjjYud"></div>
      <div class="MjjYud"><h2>Videos</h2><g-scrolling-carousel><div>Video one · 3 min</div></g-scrolling-carousel></div>
      <div class="MjjYud" style="display:none">Hidden block</div>
      ${result('two.example')}</div></div>`));
    expect(rows.map((r) => [r.position, r.pagePosition])).toEqual([[1, 1], [2, 3]]);
  });

  it('counts an AI Overview that Google wraps in one block with the results after it', () => {
    const rows = SBWSerp.parseResults(doc(`<div id="search"><div id="rso">${result('one.example')}
      <div><div class="ULSxyf"><div data-subtree="aimc"><h2>AI Overview</h2><div>An AI summary of the answer.</div></div></div>
      ${result('two.example')}${result('three.example')}</div></div></div>`));
    expect(rows.map((r) => r.pagePosition)).toEqual([1, 3, 4]);
  });

  it('counts a block above the results list inside #search', () => {
    const rows = SBWSerp.parseResults(doc(`<div id="search"><div class="ai-overview-shell"><div>An AI summary above everything.</div></div>
      <div id="rso">${result('one.example')}</div></div>`));
    expect(rows[0].pagePosition).toBe(2);
  });

  it('matches the export, on a real saved page', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../fixtures/serp-google-social-profiles.html'), 'utf8');
    const rows = SBWSerp.parseResults(new JSDOM(`<!doctype html><body>${html}</body>`).window.document);
    // The AI Overview sits between result 1 and LinkedIn, and Search
    // Console's own box (shown to the site's owner) between LinkedIn and Yelp.
    // The one ad on the page is at the bottom.
    expect(rows.map((r) => [r.position, r.pagePosition])).toEqual([[1, 1], [2, 3], [3, 5], [4, 6], [5, 7]]);
    const csv = SBWSerp.resultsToCsv(rows, SBWSerp.searchContext({ search: '?q=seo+bandwagon' }));
    const [header, ...lines] = csv.replace(/^﻿/, '').trim().split('\r\n');
    const at = header.split(',').indexOf('Position counting everything');
    expect(lines.map((l) => l.split(',').at(at - header.split(',').length))).toEqual(['1', '3', '5', '6', '7']);
  });
});

describe('the bar goes below the whole result (1.10.2)', () => {
  it('anchors after the description, not between it and the title', () => {
    const document = new JSDOM(`<!doctype html><body><div id="rso"><div class="MjjYud"><div class="g">
      <div class="title"><a href="https://example.com/page"><h3>A title</h3></a><cite>https://example.com</cite></div>
      <div class="VwiC3b">A description long enough to count as a real snippet for this result.</div>
      </div></div></div></body>`).window.document;
    const [row] = SBWSerp.parseResults(document);
    expect(row._end.contains(document.querySelector('.VwiC3b'))).toBe(true);
    expect(row._end.contains(row._el)).toBe(true);
    expect(Object.keys(row)).not.toContain('_end');
  });

  it('anchors after the sitelinks when Google wraps them with the result', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../fixtures/serp-google-social-profiles.html'), 'utf8');
    const document = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
    const [first] = SBWSerp.parseResults(document);
    expect(first._end.getAttribute('data-rpos')).toBe('0');
    expect([...first._end.querySelectorAll('h3')].map((h) => h.textContent)).toContain('Contact');
  });
});

describe('the place a location stands for (1.10.2)', () => {
  it('reads the name back out of a uule the simulator wrote', () => {
    const u = SBWSerp.uule('Austin,Texas,United States');
    expect(SBWSerp.placeFromUule(u)).toBe('Austin,Texas,United States');
    expect(SBWSerp.placeFromUule(u.replace('+', ' '))).toBe('Austin,Texas,United States');
  });

  it('is blank for Google\'s coordinate form and for anything that does not decode', () => {
    expect(SBWSerp.placeFromUule('a+cm9sZToxIHByb2R1Y2VyOjEy')).toBe('');
    expect(SBWSerp.placeFromUule('w+CAIQICIZbogus')).toBe('');
    expect(SBWSerp.placeFromUule('')).toBe('');
  });

  it('fills the Place name column, beside the encoded Location', () => {
    const u = SBWSerp.uule('Denver,Colorado,United States');
    const search = '?' + new URLSearchParams({ q: 'plumbers', uule: u }).toString();
    const ctx = SBWSerp.searchContext({ search });
    expect(ctx.place).toBe('Denver,Colorado,United States');
    const tsv = SBWSerp.resultsToTsv([{ position: 1, url: 'https://a.example/', domain: 'a.example', title: 'A' }], ctx);
    const [header, line] = tsv.split('\n');
    const cell = (name) => line.split('\t')[header.split('\t').indexOf(name)];
    expect(cell('Place name')).toBe('Denver,Colorado,United States');
    expect(cell('Location')).toBe(u);
  });
});

describe('metro names Google knows (1.10.2)', () => {
  // Google's geotargets list (2026-10-06) has none of these six metro names;
  // a uule built from one made Google fall back to the searcher's own place.
  it.each([
    ['Dallas, TX', 'Dallas,Texas,United States'],
    ['Fort Myers, FL', 'Fort Myers,Florida,United States'],
    ['Minneapolis, MN', 'Minneapolis,Minnesota,United States'],
    ['Raleigh, NC', 'Raleigh,North Carolina,United States'],
    ['Sarasota, FL', 'Sarasota,Florida,United States'],
    ['Tampa, FL', 'Tampa,Florida,United States']
  ])('%s searches as %s', (label, canonical) => {
    expect(SBWSerp.PRESET_LOCATIONS.find((l) => l.label === label).canonical).toBe(canonical);
  });

  it('keeps no hyphenated metro name', () => {
    expect(SBWSerp.PRESET_LOCATIONS.filter((l) => /-/.test(l.canonical))).toEqual([]);
  });
});
