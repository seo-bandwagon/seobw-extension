// The coverage report's summary as a Markdown table, for the job summary
// (1.13.8, #74). Reads the json-summary reporter's file that
// `npm run test:coverage` writes (vitest.config.mjs) and prints the totals
// and the files with the least line coverage. No threshold: the baseline is
// recorded first (ROADMAP.md, the PR), a gate comes later.
//
//   node scripts/coverage-summary.mjs [coverage/coverage-summary.json] >> "$GITHUB_STEP_SUMMARY"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = ['lines', 'statements', 'functions', 'branches'];

export function summaryMarkdown(summary, { root = process.cwd(), lowest = 10 } = {}) {
  const total = summary && summary.total;
  if (!total) throw new Error('No "total" in the coverage summary');
  const pct = (m) => (m && typeof m.pct === 'number' ? m.pct.toFixed(2) + '%' : 'n/a');
  const count = (m) => (m ? `${m.covered} / ${m.total}` : '');
  const out = [];
  out.push('## Test coverage');
  out.push('');
  out.push('| | Covered | Of | % |');
  out.push('|---|---:|---:|---:|');
  for (const k of METRICS) {
    const m = total[k];
    out.push(`| ${k[0].toUpperCase() + k.slice(1)} | ${m ? m.covered : ''} | ${m ? m.total : ''} | ${pct(m)} |`);
  }
  const files = Object.entries(summary)
    .filter(([k, v]) => k !== 'total' && v && v.lines && v.lines.total > 0)
    .map(([k, v]) => ({ file: path.relative(root, k) || k, lines: v.lines }))
    .sort((a, b) => a.lines.pct - b.lines.pct || b.lines.total - a.lines.total);
  if (files.length && lowest > 0) {
    out.push('');
    out.push(`Lowest line coverage (${Math.min(lowest, files.length)} of ${files.length} files):`);
    out.push('');
    out.push('| File | Lines | % |');
    out.push('|---|---:|---:|');
    for (const f of files.slice(0, lowest)) out.push(`| \`${f.file}\` | ${count(f.lines)} | ${pct(f.lines)} |`);
  }
  out.push('');
  out.push('No threshold yet (#74): the full HTML report is the `coverage-report` artifact, kept 7 days.');
  return out.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || 'coverage/coverage-summary.json';
  const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stdout.write(summaryMarkdown(summary));
}
