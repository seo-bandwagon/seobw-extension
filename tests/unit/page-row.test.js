// One Google result's page checks from its HTML (1.12.0, src/lib/page-row.js):
// the popup's own analyzer on a parsed Document, plus what only the fetch
// knows. The saved pages are in tests/fixtures/pages.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const PAGES = resolve(__dirname, '../fixtures/pages');
const html = (f) => readFileSync(resolve(PAGES, f), 'utf8');
const GUIDE = 'https://www.greenplot.example/guides/start-a-garden/';

let P;
beforeAll(async () => {
  globalThis.SEOBWAnalysis = (await import('../../extension/lib/content-analysis.js')).default;
  globalThis.SEOBWExtraction = (await import('../../extension/lib/dom-extraction.js')).default;
  await import('../../extension/src/lib/structured-data.js');
  await import('../../extension/src/lib/hreflang.js');
  await import('../../extension/src/lib/serp-preview.js');
  P = (await import('../../extension/src/lib/page-row.js')).default;
});

function rowOf(file, url, fetchInfo, site) {
  const dom = new JSDOM('', { url });
  globalThis.DOMParser = dom.window.DOMParser;
  const doc = P.parse(html(file), url);
  return P.fromDocument(doc, Object.assign({ url, finalUrl: url, status: 200, redirected: false, headers: {} }, fetchInfo), site);
}

describe('the page row', () => {
  it('reads an English guide: title and description in px, H1, words, schema, canonical, checklist', () => {
    const r = rowOf('good-en.html', GUIDE);
    expect(r.title.chars).toBeGreaterThan(10);
    expect(typeof r.title.px).toBe('number');
    expect(r.h1.count).toBe(1);
    expect(r.words).toBeGreaterThan(300);
    expect(r.indexable).toEqual({ ok: true, reasons: [] });
    expect(r.checklist.score).toBeGreaterThan(80);
    expect(r.source).toBe('html');
  });

  it('a noindex page is not indexable, and says why', () => {
    const r = rowOf('noindex.html', GUIDE);
    expect(r.indexable.ok).toBe(false);
    expect(r.indexable.reasons.join(' ')).toMatch(/noindex in the (robots|googlebot) meta/);
  });

  it('Microdata and RDFa types count as schema', () => {
    expect(rowOf('microdata.html', GUIDE).schema.length).toBeGreaterThan(0);
    expect(rowOf('rdfa.html', GUIDE).schema.length).toBeGreaterThan(0);
  });

  it('counts the words of a Japanese page', () => {
    expect(rowOf('non-english-ja.html', GUIDE).words).toBeGreaterThan(600);
  });

  it('the fetch\'s own facts: status, redirect and the X-Robots-Tag header', () => {
    const r = rowOf('good-en.html', GUIDE, { status: 404, redirected: true, headers: { 'x-robots-tag': 'googlebot: noindex' } });
    expect(r.status).toBe(404);
    expect(r.redirected).toBe(true);
    expect(r.indexable.reasons).toEqual(expect.arrayContaining(['status 404', 'noindex in the X-Robots-Tag header']));
  });

  it('another crawler\'s X-Robots-Tag is not Google\'s', () => {
    expect(P.noindexHeader({ 'x-robots-tag': 'otherbot: noindex' })).toBe(false);
    expect(P.noindexHeader({ 'x-robots-tag': 'noindex, nofollow' })).toBe(true);
    expect(P.noindexHeader({ 'x-robots-tag': 'otherbot: noindex, googlebot: none' })).toBe(true);
  });

  it('carries the site\'s robots.txt and llms.txt facts', () => {
    const site = { robots: { found: true, status: 200, blocked: ['GPTBot'], allowed: [] }, llms: { found: true } };
    const r = rowOf('good-en.html', GUIDE, {}, site);
    expect(r.robots.blocked).toEqual(['GPTBot']);
    expect(r.llms.found).toBe(true);
  });
});

describe('1.12.0 review fixes', () => {
  function rowFromHtml(htmlText, url, fetchInfo) {
    const dom = new JSDOM('', { url: 'chrome-extension://abc/src/offscreen/offscreen.html' });
    globalThis.DOMParser = dom.window.DOMParser;
    return P.fromDocument(P.parse(htmlText, url), Object.assign({ url, finalUrl: url, status: 200, headers: {} }, fetchInfo));
  }

  it('a page\'s own relative <base href="/"> resolves against the page, not the parser', () => {
    const r = rowFromHtml('<html><head><base href="/"><title>T</title><link rel="canonical" href="guides/a"></head><body><h1>A</h1></body></html>', 'https://site.example/guides/a');
    expect(r.canonical.href).toBe('https://site.example/guides/a');
    expect(r.canonical.target).toBe('self');
    expect(r.indexable.ok).toBe(true);
  });

  it('a Google link\'s srsltid= or utm_ tags don\'t make the canonical "elsewhere"', () => {
    const r = rowFromHtml('<html><head><title>T</title><link rel="canonical" href="https://site.example/p"></head><body></body></html>', 'https://site.example/p?srsltid=AfmBOo123&utm_source=x');
    expect(r.canonical.target).toBe('self');
    expect(r.indexable.ok).toBe(true);
  });

  it.each([
    ['max-image-preview:large, noindex', true],
    ['max-snippet:-1, noindex', true],
    ['googlebot: max-snippet:20, noindex', true],
    ['otherbot: noindex', false],
    ['otherbot: noindex, googlebot: all', false],
    ['unavailable_after: 2026-12-01, nofollow', false]
  ])('X-Robots-Tag %j is a noindex for Google: %s', (header, expected) => {
    expect(P.noindexHeader({ 'x-robots-tag': header })).toBe(expected);
  });
});
