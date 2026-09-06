// Unit tests for lib/dom-extraction.js against small, hand-built JSDOM
// fragments (as opposed to tests/integration/dom-extraction.test.js, which
// exercises the extractors against a real fixture page). This file targets
// the specific fix-round-1 behaviors that need exact control over markup:
// rel-attribute token matching, aria-level precedence, the heading-outline
// cap, the links-list protocol gate, and image lazy-loading detection.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import extraction from '../../lib/dom-extraction.js';

const { extractHeadings, extractLinks, extractImages, relTokens, isNofollowFamily } = extraction;

function parseFragment(html, url) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: url || 'https://example.com/page' });
  return dom.window.document;
}

describe('SEOBWExtraction namespace additions (fix round 1)', () => {
  it('exports relTokens, isNofollowFamily, and the cap constants', () => {
    expect(typeof relTokens).toBe('function');
    expect(typeof isNofollowFamily).toBe('function');
    expect(extraction.OUTLINE_CAP).toBe(500);
    expect(extraction.LINKS_LIST_CAP).toBe(500);
    expect(extraction.IMAGES_LIST_CAP).toBe(500);
    expect(extraction.NOFOLLOW_ANCHORS_CAP).toBe(50);
  });
});

/* ---------- item 1: rel is token-matched, not substring-matched ---------- */

describe('relTokens / isNofollowFamily', () => {
  it('matches rel="NOFOLLOW" case-insensitively', () => {
    expect(isNofollowFamily('NOFOLLOW')).toBe(true);
  });

  it('does not match "me nofollowing" (no real nofollow token)', () => {
    expect(isNofollowFamily('me nofollowing')).toBe(false);
  });

  it('does not match "sponsoredX" (no real sponsored token)', () => {
    expect(isNofollowFamily('sponsoredX')).toBe(false);
  });

  it('matches all three when all three tokens are present', () => {
    const tokens = relTokens('nofollow ugc sponsored');
    expect(tokens.has('nofollow')).toBe(true);
    expect(tokens.has('ugc')).toBe(true);
    expect(tokens.has('sponsored')).toBe(true);
  });

  it('handles null/undefined/empty rel without throwing', () => {
    expect(isNofollowFamily(null)).toBe(false);
    expect(isNofollowFamily(undefined)).toBe(false);
    expect(isNofollowFamily('')).toBe(false);
  });
});

describe('extractLinks — nofollow/ugc/sponsored counting uses token matching', () => {
  it('counts rel="NOFOLLOW" (uppercase) as nofollow', () => {
    const doc = parseFragment('<a href="/a" rel="NOFOLLOW">a</a>');
    const links = extractLinks(doc, { hostname: 'example.com' });
    expect(links.nofollow).toBe(1);
  });

  it('does not count rel="me nofollowing" as nofollow', () => {
    const doc = parseFragment('<a href="/a" rel="me nofollowing">a</a>');
    const links = extractLinks(doc, { hostname: 'example.com' });
    expect(links.nofollow).toBe(0);
  });

  it('does not count rel="sponsoredX" as sponsored', () => {
    const doc = parseFragment('<a href="/a" rel="sponsoredX">a</a>');
    const links = extractLinks(doc, { hostname: 'example.com' });
    expect(links.sponsored).toBe(0);
  });

  it('counts all three when rel carries all three tokens on one link', () => {
    const doc = parseFragment('<a href="/a" rel="nofollow ugc sponsored">a</a>');
    const links = extractLinks(doc, { hostname: 'example.com' });
    expect(links.nofollow).toBe(1);
    expect(links.ugc).toBe(1);
    expect(links.sponsored).toBe(1);
    // One anchor, one nofollowAnchors entry — not three.
    expect(links.nofollowAnchors.length).toBe(1);
  });

  it('the highlight-selector token test (isNofollowFamily) agrees with the counted nofollowAnchors set', () => {
    const html = `
      <a href="/keep-1" rel="NOFOLLOW">one</a>
      <a href="/skip-1" rel="me nofollowing">two</a>
      <a href="/keep-2" rel="ugc">three</a>
      <a href="/skip-2" rel="sponsoredX">four</a>
      <a href="/keep-3" rel="nofollow ugc sponsored">five</a>
      <a href="/skip-3">six</a>
    `;
    const doc = parseFragment(html);
    const links = extractLinks(doc, { hostname: 'example.com' });
    const countedHrefs = new Set(links.nofollowAnchors.map(a => a.url).sort());

    // Mirrors exactly what src/content/analyzer.js's highlightElement()
    // does for the 'nofollow' case: select every a[rel] and keep the ones
    // isNofollowFamily() (the same exported function) accepts.
    const highlighted = Array.from(doc.querySelectorAll('a[rel]'))
      .filter(el => isNofollowFamily(el.getAttribute('rel')))
      .map(el => el.href)
      .sort();

    expect(highlighted).toEqual(Array.from(countedHrefs).sort());
    expect(highlighted.length).toBe(3);
  });
});

/* ---------- item 5: aria-level wins over the tag name ---------- */

describe('extractHeadings — outline aria-level precedence (item 5)', () => {
  it('an aria-level on a real heading tag overrides the tag-implied level', () => {
    const doc = parseFragment('<h2 role="heading" aria-level="3">Title</h2>');
    const outline = extractHeadings(doc).outline;
    expect(outline).toEqual([{ level: 3, text: 'Title', order: 1 }]);
  });

  it('falls back to the tag name when aria-level is present but unparseable', () => {
    const doc = parseFragment('<h2 role="heading" aria-level="not-a-number">Title</h2>');
    const outline = extractHeadings(doc).outline;
    expect(outline[0].level).toBe(2);
  });

  it('a plain hN with no aria-level uses the tag-implied level', () => {
    const doc = parseFragment('<h4>Title</h4>');
    const outline = extractHeadings(doc).outline;
    expect(outline[0].level).toBe(4);
  });

  it('role=heading with an empty aria-level defaults to level 2', () => {
    const doc = parseFragment('<div role="heading" aria-level="">Title</div>');
    const outline = extractHeadings(doc).outline;
    expect(outline[0].level).toBe(2);
  });

  it('role=heading with no aria-level attribute at all is skipped entirely', () => {
    const doc = parseFragment('<div role="heading">Title</div>');
    const outline = extractHeadings(doc).outline;
    expect(outline.length).toBe(0);
  });

  it('clamps an out-of-range aria-level into 1-6', () => {
    const doc = parseFragment('<div role="heading" aria-level="99">Title</div>');
    const outline = extractHeadings(doc).outline;
    expect(outline[0].level).toBe(6);
  });
});

describe('extractHeadings — outline cap (item 3)', () => {
  it('caps the outline at OUTLINE_CAP (500) entries', () => {
    const html = Array.from({ length: 520 }, (_, i) => `<h2>Heading ${i}</h2>`).join('');
    const doc = parseFragment(html);
    const outline = extractHeadings(doc).outline;
    expect(outline.length).toBe(500);
    expect(outline[0].text).toBe('Heading 0');
    expect(outline[499].text).toBe('Heading 499');
  });
});

/* ---------- item 9: links.list requires ^https?: ---------- */

describe('extractLinks — list requires an http(s) scheme (item 9)', () => {
  it('excludes an ftp:// link to the same host from list', () => {
    const doc = parseFragment('<a href="ftp://example.com/file">file</a>', 'https://example.com/page');
    const links = extractLinks(doc, { hostname: 'example.com' });
    expect(links.list.length).toBe(0);
  });

  it('still includes a normal https same-host link in list', () => {
    const doc = parseFragment('<a href="https://example.com/about">about</a>', 'https://example.com/page');
    const links = extractLinks(doc, { hostname: 'example.com' });
    expect(links.list.length).toBe(1);
    expect(links.list[0].type).toBe('internal');
  });

  it('excludes a mailto: link from list', () => {
    const doc = parseFragment('<a href="mailto:hi@example.com">mail</a>', 'https://example.com/page');
    const links = extractLinks(doc, { hostname: 'example.com' });
    expect(links.list.length).toBe(0);
  });
});

/* ---------- item 10: images list field semantics ---------- */

describe('extractImages — lazy/data-src semantics (item 10)', () => {
  it('marks loading="lazy" as lazy', () => {
    const doc = parseFragment('<img src="/a.jpg" loading="lazy">');
    const list = extractImages(doc).list;
    expect(list[0].lazy).toBe(true);
  });

  it('marks a data-src image with no src attribute as lazy, using data-src as Src', () => {
    const doc = parseFragment('<img data-src="/lazy.jpg" alt="a">');
    const list = extractImages(doc).list;
    expect(list[0].lazy).toBe(true);
    expect(list[0].src).toBe('/lazy.jpg');
  });

  it('does not mark an image with both src and data-src as lazy from data-src alone', () => {
    const doc = parseFragment('<img src="/eager.jpg" data-src="/lazy.jpg">');
    const list = extractImages(doc).list;
    expect(list[0].lazy).toBe(false);
  });

  it('a srcset-only image (no src) exports an empty Src', () => {
    const doc = parseFragment('<img srcset="/a-1x.jpg 1x, /a-2x.jpg 2x">');
    const list = extractImages(doc).list;
    expect(list[0].src).toBe('');
  });

  it('width/height are the raw attribute strings, unmodified', () => {
    const doc = parseFragment('<img src="/a.jpg" width="300" height="150">');
    const list = extractImages(doc).list;
    expect(list[0].width).toBe('300');
    expect(list[0].height).toBe('150');
  });
});
