// CHROMEWEBSTORE.md → "To paste with the combined submission (1.13.0)": the
// dashboard texts of the one upload that carries 1.10.3 to 1.13.0 (owner,
// 2026-11-02: submissions B and C become one). Each must fit its field, and
// the justification, the single purpose and the description paragraphs must
// be the very text of docs/CWS-LISTING.md, so the two can't drift before
// they are pasted. Was paste-submission-b.test.js (1.11.0). 1.13.3 adds the
// AI Overview study's sentence to the Google results justification, the Web
// history and Website content texts and the description's PRIVACY block, and
// scopes the two promises it breaks (the exports that never leave the device).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const store = readFileSync(path.join(REPO, 'CHROMEWEBSTORE.md'), 'utf8');
const listing = readFileSync(path.join(REPO, 'docs/CWS-LISTING.md'), 'utf8');
const readme = readFileSync(path.join(REPO, 'README.md'), 'utf8');
const section = store.split('## To paste with the combined submission (1.13.0)')[1].split('\n## ')[0];
const blocks = section.split('```').filter((_, i) => i % 2 === 1).map((b) => b.trim());
const description = listing.split('## 2. Detailed description')[1].split('```')[1];
const [googleScripts, allSites, offscreen, dnr, webHistory, websiteContent, singlePurpose, ...paragraphs] = blocks;

describe('To paste with the combined submission (1.13.0)', () => {
  it('replaces submissions B and C: neither has a section of its own any more', () => {
    expect(store).not.toMatch(/^## To paste with submission [BC]/m);
  });

  it('has four justifications, two data-use texts, the single purpose and six description blocks', () => {
    expect(blocks).toHaveLength(13);
    expect(paragraphs).toHaveLength(6);
  });

  it('the Google results justification and the single purpose fit their 1,000-character fields, and are the listing doc\'s own text', () => {
    expect(googleScripts.length).toBeLessThanOrEqual(1000);
    expect(singlePurpose.length).toBeLessThanOrEqual(1000);
    expect(listing).toContain('> ' + googleScripts);
    expect(listing).toContain(singlePurpose);
  });

  it('says keyword data sends the query, only after its own disclosure, and never a result\'s address with it', () => {
    expect(googleScripts).toMatch(/for keyword data, after its own disclosure, the query and the related searches and questions shown/);
    expect(googleScripts).not.toMatch(/never the search terms/);
    expect(webHistory).toMatch(/After the user says yes to keyword data, the query of a Google search the user makes/);
    expect(websiteContent).toMatch(/related searches and People Also Ask questions shown on that results page, with its query/);
    expect(websiteContent).toMatch(/Never a result's address with the keyword data/);
    expect(singlePurpose).toMatch(/the query's keyword data/);
  });

  it('says the AI Overview study sends only for an invited tester, after their own yes, on Send to study, apart from the account (1.13.3)', () => {
    expect(googleScripts).toMatch(/for the AI Overview study, after an invited tester's own yes, that search and its page's export, only when the tester clicks Send to study in a private window the study opened/);
    expect(webHistory).toMatch(/For invited testers of SEO Bandwagon's AI Overview study who turn on study sends, the search term the study gave them, sent when they click Send to study/);
    expect(webHistory).toMatch(/a record that Google stopped them that day, sent when they click Google stopped me/);
    expect(webHistory).toMatch(/kept apart from the account/);
    expect(websiteContent).toMatch(/on Send to study, that results page's export from a private window the study opened/);
    expect(websiteContent).toMatch(/with no figures or keyword data/);
    expect(websiteContent).toMatch(/kept apart from the account/);
    const privacy = paragraphs.find((b) => b.startsWith('PRIVACY'));
    expect(privacy).toMatch(/Study mode is for invited testers of SEO Bandwagon's AI Overview study and is off until you turn it on in Settings, which says what it sends first/);
    expect(privacy).toMatch(/the study's search and the export of its results, only when you click Send to study, to the study and not to your account/);
  });

  it('no longer promises that the exports never leave the device without naming the study\'s one send (1.13.3)', () => {
    expect(store).toMatch(/exports a person makes stay entirely on the device[^|]*the one send of a results page's export is 1\.13\.3's Send to study/);
    expect(store).not.toMatch(/The CSV and clipboard exports stay entirely on the device/);
    expect(readme).toMatch(/never leave the\s+browser at all, except[^.]*Send to study/);
    expect(readme).not.toMatch(/never leave the\s+browser at all —/);
  });

  it('keeps 1.12.0\'s texts: the all-sites sentence, offscreen and the local-address rules', () => {
    expect(allSites).toMatch(/robots\.txt and llms\.txt/);
    expect(offscreen).toMatch(/offscreen document/);
    expect(dnr).toMatch(/local and private network addresses/);
  });

  it('each description paragraph is in the description block, word for word, keyword data among them', () => {
    paragraphs.forEach((b) => expect(description).toContain(b));
    expect(paragraphs.some((b) => b.startsWith('KEYWORD DATA'))).toBe(true);
    expect(paragraphs.some((b) => b.startsWith('Analyze checks a listing'))).toBe(true);
  });

  it('no longer says bare result domains are sent, or that Analyze opens a background tab', () => {
    expect(blocks.join('\n')).not.toMatch(/domains of the results shown/);
    expect(googleScripts).not.toMatch(/background tab/);
  });
});
