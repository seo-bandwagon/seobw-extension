// SEO Bandwagon — which AI crawlers a site's robots.txt blocks (1.12.0)
//
// The row under a Google result says whether the page is closed to the
// crawlers of AI assistants and AI training, read from its site's own
// robots.txt as robots.txt is read (RFC 9309): the group naming the crawler,
// or else the `*` group; the longest matching rule wins, Allow on a tie;
// `*` and `$` in a path. Pure: the worker fetches the file, from the
// user's browser, without cookies, on the user's click.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWRobotsAi` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWRobotsAi = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // The user-agent tokens each crawler obeys, and whose it is.
  const AI_CRAWLERS = [
    { token: 'GPTBot', owner: 'OpenAI' },
    { token: 'OAI-SearchBot', owner: 'OpenAI' },
    { token: 'ChatGPT-User', owner: 'OpenAI' },
    { token: 'ClaudeBot', owner: 'Anthropic' },
    { token: 'Claude-SearchBot', owner: 'Anthropic' },
    { token: 'PerplexityBot', owner: 'Perplexity' },
    { token: 'Google-Extended', owner: 'Google' },
    { token: 'Applebot-Extended', owner: 'Apple' },
    { token: 'CCBot', owner: 'Common Crawl' },
    { token: 'Meta-ExternalAgent', owner: 'Meta' },
    { token: 'Bytespider', owner: 'ByteDance' }
  ];

  /** robots.txt as groups: [{ agents: ['gptbot'], rules: [{ allow, path }] }]. */
  function parse(text) {
    const groups = [];
    let current = null;
    let lastWasAgent = false;
    String(text || '').split(/\r?\n/).forEach((raw) => {
      const line = raw.replace(/#.*$/, '').trim();
      const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) return;
      const field = m[1].toLowerCase();
      const value = m[2].trim();
      if (field === 'user-agent') {
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [] };
          groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
        return;
      }
      lastWasAgent = false;
      if (!current) return;
      if (field === 'allow' || field === 'disallow') {
        // An empty Disallow allows everything: it is no rule at all.
        if (field === 'disallow' && !value) return;
        current.rules.push({ allow: field === 'allow', path: value });
      }
    });
    return groups;
  }

  function ruleMatches(rulePath, path) {
    if (!rulePath) return false;
    let pattern = rulePath.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const anchored = pattern.endsWith('$');
    if (anchored) pattern = pattern.slice(0, -1);
    return new RegExp('^' + pattern + (anchored ? '$' : '')).test(path);
  }

  /** Whether `path` is allowed for `token` by `groups` (parse()'s). */
  function allowed(groups, token, path) {
    const t = String(token).toLowerCase();
    let chosen = groups.filter((g) => g.agents.some((a) => a !== '*' && t.indexOf(a) === 0 && a.length > 0));
    if (!chosen.length) chosen = groups.filter((g) => g.agents.includes('*'));
    const rules = chosen.flatMap((g) => g.rules);
    let best = null;
    rules.forEach((r) => {
      if (!ruleMatches(r.path, path)) return;
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    });
    return !best || best.allow;
  }

  /**
   * Which AI crawlers may read `path`, from robots.txt `text`:
   * `{ blocked: [token…], allowed: [token…] }`. No robots.txt (a 404) blocks
   * nothing.
   */
  function aiCrawlerStatus(text, path) {
    const groups = parse(text);
    const p = path || '/';
    const out = { blocked: [], allowed: [] };
    AI_CRAWLERS.forEach((c) => {
      (allowed(groups, c.token, p) ? out.allowed : out.blocked).push(c.token);
    });
    return out;
  }

  return { AI_CRAWLERS, parse, allowed, aiCrawlerStatus };
});
