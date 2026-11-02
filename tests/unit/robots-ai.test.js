// Which AI crawlers a site's robots.txt blocks (1.12.0, src/lib/robots-ai.js),
// read as robots.txt is read: the crawler's own group or else `*`, the
// longest matching rule, Allow on a tie.

import { describe, it, expect } from 'vitest';

const R = require('../../extension/src/lib/robots-ai.js');

describe('AI crawlers in robots.txt', () => {
  it('blocks the crawlers a site names, and nothing else', () => {
    const txt = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin/\n';
    const s = R.aiCrawlerStatus(txt, '/blog/post');
    expect(s.blocked).toEqual(['GPTBot', 'ClaudeBot', 'CCBot']);
    expect(s.allowed).toContain('PerplexityBot');
  });

  it('a `*` group blocks every crawler without its own group', () => {
    expect(R.aiCrawlerStatus('User-agent: *\nDisallow: /', '/').blocked).toHaveLength(R.AI_CRAWLERS.length);
  });

  it('a crawler\'s own group overrides `*`', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n';
    const s = R.aiCrawlerStatus(txt, '/x');
    expect(s.allowed).toEqual(['GPTBot']);
  });

  it('the longest rule wins, Allow on a tie, with * and $', () => {
    const txt = 'User-agent: GPTBot\nDisallow: /private/\nAllow: /private/press/\nDisallow: /*.pdf$\n';
    expect(R.allowed(R.parse(txt), 'GPTBot', '/private/press/note')).toBe(true);
    expect(R.allowed(R.parse(txt), 'GPTBot', '/private/x')).toBe(false);
    expect(R.allowed(R.parse(txt), 'GPTBot', '/files/a.pdf')).toBe(false);
    expect(R.allowed(R.parse(txt), 'GPTBot', '/files/a.pdf?x=1')).toBe(true);
  });

  it('an empty robots.txt or an empty Disallow blocks nothing', () => {
    expect(R.aiCrawlerStatus('', '/').blocked).toEqual([]);
    expect(R.aiCrawlerStatus('User-agent: *\nDisallow:\n', '/').blocked).toEqual([]);
  });

  it('matches crawler names in any case and ignores comments', () => {
    expect(R.aiCrawlerStatus('user-agent: gptbot # OpenAI\ndisallow: / # all\n', '/').blocked).toEqual(['GPTBot']);
  });
});
