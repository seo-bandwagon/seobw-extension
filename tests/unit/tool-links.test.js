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
// Fix round 1, item 2: every kind now builds off `new URL(pageUrl).href`
// (credential-cleared, and — as an unavoidable side effect — normalized:
// a raw space in the query is percent-encoded to %20 by the URL
// constructor itself, same as any real chrome.tabs URL already arrives
// pre-encoded). Expectations below encode PAGE_HREF, not the raw PAGE
// string, to match what the URL constructor actually normalizes it to.
const PAGE_HREF = new URL(PAGE).href;

describe('toolUrl — gsc', () => {
  it('builds a Search Console inspect URL with an encoded resource_id and id', () => {
    const url = SBWToolLinks.toolUrl('gsc', { pageUrl: PAGE });
    expect(url).toBe(
      'https://search.google.com/search-console/inspect?resource_id=' +
      encodeURIComponent('https://example.com/') +
      '&id=' + encodeURIComponent(PAGE_HREF)
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
    expect(url).toBe('https://web.archive.org/web/*/' + encodeURIComponent(PAGE_HREF));
  });
});

describe('toolUrl — pagespeed', () => {
  it('builds a PageSpeed Insights URL with the page URL encoded', () => {
    const url = SBWToolLinks.toolUrl('pagespeed', { pageUrl: PAGE });
    expect(url).toBe('https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(PAGE_HREF));
  });
});

describe('toolUrl — rich-results', () => {
  it('builds a Rich Results Test URL with the page URL encoded', () => {
    const url = SBWToolLinks.toolUrl('rich-results', { pageUrl: PAGE });
    expect(url).toBe('https://search.google.com/test/rich-results?url=' + encodeURIComponent(PAGE_HREF));
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

  it('encodes special characters in the selection (ampersands)', () => {
    const url = SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: 'best & bye' });
    expect(url).toBe('https://www.google.com/search?q=%22' + encodeURIComponent('best & bye') + '%22');
  });

  it('returns null for an empty or whitespace-only selection', () => {
    expect(SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: '' })).toBeNull();
    expect(SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: '   ' })).toBeNull();
    expect(SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE })).toBeNull();
  });

  // Fix round 1, item 13: a literal `"` inside the selection would
  // otherwise close the wrapping quotes early — it's replaced with a space
  // (then trimmed) before the selection is quoted and encoded.
  it('replaces literal quote marks in the selection with a space', () => {
    const url = SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: 'he said "hi"' });
    expect(url).toBe('https://www.google.com/search?q=%22' + encodeURIComponent('he said  hi') + '%22');
  });

  it('trims a quote-turned-space at the edge of the selection', () => {
    const url = SBWToolLinks.toolUrl('quoted-search', { pageUrl: PAGE, selection: '"leading and trailing"' });
    expect(url).toBe('https://www.google.com/search?q=%22' + encodeURIComponent('leading and trailing') + '%22');
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

// Fix round 1, item 2: a pageUrl carrying embedded HTTP Basic Auth
// credentials must never reach any produced URL — the raw opts.pageUrl
// string is never used; every kind builds off a cleared-credential
// `URL.href`.
describe('toolUrl — strips embedded credentials from pageUrl (item 2)', () => {
  const CRED_PAGE = 'http://user:pw@host.example/path';

  it('never leaks the username or password into the gsc URL', () => {
    const url = SBWToolLinks.toolUrl('gsc', { pageUrl: CRED_PAGE });
    expect(url).not.toContain('user');
    expect(url).not.toContain('pw');
    expect(url).toContain(encodeURIComponent('http://host.example/path'));
  });

  it('never leaks credentials into the wayback URL', () => {
    const url = SBWToolLinks.toolUrl('wayback', { pageUrl: CRED_PAGE });
    expect(url).not.toContain('user');
    expect(url).not.toContain('pw');
  });

  it('never leaks credentials into the pagespeed URL', () => {
    const url = SBWToolLinks.toolUrl('pagespeed', { pageUrl: CRED_PAGE });
    expect(url).not.toContain('user');
    expect(url).not.toContain('pw');
  });

  it('never leaks credentials into the rich-results URL', () => {
    const url = SBWToolLinks.toolUrl('rich-results', { pageUrl: CRED_PAGE });
    expect(url).not.toContain('user');
    expect(url).not.toContain('pw');
  });

  it('never leaks credentials into the origin-rooted sitemap/robots URLs', () => {
    expect(SBWToolLinks.toolUrl('sitemap', { pageUrl: CRED_PAGE })).toBe('http://host.example/sitemap.xml');
    expect(SBWToolLinks.toolUrl('robots', { pageUrl: CRED_PAGE })).toBe('http://host.example/robots.txt');
  });

  it('normalizes an uppercase scheme and host', () => {
    const url = SBWToolLinks.toolUrl('sitemap', { pageUrl: 'HTTP://EXAMPLE.COM/path' });
    expect(url).toBe('http://example.com/sitemap.xml');
  });
});
