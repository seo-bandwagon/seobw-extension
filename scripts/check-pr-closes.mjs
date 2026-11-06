#!/usr/bin/env node
// SEO Bandwagon — CI check: a pull request that checks off a ROADMAP.md item
// carrying an open issue's number closes that issue.
//
// Usage: OPEN_ISSUES='[67,69]' PR_BODY='…' node scripts/check-pr-closes.mjs [base-ref]
//        (base-ref defaults to origin/main; .github/workflows/pr-closes.yml
//        sets both variables)
//
// Owner, 2026-11-06: "Release PRs close them". Issues close only when a merged
// PR says `Closes #N` (or `Fixes`/`Resolves`), and from mid-October to
// 1.13.6 almost no PR did: 37 of 40 merged PRs said "Linked issue: none", so
// work shipped while its issue stayed open. An item is "checked off" when an
// added line reads `- [x] …#N…` and no removed line already did; only numbers
// that are open issues count (a PR number or a closed issue needs nothing).

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CHECKED = /^\s*[-*] \[[xX]\]/;
const REF = /(?<![\w/])#(\d+)\b/g;
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi;

function refs(line) {
  return [...line.matchAll(REF)].map((m) => Number(m[1]));
}

// Issue numbers on ROADMAP.md lines this diff checks off.
export function newlyChecked(diff) {
  const added = new Set();
  const removed = new Set();
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    const sign = raw[0];
    const line = raw.slice(1);
    if ((sign !== '+' && sign !== '-') || !CHECKED.test(line)) continue;
    for (const n of refs(line)) (sign === '+' ? added : removed).add(n);
  }
  return [...added].filter((n) => !removed.has(n)).sort((a, b) => a - b);
}

// Issue numbers the PR body closes with GitHub's keywords.
export function closedInBody(body) {
  return new Set([...String(body || '').matchAll(CLOSING)].map((m) => Number(m[1])));
}

// Checked-off open issues the body doesn't close.
export function missingCloses({ diff, body, openIssues }) {
  const open = new Set(openIssues);
  const closed = closedInBody(body);
  return newlyChecked(diff).filter((n) => open.has(n) && !closed.has(n));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const base = process.argv[2] || 'origin/main';
  const diff = execFileSync('git', ['diff', '--unified=0', `${base}...HEAD`, '--', 'ROADMAP.md'], { encoding: 'utf8' });
  let openIssues;
  try {
    openIssues = JSON.parse(process.env.OPEN_ISSUES || '');
  } catch {
    console.error('OPEN_ISSUES must be a JSON array of the open issue numbers.');
    process.exit(2);
  }
  const missing = missingCloses({ diff, body: process.env.PR_BODY, openIssues });
  const checked = newlyChecked(diff);
  if (!missing.length) {
    console.log(checked.length
      ? `ROADMAP items checked off: ${checked.map((n) => '#' + n).join(', ')}. Every open one is closed by this PR.`
      : 'No ROADMAP item with an issue number is checked off.');
    process.exit(0);
  }
  for (const n of missing) {
    console.error(`::error file=ROADMAP.md::This PR checks off #${n}, an open issue, but its description doesn't close it. Add a line "Closes #${n}".`);
  }
  console.error('Edit the PR description; this check reruns on the edit.');
  process.exit(1);
}
