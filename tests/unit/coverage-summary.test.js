// #74 (1.13.8): the coverage report in CI (scripts/coverage-summary.mjs,
// .github/workflows/test.yml).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { summaryMarkdown } from '../../scripts/coverage-summary.mjs';

const m = (covered, total) => ({ covered, total, skipped: 0, pct: total ? (covered / total) * 100 : 100 });

describe('summaryMarkdown', () => {
  it('gives the totals and the least-covered files', () => {
    const md = summaryMarkdown({
      total: { lines: m(50, 100), statements: m(55, 110), functions: m(9, 10), branches: m(20, 40) },
      '/repo/extension/src/lib/a.js': { lines: m(1, 10) },
      '/repo/extension/src/lib/b.js': { lines: m(9, 10) },
      '/repo/extension/src/lib/empty.js': { lines: m(0, 0) }
    }, { root: '/repo', lowest: 5 });
    expect(md).toContain('| Lines | 50 | 100 | 50.00% |');
    expect(md).toContain('| Branches | 20 | 40 | 50.00% |');
    expect(md.indexOf('extension/src/lib/a.js')).toBeLessThan(md.indexOf('extension/src/lib/b.js'));
    expect(md).not.toContain('empty.js');
    expect(md).toContain('No threshold yet');
  });

  it('refuses a file with no totals', () => {
    expect(() => summaryMarkdown({})).toThrow(/total/);
  });
});

describe('the workflow', () => {
  const yml = fs.readFileSync('.github/workflows/test.yml', 'utf8');
  it('runs the suite once, with coverage, and no plain npm test beside it', () => {
    expect(yml).toContain('run: npm run test:coverage');
    expect(yml).not.toMatch(/^\s+- run: npm test\s*$/m);
  });
  it('writes the summary to the job summary and keeps the HTML report 7 days', () => {
    expect(yml).toContain('node scripts/coverage-summary.mjs coverage/coverage-summary.json >> "$GITHUB_STEP_SUMMARY"');
    expect(yml).toMatch(/name: coverage-report\s+path: coverage\/\s+retention-days: 7/);
  });
  it('the config writes the summary the script reads', async () => {
    const cfg = (await import('../../vitest.config.mjs')).default;
    expect(cfg.test.coverage.reporter).toEqual(expect.arrayContaining(['json-summary', 'html']));
    expect(cfg.test.coverage.reportsDirectory).toBe('coverage');
    expect(cfg.test.coverage.reportOnFailure).toBe(true);
  });
});
