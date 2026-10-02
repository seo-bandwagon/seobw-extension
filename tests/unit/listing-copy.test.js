// Chrome Web Store listing copy — keyword-spam rules (violation "Yellow
// Argon", 2026-09-24). The 1.6.0 draft was removed because the detailed
// description named fifteen structured-data types in one sentence. Google's
// spam FAQ: no lists of keywords without added value, and no single keyword
// more than five times. This test reads the paste-ready block from the
// listing doc and the manifest's short description.
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

  for (const [name, text] of [['detailed description', detailed], ['short description', short]]) {
    it(`${name}: no keyword more than five times`, () => {
      const over = [...keywordCounts(text)].filter(([, n]) => n > 5);
      expect(over).toEqual([]);
    });

    it(`${name}: no list of five or more bare terms`, () => {
      expect(longestList(text)).toBeLessThan(5);
    });
  }

  it('the list detector catches the text that was removed', () => {
    const removed = 'checks each item against the fields for its type (Article, Product, LocalBusiness, Organization, Person, BreadcrumbList, FAQPage, HowTo, Recipe, Event, VideoObject, Review, WebSite, WebPage, JobPosting), showing eligibility.';
    expect(longestList(removed)).toBeGreaterThanOrEqual(5);
  });

  it('the keyword counter catches unnatural repetition', () => {
    expect([...keywordCounts('page page pages page page page')].some(([, n]) => n > 5)).toBe(true);
  });
});
