// The words and links that read the browser from src/lib/browser.js (1.13.6),
// with the Chrome values (the source, as the Chrome build ships) and the Edge
// values (scripts/targets/edge.mjs, as the Edge build ships).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import edge from '../../scripts/targets/edge.mjs';

await import('../../extension/src/lib/analysis-errors.js');
await import('../../extension/src/lib/link-check.js');
await import('../../extension/src/lib/fullpage-capture.js');
await import('../../extension/src/lib/fullpage-runs.js');
await import('../../extension/src/lib/review-prompt.js');
await import('../../extension/src/lib/theme-mode.js');
await import('../../extension/src/lib/aio-study.js');

const CHROME = globalThis.SBWBrowser;
const EDGE = CHROME.withValues(edge.browser);
const asEdge = () => { globalThis.SBWBrowser = EDGE; };
afterEach(() => { globalThis.SBWBrowser = CHROME; });

describe('a page no extension may read (analysis-errors)', () => {
  const page = (u, o) => globalThis.SBWAnalysisErrors.unreadablePage(u, o);

  it('Chrome: the Chrome Web Store and Chrome\'s own pages, as before', () => {
    expect(page('https://chromewebstore.google.com/detail/x/abc')).toEqual({
      title: 'CHROME WEB STORE PAGE',
      body: "Chrome doesn't let any extension read Chrome Web Store pages. Open another page and click the icon again."
    });
    expect(page('chrome://settings').title).toBe("CHROME DOESN'T ALLOW THIS PAGE");
    expect(page('file:///x.html').body).toContain("on Chrome's Extensions page");
  });

  it('Edge: Microsoft Edge Add-ons and Microsoft Edge\'s own pages; the Chrome Web Store is a web page', () => {
    asEdge();
    expect(page('https://microsoftedge.microsoft.com/addons/detail/x/abc')).toEqual({
      title: 'MICROSOFT EDGE ADD-ONS PAGE',
      body: "Microsoft Edge doesn't let any extension read Microsoft Edge Add-ons pages. Open another page and click the icon again."
    });
    expect(page('https://chromewebstore.google.com/detail/x/abc')).toBeNull();
    expect(page('edge://settings')).toEqual({
      title: "MICROSOFT EDGE DOESN'T ALLOW THIS PAGE",
      body: "Microsoft Edge doesn't let extensions read its own pages, other extensions' pages or the new tab. Open a web page and click the icon again."
    });
    expect(page('file:///x.html').body).toContain("on Microsoft Edge's Extensions page");
  });
});

describe('links no extension may open (link-check)', () => {
  it('Chrome: the Chrome Web Store\'s two hosts', () => {
    expect(globalThis.SBWLinkCheck.isUncheckable('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(globalThis.SBWLinkCheck.isUncheckable('https://chrome.google.com/webstore/detail/x')).toBe(true);
    expect(globalThis.SBWLinkCheck.isUncheckable('https://microsoftedge.microsoft.com/addons/detail/x')).toBe(false);
  });

  it('Edge: Microsoft Edge Add-ons', () => {
    asEdge();
    expect(globalThis.SBWLinkCheck.isUncheckable('https://microsoftedge.microsoft.com/addons/detail/x')).toBe(true);
    expect(globalThis.SBWLinkCheck.isUncheckable('https://chromewebstore.google.com/detail/x')).toBe(false);
  });
});

describe('a capture the browser stopped (fullpage-capture, fullpage-runs)', () => {
  it('names the build\'s browser', () => {
    expect(globalThis.SBWFullPageRuns.INTERRUPTED).toBe('The capture stopped when Chrome paused the extension. Try again.');
    asEdge();
    expect(globalThis.SBWFullPageRuns.INTERRUPTED).toBe('The capture stopped when Microsoft Edge paused the extension. Try again.');
  });
});

describe('the review prompt and "Rate us" (review-prompt)', () => {
  it('Chrome: the Chrome Web Store listing\'s reviews', () => {
    expect(globalThis.SBWReview.REVIEW_URL).toBe('https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj/reviews');
  });

  it('Edge: none until the listing exists, so the prompt stays off', () => {
    asEdge();
    expect(globalThis.SBWReview.REVIEW_URL).toBeNull();
  });
});

describe('the Neon theme links (theme-mode)', () => {
  it('Chrome: the themes\' Chrome Web Store listings', () => {
    expect(globalThis.SBWTheme.listingUrl('dark')).toMatch(/^https:\/\/chromewebstore\.google\.com\/detail\/[a-p]{32}$/);
  });

  it('Edge: none, so no theme link or prompt shows', () => {
    asEdge();
    expect(globalThis.SBWTheme.listingUrl('dark')).toBeNull();
    expect(globalThis.SBWTheme.listingUrl('light')).toBeNull();
  });
});

describe('the study\'s private-window switch (aio-study)', () => {
  const words = () => globalThis.SBWAioStudy.message('incognito_off');

  it('Chrome: Allow in Incognito, as before', () => {
    expect(words()).toBe("SEO Bandwagon isn't allowed in private windows, and the study only searches in one. On the extension's Details page, switch on Allow in Incognito, then click the term again.");
  });

  it('Edge: Allow in InPrivate', () => {
    asEdge();
    expect(words()).toContain('switch on Allow in InPrivate, then click the term again.');
  });

  it('a content script, which doesn\'t load browser.js, names no switch', () => {
    globalThis.SBWBrowser = undefined;
    expect(words()).toContain('switch on the setting for private windows, then click the term again.');
  });
});
