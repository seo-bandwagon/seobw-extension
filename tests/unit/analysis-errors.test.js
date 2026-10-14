// What the popup and the panel say when a tab can't be analyzed (#89, #63).
import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/analysis-errors.js');
const { nonHtmlKind, describe: say } = globalThis.SBWAnalysisErrors;

describe('nonHtmlKind', () => {
  it('lets HTML through', () => {
    expect(nonHtmlKind('text/html')).toBeNull();
    expect(nonHtmlKind('application/xhtml+xml')).toBeNull();
    expect(nonHtmlKind('')).toBeNull();
  });

  it('names PDFs, SVGs, images, sitemaps and feeds, JSON and text', () => {
    expect(nonHtmlKind('application/pdf')).toBe('a PDF');
    expect(nonHtmlKind('image/svg+xml')).toBe('an SVG image');
    expect(nonHtmlKind('image/png')).toBe('an image');
    expect(nonHtmlKind('application/xml')).toMatch(/sitemap/);
    expect(nonHtmlKind('text/xml')).toMatch(/sitemap/);
    expect(nonHtmlKind('application/rss+xml')).toMatch(/feed/);
    expect(nonHtmlKind('application/json')).toBe('a JSON file');
    expect(nonHtmlKind('text/plain')).toBe('a plain text file');
  });
});

describe('describe', () => {
  it('is null for a real analysis', () => {
    expect(say({ url: 'https://example.com/', seoScore: {} })).toBeNull();
    expect(say(null)).toBeNull();
  });

  it('says what a non-HTML tab is', () => {
    expect(say({ error: 'not-html', kind: 'a PDF' })).toEqual({
      title: 'NOT A WEB PAGE',
      body: 'This tab shows a PDF. The on-page analysis covers web pages; the tools above still open for this address.'
    });
  });

  it('asks for a reload when the analysis threw', () => {
    expect(say({ error: 'analysis-failed', message: 'x' }).title).toBe("COULDN'T FINISH THE ANALYSIS");
  });
});
