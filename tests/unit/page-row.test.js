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
