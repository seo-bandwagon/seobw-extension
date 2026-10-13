// Chrome Web Store listing copy — keyword-spam rules (violation "Yellow
// Argon", 2026-09-24). The 1.6.0 draft was removed because the detailed
// description named fifteen structured-data types in one sentence. Google's
// spam FAQ (developer.chrome.com/docs/webstore/spam-faq, read 2026-10-13):
// keywords relevant and in context; more than five of one keyword "may result
// in increased scrutiny" but is allowed when appropriate; the primary-purpose
// word not more than five times (their example: "puzzle" for a puzzle
// extension); no list of more than five sites or brands. Until 2026-10-13
// this test capped EVERY word at five, which only a ~2,500-character
// description can meet; the field allows 16,000. Now: search and purpose
// keywords at most five, any other word only guarded against stuffing.
// This test reads the paste-ready block from the listing doc and the
// manifest's short description.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const listing = readFileSync(path.join(REPO, 'docs/CWS-LISTING.md'), 'utf8');
const detailed = listing.split('## 2. Detailed description')[1].split('```')[1];
const short = JSON.parse(readFileSync(path.join(REPO, 'extension/manifest.json'), 'utf8')).description;

// Function words and the product's own name are not keywords.
const STOP = new Set(('the a an of and to in on for it its is you your with as or at by that this ' +
  'each any can be are from what when how no not all one if into without until they them where ' +
  'seo bandwagon').split(' '));

// Words someone would type into the store's search to find a tool like this,
// and the purpose word. Each at most five times, per Google's FAQ.
const SEARCH_KEYWORDS = ['seo', 'google', 'search', 'rank', 'ranking', 'keyword', 'audit', 'checker',
  'optimization', 'serp', 'backlink', 'chrome', 'extension', 'tool'];
const MAX_KEYWORD = 5;
// Ordinary words ("page", "link", "result") recur in any long, plain
// description; this only catches stuffing.
const MAX_OTHER_WORD = 25;
const MAX_DESCRIPTION_CHARS = 16000;

function searchKeywordCounts(text) {
  const counts = new Map();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) || []) {
    const w = raw.replace(/s$/, '');
    if (SEARCH_KEYWORDS.includes(w)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  return counts;
}

// Singular and plural count as one keyword ("link" / "links").
function keywordCounts(text) {
  const counts = new Map();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) || []) {
    if (STOP.has(raw) || raw.length < 3) continue;
    const w = raw.replace(/s$/, '');
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return counts;
}

// A run of five or more short comma-separated items reads as a keyword list.
function longestList(text) {
  let longest = 0;
  for (const sentence of text.split(/[.;:\n()]+/)) {
    const items = sentence.split(/,|\bor\b|\band\b/).map((s) => s.trim()).filter(Boolean);
    const short = items.filter((s) => s.split(/\s+/).length <= 3);
    if (items.length >= 5 && short.length === items.length) longest = Math.max(longest, items.length);
  }
  return longest;
}

describe('store listing copy', () => {
  it('found the detailed description block', () => {
    expect(detailed.length).toBeGreaterThan(500);
  });

  it("detailed description: within the store's 16,000 characters", () => {
    expect(detailed.trim().length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });

  for (const [name, text] of [['detailed description', detailed], ['short description', short]]) {
    it(`${name}: no search or purpose keyword more than five times`, () => {
      const over = [...searchKeywordCounts(text)].filter(([, n]) => n > MAX_KEYWORD);
      expect(over).toEqual([]);
    });

    it(`${name}: no other word repeated to the point of stuffing`, () => {
      const over = [...keywordCounts(text)].filter(([, n]) => n > MAX_OTHER_WORD);
      expect(over).toEqual([]);
    });

    it(`${name}: no list of five or more bare terms`, () => {
      expect(longestList(text)).toBeLessThan(5);
    });
  }

  it('the listing doc carries the manifest short description, word for word', () => {
    const doc = listing.split('## 1. Short description')[1].split('```')[1].trim();
    expect(doc).toBe(short);
  });

  // The popup lists issue labels such as "Missing H1" with no fix text
  // (lib/content-analysis.js, calculateSEOScore). The store said "a score with
  // fixes" and "a short list of fixes" until 1.7.3; name fixes again only when
  // a build that shows them ships.
  for (const [name, text] of [['detailed description', detailed], ['short description', short]]) {
    it(`${name}: names issues, not fixes`, () => {
      expect(text).not.toMatch(/\bfix(es)?\b/i);
    });
  }

  it('the list detector catches the text that was removed', () => {
    const removed = 'checks each item against the fields for its type (Article, Product, LocalBusiness, Organization, Person, BreadcrumbList, FAQPage, HowTo, Recipe, Event, VideoObject, Review, WebSite, WebPage, JobPosting), showing eligibility.';
    expect(longestList(removed)).toBeGreaterThanOrEqual(5);
  });

  it('the keyword counters catch unnatural repetition', () => {
    expect([...searchKeywordCounts('SEO tool, SEO checker, SEO audit, free SEO, best SEO, SEO extension')]
      .some(([, n]) => n > MAX_KEYWORD)).toBe(true);
    expect([...keywordCounts('page '.repeat(MAX_OTHER_WORD + 1))].some(([, n]) => n > MAX_OTHER_WORD)).toBe(true);
  });
});
