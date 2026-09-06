// Unit tests for the pure HTML-vs-rendered-DOM diff logic
// (src/lib/html-diff.js). No fetch/chrome/DOM dependency here — the worker
// (service-worker.js) owns the actual raw-HTML fetch; the content script's
// analyzer.js owns the rendered-DOM analysis. This module only summarizes
// and diffs the two.

import { describe, it, expect, beforeAll } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWHtmlDiff` rather than an ESM default export. hreflang.js is
// imported first so summarizeHtml's optional hreflangCount path (which reads
// globalThis.SBWHreflang) has something to find, matching the worker's own
// importScripts order.
await import('../../src/lib/hreflang.js');
await import('../../src/lib/html-diff.js');
const SBWHtmlDiff = globalThis.SBWHtmlDiff;

describe('SBWHtmlDiff namespace', () => {
  it('attaches to globalThis.SBWHtmlDiff', () => {
    expect(SBWHtmlDiff).toBeTruthy();
    ['summarizeHtml', 'summarizeDom', 'diffSummaries']
      .forEach(fn => expect(typeof SBWHtmlDiff[fn]).toBe('function'));
  });
});

describe('summarizeHtml', () => {
  const HTML = `<!DOCTYPE html>
<html><head>
<title>Family Dentistry in North Austin</title>
<meta name="description" content="Gentle family dentistry in North Austin.">
<link rel="canonical" href="https://northsidedental.com/austin/family-dentistry">
<meta name="robots" content="index, follow">
<link rel="alternate" hreflang="en" href="https://northsidedental.com/en/austin-dentist">
<script type="application/ld+json">{"@type":"Dentist"}</script>
</head>
<body>
<h1>Family Dentistry in North Austin</h1>
<h2>Our Services</h2>
<h2>Meet the Team</h2>
<p>Some body copy with <a href="/services">a link</a> and <img src="/tooth.png"> an image.</p>
<script>var x = '<a href="/fake">not a real link</a>';</script>
</body></html>`;

  it('extracts title/metaDescription/canonical/robots', () => {
    const s = SBWHtmlDiff.summarizeHtml(HTML, 'https://northsidedental.com/austin/family-dentistry');
    expect(s.title).toBe('Family Dentistry in North Austin');
    expect(s.metaDescription).toBe('Gentle family dentistry in North Austin.');
    expect(s.canonical).toBe('https://northsidedental.com/austin/family-dentistry');
    expect(s.robots).toBe('index, follow');
  });

  it('counts headings per level and captures up to 5 H1 texts', () => {
    const s = SBWHtmlDiff.summarizeHtml(HTML, 'https://northsidedental.com/austin/family-dentistry');
    expect(s.headings).toEqual({ h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 });
    expect(s.h1Texts).toEqual(['Family Dentistry in North Austin']);
  });

  it('counts links and images, ignoring markup hidden inside <script>', () => {
    const s = SBWHtmlDiff.summarizeHtml(HTML, 'https://northsidedental.com/austin/family-dentistry');
    expect(s.linkCount).toBe(1); // the inline <script>'s fake <a> must not count
    expect(s.imgCount).toBe(1);
  });

  it('counts JSON-LD blocks', () => {
    const s = SBWHtmlDiff.summarizeHtml(HTML, 'https://northsidedental.com/austin/family-dentistry');
    expect(s.jsonLdBlocks).toBe(1);
  });

  it('approximates word count from visible text, excluding scripts/styles/tags', () => {
    const s = SBWHtmlDiff.summarizeHtml(HTML, 'https://northsidedental.com/austin/family-dentistry');
    // "Family Dentistry in North Austin" (title, not body) is not counted;
    // the visible body text is what's summed. Just assert a sane range
    // rather than an exact brittle count of every word/heading combined.
    expect(s.wordCountApprox).toBeGreaterThan(10);
    expect(s.wordCountApprox).toBeLessThan(40);
  });

  it('reuses SBWHreflang.extractHreflangFromHtml for hreflangCount', () => {
    const s = SBWHtmlDiff.summarizeHtml(HTML, 'https://northsidedental.com/austin/family-dentistry');
    expect(s.hreflangCount).toBe(1);
  });

  it('caps scanning at 1 MB and never throws on huge input', () => {
    const huge = '<html><head><title>t</title></head><body>' + 'x'.repeat(2 * 1024 * 1024) + '</body></html>';
    expect(() => SBWHtmlDiff.summarizeHtml(huge, 'https://example.com/')).not.toThrow();
  });

  it('handles empty/non-string input without throwing', () => {
    expect(() => SBWHtmlDiff.summarizeHtml('', 'https://example.com/')).not.toThrow();
    expect(() => SBWHtmlDiff.summarizeHtml(null, 'https://example.com/')).not.toThrow();
    const s = SBWHtmlDiff.summarizeHtml(null, 'https://example.com/');
    expect(s.title).toBe('');
    expect(s.canonical).toBeNull();
  });
});

describe('summarizeDom', () => {
  const ANALYSIS = {
    meta: {
      title: { text: 'Family Dentistry in North Austin', length: 33 },
      description: { text: 'Gentle family dentistry in North Austin.', length: 41 },
      canonical: 'https://northsidedental.com/austin/family-dentistry',
      robots: 'index, follow',
      schema: [{ '@type': 'Dentist' }]
    },
    headings: {
      h1: ['Family Dentistry in North Austin'],
      h2: ['Our Services', 'Meet the Team'],
      h3: [], h4: [], h5: [], h6: []
    },
    links: { internal: { count: 30 }, external: { count: 8 } },
    images: { total: 12 },
    content: { wordCount: 842 },
    hreflang: { count: 3 }
  };

  it('maps analyzer field names onto the same shape summarizeHtml produces', () => {
    const s = SBWHtmlDiff.summarizeDom(ANALYSIS);
    expect(s.title).toBe('Family Dentistry in North Austin');
    expect(s.metaDescription).toBe('Gentle family dentistry in North Austin.');
    expect(s.canonical).toBe('https://northsidedental.com/austin/family-dentistry');
    expect(s.robots).toBe('index, follow');
    expect(s.headings).toEqual({ h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 });
    expect(s.h1Texts).toEqual(['Family Dentistry in North Austin']);
    expect(s.linkCount).toBe(38);
    expect(s.imgCount).toBe(12);
    expect(s.jsonLdBlocks).toBe(1);
    expect(s.wordCountApprox).toBe(842);
    expect(s.hreflangCount).toBe(3);
  });

  it('defaults every field safely on a missing/empty analysis object', () => {
    const s = SBWHtmlDiff.summarizeDom({});
    expect(s.title).toBe('');
    expect(s.canonical).toBeNull();
    expect(s.headings).toEqual({ h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 });
    expect(s.linkCount).toBe(0);
    expect(s.wordCountApprox).toBe(0);
    expect(() => SBWHtmlDiff.summarizeDom(undefined)).not.toThrow();
  });
});

describe('diffSummaries', () => {
  function baseSummary(overrides) {
    return Object.assign({
      title: 'Family Dentistry in North Austin',
      metaDescription: 'Gentle family dentistry in North Austin.',
      canonical: 'https://northsidedental.com/austin/family-dentistry',
      robots: 'index, follow',
      headings: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
      h1Texts: ['Family Dentistry in North Austin'],
      linkCount: 30,
      imgCount: 12,
      jsonLdBlocks: 1,
      wordCountApprox: 500,
      hreflangCount: 1
    }, overrides);
  }

  it('raw with no H1 vs DOM with one -> js-only, and verdict js-rendered', () => {
    const raw = baseSummary({ headings: { h1: 0, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 }, h1Texts: [] });
    const dom = baseSummary();
    const { rows, verdict } = SBWHtmlDiff.diffSummaries(raw, dom);
    const h1Row = rows.find(r => r.field === 'h1');
    expect(h1Row.status).toBe('js-only');
    expect(h1Row.raw).toBe(0);
    expect(h1Row.rendered).toBe(1);
    expect(verdict).toBe('js-rendered');
  });

  it('identical summaries -> every field same, verdict static', () => {
    const raw = baseSummary();
    const dom = baseSummary();
    const { rows, verdict } = SBWHtmlDiff.diffSummaries(raw, dom);
    expect(rows.every(r => r.status === 'same')).toBe(true);
    expect(verdict).toBe('static');
  });

  it('canonical differs -> changed, without tripping js-rendered on its own', () => {
    const raw = baseSummary({ canonical: 'https://northsidedental.com/old-canonical' });
    const dom = baseSummary();
    const { rows, verdict } = SBWHtmlDiff.diffSummaries(raw, dom);
    const canonicalRow = rows.find(r => r.field === 'canonical');
    expect(canonicalRow.status).toBe('changed');
    expect(canonicalRow.raw).toBe('https://northsidedental.com/old-canonical');
    expect(canonicalRow.rendered).toBe('https://northsidedental.com/austin/family-dentistry');
    // Nothing critical is JS-only and word count didn't grow -> not js-rendered.
    expect(verdict).toBe('hydrated');
  });

  it('word-count growth over 50% flips the verdict to js-rendered even with no critical js-only field', () => {
    const raw = baseSummary({ wordCountApprox: 100 });
    const dom = baseSummary({ wordCountApprox: 300 }); // +200% growth
    const { verdict } = SBWHtmlDiff.diffSummaries(raw, dom);
    expect(verdict).toBe('js-rendered');
  });

  it('word-count growth at or under 50% does not by itself flip the verdict', () => {
    const raw = baseSummary({ wordCountApprox: 400 });
    const dom = baseSummary({ wordCountApprox: 550 }); // +37.5% growth
    const { rows, verdict } = SBWHtmlDiff.diffSummaries(raw, dom);
    const wordRow = rows.find(r => r.field === 'wordCountApprox');
    expect(wordRow.status).toBe('changed');
    expect(verdict).toBe('hydrated');
  });

  it('a field present only in raw (rare, but a rendered fallback wiping content) is raw-only', () => {
    const raw = baseSummary();
    const dom = baseSummary({ jsonLdBlocks: 0 });
    const { rows } = SBWHtmlDiff.diffSummaries(raw, dom);
    const row = rows.find(r => r.field === 'jsonLdBlocks');
    expect(row.status).toBe('raw-only');
  });

  it('handles missing raw/dom summaries without throwing', () => {
    expect(() => SBWHtmlDiff.diffSummaries(null, null)).not.toThrow();
    const { verdict } = SBWHtmlDiff.diffSummaries(undefined, undefined);
    expect(verdict).toBe('static'); // both sides are all-empty -> every field trivially "same"
  });
});

// --- Fix round 1 (review findings on 9d8dfa1) ---

describe('summarizeHtml — main-content word count (CRITICAL 1)', () => {
  const BASE_URL = 'https://northsidedental.com/austin/family-dentistry';

  it('scopes the word count to <main> when present, excluding header/nav/footer chrome', () => {
    const html = `<html><body>
      <header><nav>Home About Contact</nav></header>
      <main><p>Real page content goes here with several words.</p></main>
      <footer>Copyright 2024 Some Company All Rights Reserved</footer>
    </body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, BASE_URL);
    // "Real page content goes here with several words." = 8 words
    expect(s.wordCountApprox).toBe(8);
  });

  it('excludes header/nav/footer/aside text when there is no <main> or <article>', () => {
    const html = `<html><body>
      <header><nav>Home About Contact</nav></header>
      <aside>Related links over here</aside>
      <p>Real body content goes here with several words.</p>
      <footer>Copyright 2024 Some Company All Rights Reserved</footer>
    </body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, BASE_URL);
    // "Real body content goes here with several words." = 8 words
    expect(s.wordCountApprox).toBe(8);
  });

  it('prefers <article> over the header/nav/footer-stripped body when there is no <main>', () => {
    const html = `<html><body>
      <header>Site Header Text Here</header>
      <article>Article body text with six words.</article>
    </body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, BASE_URL);
    // "Article body text with six words." = 6 words
    expect(s.wordCountApprox).toBe(6);
  });
});

describe('summarizeHtml — unquoted attribute values (IMPORTANT 2a)', () => {
  const BASE_URL = 'https://example.com/page';

  it('extracts an unquoted meta[name=robots]', () => {
    const html = `<html><head><meta name=robots content="index,follow"></head><body></body></html>`;
    expect(SBWHtmlDiff.summarizeHtml(html, BASE_URL).robots).toBe('index,follow');
  });

  it('extracts an unquoted meta[name=description]', () => {
    const html = `<html><head><meta name=description content="Gentle family dentistry."></head><body></body></html>`;
    expect(SBWHtmlDiff.summarizeHtml(html, BASE_URL).metaDescription).toBe('Gentle family dentistry.');
  });

  it('extracts an unquoted link[rel=canonical] with an unquoted href', () => {
    const html = `<html><head><link rel=canonical href=https://example.com/page></head><body></body></html>`;
    expect(SBWHtmlDiff.summarizeHtml(html, BASE_URL).canonical).toBe('https://example.com/page');
  });
});

describe('summarizeHtml — entity decoding (IMPORTANT 2b)', () => {
  const BASE_URL = 'https://example.com/page';

  it('decodes &amp; in a meta description to a literal &', () => {
    const html = `<html><head><meta name="description" content="Cheap &amp; fast"></head><body></body></html>`;
    expect(SBWHtmlDiff.summarizeHtml(html, BASE_URL).metaDescription).toBe('Cheap & fast');
  });

  it('decodes named and decimal entities in the title to real dash characters', () => {
    const html = `<html><head><title>Smith &amp; Sons &mdash; Plumbers &#8211; Fast</title></head><body></body></html>`;
    expect(SBWHtmlDiff.summarizeHtml(html, BASE_URL).title).toBe('Smith & Sons — Plumbers – Fast');
  });

  it('decodes &amp; LAST so a double-escaped entity is not over-decoded', () => {
    const html = `<html><head><title>&amp;lt;</title></head><body></body></html>`;
    expect(SBWHtmlDiff.summarizeHtml(html, BASE_URL).title).toBe('&lt;');
  });
});

describe('summarizeHtml — canonical resolution (IMPORTANT 2c)', () => {
  it('resolves a relative canonical against baseUrl', () => {
    const html = `<html><head><link rel="canonical" href="/services/plumbing"></head><body></body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, 'https://example.com/current-page');
    expect(s.canonical).toBe('https://example.com/services/plumbing');
  });

  it('resolves a protocol-relative canonical against baseUrl', () => {
    const html = `<html><head><link rel="canonical" href="//cdn.example.com/x"></head><body></body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, 'https://example.com/current-page');
    expect(s.canonical).toBe('https://cdn.example.com/x');
  });

  it('resolves a relative canonical against a <base href> instead of baseUrl when one is present', () => {
    const html = `<html><head><base href="https://other.example.com/sub/"><link rel="canonical" href="plumbing"></head><body></body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, 'https://example.com/current-page');
    expect(s.canonical).toBe('https://other.example.com/sub/plumbing');
  });

  it('returns null rather than throwing when the canonical cannot be resolved', () => {
    const html = `<html><head><link rel="canonical" href="/x"></head><body></body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, 'not-a-valid-base');
    expect(s.canonical).toBeNull();
  });
});

describe('summarizeHtml — truncation (IMPORTANT 3)', () => {
  const BASE_URL = 'https://example.com/page';

  it('excludes a trailing unterminated <script> block from the word count', () => {
    const html = `<html><body><main><p>Real content here now.</p></main>` +
      `<script>var x = "this never closes and has many many words in it`;
    const s = SBWHtmlDiff.summarizeHtml(html, BASE_URL);
    // "Real content here now." = 4 words — the dangling script text must not count
    expect(s.wordCountApprox).toBe(4);
  });

  it('records the truncated flag on the summary when passed', () => {
    const html = `<html><body><main>content</main></body></html>`;
    const s1 = SBWHtmlDiff.summarizeHtml(html, BASE_URL, { truncated: true });
    expect(s1.truncated).toBe(true);
    const s2 = SBWHtmlDiff.summarizeHtml(html, BASE_URL, { truncated: false });
    expect(s2.truncated).toBe(false);
    const s3 = SBWHtmlDiff.summarizeHtml(html, BASE_URL);
    expect(s3.truncated).toBe(false);
  });
});

describe('diffSummaries — truncation never flips the verdict to js-rendered (IMPORTANT 3)', () => {
  function baseSummary(overrides) {
    return Object.assign({
      title: 'T', metaDescription: 'D', canonical: 'https://example.com/',
      robots: 'index, follow',
      headings: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      h1Texts: ['T'], linkCount: 1, imgCount: 0, jsonLdBlocks: 0,
      wordCountApprox: 100, hreflangCount: 0
    }, overrides);
  }

  it('a truncated raw summary that would trip js-rendered reports partial instead', () => {
    const raw = baseSummary({ truncated: true, headings: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }, h1Texts: [] });
    const dom = baseSummary();
    const { verdict } = SBWHtmlDiff.diffSummaries(raw, dom);
    expect(verdict).not.toBe('js-rendered');
    expect(verdict).toBe('partial');
  });

  it('carries the truncated flag through to the diff result', () => {
    const raw = baseSummary({ truncated: true });
    const dom = baseSummary();
    const { truncated } = SBWHtmlDiff.diffSummaries(raw, dom);
    expect(truncated).toBe(true);
  });

  it('an untruncated raw summary still reports js-rendered normally', () => {
    const raw = baseSummary({ headings: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }, h1Texts: [] });
    const dom = baseSummary();
    const { verdict } = SBWHtmlDiff.diffSummaries(raw, dom);
    expect(verdict).toBe('js-rendered');
  });
});

describe('summarizeHtml — symmetric link/JSON-LD counts (IMPORTANT 4)', () => {
  const BASE_URL = 'https://example.com/page';

  it('counts only http(s)-resolvable <a> tags, skipping mailto/tel/javascript/bare anchors', () => {
    const html = `<html><body>
      <a href="/real-page">real</a>
      <a href="mailto:hi@example.com">mail</a>
      <a href="tel:+15555550123">call</a>
      <a href="javascript:void(0)">js</a>
      <a name="anchor-only">bare</a>
    </body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, BASE_URL);
    expect(s.linkCount).toBe(1);
  });

  it('counts only JSON-LD blocks whose body actually JSON.parses', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Dentist"}</script>
      <script type="application/ld+json">{ this is not valid json }</script>
      </head><body></body></html>`;
    const s = SBWHtmlDiff.summarizeHtml(html, BASE_URL);
    expect(s.jsonLdBlocks).toBe(1);
  });
});
