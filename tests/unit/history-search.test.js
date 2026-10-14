// History search: words, separators, titles and hosts (#62).
import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/history-search.js');
const { matches, filter } = globalThis.SBWHistorySearch;

const LOCAL = { url: 'https://seobandwagon.com/local-seo', meta: { title: { text: 'Local SEO services for small businesses' } } };
const HOME = { url: 'https://www.example.org/', content: { title: 'Example Domain' } };

describe('history search', () => {
  it('"local seo" finds /local-seo (#62)', () => {
    expect(matches(LOCAL, 'local seo')).toBe(true);
    expect(matches(LOCAL, 'Local-SEO')).toBe(true);
  });

  it('matches the page title and the host', () => {
    expect(matches(LOCAL, 'small businesses')).toBe(true);
    expect(matches(HOME, 'example domain')).toBe(true);
    expect(matches(HOME, 'example.org')).toBe(true);
  });

  it('needs every word', () => {
    expect(matches(LOCAL, 'local pizza')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(filter([LOCAL, HOME], '  ')).toHaveLength(2);
    expect(filter([LOCAL, HOME], 'seobandwagon')).toEqual([LOCAL]);
  });
});
