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
    expect(SBWSerp.bareDomain('https://support.google.de/websearch')).toBeNull();
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

  it('includes gl/hl/uule/num when provided', () => {
    const url = SBWSerp.buildSearchUrl({ q: 'x', gl: 'us', hl: 'en', uule: 'ABC', num: 20 });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('gl')).toBe('us');
    expect(parsed.searchParams.get('hl')).toBe('en');
    expect(parsed.searchParams.get('uule')).toBe('ABC');
    expect(parsed.searchParams.get('num')).toBe('20');
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
  it('clamps num to the 1-100 range', () => {
    const tooHigh = new URL(SBWSerp.buildSearchUrl({ q: 'x', num: 500 }));
    expect(tooHigh.searchParams.get('num')).toBe('100');
    const tooLow = new URL(SBWSerp.buildSearchUrl({ q: 'x', num: -5 }));
    expect(tooLow.searchParams.get('num')).toBe('1');
  });

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
    expect(csv).toContain('Query,Position,URL,Domain,Title,Snippet,Captured,Country,Language,Location,Page');
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
    // A row with no snippet still emits the column, empty.
    expect(body[0].split(',').length).toBe(11);
  });

  it('still guards formula injection in the new columns', () => {
    const rows = [{ position: 1, url: 'https://a.com/', domain: 'a.com', title: 'T', snippet: '=SUM(A1)' }];
    const csv = SBWSerp.resultsToCsv(rows, { query: '+evil', capturedAt: 'Z', page: 1 });
    expect(csv).not.toContain(',=SUM(A1)');
    expect(csv).not.toContain(',+evil');
  });
});
