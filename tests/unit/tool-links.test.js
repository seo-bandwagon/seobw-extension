// Unit tests for the pure "SEO Bandwagon tools" URL builder
// (src/lib/tool-links.js) — used by both the context-menu handler
// (src/background/service-worker.js) and the popup's TOOLS row
// (src/popup/tools.js).
//
// Every URL must come from `new URL(pageUrl)` (never a string-split of the
// origin) and every user-controlled part must be percent-encoded. A
// non-http(s) pageUrl (chrome://, file://, an unparseable string) must
// return null for every kind, not a malformed URL — the menu item does
// nothing rather than open something broken or unsafe.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWToolLinks` rather than an ESM default export.
await import('../../src/lib/tool-links.js');
const SBWToolLinks = globalThis.SBWToolLinks;

describe('SBWToolLinks namespace', () => {
  it('attaches to globalThis.SBWToolLinks', () => {
    expect(SBWToolLinks).toBeTruthy();
    expect(typeof SBWToolLinks.toolUrl).toBe('function');
  });
});

const PAGE = 'https://example.com/some/page?x=1&y=two words';

describe('toolUrl — gsc', () => {
  it('builds a Search Console inspect URL with an encoded resource_id and id', () => {
    const url = SBWToolLinks.toolUrl('gsc', { pageUrl: PAGE });
    expect(url).toBe(
      'https://search.google.com/search-console/inspect?resource_id=' +
      encodeURIComponent('https://example.com/') +
      '&id=' + encodeURIComponent(PAGE)
    );
  });

  it('derives the origin via URL parsing, not string-splitting', () => {
    const url = SBWToolLinks.toolUrl('gsc', { pageUrl: 'https://sub.example.co.uk:8080/a/b' });
    expect(url).toContain(encodeURIComponent('https://sub.example.co.uk:8080/'));
  });
});

describe('toolUrl — wayback', () => {
  it('builds a Wayback Machine calendar URL with the page URL encoded', () => {
    const url = SBWToolLinks.toolUrl('wayback', { pageUrl: PAGE });
    expect(url).toBe('https://web.archive.org/web/*/' + encodeURIComponent(PAGE));
  });
});

describe('toolUrl — pagespeed', () => {
  it('builds a PageSpeed Insights URL with the page URL encoded', () => {
    const url = SBWToolLinks.toolUrl('pagespeed', { pageUrl: PAGE });
    expect(url).toBe('https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(PAGE));
  });
});

describe('toolUrl — rich-results', () => {
  it('builds a Rich Results Test URL with the page URL encoded', () => {
    const url = SBWToolLinks.toolUrl('rich-results', { pageUrl: PAGE });
    expect(url).toBe('https://search.google.com/test/rich-results?url=' + encodeURIComponent(PAGE));
  });
});

describe('toolUrl — site-search', () => {
  it('builds a site: search from the hostname only, not the full URL', () => {
    const url = SBWToolLinks.toolUrl('site-search', { pageUrl: PAGE });
    expect(url).toBe('https://www.google.com/search?q=site:' + encodeURIComponent('example.com'));
  });

  it('never leaks the path or query string into the search', () => {
    const url = SBWToolLinks.toolUrl('site-search', { pageUrl: PAGE });
    expect(url).not.toContain('some');
    expect(url).not.toContain('x=1');
  });
});

describe('toolUrl — sitemap / robots', () => {
  it('builds an origin-rooted sitemap.xml URL', () => {
    const url = SBWToolLinks.toolUrl('sitemap', { pageUrl: PAGE });
    expect(url).toBe('https://example.com/sitemap.xml');
  });

  it('builds an origin-rooted robots.txt URL', () => {
    const url = SBWToolLinks.toolUrl('robots', { pageUrl: PAGE });
    expect(url).toBe('https://example.com/robots.txt');
  });

  it('drops any path from the current page — always origin-rooted', () => {
    const url = SBWToolLinks.toolUrl('sitemap', { pageUrl: 'https://example.com/deep/nested/path?x=1' });
    expect(url).toBe('https://example.com/sitemap.xml');
  });
});

describe('toolUrl — quoted-search (selection)', () => {
  it('wraps the encoded selection in literal quote marks', () => {
    const url = SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: 'best plumber austin' });
    expect(url).toBe('https://www.google.com/search?q=%22' + encodeURIComponent('best plumber austin') + '%22');
  });

  it('caps the selection at 200 characters BEFORE encoding', () => {
    const long = 'x'.repeat(500);
    const url = SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: long });
    const expected = 'https://www.google.com/search?q=%22' + encodeURIComponent('x'.repeat(200)) + '%22';
    expect(url).toBe(expected);
  });

  it('encodes special characters in the selection (quotes, ampersands)', () => {
    const url = SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: 'say "hi" & bye' });
    expect(url).toBe('https://www.google.com/search?q=%22' + encodeURIComponent('say "hi" & bye') + '%22');
  });

  it('returns null for an empty or whitespace-only selection', () => {
    expect(SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: '' })).toBeNull();
    expect(SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: '   ' })).toBeNull();
    expect(SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE })).toBeNull();
  });
});

describe('toolUrl — rejects non-http(s) pageUrl', () => {
  it('returns null for a chrome:// page', () => {
    expect(SBWToolLinks.toolUrl('gsc', { pageUrl: 'chrome://extensions/' })).toBeNull();
  });

  it('returns null for a file:// page', () => {
    expect(SBWToolLinks.toolUrl('sitemap', { pageUrl: 'file:///Users/dana/report.html' })).toBeNull();
  });

  it('returns null for an unparseable pageUrl', () => {
    expect(SBWToolLinks.toolUrl('wayback', { pageUrl: 'not a url' })).toBeNull();
  });

  it('returns null for a missing pageUrl', () => {
    expect(SBWToolLinks.toolUrl('robots', {})).toBeNull();
    expect(SBWToolLinks.toolUrl('robots')).toBeNull();
  });

  it('rejects non-http(s) pageUrl even for the selection-based kind', () => {
    expect(SBWToolLinks.toolUrl('quoted-search', { pageUrl: 'chrome://extensions/', selection: 'hello' })).toBeNull();
  });
});

describe('toolUrl — unknown kind', () => {
  it('returns null for an unrecognized kind', () => {
    expect(SBWToolLinks.toolUrl('not-a-real-kind', { pageUrl: PAGE })).toBeNull();
  });
});
