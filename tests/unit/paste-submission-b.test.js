// CHROMEWEBSTORE.md → "To paste with submission B" (1.11.0): the dashboard
// texts the upload of 1.11.0 must change. Each must fit its field, and the
// description paragraphs and single purpose must be the very text of
// docs/CWS-LISTING.md, so the two can't drift before they are pasted.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const store = readFileSync(path.join(REPO, 'CHROMEWEBSTORE.md'), 'utf8');
const listing = readFileSync(path.join(REPO, 'docs/CWS-LISTING.md'), 'utf8');
const section = store.split('## To paste with submission B')[1].split('\n## ')[0];
const blocks = section.split('```').filter((_, i) => i % 2 === 1).map((b) => b.trim());
const description = listing.split('## 2. Detailed description')[1].split('```')[1];

describe('To paste with submission B', () => {
  it('has the justification, two data-use texts, the single purpose and four description blocks', () => {
    expect(blocks).toHaveLength(8);
  });

  it('the host justification and the single purpose fit their 1,000-character fields', () => {
    expect(blocks[0].length).toBeLessThanOrEqual(1000);
    expect(blocks[3].length).toBeLessThanOrEqual(1000);
    expect(blocks[0]).toMatch(/never the search terms/);
    expect(blocks[3]).toMatch(/link, traffic and domain-age figures/);
  });

  it('the justification and single purpose are the listing doc\'s own text', () => {
    expect(listing).toContain('> ' + blocks[0]);
    expect(listing).toContain(blocks[3]);
  });

  it('each description paragraph is in the description block, word for word', () => {
    blocks.slice(4).forEach((b) => expect(description).toContain(b));
  });

  it('no longer says bare result domains are sent', () => {
    expect(blocks.join('\n')).not.toMatch(/domains of the results shown/);
  });
});
