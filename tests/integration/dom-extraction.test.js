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
