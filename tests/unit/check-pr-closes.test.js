// scripts/check-pr-closes.mjs: a PR that checks off a ROADMAP item with an
// open issue's number must close that issue (owner, 2026-11-06).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { newlyChecked, closedInBody, missingCloses } from '../../scripts/check-pr-closes.mjs';

const diff = (...lines) => ['diff --git a/ROADMAP.md b/ROADMAP.md', '--- a/ROADMAP.md', '+++ b/ROADMAP.md', '@@ -1 +1 @@', ...lines].join('\n');

describe('newlyChecked', () => {
  it('finds the issue numbers on a line that goes from [ ] to [x]', () => {
    expect(newlyChecked(diff('- - [ ] Search Console row actions (#67)', '+ - [x] Search Console row actions (#67)'))).toEqual([67]);
  });

  it('reads every number on a line, in any of the forms the roadmap uses', () => {
    expect(newlyChecked(diff(
      '+- [x] Corrected details (#69); Undo (#70); campaign steps (#71)',
      '+- [x] #74 a test coverage report in CI',
      '+- [x] the toolbar at the top or the bottom (owner 2026-10-23; closes #53)'
    ))).toEqual([53, 69, 70, 71, 74]);
  });

  it('ignores a line that was already checked and is only reworded', () => {
    expect(newlyChecked(diff('-- [x] #41 results behind /goto', '+- [x] #41 results behind Google /goto redirects'))).toEqual([]);
  });

  it('ignores unchecked lines, prose and other repositories', () => {
    expect(newlyChecked(diff(
      '+- [ ] Undo (#70)',
      '+Shipped in seobw-extension#147 and keepkalm/platform#530; see #12.',
      '+- [x] the privacy sentence is in keepkalm/platform#530'
    ))).toEqual([]);
  });

  it('ignores the diff headers', () => {
    expect(newlyChecked('--- a/ROADMAP.md\n+++ b/ROADMAP.md')).toEqual([]);
  });
});

describe('closedInBody', () => {
  it("reads GitHub's closing keywords, one issue each", () => {
    const body = 'Closes #67\nfixes #69, resolves: #70\nFixed #71 and #72\nRefs #73\nCLOSED #74';
    expect([...closedInBody(body)].sort((a, b) => a - b)).toEqual([67, 69, 70, 71, 74]);
  });

  it('treats a missing body as closing nothing', () => {
    expect(closedInBody(null).size).toBe(0);
  });
});

describe('missingCloses', () => {
  const checked = diff('+- [x] Corrected details (#69); Undo (#70); campaign steps (#71)');

  it('names each open issue the body does not close', () => {
    expect(missingCloses({ diff: checked, body: 'Closes #69', openIssues: [67, 69, 70, 71] })).toEqual([70, 71]);
  });

  it('passes when the body closes them all', () => {
    expect(missingCloses({ diff: checked, body: 'Closes #69\nCloses #70\nCloses #71', openIssues: [69, 70, 71] })).toEqual([]);
  });

  it('asks nothing for a number that is a closed issue or a pull request', () => {
    expect(missingCloses({ diff: checked, body: '', openIssues: [67] })).toEqual([]);
  });
});

describe('the repository follows it', () => {
  it('the PR template asks for one Closes line per issue', () => {
    expect(fs.readFileSync('.github/pull_request_template.md', 'utf8')).toMatch(/Closes #N/);
  });

  it('the workflow runs the check on every PR and on a description edit', () => {
    const wf = fs.readFileSync('.github/workflows/pr-closes.yml', 'utf8');
    expect(wf).toMatch(/types: \[opened, edited, synchronize, reopened\]/);
    expect(wf).toMatch(/node scripts\/check-pr-closes\.mjs/);
    // The description reaches the script through the environment, never
    // spliced into the shell.
    expect(wf).toMatch(/PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/);
    expect(wf).not.toMatch(/run:[^\n]*\$\{\{ github\.event\.pull_request\.body/);
  });
});
