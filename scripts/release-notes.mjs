#!/usr/bin/env node
// Release notes for a GitHub release: the "What's new" block from
// docs/CWS-LISTING.md §6 (the text the store submission uses) and the zip's
// SHA-256. GitHub appends its generated list of merged pull requests.
// usage: node scripts/release-notes.mjs <zip>   (prints Markdown)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function whatsNew(listing) {
  const at = listing.indexOf("\n## 6. What's new");
  if (at < 0) return null;
  const heading = listing.slice(at + 1).split('\n')[0].replace(/^##\s*6\.\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  const block = listing.slice(at).split('```')[1];
  return block ? { heading, text: block.replace(/^\n/, '').replace(/\s+$/, '') } : null;
}

export function notes(listing, zipName, sha256) {
  const w = whatsNew(listing);
  return [
    w ? `## ${w.heading}\n\n${w.text}` : '',
    `## Package\n\n\`${zipName}\`\nSHA-256: \`${sha256}\``
  ].filter(Boolean).join('\n\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const zip = process.argv[2];
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  process.stdout.write(notes(fs.readFileSync('docs/CWS-LISTING.md', 'utf8'), zip.split('/').pop(), sha));
}
