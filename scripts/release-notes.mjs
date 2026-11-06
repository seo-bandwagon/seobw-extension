#!/usr/bin/env node
// Release notes for a GitHub release: the "What's new" block from
// docs/CWS-LISTING.md §6 (the text the store submission uses) and each zip's
// SHA-256 (from 1.13.6, the Chrome zip and the Edge zip). GitHub appends its
// generated list of merged pull requests.
// usage: node scripts/release-notes.mjs <zip> [<zip> …]   (prints Markdown)
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

// `more`: further packages of the same release, as { name, sha256 }.
export function notes(listing, zipName, sha256, more = []) {
  const w = whatsNew(listing);
  const packages = [{ name: zipName, sha256 }, ...more];
  return [
    w ? `## ${w.heading}\n\n${w.text}` : '',
    `## ${packages.length > 1 ? 'Packages' : 'Package'}\n\n` +
      packages.map((p) => `\`${p.name}\`\nSHA-256: \`${p.sha256}\``).join('\n\n')
  ].filter(Boolean).join('\n\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [first, ...rest] = process.argv.slice(2).map((zip) => ({
    name: zip.split('/').pop(),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex')
  }));
  process.stdout.write(notes(fs.readFileSync('docs/CWS-LISTING.md', 'utf8'), first.name, first.sha256, rest));
}
