// Unit tests for the pure broken-link-checker logic (src/lib/link-check.js).
// No fetch/chrome dependency here — the worker (service-worker.js) owns the
// actual probing; this module is the scheduler/classifier/CSV-shaper it
// calls into, plus the content-script link collector's normalizer.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWLinkCheck` rather than an ESM default export.
await import('../../extension/src/lib/link-check.js');
const SBWLinkCheck = globalThis.SBWLinkCheck;

describe('SBWLinkCheck namespace', () => {
  it('attaches to globalThis.SBWLinkCheck', () => {
    expect(SBWLinkCheck).toBeTruthy();
    ['normalizeUrl', 'planChecks', 'hostKey', 'pickNext', 'classify', 'groupResults', 'resultRows', 'isComplete']
      .forEach(fn => expect(typeof SBWLinkCheck[fn]).toBe('function'));
  });
});

describe('normalizeUrl', () => {
  it('accepts absolute http URLs', () => {
    expect(SBWLinkCheck.normalizeUrl('http://example.com/page')).toBe('http://example.com/page');
  });

  it('accepts absolute https URLs', () => {
    expect(SBWLinkCheck.normalizeUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('strips a #fragment', () => {
    expect(SBWLinkCheck.normalizeUrl('https://example.com/page#section-2')).toBe('https://example.com/page');
  });

  it('keeps the query string', () => {
    expect(SBWLinkCheck.normalizeUrl('https://example.com/page?a=1&b=2#frag')).toBe('https://example.com/page?a=1&b=2');
  });

  it('rejects relative URLs', () => {
    expect(SBWLinkCheck.normalizeUrl('/relative/path')).toBeNull();
  });

  it('rejects mailto: and other non-http(s) schemes', () => {
    expect(SBWLinkCheck.normalizeUrl('mailto:a@example.com')).toBeNull();
    expect(SBWLinkCheck.normalizeUrl('javascript:void(0)')).toBeNull();
    expect(SBWLinkCheck.normalizeUrl('tel:+15125550134')).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(SBWLinkCheck.normalizeUrl('')).toBeNull();
    expect(SBWLinkCheck.normalizeUrl(null)).toBeNull();
    expect(SBWLinkCheck.normalizeUrl(undefined)).toBeNull();
  });
});

describe('hostKey', () => {
  it('lowercases the hostname', () => {
    expect(SBWLinkCheck.hostKey('https://EXAMPLE.com/x')).toBe('example.com');
  });

  it('strips a leading www.', () => {
    expect(SBWLinkCheck.hostKey('https://www.example.com/x')).toBe('example.com');
    expect(SBWLinkCheck.hostKey('https://WWW.Example.com/x')).toBe('example.com');
  });

  it('leaves non-www subdomains alone', () => {
    expect(SBWLinkCheck.hostKey('https://blog.example.com/x')).toBe('blog.example.com');
  });
});

describe('planChecks', () => {
  it('dedupes by normalized URL, keeping the first anchor text/rel', () => {
    const links = [
      { url: 'https://example.com/a', text: 'First', rel: null, internal: true },
      { url: 'https://example.com/a#frag', text: 'Second (dup)', rel: 'nofollow', internal: true },
      { url: 'https://example.com/b', text: 'B', rel: null, internal: false }
    ];
    const { queue, total, truncated } = SBWLinkCheck.planChecks(links);
    expect(total).toBe(2);
    expect(truncated).toBe(false);
    expect(queue).toHaveLength(2);
    const a = queue.find(q => q.url === 'https://example.com/a');
    expect(a.text).toBe('First');
    expect(a.rel).toBeNull();
  });

  it('strips fragments before dedupe', () => {
    const links = [
      { url: 'https://example.com/a#one', text: 'a', rel: null, internal: true },
      { url: 'https://example.com/a#two', text: 'a again', rel: null, internal: true }
    ];
    const { queue, total } = SBWLinkCheck.planChecks(links);
    expect(total).toBe(1);
    expect(queue).toHaveLength(1);
  });

  it('drops non-http(s) links entirely (not counted in total)', () => {
    const links = [
      { url: 'https://example.com/a', text: 'a', rel: null, internal: true },
      { url: 'mailto:x@example.com', text: 'mail', rel: null, internal: false },
      { url: '/relative', text: 'rel', rel: null, internal: true }
    ];
    const { queue, total } = SBWLinkCheck.planChecks(links);
    expect(total).toBe(1);
    expect(queue).toHaveLength(1);
  });

  it('caps the queue at max and sets truncated', () => {
    const links = Array.from({ length: 350 }, (_, i) => ({
      url: `https://example.com/page-${i}`, text: `p${i}`, rel: null, internal: true
    }));
    const { queue, total, truncated } = SBWLinkCheck.planChecks(links, { max: 300 });
    expect(total).toBe(350);
    expect(queue).toHaveLength(300);
    expect(truncated).toBe(true);
  });

  it('does not truncate when under the cap', () => {
    const links = [{ url: 'https://example.com/a', text: 'a', rel: null, internal: true }];
    const { queue, total, truncated } = SBWLinkCheck.planChecks(links, { max: 300 });
    expect(total).toBe(1);
    expect(queue).toHaveLength(1);
    expect(truncated).toBe(false);
  });

  it('defaults max to 300', () => {
    const links = Array.from({ length: 301 }, (_, i) => ({
      url: `https://example.com/page-${i}`, text: `p${i}`, rel: null, internal: true
    }));
    const { queue, truncated } = SBWLinkCheck.planChecks(links);
    expect(queue).toHaveLength(300);
    expect(truncated).toBe(true);
  });

  // task-1-fix-1-brief item 7: `max: 0` is an explicit "check nothing", not
  // "unset" — `(options && options.max) || DEFAULT` used to treat 0 as
  // falsy and silently fall back to 300.
  it('honours an explicit max: 0 as zero capacity, not "unset"', () => {
    const links = [
      { url: 'https://example.com/a', text: 'a', rel: null, internal: true },
      { url: 'https://example.com/b', text: 'b', rel: null, internal: true }
    ];
    const { queue, total, truncated } = SBWLinkCheck.planChecks(links, { max: 0 });
    expect(queue).toEqual([]);
    expect(total).toBe(2);
    expect(truncated).toBe(true);
  });
});

describe('pickNext', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ url: `https://example.com/${i}` }));

  it('returns the first queue item when nothing is inflight', () => {
    const queue = mk(3);
    const next = SBWLinkCheck.pickNext(queue, {});
    expect(next).toBe(queue[0]);
  });

  it('returns null for an empty queue', () => {
    expect(SBWLinkCheck.pickNext([], {})).toBeNull();
  });

  it('enforces the per-host limit, skipping items whose host is saturated', () => {
    const queue = [
      { url: 'https://a.example/1' },
      { url: 'https://a.example/2' },
      { url: 'https://b.example/1' }
    ];
    // a.example already has 2 inflight (the default perHost limit)
    const inflight = { 'a.example': 2 };
    const next = SBWLinkCheck.pickNext(queue, inflight, { perHost: 2, global: 6 });
    expect(next.url).toBe('https://b.example/1');
  });

  it('enforces the global limit even when hosts are under their per-host cap', () => {
    const queue = [{ url: 'https://a.example/1' }, { url: 'https://b.example/1' }];
    const inflight = { 'a.example': 3, 'b.example': 3 }; // 6 total, global cap is 6
    const next = SBWLinkCheck.pickNext(queue, inflight, { perHost: 2, global: 6 });
    expect(next).toBeNull();
  });

  it('returns null when every queued host is saturated', () => {
    const queue = [{ url: 'https://a.example/1' }, { url: 'https://a.example/2' }];
    const inflight = { 'a.example': 2 };
    expect(SBWLinkCheck.pickNext(queue, inflight, { perHost: 2, global: 6 })).toBeNull();
  });

  it('uses default perHost=2, global=6 when options omitted', () => {
    const queue = [{ url: 'https://a.example/1' }];
    expect(SBWLinkCheck.pickNext(queue, { 'a.example': 2 })).toBeNull();
    expect(SBWLinkCheck.pickNext(queue, { 'a.example': 1 })).toBe(queue[0]);
  });

  // task-1-fix-1-brief item 7: an explicit 0 must mean zero capacity, not
  // "unset, use the default" — `(options && options.x) || DEFAULT` used to
  // treat { perHost: 0 } / { global: 0 } as falsy and fall back to 2/6.
  it('honours an explicit perHost: 0 as zero capacity', () => {
    const queue = [{ url: 'https://a.example/1' }];
    expect(SBWLinkCheck.pickNext(queue, {}, { perHost: 0, global: 6 })).toBeNull();
  });

  it('honours an explicit global: 0 as zero capacity', () => {
    const queue = [{ url: 'https://a.example/1' }];
    expect(SBWLinkCheck.pickNext(queue, {}, { perHost: 2, global: 0 })).toBeNull();
  });
});

describe('isComplete', () => {
  it('is false while doneCount is behind total', () => {
    expect(SBWLinkCheck.isComplete(3, 5, 0)).toBe(false);
  });

  it('is false once doneCount reaches total if something is still inflight', () => {
    expect(SBWLinkCheck.isComplete(5, 5, 1)).toBe(false);
  });

  it('is true once doneCount reaches total and nothing is inflight', () => {
    expect(SBWLinkCheck.isComplete(5, 5, 0)).toBe(true);
  });

  it('is true for an empty run (0 total, 0 inflight)', () => {
    expect(SBWLinkCheck.isComplete(0, 0, 0)).toBe(true);
  });

  it('treats a missing/undefined inflight as zero', () => {
    expect(SBWLinkCheck.isComplete(5, 5)).toBe(true);
  });
});

describe('classify', () => {
  it('classifies 2xx as ok', () => {
    expect(SBWLinkCheck.classify({ status: 200 })).toBe('ok');
    expect(SBWLinkCheck.classify({ status: 204 })).toBe('ok');
    expect(SBWLinkCheck.classify({ status: 299 })).toBe('ok');
  });

  it('classifies 3xx as redirect', () => {
    expect(SBWLinkCheck.classify({ status: 301, finalUrl: 'https://example.com/new' })).toBe('redirect');
    expect(SBWLinkCheck.classify({ status: 399 })).toBe('redirect');
  });

  it('classifies 4xx as client', () => {
    expect(SBWLinkCheck.classify({ status: 404 })).toBe('client');
    expect(SBWLinkCheck.classify({ status: 499 })).toBe('client');
  });

  it('classifies 5xx as server', () => {
    expect(SBWLinkCheck.classify({ status: 500 })).toBe('server');
    expect(SBWLinkCheck.classify({ status: 599 })).toBe('server');
  });

  it('classifies status 0 with error: timeout as timeout', () => {
    expect(SBWLinkCheck.classify({ status: 0, error: 'timeout' })).toBe('timeout');
  });

  it('classifies status 0 with any other/no error as network', () => {
    expect(SBWLinkCheck.classify({ status: 0, error: 'network' })).toBe('network');
    expect(SBWLinkCheck.classify({ status: 0 })).toBe('network');
  });

  it('status 0 wins over a stray status-based read (error field is authoritative at 0)', () => {
    expect(SBWLinkCheck.classify({ status: 0, error: 'timeout', finalUrl: null })).toBe('timeout');
  });
});

describe('groupResults', () => {
  const results = [
    { url: 'https://a.example/ok', status: 200 },
    { url: 'https://a.example/redir', status: 301, finalUrl: 'https://a.example/new' },
    { url: 'https://a.example/404', status: 404 },
    { url: 'https://a.example/500', status: 500 },
    { url: 'https://a.example/timeout', status: 0, error: 'timeout' },
    { url: 'https://a.example/net', status: 0, error: 'network' },
    { url: 'https://a.example/aa-ok', status: 200 }
  ];

  // 'uncheckable' joined the six in 1.7.6 (#46).
  it('buckets results into the seven classes', () => {
    const { groups } = SBWLinkCheck.groupResults(results);
    expect(Object.keys(groups).sort()).toEqual(['client', 'network', 'ok', 'redirect', 'server', 'timeout', 'uncheckable'].sort());
    expect(groups.ok).toHaveLength(2);
    expect(groups.redirect).toHaveLength(1);
    expect(groups.client).toHaveLength(1);
    expect(groups.server).toHaveLength(1);
    expect(groups.timeout).toHaveLength(1);
    expect(groups.network).toHaveLength(1);
  });

  it('sorts each group by URL', () => {
    const { groups } = SBWLinkCheck.groupResults(results);
    const urls = groups.ok.map(r => r.url);
    expect(urls).toEqual([...urls].sort());
  });

  it('provides counts per class', () => {
    const { counts } = SBWLinkCheck.groupResults(results);
    expect(counts).toEqual({ ok: 2, redirect: 1, client: 1, server: 1, timeout: 1, network: 1, uncheckable: 0 });
  });

  it('sums client+server+timeout+network into broken', () => {
    const { broken } = SBWLinkCheck.groupResults(results);
    expect(broken).toBe(4);
  });

  it('handles an empty result set', () => {
    const { groups, counts, broken } = SBWLinkCheck.groupResults([]);
    expect(counts).toEqual({ ok: 0, redirect: 0, client: 0, server: 0, timeout: 0, network: 0, uncheckable: 0 });
    expect(broken).toBe(0);
    Object.values(groups).forEach(g => expect(g).toEqual([]));
  });
});

describe('resultRows', () => {
  it('shapes rows with url, status, class, finalUrl, anchor, rel, type, ms, error', () => {
    const results = [
      { url: 'https://example.com/a', text: 'Anchor A', rel: 'nofollow', internal: true, status: 301, finalUrl: 'https://example.com/a2', redirected: true, ms: 120 },
      { url: 'https://example.com/b', text: 'Anchor B', rel: null, internal: false, status: 0, error: 'timeout', ms: 10000 }
    ];
    const rows = SBWLinkCheck.resultRows(results);
    expect(rows).toEqual([
      { url: 'https://example.com/a', status: 301, class: 'redirect', finalUrl: 'https://example.com/a2', anchor: 'Anchor A', rel: 'nofollow', type: 'internal', ms: 120, error: null },
      { url: 'https://example.com/b', status: 0, class: 'timeout', finalUrl: null, anchor: 'Anchor B', rel: null, type: 'external', ms: 10000, error: 'timeout' }
    ]);
  });

  it('maps internal: true/false to type internal/external', () => {
    const rows = SBWLinkCheck.resultRows([
      { url: 'https://x/', text: '', rel: null, internal: true, status: 200, ms: 5 },
      { url: 'https://y/', text: '', rel: null, internal: false, status: 200, ms: 5 }
    ]);
    expect(rows[0].type).toBe('internal');
    expect(rows[1].type).toBe('external');
  });
});

/* ---------- #46: hosts Chrome won't let an extension fetch ---------- */

describe('uncheckable links (#46)', () => {
  it('recognises the Chrome Web Store, old and new', () => {
    expect(SBWLinkCheck.isUncheckable('https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj?utm_source=x')).toBe(true);
    expect(SBWLinkCheck.isUncheckable('https://chrome.google.com/webstore/detail/x/abc')).toBe(true);
    expect(SBWLinkCheck.isUncheckable('https://chrome.google.com/webstore')).toBe(true);
  });

  it('leaves everything else checkable', () => {
    expect(SBWLinkCheck.isUncheckable('https://chrome.google.com/extensions')).toBe(false);
    expect(SBWLinkCheck.isUncheckable('https://www.google.com/chrome/')).toBe(false);
    expect(SBWLinkCheck.isUncheckable('https://example.com/webstore')).toBe(false);
    expect(SBWLinkCheck.isUncheckable('not a url')).toBe(false);
  });

  it('classifies them as uncheckable, never broken', () => {
    const r = { url: 'https://chromewebstore.google.com/detail/x', status: 0, error: 'uncheckable' };
    expect(SBWLinkCheck.classify(r)).toBe('uncheckable');
    const { counts, broken } = SBWLinkCheck.groupResults([r, { url: 'https://a.example/404', status: 404 }]);
    expect(counts.uncheckable).toBe(1);
    expect(broken).toBe(1);
    expect(SBWLinkCheck.resultRows([r])[0]).toMatchObject({ class: 'uncheckable', error: 'uncheckable' });
  });
});
