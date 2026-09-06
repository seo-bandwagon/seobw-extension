// Integration tests for lib/dom-extraction.js against the fixture
// HTML snapshot of https://seobandwagon.com/local-seo.
//
// These tests parse the real HTML with JSDOM, invoke the DOM extractors,
// and assert against the actual contents of the page. When the platform's
// /local-seo page changes meaningfully, refresh the fixture:
//
//   curl -sSL -A "Mozilla/5.0" https://seobandwagon.com/local-seo \
//     -o tests/fixtures/local-seo.html
//
// Then update assertions below to reflect any intentional changes.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import extraction from '../../lib/dom-extraction.js';
import analysis from '../../lib/content-analysis.js';

const { extractMeta, extractHeadings, extractLinks, extractImages, extractTechnical, getMainContent } = extraction;
const { calculateSEOScore, cleanText, getWords, calculateReadability } = analysis;

const FIXTURE_URL = 'https://seobandwagon.com/local-seo';
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '..', 'fixtures', 'local-seo.html');

let dom;

beforeAll(() => {
  const html = readFileSync(fixturePath, 'utf-8');
  // Set the URL so window.location.hostname === 'seobandwagon.com' for
  // internal-vs-external link detection.
  dom = new JSDOM(html, { url: FIXTURE_URL });
});

describe('extractMeta (against seobandwagon.com/local-seo fixture)', () => {
  it('pulls a non-empty title', () => {
    const meta = extractMeta(dom.window.document);
    expect(meta.title.text.length).toBeGreaterThan(0);
    expect(meta.title.length).toBe(meta.title.text.length);
  });

  it('returns a description with measurable length', () => {
    const meta = extractMeta(dom.window.document);
    // Could be empty if the page lacks one; just assert the shape is correct
    expect(typeof meta.description.text).toBe('string');
    expect(meta.description.length).toBe(meta.description.text.length);
  });

  it('returns a structured openGraph object', () => {
    const meta = extractMeta(dom.window.document);
    expect(meta.openGraph).toHaveProperty('title');
    expect(meta.openGraph).toHaveProperty('description');
    expect(meta.openGraph).toHaveProperty('image');
  });

  it('returns canonical URL pointing at seobandwagon.com when set', () => {
    const meta = extractMeta(dom.window.document);
    if (meta.canonical) {
      expect(meta.canonical).toMatch(/seobandwagon\.com/);
    }
  });

  it('returns an array for schema (even if parsing fails)', () => {
    const meta = extractMeta(dom.window.document);
    expect(Array.isArray(meta.schema)).toBe(true);
  });

  it('handles a document with zero meta tags gracefully', () => {
    const empty = new JSDOM('<html><head></head><body></body></html>', { url: FIXTURE_URL });
    const meta = extractMeta(empty.window.document);
    expect(meta.title.text).toBe('');
    expect(meta.description.text).toBe('');
    expect(meta.canonical).toBeNull();
    expect(meta.schema).toEqual([]);
  });
});

describe('extractHeadings', () => {
  it('populates h1-h6 arrays + detects multiple-h1', () => {
    const headings = extractHeadings(dom.window.document);
    for (let i = 1; i <= 6; i++) {
      expect(Array.isArray(headings['h' + i])).toBe(true);
    }
    expect(headings.multipleH1).toBe(headings.h1.length > 1);
  });

  it('local-seo has at least one H1', () => {
    const headings = extractHeadings(dom.window.document);
    expect(headings.h1.length).toBeGreaterThanOrEqual(1);
  });

  it('treats empty heading elements as absent', () => {
    const d = new JSDOM('<html><body><h1></h1><h1>Real</h1></body></html>', { url: FIXTURE_URL });
    const headings = extractHeadings(d.window.document);
    expect(headings.h1.length).toBe(1);
    expect(headings.h1[0]).toBe('Real');
  });

  // Task 7, item A: "No H7" — instead, a document-order outline (level,
  // text, order) that also picks up ARIA heading roles the plain hN
  // extraction above ignores. Used by the popup's headings CSV export and
  // "Copy outline" button.
  describe('outline (Task 7, item A)', () => {
    it('lists real h1-h6 tags in document order with 1-based order numbers', () => {
      const html = '<html><body>' +
        '<h1>Title</h1><h3>Sub A</h3><h2>Section</h2><h3>Sub B</h3>' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const headings = extractHeadings(d.window.document);
      expect(headings.outline).toEqual([
        { level: 1, text: 'Title', order: 1 },
        { level: 3, text: 'Sub A', order: 2 },
        { level: 2, text: 'Section', order: 3 },
        { level: 3, text: 'Sub B', order: 4 }
      ]);
    });

    it('includes [role="heading"][aria-level] elements the plain hN arrays ignore', () => {
      const html = '<html><body>' +
        '<h1>Title</h1>' +
        '<div role="heading" aria-level="2">ARIA Section</div>' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const headings = extractHeadings(d.window.document);
      // The plain per-level arrays stay literal-tag-only...
      expect(headings.h2).toEqual([]);
      // ...but the outline sees both, in document order.
      expect(headings.outline).toEqual([
        { level: 1, text: 'Title', order: 1 },
        { level: 2, text: 'ARIA Section', order: 2 }
      ]);
    });

    it('defaults a non-numeric aria-level to 2, per WAI-ARIA', () => {
      // The extraction selector is literally `[role="heading"][aria-level]`
      // (matching the brief) — an element with role="heading" but no
      // aria-level attribute at all isn't matched, only one where the
      // attribute is present but not a usable number.
      const html = '<html><body>' +
        '<div role="heading" aria-level="not-a-number">Bad level</div>' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const headings = extractHeadings(d.window.document);
      expect(headings.outline).toEqual([
        { level: 2, text: 'Bad level', order: 1 }
      ]);
    });

    it('does not include a role="heading" element with no aria-level attribute at all', () => {
      const html = '<html><body><div role="heading">No level attr</div></body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const headings = extractHeadings(d.window.document);
      expect(headings.outline).toEqual([]);
    });

    it('clamps an out-of-range aria-level into 1-6', () => {
      const html = '<html><body>' +
        '<div role="heading" aria-level="9">Too deep</div>' +
        '<div role="heading" aria-level="0">Too shallow</div>' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const headings = extractHeadings(d.window.document);
      expect(headings.outline[0].level).toBe(6);
      expect(headings.outline[1].level).toBe(1);
    });

    it('excludes empty-text headings from the outline, same as the hN arrays', () => {
      const html = '<html><body>' +
        '<h1></h1><h1>Real</h1><div role="heading" aria-level="2">   </div>' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const headings = extractHeadings(d.window.document);
      expect(headings.outline).toEqual([{ level: 1, text: 'Real', order: 1 }]);
    });

    it('never double-counts an hN element that also carries role=heading', () => {
      const html = '<html><body><h2 role="heading" aria-level="2">Once</h2></body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const headings = extractHeadings(d.window.document);
      expect(headings.outline.length).toBe(1);
      expect(headings.outline[0]).toEqual({ level: 2, text: 'Once', order: 1 });
    });
  });
});

describe('extractLinks', () => {
  it('categorizes links as internal vs external', () => {
    const links = extractLinks(dom.window.document, dom.window.location);
    expect(links.internal.count).toBeGreaterThan(0);
    expect(typeof links.external.count).toBe('number');
    expect(Array.isArray(links.external.domains)).toBe(true);
    expect(Array.isArray(links.anchors)).toBe(true);
  });

  it('caps internal.urls at 100 for pages with thousands of links', () => {
    const bigHtml = '<html><body>' +
      Array.from({ length: 200 }, (_, i) =>
        `<a href="https://seobandwagon.com/page-${i}">Link ${i}</a>`
      ).join('') +
      '</body></html>';
    const d = new JSDOM(bigHtml, { url: FIXTURE_URL });
    const links = extractLinks(d.window.document, d.window.location);
    expect(links.internal.count).toBe(200);
    expect(links.internal.urls.length).toBe(100);
  });

  it('counts nofollow rel correctly', () => {
    const html = '<html><body>' +
      '<a href="https://example.com" rel="nofollow">A</a>' +
      '<a href="https://example.com/b">B</a>' +
      '<a href="https://example.com/c" rel="noopener nofollow">C</a>' +
      '</body></html>';
    const d = new JSDOM(html, { url: FIXTURE_URL });
    const links = extractLinks(d.window.document, d.window.location);
    expect(links.nofollow).toBe(2);
  });

  it('ignores links with unparseable hrefs', () => {
    const html = '<html><body>' +
      '<a href="https://valid.com">valid</a>' +
      '<a href="javascript:void(0)">js</a>' +
      '<a href="#anchor">anchor</a>' +
      '</body></html>';
    const d = new JSDOM(html, { url: FIXTURE_URL });
    // should not throw
    expect(() => extractLinks(d.window.document, d.window.location)).not.toThrow();
  });

  // Task 7, item D: nofollow surfacing — ugc/sponsored counted separately
  // from plain nofollow, plus a capped list of the actual anchors so the
  // popup can render an expandable list next to the existing Highlight
  // button (which already treats all three rel values as one family).
  describe('ugc / sponsored / nofollowAnchors (Task 7, item D)', () => {
    const html = '<html><body>' +
      '<a href="https://example.com/a" rel="nofollow">Plain nofollow</a>' +
      '<a href="https://example.com/b" rel="ugc">UGC only</a>' +
      '<a href="https://example.com/c" rel="sponsored">Sponsored only</a>' +
      '<a href="https://example.com/d" rel="noopener ugc nofollow">UGC + nofollow</a>' +
      '<a href="https://example.com/e">Plain link</a>' +
      '</body></html>';

    it('counts nofollow, ugc, and sponsored as separate totals', () => {
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const links = extractLinks(d.window.document, d.window.location);
      expect(links.nofollow).toBe(2); // a, d
      expect(links.ugc).toBe(2);      // b, d
      expect(links.sponsored).toBe(1); // c
    });

    it('lists every nofollow/ugc/sponsored anchor with url, text, and rel', () => {
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const links = extractLinks(d.window.document, d.window.location);
      expect(links.nofollowAnchors.length).toBe(4); // a, b, c, d — not the plain link
      expect(links.nofollowAnchors[0]).toEqual({
        url: 'https://example.com/a', text: 'Plain nofollow', rel: 'nofollow'
      });
      expect(links.nofollowAnchors.some(l => l.url === 'https://example.com/e')).toBe(false);
    });

    it('caps nofollowAnchors at 50', () => {
      const bigHtml = '<html><body>' +
        Array.from({ length: 80 }, (_, i) =>
          `<a href="https://example.com/n${i}" rel="nofollow">N${i}</a>`
        ).join('') +
        '</body></html>';
      const d = new JSDOM(bigHtml, { url: FIXTURE_URL });
      const links = extractLinks(d.window.document, d.window.location);
      expect(links.nofollow).toBe(80);
      expect(links.nofollowAnchors.length).toBe(50);
    });
  });

  // Task 7, item B: a full per-link list (url, anchor text, rel, internal/
  // external type) backing the popup's Links "Export CSV" button — richer
  // than the existing `anchors` field (text/href only, no rel or type).
  describe('list (Task 7, item B — links CSV export)', () => {
    it('includes url, anchor, rel, and type for every parseable link', () => {
      const html = '<html><body>' +
        '<a href="https://seobandwagon.com/internal" rel="nofollow">Internal link</a>' +
        '<a href="https://other-site.example/external">External link</a>' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const links = extractLinks(d.window.document, d.window.location);
      expect(links.list).toEqual([
        { url: 'https://seobandwagon.com/internal', anchor: 'Internal link', rel: 'nofollow', type: 'internal' },
        { url: 'https://other-site.example/external', anchor: 'External link', rel: '', type: 'external' }
      ]);
    });

    it('excludes unparseable hrefs from the list without throwing', () => {
      const html = '<html><body>' +
        '<a href="https://valid.com">valid</a>' +
        '<a href="javascript:void(0)">js</a>' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const links = extractLinks(d.window.document, d.window.location);
      expect(links.list.length).toBe(1);
      expect(links.list[0].url).toBe('https://valid.com/');
    });
  });
});

describe('extractImages', () => {
  it('returns shape with total + missingAlt + altTexts', () => {
    const images = extractImages(dom.window.document);
    expect(typeof images.total).toBe('number');
    expect(typeof images.missingAlt.count).toBe('number');
    expect(Array.isArray(images.missingAlt.srcs)).toBe(true);
    expect(Array.isArray(images.altTexts)).toBe(true);
  });

  it('counts missing alt correctly', () => {
    const html = '<html><body>' +
      '<img src="a.jpg">' +               // missing
      '<img src="b.jpg" alt="">' +         // empty alt = missing
      '<img src="c.jpg" alt="   ">' +     // whitespace alt = missing
      '<img src="d.jpg" alt="Valid alt">' +
      '</body></html>';
    const d = new JSDOM(html, { url: FIXTURE_URL });
    const images = extractImages(d.window.document);
    expect(images.total).toBe(4);
    expect(images.missingAlt.count).toBe(3);
    expect(images.altTexts).toEqual(['Valid alt']);
  });

  it('returns zeroes for a page with no images', () => {
    const d = new JSDOM('<html><body></body></html>', { url: FIXTURE_URL });
    const images = extractImages(d.window.document);
    expect(images.total).toBe(0);
    expect(images.missingAlt.count).toBe(0);
  });

  // Task 7, item B: a full per-image list (src, alt, hasAlt, lazy,
  // width/height) backing the popup's Images "Export CSV" button.
  describe('list (Task 7, item B — images CSV export)', () => {
    it('includes src, alt, hasAlt, lazy, width, and height per image', () => {
      const html = '<html><body>' +
        '<img src="a.jpg" alt="A photo" width="640" height="480">' +
        '<img src="b.jpg" loading="lazy">' +
        '</body></html>';
      const d = new JSDOM(html, { url: FIXTURE_URL });
      const images = extractImages(d.window.document);
      expect(images.list[0]).toEqual({
        src: 'https://seobandwagon.com/a.jpg', alt: 'A photo', hasAlt: true, lazy: false, width: '640', height: '480'
      });
      expect(images.list[1]).toEqual({
        src: 'https://seobandwagon.com/b.jpg', alt: '', hasAlt: false, lazy: true, width: null, height: null
      });
    });

    it('returns an empty list for a page with no images', () => {
      const d = new JSDOM('<html><body></body></html>', { url: FIXTURE_URL });
      const images = extractImages(d.window.document);
      expect(images.list).toEqual([]);
    });
  });
});

describe('extractTechnical', () => {
  it('returns DOM element count + scripts + stylesheets', () => {
    const tech = extractTechnical(dom.window.document, dom.window);
    expect(tech.domElements).toBeGreaterThan(0);
    expect(typeof tech.scripts).toBe('number');
    expect(typeof tech.stylesheets).toBe('number');
  });

  it('calculates url depth correctly', () => {
    const tech = extractTechnical(dom.window.document, dom.window);
    // /local-seo -> depth 1
    expect(tech.urlDepth).toBe(1);
  });

  it('handles a zero-element body', () => {
    const d = new JSDOM('<html><body></body></html>', { url: FIXTURE_URL });
    const tech = extractTechnical(d.window.document, d.window);
    expect(tech.domElements).toBeGreaterThanOrEqual(2); // html + body
    expect(tech.urlDepth).toBe(1);
  });
});

describe('getMainContent', () => {
  it('returns a non-empty string for the fixture', () => {
    const content = getMainContent(dom.window.document);
    expect(typeof content).toBe('string');
    // The page has real copy; at minimum a few characters of text
    expect(content.length).toBeGreaterThan(50);
  });

  it('excludes header / footer / nav when no <main> is present', () => {
    const html = '<html><body>' +
      '<header>HEADER</header>' +
      '<nav>NAV</nav>' +
      '<section>Main body text here</section>' +
      '<footer>FOOTER</footer>' +
      '</body></html>';
    const d = new JSDOM(html, { url: FIXTURE_URL });
    const content = getMainContent(d.window.document);
    expect(content).toContain('Main body text here');
    expect(content).not.toContain('HEADER');
    expect(content).not.toContain('FOOTER');
    expect(content).not.toContain('NAV');
  });

  it('prefers <main> if present', () => {
    const html = '<html><body>' +
      '<header>HEADER</header>' +
      '<main>The main content lives here</main>' +
      '<footer>FOOTER</footer>' +
      '</body></html>';
    const d = new JSDOM(html, { url: FIXTURE_URL });
    const content = getMainContent(d.window.document);
    expect(content).toContain('The main content lives here');
    expect(content).not.toContain('HEADER');
  });
});

describe('full analysis pipeline against local-seo fixture', () => {
  it('produces a score + grade when chaining extractors → calculateSEOScore', () => {
    const doc = dom.window.document;
    const meta = extractMeta(doc);
    const headings = extractHeadings(doc);
    const links = extractLinks(doc, dom.window.location);
    const images = extractImages(doc);
    const technical = extractTechnical(doc, dom.window);
    const mainText = getMainContent(doc);
    const words = getWords(cleanText(mainText));
    const readability = calculateReadability(mainText, words);

    const result = calculateSEOScore(
      { wordCount: words.length, readability: readability },
      meta,
      headings,
      links,
      images,
      technical
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
    expect(Array.isArray(result.issues)).toBe(true);
  });
});
