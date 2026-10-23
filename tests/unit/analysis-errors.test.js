// What the popup and the panel say when a tab can't be analyzed (#89, #63).
import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/analysis-errors.js');
const { nonHtmlKind, describe: say, unreadablePage } = globalThis.SBWAnalysisErrors;

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

// #129: pages Chrome never lets an extension script, told apart by address
// before the popup tries, so it neither injects nor logs an error there.
describe('unreadablePage', () => {
  it('lets web pages through, and a tab with no address', () => {
    expect(unreadablePage('https://example.com/')).toBeNull();
    expect(unreadablePage('http://localhost:3000/a')).toBeNull();
    expect(unreadablePage('https://chrome.google.com/search')).toBeNull();
    expect(unreadablePage(undefined)).toBeNull();
    expect(unreadablePage('')).toBeNull();
  });

  it("names Chrome's own pages, the new tab and other extensions' pages", () => {
    for (const url of [
      'chrome://settings/',
      'chrome://newtab/',
      'chrome-extension://dphmaddiedhkejfhabkfdenfphjljioj/src/newtab/newtab.html',
      'about:blank',
      'view-source:https://example.com/',
      'edge://settings/'
    ]) {
      expect(unreadablePage(url)?.title, url).toBe("CHROME DOESN'T ALLOW THIS PAGE");
    }
  });

  it('names the Chrome Web Store, old address and new', () => {
    expect(unreadablePage('https://chromewebstore.google.com/detail/x/abc')?.title).toBe('CHROME WEB STORE PAGE');
    expect(unreadablePage('https://chrome.google.com/webstore/detail/x/abc')?.title).toBe('CHROME WEB STORE PAGE');
  });

  it('asks for file access only while it is off', () => {
    expect(unreadablePage('file:///Users/k/page.html')?.body).toMatch(/Allow access to file URLs/);
    expect(unreadablePage('file:///Users/k/page.html', { fileAccess: true })).toBeNull();
  });
});
