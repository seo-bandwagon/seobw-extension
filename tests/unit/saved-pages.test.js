// 1.10.4 on saved pages (tests/fixtures/pages/): each one runs through the
// popup's own path, the files popup.js injects evaluated in a jsdom window and
// { action: 'analyze' } sent to analyzer.js, and the score, issues and facts
// are checked against what the page is. The pages are whole documents written
// for these tests (original text), one per thing 1.10.4 fixes:
//
//   non-English   non-english-ru.html, non-english-ja.html
//   Microdata     microdata.html (and rdfa.html)
//   http          good-en.html served at http://
//   noindex       noindex.html (and a googlebot-only copy)
//   duplicates    duplicates.html: two titles, descriptions, canonicals
//   headings      headings.html: skipped levels, an empty and an image-only H1
//   main region   tiny-main.html: <main> with one line, decorative images
//
// Before 1.10.4 (main at 7760cf0) these scored: Russian 90 with 0 words,
// Japanese 82 with 0 words, Microdata and RDFa 90 ("No structured data"), the
// http and noindex pages 100, duplicates 100, headings 90 ("Missing H1"),
// tiny-main 80 (4 words, "Many images missing alt").
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import analysis from '../../extension/lib/content-analysis.js';
import extraction from '../../extension/lib/dom-extraction.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION = resolve(REPO, 'extension');
const PAGES = resolve(REPO, 'tests/fixtures/pages');
const GUIDE = 'https://www.greenplot.example/guides/start-a-garden/';

const html = (file) => readFileSync(resolve(PAGES, file), 'utf8');

/** The files the popup injects, read from popup.js as the organic-grade test reads them. */
function popupInjectionFiles() {
  const src = readFileSync(resolve(EXTENSION, 'src/popup/popup.js'), 'utf8');
  const m = /executeScript\(\{\s*target:\s*\{\s*tabId:\s*tab\.id\s*\},\s*files:\s*(\[[^\]]+\])/.exec(src);
  if (!m) throw new Error('could not find the analysis executeScript files list in popup.js');
  return JSON.parse(m[1].replace(/'/g, '"'));
}
const SOURCES = popupInjectionFiles().map((file) => [file, readFileSync(resolve(EXTENSION, file), 'utf8')]);

/** analyzer.js's answer for a page, as the popup gets it. Waits out its 2 s Web Vitals window. */
async function analyze(source, url) {
  const dom = new JSDOM(source, { url, runScripts: 'outside-only' });
  const { window } = dom;
  let listener = null;
  window.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
  const context = dom.getInternalVMContext();
  for (const [file, code] of SOURCES) new vm.Script(code, { filename: file }).runInContext(context);
  const response = await new Promise((done) => listener({ action: 'analyze' }, {}, done));
  window.close();
  return JSON.parse(JSON.stringify(response));
}

const runs = {};
beforeAll(async () => {
  const jobs = {
    ru: [html('non-english-ru.html'), 'https://zelenaya-gryadka.example/ogorod/kak-nachat/'],
    ja: [html('non-english-ja.html'), 'https://greenplot.example/ja/kateisaien/'],
    en: [html('good-en.html'), GUIDE],
    http: [html('good-en.html'), GUIDE.replace('https:', 'http:')],
    noindex: [html('noindex.html'), GUIDE],
    googlebot: [html('good-en.html').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="GOOGLEBOT" content="none">'), GUIDE],
    microdata: [html('microdata.html'), GUIDE],
    rdfa: [html('rdfa.html'), GUIDE],
    duplicates: [html('duplicates.html'), GUIDE],
    headings: [html('headings.html'), GUIDE],
    tinyMain: [html('tiny-main.html'), GUIDE]
  };
  const names = Object.keys(jobs);
  const results = await Promise.all(names.map((n) => analyze(...jobs[n])));
  names.forEach((n, i) => { runs[n] = results[i]; });
}, 30_000);

describe('words in every language', () => {
  it('counts a Russian page\'s words, and scores it as the complete page it is', () => {
    const ru = runs.ru;
    expect(ru.content.wordCount).toBeGreaterThan(600);
    expect(ru.seoScore.issues).not.toContain('Thin content');
    expect(ru.seoScore.score).toBe(100);
    expect(ru.content.topWords.length).toBeGreaterThan(5);
  });

  it('splits a Japanese page into words, and reads its title and description at double width', () => {
    const ja = runs.ja;
    expect(ja.content.wordCount).toBeGreaterThan(600);
    expect(ja.meta.title.displayLength).toBeGreaterThan(ja.meta.title.length);
    expect(ja.seoScore.issues).toEqual([]);
    expect(ja.seoScore.score).toBe(100);
  });

  it('scores readability only for the English page', () => {
    expect(runs.en.content.readability).toMatchObject({ level: expect.any(String) });
    expect(runs.en.content.language).toEqual({ code: 'en', source: 'lang', english: true });
    expect(runs.ru.content.readability).toBeNull();
    expect(runs.ru.content.language).toMatchObject({ code: 'ru', english: false });
    expect(runs.ja.content.readability).toBeNull();
  });

  it('keeps an English page\'s word count where it was', () => {
    // 789 before 1.10.4 too: apostrophes and hyphens still join a word.
    expect(runs.en.content.wordCount).toBe(789);
  });
});

describe('structured data in every syntax', () => {
  it('counts Microdata and RDFa, so neither page reads "No structured data"', () => {
    expect(runs.microdata.meta.structuredData).toEqual({ jsonLd: 0, microdata: 1, rdfa: 0 });
    expect(runs.rdfa.meta.structuredData).toEqual({ jsonLd: 0, microdata: 0, rdfa: 1 });
    for (const r of [runs.microdata, runs.rdfa]) {
      expect(r.seoScore.issues).not.toContain('No structured data');
      expect(r.seoScore.score).toBe(100);
    }
  });
});

describe('one list of checks behind the score and the sub-scores', () => {
  const tech = (r) => analysis.groupChecks(analysis.evaluateChecks(r).checks).find((g) => g.k === 'Tech');

  it('an http page loses 5 points in the score and in Tech', () => {
    expect(runs.en.seoScore.score).toBe(100);
    expect(runs.http.seoScore).toMatchObject({ score: 95, issues: ['Not served over HTTPS'] });
    expect(tech(runs.http).v).toBeLessThan(100);
  });

  it('a noindex page loses 15, from the robots meta or the googlebot meta (none is noindex)', () => {
    expect(runs.noindex.seoScore).toMatchObject({ score: 85, grade: 'B', issues: ['Set to noindex'] });
    expect(runs.noindex.meta).toMatchObject({ robots: 'noindex, follow', noindex: true, noindexSource: 'robots' });
    expect(runs.googlebot.seoScore).toMatchObject({ score: 85, issues: ['Set to noindex'] });
    expect(runs.googlebot.meta).toMatchObject({ googlebot: 'none', noindexSource: 'googlebot' });
    expect(tech(runs.noindex).v).toBeLessThan(60);
  });

  it('the score the analyzer sends is the score the checks give the same data', () => {
    for (const r of Object.values(runs)) {
      expect(analysis.evaluateChecks(r).score).toBe(r.seoScore.score);
    }
  });
});

describe('meta tags', () => {
  it('reads the canonical as a URL and says it points to itself', () => {
    expect(runs.en.meta).toMatchObject({ canonical: GUIDE, canonicalTarget: 'self', canonicalUrls: [GUIDE], canonicalCount: 1 });
    expect(runs.http.meta.canonicalTarget).toBe('elsewhere');
  });

  it('flags duplicate title, description and canonical tags, and canonicals that disagree', () => {
    const d = runs.duplicates;
    expect(d.meta.title.count).toBe(2);
    expect(d.meta.description.count).toBe(2);
    expect(d.meta.canonicalCount).toBe(2);
    expect(d.meta.canonicalUrls).toHaveLength(2);
    expect(d.seoScore.issues).toEqual(expect.arrayContaining(['Conflicting canonical tags', 'Duplicate tags']));
  });

  it('checks lang, viewport and charset', () => {
    expect(runs.en.meta).toMatchObject({ lang: 'en', viewport: 'width=device-width, initial-scale=1' });
    expect(runs.en.meta.charset.declared).toBe('utf-8');
    const d = runs.duplicates;
    expect(d.meta).toMatchObject({ lang: null, viewport: null });
    expect(d.meta.charset.declared).toBe('windows-1252');
    expect(d.seoScore.issues).toEqual(expect.arrayContaining(['No language declared', 'Missing viewport', 'Not UTF-8']));
    // 100 - 5 (canonicals) - 4 (viewport) - 2 (lang) - 2 (duplicates) - 2 (charset)
    expect(d.seoScore.score).toBe(85);
  });

  it('every issue has fix text and the points it costs', () => {
    for (const issue of runs.duplicates.seoScore.issues) {
      const fix = analysis.fixFor(issue, runs.duplicates);
      expect(fix.body, issue).not.toBe('');
      expect(fix.points, issue).toBeGreaterThan(0);
    }
    expect(analysis.fixFor('Duplicate tags', runs.duplicates).body).toMatch(/^2 title tags, 2 meta descriptions, 2 canonical tags\./);
  });
});

describe('headings', () => {
  it('keeps the full ordered H1 to H6 tree, with skipped and empty headings flagged', () => {
    const outline = runs.headings.headings.outline;
    expect(outline.map((h) => h.level)).toEqual([1, 3, 2, 2, 5, 2, 3, 2, 2, 2, 6]);
    expect(outline[0]).toMatchObject({ text: 'How to start a small vegetable garden', fromAlt: true });
    expect(outline[1]).toMatchObject({ text: 'Before you start', skipped: [2] });
    expect(outline[2]).toMatchObject({ text: '', empty: true });
    expect(outline[4]).toMatchObject({ text: 'Morning sun or afternoon sun', skipped: [3, 4] });
    expect(outline[10]).toMatchObject({ text: 'A note on frost dates', skipped: [3, 4, 5] });
    expect(runs.headings.headings).toMatchObject({ skips: 3, empty: 1 });
  });

  it('an H1 that is only an image is an H1, not "Missing H1"', () => {
    expect(runs.headings.headings.h1).toEqual(['How to start a small vegetable garden']);
    expect(runs.headings.seoScore.issues).not.toContain('Missing H1');
  });
});

describe('images and words', () => {
  it('tells a decorative alt="" apart from a missing alt', () => {
    const img = runs.tinyMain.images;
    expect(img.total).toBe(5);
    expect(img.decorative).toBe(3);
    expect(img.missingAlt.count).toBe(0);
    expect(runs.tinyMain.seoScore.issues).not.toContain('Many images missing alt');
  });

  it('counts the body when the main region holds only a welcome line', () => {
    expect(runs.tinyMain.content.scope).toBe('body-fallback');
    expect(runs.tinyMain.content.wordCount).toBeGreaterThan(700);
    expect(runs.tinyMain.seoScore.score).toBe(100);
    expect(runs.en.content.scope).toBe('main');
  });
});

describe('the same analysis on a parsed Document (1.12.0 runs it offscreen)', () => {
  it('gives a DOMParser document (no window, not laid out) the score the live page gets', () => {
    for (const [file, url] of [['non-english-ru.html', 'https://zelenaya-gryadka.example/ogorod/kak-nachat/'], ['duplicates.html', GUIDE], ['tiny-main.html', GUIDE]]) {
      // The parser's page sits at the page's address so relative links resolve the same.
      const dom = new JSDOM('', { url });
      const parsed = new dom.window.DOMParser().parseFromString(html(file), 'text/html');
      expect(parsed.defaultView).toBeNull();
      const { data } = analysis.analyzeDocument(parsed, null, extraction, url);
      const live = { 'non-english-ru.html': runs.ru, 'duplicates.html': runs.duplicates, 'tiny-main.html': runs.tinyMain }[file];
      expect(data.seoScore, file).toEqual(live.seoScore);
      expect(data.technical.url.protocol, file).toBe('https:');
      dom.window.close();
    }
  });
});

describe('tech stack from the page\'s own globals', () => {
  // What the service worker's world:'MAIN' probe returns for a page; the
  // isolated world (null) sees none of it.
  const doc = new JSDOM('<!doctype html><html><body><div id="__nuxt"></div><div id="app"></div></body></html>').window.document;
  const names = (globals) => extraction.detectTechStack(doc, globals).map((t) => t.name);

  it('finds the Facebook Pixel, Vue and Tag Manager only from the page\'s world', () => {
    const globals = { fbq: true, vueRoot: true, gtmContainers: 1, gaTags: 0 };
    expect(names(globals)).toEqual(expect.arrayContaining(['Facebook Pixel', 'Vue.js', 'Google Tag Manager', 'Nuxt.js']));
    expect(names(globals)).not.toContain('Google Analytics');
    expect(names(null)).not.toContain('Facebook Pixel');
  });

  it('reports Tag Manager and Analytics apart', () => {
    const gtmOnly = new JSDOM('<script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script>').window.document;
    expect(extraction.detectTechStack(gtmOnly, null).map((t) => t.name)).toEqual(['Google Tag Manager']);
    const ga = new JSDOM('<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>').window.document;
    expect(extraction.detectTechStack(ga, null).map((t) => t.name)).toEqual(['Google Analytics']);
  });

  it('does not take cdnjs.cloudflare.com for a site behind Cloudflare', () => {
    const cdnjs = new JSDOM('<script src="https://cdnjs.cloudflare.com/ajax/libs/x/1.0/x.js"></script>').window.document;
    expect(extraction.detectTechStack(cdnjs, null).map((t) => t.name)).not.toContain('Cloudflare');
    const cf = new JSDOM('<script src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>').window.document;
    expect(extraction.detectTechStack(cf, null).map((t) => t.name)).toContain('Cloudflare');
  });
});

// ------------------------------------------------------------- the popup

// The real popup (src/popup/popup.html and every script it loads, in order)
// in a jsdom window, opened on one of the analyses above: `chrome` answers
// getCachedAnalysis with it and anything else with an empty answer.
const POPUP = resolve(EXTENSION, 'src/popup/popup.html');

function chromeStub(window, tab, data) {
  const reply = (msg) => (msg && msg.action === 'getCachedAnalysis' ? { hit: true, data } : {});
  let node = null;
  const over = {
    runtime: {
      lastError: undefined,
      id: 'test',
      getManifest: () => ({ version: '1.10.4', version_name: '1.10.4 — test' }),
      getURL: (p) => 'chrome-extension://test/' + p,
      sendMessage: (msg, cb) => {
        if (typeof cb === 'function') { window.setTimeout(() => cb(reply(msg)), 0); return undefined; }
        return window.Promise.resolve(reply(msg));
      },
      // A port: Link Check listens on one.
      connect: () => node(null)
    },
    tabs: { query: (q, cb) => { window.setTimeout(() => cb([tab]), 0); } }
  };
  node = (value) => new Proxy(typeof value === 'function' ? value : function () {}, {
    get(target, prop) {
      if (value && typeof value === 'object' && prop in value) {
        const v = value[prop];
        return v && typeof v === 'object' ? node(v) : v;
      }
      if (prop === 'then') return undefined;
      return node(null);
    },
    apply(target, self, args) {
      if (typeof value === 'function') return value.apply(self, args);
      const cb = args.find((a) => typeof a === 'function');
      if (cb) { window.setTimeout(() => cb({}), 0); return undefined; }
      return window.Promise.resolve({});
    }
  });
  return node(over);
}

async function openPopup(data) {
  const source = readFileSync(POPUP, 'utf8');
  const dom = new JSDOM(source, { url: 'https://popup.test/src/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.chrome = chromeStub(window, { id: 7, url: data.url, title: 'Saved page' }, data);
  window.navigator.clipboard = { writeText: async () => {} };
  const context = dom.getInternalVMContext();
  const scripts = [...window.document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  for (const src of scripts) {
    const file = resolve(dirname(POPUP), src);
    try {
      new vm.Script(readFileSync(file, 'utf8'), { filename: file }).runInContext(context);
    } catch (e) { /* a module this test doesn't need; the SEO tab is what's checked */ }
  }
  for (let i = 0; i < 100 && !window.document.querySelector('.seo-hero'); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return window;
}

const rowValue = (window, section, label) => {
  const rows = [...window.document.querySelectorAll(`[data-section="${section}"] .data-row`)];
  const row = rows.find((r) => r.querySelector('.data-label') && r.querySelector('.data-label').textContent.trim() === label);
  return row ? row.querySelector('.data-value') : null;
};

describe('the popup shows it', () => {
  it('every issue with its fix and the points it costs', async () => {
    const w = await openPopup(runs.duplicates);
    const issues = [...w.document.querySelectorAll('[data-section="issues"] .issue')];
    expect(issues).toHaveLength(runs.duplicates.seoScore.issues.length);
    for (const el of issues) {
      expect(el.querySelector('.issue-fix').textContent.length).toBeGreaterThan(10);
      expect(el.querySelector('.issue-points').textContent).toMatch(/^−\d+$/);
    }
    const viewport = issues.find((el) => el.querySelector('.issue-label').textContent === 'Missing viewport');
    expect(viewport.querySelector('.issue-points').textContent).toBe('−4');
    w.close();
  });

  it('the canonical as a URL, with where it points, and the head tags 1.10.4 reads', async () => {
    const w = await openPopup(runs.en);
    expect(rowValue(w, 'meta', 'Canonical').textContent).toBe('Points to itself');
    expect(rowValue(w, 'meta', 'Canonical URL').textContent).toBe('www.greenplot.example/guides/start-a-garden/');
    expect(rowValue(w, 'meta', 'Indexable').textContent).toBe('Yes');
    expect(rowValue(w, 'meta', 'Lang').textContent).toBe('en');
    expect(rowValue(w, 'meta', 'Viewport').textContent).toBe('width=device-width, initial-scale=1');
    expect(rowValue(w, 'meta', 'Charset').textContent).toBe('UTF-8');
    w.close();

    const d = await openPopup(runs.duplicates);
    expect(rowValue(d, 'meta', 'Canonical').textContent).toBe('2 different URLs');
    expect(rowValue(d, 'meta', 'URL 2').textContent).toBe('www.greenplot.example/guides/vegetable-garden/');
    expect(rowValue(d, 'meta', 'Duplicates').textContent).toBe('2 title tags, 2 meta descriptions, 2 canonical tags');
    expect(rowValue(d, 'meta', 'Lang').textContent).toBe('Missing');
    d.close();

    const g = await openPopup(runs.googlebot);
    expect(rowValue(g, 'meta', 'Googlebot').textContent).toBe('none');
    expect(rowValue(g, 'meta', 'Indexable').textContent).toBe('noindex (googlebot meta)');
    g.close();
  });

  it('the result preview cut by pixel width, not characters', async () => {
    // 52 characters: inside 60, but capital Ws run past 600 px.
    const wide = JSON.parse(JSON.stringify(runs.en));
    wide.meta.title = { text: 'WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWW', length: 52, count: 1 };
    const w = await openPopup(wide);
    expect(w.document.querySelector('.serp-title').textContent).toMatch(/ \.\.\.$/);
    expect(rowValue(w, 'meta', 'Title').textContent).toMatch(/^52 chars · \d+ px of about 600, cut$/);
    w.close();

    // The garden guide's 50-character title fits whole.
    const g = await openPopup(runs.en);
    expect(g.document.querySelector('.serp-title').textContent).toBe(runs.en.meta.title.text);
    g.close();
  });

  it('Core Web Vitals: "No data" and why, never GOOD with nothing measured', async () => {
    const hidden = JSON.parse(JSON.stringify(runs.en));
    hidden.webVitals = { lcp: null, cls: null, inp: null, fcp: null, ttfb: 120, interactions: 0, loadedHidden: true, source: 'this-visit' };
    const w = await openPopup(hidden);
    const sec = w.document.querySelector('[data-section="webvitals"]');
    expect(sec.querySelector('.section-header').textContent).toContain('NO DATA');
    expect([...sec.querySelectorAll('.cwv-v')].map((el) => el.textContent)).toEqual(['No data', 'No data', 'No data']);
    expect(sec.textContent).toContain('background tab');
    expect(sec.textContent).toContain('Measured on this visit');
    w.close();

    const partial = JSON.parse(JSON.stringify(runs.en));
    partial.webVitals = { lcp: 1200, cls: 0.02, inp: null, fcp: 900, ttfb: 120, interactions: 0, loadedHidden: false };
    const p = await openPopup(partial);
    expect(p.document.querySelector('[data-section="webvitals"] .section-header').textContent).toContain('2 OF 3 GOOD');
    p.close();
  });

  it('the full heading tree, with skipped levels and empty headings flagged', async () => {
    const w = await openPopup(runs.headings);
    const rows = [...w.document.querySelectorAll('[data-section="headings"] .h-row')];
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.querySelector('.h-tag').textContent)).toEqual(['H1', 'H3', 'H2', 'H2', 'H5', 'H2', 'H3', 'H2', 'H2', 'H2', 'H6']);
    expect(rows[1].textContent).toContain('skips H2');
    expect(rows[2].querySelector('.data-value').textContent).toBe('(empty)');
    expect(rows[4].textContent).toContain('skips H3, H4');
    expect(rows[0].textContent).toContain('image alt');
    expect(w.document.querySelector('[data-section="headings"] .section-header').textContent).toContain('3 SKIPPED · 1 EMPTY');
    w.close();
  });

  it('decorative images, the body word count, and readability only for English', async () => {
    const t = await openPopup(runs.tinyMain);
    expect(rowValue(t, 'links', 'Missing alt').textContent).toBe('0');
    expect(rowValue(t, 'links', 'Decorative').textContent).toBe('3 with alt=""');
    expect(rowValue(t, 'content', 'Counted in').textContent).toMatch(/main region has under 100 words/);
    t.close();

    const r = await openPopup(runs.ru);
    expect(rowValue(r, 'content', 'Reading level').textContent).toBe('Not scored: the page is not in English');
    expect(rowValue(r, 'content', 'Language').textContent).toBe("ru · from the page's lang attribute");
    r.close();
  });

  it('the score ring says what the score is: an on-page checklist', async () => {
    const w = await openPopup(runs.noindex);
    expect(w.document.querySelector('.seo-hero .ring').getAttribute('title')).toMatch(/On-page checklist/);
    expect(w.document.querySelector('.ring-val').textContent).toBe('85');
    w.close();
  });
});

// ------------------------------------------------- from the review of 1.10.4

describe('edge cases the review found', () => {
  it('a page element named like a global (<a id="next">) is not that global', () => {
    // As executeScript sends it: the function's source, run in the page.
    const dom = new JSDOM('<a id="next" href="/p2">Next</a><img name="ga" src="x.png" alt=""><script>window.fbq = function () {};</script>',
      { url: GUIDE, runScripts: 'dangerously' });
    expect(dom.window.next).toBeDefined(); // the element, by its id
    const probe = new vm.Script(`(${extraction.probeTechGlobals.toString()})()`).runInContext(dom.getInternalVMContext());
    expect(probe.next).toBe(false);
    expect(probe.ga).toBe(false);
    expect(probe.fbq).toBe(true);
    dom.window.close();
  });

  it('robots stays the first robots tag (as the render check reads the raw HTML); noindex reads them all', () => {
    const doc = new JSDOM('<head><meta name="robots" content="index, follow"><meta name="robots" content="noindex"></head>', { url: GUIDE }).window.document;
    const meta = extraction.extractMeta(doc, GUIDE);
    expect(meta.robots).toBe('index, follow');
    expect(meta.noindex).toBe(true);
  });

  it('what sits in <noscript> is left out, as the live page (scripts on) reads it as text', () => {
    const page = '<!doctype html><html lang="en"><body><main><p>x</p><a href="/a">A</a></main>' +
      '<noscript><img height="1" width="1" src="http://www.facebook.com/tr?id=1"><a href="/b">B</a></noscript></body></html>';
    const dom = new JSDOM('', { url: GUIDE });
    const parsed = new dom.window.DOMParser().parseFromString(page, 'text/html');
    expect(parsed.querySelectorAll('noscript img')).toHaveLength(1); // parsed as elements here
    const { data } = analysis.analyzeDocument(parsed, null, extraction, GUIDE);
    expect(data.images.total).toBe(0);
    expect(data.links.internal.count).toBe(1);
    expect(data.mixedContent.mixedCount).toBe(0);
  });

  it('the content hash is taken from 1.10.3\'s text, so the site does not read every page as changed', () => {
    const doc = new JSDOM(html('non-english-ru.html'), { url: GUIDE }).window.document;
    // 1.10.3: the first main region, ASCII letters and basic punctuation only.
    const text = extraction.legacyHashText(doc);
    expect(text).not.toMatch(/[а-я]/i);
    expect(text).toBe(doc.querySelector('main').textContent.replace(/\s+/g, ' ').replace(/[^\w\s.,!?;:'"()-]/g, '').trim());
  });
});
