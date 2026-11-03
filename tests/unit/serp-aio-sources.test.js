// 1.13.3, for the AI Overview inclusion study: the AI Overview's sources read
// signed out (src/lib/serp.js aiOverviewSources), and Search features no
// longer missing the AI Overview.
//
// tests/fixtures/serp-google-aio-signed-out.html is real Google markup saved
// signed out: the sources are /goto?url= redirects, and the pages' real
// addresses are only in Google's hidden records (HTML comments that begin
// TgQPHd|). The small markup below writes those records the way the DOM holds
// them: the comment data keeps `&quot;` for every quote.
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';

await import('../../extension/src/lib/serp.js');
const S = globalThis.SBWSerp;

const fs = require('node:fs');
const path = require('node:path');
const saved = (f) => new JSDOM('<!doctype html><body>' + fs.readFileSync(path.join(__dirname, '../fixtures', f), 'utf8') + '</body>').window.document;
const frag = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;

const box = (inner) => `<div data-subtree="aimc">${inner}</div>`;
const record = (json, head = '||') => `<!--TgQPHd|${head}${json.replace(/"/g, '&quot;')}-->`;
const favicon = (site) => `https://encrypted-tbn0.gstatic.com/faviconV2?url=${site}&amp;client=AIM&amp;size=128&amp;type=FAVICON`;
// The side panel: a [data-ignore-copy] element holding a list of cards.
const panel = (...cards) => `<div data-ignore-copy><ul>${cards.join('')}</ul></div>`;
const card = (label, href, extra = '') => `<li><a aria-label="${label.replace(/"/g, '&quot;')}" href="${href}"></a>${extra}</li>`;
const reads = (doc) => S.aiOverviewSources(doc).map((s) => [s.read, s.url]);

describe('the signed-out AI Overview page, read from a saved Google page', () => {
  const doc = saved('serp-google-aio-signed-out.html');
  // The whole context of a 450 KB page: read once, with room for a loaded machine
  // (jsdom takes seconds to match every feature's selector on it).
  let ctx;
  beforeAll(() => { ctx = S.searchContext({ search: '?q=how+does+seo+work' }, doc); }, 120000);

  it('Search features lists the AI Overview first, and the export reads the answer', () => {
    expect(ctx.features).toBe('AI Overview | People also ask | Ads (5) | Videos | Top stories | Related searches');
    expect(ctx.aiState).toBe('loaded');
    expect(ctx.aiText.startsWith('SEO (Search Engine Optimization) is the practice of improving a website')).toBe(true);
    expect(ctx.aiRedirectCitations).toBe(9);
  });

  it('reads the link, then the hidden records, then the two cards whose pages nothing names', () => {
    expect(reads(doc)).toEqual([
      ['link', 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide'],
      ['record', 'https://www.youtube.com/watch?v=N0lTwy8BliA&t=274'],
      ['record', 'https://www.youtube.com/watch?v=R-XxAk8-OXY&t=96'],
      ['record', 'https://digitalmarketinginstitute.com/blog/what-is-seo'],
      ['record', 'https://www.enterprisenation.com/learn-something/how-does-seo-work/'],
      ['record', 'https://www.reddit.com/r/webdev/comments/1b3wowf/can_you_eli5_what_is_seo_is_what_it_does_and_how/'],
      ['record', 'https://en.wikipedia.org/wiki/Search_engine_optimization'],
      ['record', 'https://www.youtube.com/watch?v=btwC4zmewss'],
      ['card site', 'https://pce.sandiego.edu'],
      ['card site', 'https://thriveagency.com']
    ]);
  }, 30000);

  it('gives the link its label, a record no title and a card its label, each with its domain', () => {
    const sources = S.aiOverviewSources(doc);
    expect(sources[0]).toEqual({ url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
      domain: 'developers.google.com', title: 'Google for Developers', read: 'link' });
    expect(sources.slice(1, 8).map((s) => s.title)).toEqual(['', '', '', '', '', '', '']);
    expect(sources.slice(8)).toEqual([
      { url: 'https://pce.sandiego.edu', domain: 'pce.sandiego.edu', title: 'How Does SEO Work? 9 Elements for Beginners to Know', read: 'card site' },
      { url: 'https://thriveagency.com', domain: 'thriveagency.com', title: 'What Is SEO: How Does It Work, What’s Included and How Much Does It Cost?', read: 'card site' }
    ]);
  }, 30000);

  it('puts every source, how it was read and its title in the export context', () => {
    expect(ctx.aiCitations.split(' | ')).toHaveLength(10);
    expect(ctx.aiCitationReads).toBe('link | record | record | record | record | record | record | record | card site | card site');
    const titles = JSON.parse(ctx.aiCitationTitles);
    expect(titles).toHaveLength(10);
    expect(titles[0]).toBe('Google for Developers');
    expect(titles.slice(1, 8)).toEqual(['', '', '', '', '', '', '']);
    expect(titles.slice(8)).toEqual(['How Does SEO Work? 9 Elements for Beginners to Know',
      'What Is SEO: How Does It Work, What’s Included and How Much Does It Cost?']);
  });

  it('lists the pages as citations, and leaves out the cards that only name a site', () => {
    const cites = S.aiOverviewCitations(doc);
    expect(cites).toHaveLength(8);
    expect(cites.map((c) => c.read)).toEqual(['link', 'record', 'record', 'record', 'record', 'record', 'record', 'record']);
    expect(cites.map((c) => c.url)).toEqual(S.aiOverviewSources(doc).slice(0, 8).map((s) => s.url));
    expect(cites[1]).toEqual({ url: 'https://www.youtube.com/watch?v=N0lTwy8BliA&t=274', domain: 'youtube.com', title: '', read: 'record' });
  }, 30000);
});

describe('the signed-in AI Overview page keeps reading its links', () => {
  const doc = saved('serp-google-social-profiles.html');

  it('reads all nine sources as links, with the same pages as before', () => {
    const sources = S.aiOverviewSources(doc);
    expect(sources).toHaveLength(9);
    expect(sources.every((s) => s.read === 'link')).toBe(true);
    expect(sources[0]).toMatchObject({ url: 'https://seobandwagon.com/pricing', domain: 'seobandwagon.com' });
    expect(S.aiOverviewCitations(doc)).toEqual(sources);
    const ctx = S.searchContext({ search: '?q=seo+bandwagon' }, doc);
    expect(ctx.features).toBe('AI Overview | Ads (1)');
    expect(ctx.aiCitationReads).toBe(Array(9).fill('link').join(' | '));
    expect(JSON.parse(ctx.aiCitationTitles)).toHaveLength(9);
  }, 30000);
});

describe('Search features and the AI Overview', () => {
  it('lists the AI Overview exactly when a box is shown, wherever the box sits', () => {
    const has = (html) => S.detectFeatures(frag(html)).some((f) => f.key === 'ai_overview');
    expect(has(box('<p>Answer.</p>'))).toBe(true);
    expect(has('<div id="search"><div id="rso"><p>A result</p></div></div>' + box('<p>Answer.</p>'))).toBe(true);
    expect(has('<div id="rso">' + box('<p>Answer.</p>') + '</div>')).toBe(true);
    expect(has('<div id="rso"><p>A result</p></div>')).toBe(false);
    expect(has('<div data-subtree="aimc" style="display:none"><p>Answer.</p></div>')).toBe(false);
  });

  it('lists it once, in its place at the front, whatever else the page shows', () => {
    const doc = frag('<div id="rso"><div data-text-ad><a href="https://ad.example/">Ad</a> Ad text</div></div>' + box('<p>Answer.</p>'));
    expect(S.detectFeatures(doc).map((f) => f.key)).toEqual(['ai_overview', 'ads']);
  });

  it('leaves the other features as they were on the saved pages', () => {
    expect(S.detectFeatures(saved('serp-google-commercial-query.html')).map((f) => f.key)).toEqual(['people_also_ask', 'related_searches']);
    expect(S.detectFeatures(saved('serp-google-goto-links.html')).some((f) => f.key === 'ai_overview')).toBe(false);
  }, 30000);
});

describe('an AI Overview box inside People also ask is not the search\'s overview', () => {
  const paa = '<div class="related-question-pair"><div data-q="What is SEO?">What is SEO?</div>' +
    box('<p>PAA answer text.</p><a href="https://paa.example/page">PAA direct</a> <a href="/goto?url=PAA1">PAA via Google</a>' +
      record('[["https://paa.example/record"]]')) + '</div>';
  const main = box('<p>Main answer text.</p><a href="https://main.example/page">Main direct</a> <a href="/goto?url=MAIN1">Main via Google</a>' +
    record('[["https://main.example/record"]]'));

  it('reads the text, the citations and the redirects from the main box only', () => {
    const doc = frag(main + paa);
    expect(S.aiOverviewText(doc)).toBe('Main answer text. Main direct Main via Google');
    expect(S.aiOverviewState(doc)).toBe('loaded');
    expect(S.aiOverviewCitations(doc).map((c) => c.url)).toEqual(['https://main.example/page', 'https://main.example/record']);
    expect(S.aiOverviewRedirectCount(doc)).toBe(1);
    expect(S.searchContext({ search: '?q=x' }, doc).aiCitations).toBe('https://main.example/page | https://main.example/record');
  });

  it('is no overview when it is the only box: state none, no feature, no sources', () => {
    const doc = frag(paa);
    expect(S.aiOverviewState(doc)).toBe('none');
    expect(S.aiOverviewText(doc)).toBe('');
    expect(S.aiOverviewRedirectCount(doc)).toBe(0);
    expect(S.aiOverviewSources(doc)).toEqual([]);
    expect(S.detectFeatures(doc).some((f) => f.key === 'ai_overview')).toBe(false);
  });
});

describe('reading a hidden record', () => {
  it('reads a page from a record written with &quot; quoting and `TgQPHd|||`', () => {
    const doc = frag(box('<p>Answer.</p>' + record('[["id-1",null,"Some title",2,"https://a.example/page?x=1"]]')));
    expect(S.aiOverviewSources(doc)).toEqual([
      { url: 'https://a.example/page?x=1', domain: 'a.example', title: '', read: 'record' }
    ]);
  });

  it('takes the JSON after the third pipe, whatever the header holds', () => {
    const doc = frag(box('<p>Answer.</p>' +
      '<!--TgQPHd||x=&amp;y:z|[[&quot;https://b.example/page&quot;]]-->' +
      '<!--TgQPHd|OUIDAf_5/eKeEre||[[&quot;https://c.example/page&quot;]]-->'));
    expect(reads(doc)).toEqual([['record', 'https://b.example/page'], ['record', 'https://c.example/page']]);
  });

  it('decodes the entities Google wrote: &amp; in an address, and \\u0026 and \\u003d in the JSON', () => {
    const doc = frag(box('<p>Answer.</p>' +
      '<!--TgQPHd|||[[&quot;https://d.example/p?a=1&amp;b=2&quot;],[&quot;https://e.example/p?a\\u003d1\\u0026b\\u003d2&quot;],[&quot;https://f.example/it&#39;s&quot;]]-->'));
    expect(reads(doc)).toEqual([
      ['record', 'https://d.example/p?a=1&b=2'],
      ['record', 'https://e.example/p?a=1&b=2'],
      ['record', 'https://f.example/it\'s']
    ]);
  });

  it('skips a record that is not JSON, or is cut short, and keeps reading the rest', () => {
    const doc = frag(box('<p>Answer.</p>' +
      '<!--TgQPHd|||not json at all https://skip1.example/page-->' +
      '<!--TgQPHd|||[[&quot;https://skip2.example/page&quot;,-->' +
      '<!--TgQPHd||just two pipes-->' +
      '<!--TgQPHd|||[[&quot;https://kept.example/page&quot;]]-->'));
    expect(reads(doc)).toEqual([['record', 'https://kept.example/page']]);
  });

  it('is only a record when the comment begins TgQPHd|', () => {
    const doc = frag(box('<p>Answer.</p>' +
      '<!-- TgQPHd|||[[&quot;https://nope1.example/page&quot;]]-->' +
      '<!--other|||[[&quot;https://nope2.example/page&quot;]]-->'));
    expect(S.aiOverviewSources(doc)).toEqual([]);
  });

  it('does not count a picture, a bare site, Google\'s own page or a string that only holds an address', () => {
    const doc = frag(box('<p>Answer.</p>' + record(JSON.stringify([[
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT',
      'https://lh3.googleusercontent.com/abc=s96',
      'https://developers.google.com',
      'https://developers.google.com/',
      'https://www.google.com/search?q=x',
      'https://www.google.com/goto?url=CAES',
      '/goto?url=CAES',
      'see https://words.example/page for more',
      'ftp://old.example/file',
      'not an address',
      42, null, true,
      'https://real.example/page'
    ]]))));
    expect(reads(doc)).toEqual([['record', 'https://real.example/page']]);
  });

  it('does not count a thumbnail, a profile picture or any picture, style sheet or script address', () => {
    const doc = frag(box('<p>Answer.</p>' + record(JSON.stringify([[
      'https://i.ytimg.com/vi/N0lTwy8BliA/hqdefault.jpg',
      'https://yt3.ggpht.com/ytc/AIdro_k=s88-c-k-c0x00ffffff-no-rj',
      'https://ytimg.com/vi/abc/default',
      'https://cdn.example/photo.JPG',
      'https://cdn.example/photo.jpeg',
      'https://cdn.example/a/b.png?width=300',
      'https://cdn.example/anim.gif',
      'https://cdn.example/pic.webp',
      'https://cdn.example/logo.svg',
      'https://cdn.example/favicon.ico',
      'https://cdn.example/site.css',
      'https://cdn.example/app.min.js',
      'https://example.com/blog/photo-jpg',
      'https://example.com/guide.json',
      'https://notytimg.com/page',
      'https://real.example/page'
    ]]))));
    expect(reads(doc)).toEqual([
      ['record', 'https://example.com/blog/photo-jpg'],
      ['record', 'https://example.com/guide.json'],
      ['record', 'https://notytimg.com/page'],
      ['record', 'https://real.example/page']
    ]);
  });

  it('counts a site with a path or a query as a page, and a site alone as nothing', () => {
    const doc = frag(box('<p>Answer.</p>' + record('[["https://g.example/","https://h.example/?q=1","https://i.example/a"]]')));
    expect(reads(doc)).toEqual([['record', 'https://h.example/?q=1'], ['record', 'https://i.example/a']]);
  });

  it('reads links and records in the overview\'s own order, a source\'s link and its record side by side', () => {
    const doc = frag(box(
      '<p>Answer.</p>' +
      '<a href="https://one.example/page" aria-label="One">One</a>' + record('[["https://two.example/page"]]') +
      '<div><a href="https://three.example/page" aria-label="Three">Three</a></div>' +
      record('[["https://four.example/page","https://five.example/page"]]') +
      '<a href="https://six.example/page" aria-label="Six">Six</a>'));
    expect(reads(doc)).toEqual([
      ['link', 'https://one.example/page'],
      ['record', 'https://two.example/page'],
      ['link', 'https://three.example/page'],
      ['record', 'https://four.example/page'],
      ['record', 'https://five.example/page'],
      ['link', 'https://six.example/page']
    ]);
    // The citations are the same walk without the cards.
    expect(S.aiOverviewCitations(doc).map((c) => c.url)).toEqual(S.aiOverviewSources(doc).map((c) => c.url));
  });

  it('walks each box in turn, and still puts the cards after every link and record', () => {
    const doc = frag(
      box('<a href="https://a.example/1" aria-label="A1">A1</a>' + record('[["https://a.example/2"]]') +
        panel(card('Card Z', '/goto?url=Z', `<img src="${favicon('https://z.example')}">`))) +
      '<div data-subtree="aimc"><a href="https://b.example/1" aria-label="B1">B1</a></div>');
    expect(reads(doc)).toEqual([
      ['link', 'https://a.example/1'],
      ['record', 'https://a.example/2'],
      ['link', 'https://b.example/1'],
      ['card site', 'https://z.example']
    ]);
  });

  it('reads a page whose record comes before its link from the link: the title, in the record\'s place', () => {
    const doc = frag(box(
      record('[["https://first.example/page"]]') + '<a href="https://other.example/x" aria-label="Other">Other</a>' +
      '<a href="https://first.example/page#:~:text=hi" aria-label="First page">First</a>'));
    expect(S.aiOverviewSources(doc)).toEqual([
      { url: 'https://first.example/page', domain: 'first.example', title: 'First page', read: 'link' },
      { url: 'https://other.example/x', domain: 'other.example', title: 'Other', read: 'link' }
    ]);
  });

  it('counts a page once when a record\'s text-fragment address sits beside a direct link to it', () => {
    const doc = frag(box('<p>Answer.</p><a href="https://j.example/page" aria-label="J page">J</a>' +
      record('[["https://j.example/page#:~:text=some%20words"]]') + record('[["https://j.example/page"]]')));
    expect(S.aiOverviewSources(doc)).toEqual([
      { url: 'https://j.example/page', domain: 'j.example', title: 'J page', read: 'link' }
    ]);
  });

  it('finds an address however deep the record nests it, and does not choke on a very deep one', () => {
    const deep = '['.repeat(20000) + '"https://deep.example/page"' + ']'.repeat(20000);
    expect(reads(frag(box('<p>Answer.</p>' + record(deep))))).toEqual([['record', 'https://deep.example/page']]);
    const keyed = '{"a":[{"b":"https://keyed.example/page"}]}';
    expect(reads(frag(box('<p>Answer.</p>' + record(keyed))))).toEqual([['record', 'https://keyed.example/page']]);
  });

  it('reads records inside the shown box only', () => {
    const doc = frag(box('<p>Answer.</p>') + record('[["https://outside.example/page"]]') +
      '<div hidden>' + box(record('[["https://hidden.example/page"]]')) + '</div>');
    expect(S.aiOverviewSources(doc)).toEqual([]);
  });
});

describe('reading a side-panel card', () => {
  it('takes the site from the card\'s image, src or data-src', () => {
    const doc = frag(box('<p>Answer.</p>' + panel(
      card('Card one', '/goto?url=C1', `<img src="${favicon('https://one.example')}">`),
      card('Card two', '/goto?url=C2', `<img src="data:image/gif;base64,AAAA" data-src="${favicon('https://two.example/some/path')}">`))));
    expect(S.aiOverviewSources(doc)).toEqual([
      { url: 'https://one.example', domain: 'one.example', title: 'Card one', read: 'card site' },
      { url: 'https://two.example', domain: 'two.example', title: 'Card two', read: 'card site' }
    ]);
  });

  it('takes it from the card\'s own record when the image has none', () => {
    const own = record(JSON.stringify([['id', null, 'https://encrypted-tbn1.gstatic.com/faviconV2?url=https://own.example&client=AIM&size=128']]));
    const doc = frag(box('<p>Answer.</p>' + panel(card('Own record card', '/goto?url=C1', `<img>${own}`))));
    expect(reads(doc)).toEqual([['card site', 'https://own.example']]);
  });

  it('takes it from a record elsewhere in the box whose array begins with the card\'s title', () => {
    const elsewhere = record(JSON.stringify([['id', ['Titled card', 'A snippet...', 'https://encrypted-tbn1.gstatic.com/faviconV2?url=https://titled.example&client=AIM', 'https://titled.example']]]));
    const decoy = record(JSON.stringify([['Another title', 'x', 'https://encrypted-tbn1.gstatic.com/faviconV2?url=https://decoy.example&client=AIM']]));
    const doc = frag(box('<p>Answer.</p>' + decoy + elsewhere + panel(card('Titled card', '/goto?url=C1', '<img>'))));
    expect(S.aiOverviewSources(doc)).toEqual([
      { url: 'https://titled.example', domain: 'titled.example', title: 'Titled card', read: 'card site' }
    ]);
  });

  it('prefers the image, then the card\'s own record, then the title\'s record', () => {
    const own = record(JSON.stringify([['https://encrypted-tbn1.gstatic.com/faviconV2?url=https://record-site.example&client=AIM']]));
    const titled = record(JSON.stringify([['Order card', 'x', 'https://encrypted-tbn1.gstatic.com/faviconV2?url=https://title-site.example&client=AIM']]));
    const withImg = frag(box(titled + panel(card('Order card', '/goto?url=C1', `<img src="${favicon('https://image-site.example')}">${own}`))));
    expect(reads(withImg)).toEqual([['card site', 'https://image-site.example']]);
    const noImg = frag(box(titled + panel(card('Order card', '/goto?url=C1', `<img>${own}`))));
    expect(reads(noImg)).toEqual([['card site', 'https://record-site.example']]);
    const titleOnly = frag(box(titled + panel(card('Order card', '/goto?url=C1', '<img>'))));
    expect(reads(titleOnly)).toEqual([['card site', 'https://title-site.example']]);
  });

  it('is no entry when nothing names the card\'s site', () => {
    const decoy = record(JSON.stringify([['A different title', 'x', 'https://encrypted-tbn1.gstatic.com/faviconV2?url=https://decoy.example&client=AIM']]));
    const doc = frag(box('<p>Answer.</p>' + decoy + panel(
      card('No site card', '/goto?url=C1', '<img src="https://example.com/logo.png">'),
      card('', '/goto?url=C2', '<img>'))));
    expect(S.aiOverviewSources(doc)).toEqual([]);
  });

  it('is not a favicon unless the path ends /faviconV2 and the address names a site', () => {
    const doc = frag(box('<p>Answer.</p>' + panel(
      card('Wrong path', '/goto?url=C1', '<img src="https://encrypted-tbn0.gstatic.com/images?url=https://wrong.example&faviconV2">'),
      card('No site', '/goto?url=C2', '<img src="https://encrypted-tbn0.gstatic.com/faviconV2?client=AIM">'),
      card('Not a site', '/goto?url=C3', '<img src="https://encrypted-tbn0.gstatic.com/faviconV2?url=not-an-address">'),
      card('Google itself', '/goto?url=C4', '<img src="https://encrypted-tbn0.gstatic.com/faviconV2?url=https://www.google.com/search">'))));
    expect(S.aiOverviewSources(doc)).toEqual([]);
  });

  it('drops a card when a link or a record names a page on its site', () => {
    const doc = frag(box('<p>Answer.</p><a href="https://linked.example/page" aria-label="Linked page">x</a>' +
      record('[["https://recorded.example/page"]]') + panel(
      card('Linked card', '/goto?url=C1', `<img src="${favicon('https://linked.example')}">`),
      card('Recorded card', '/goto?url=C2', `<img src="${favicon('https://www.recorded.example')}">`),
      card('Unnamed card', '/goto?url=C3', `<img src="${favicon('https://unnamed.example')}">`))));
    expect(reads(doc)).toEqual([
      ['link', 'https://linked.example/page'],
      ['record', 'https://recorded.example/page'],
      ['card site', 'https://unnamed.example']
    ]);
  });

  it('keeps two cards on one site that have different titles, and one card listed twice once', () => {
    const img = `<img src="${favicon('https://shared.example')}">`;
    const doc = frag(box('<p>Answer.</p>' + panel(
      card('First article', '/goto?url=C1', img),
      card('Second article', '/goto?url=C2', img),
      card('First article', '/goto?url=C3', img))));
    expect(S.aiOverviewSources(doc).map((s) => [s.read, s.url, s.title])).toEqual([
      ['card site', 'https://shared.example', 'First article'],
      ['card site', 'https://shared.example', 'Second article']
    ]);
  });

  it('reads a card whose href is a direct address as a link, once', () => {
    const doc = frag(box('<p>Answer.</p>' + panel(
      card('Direct card', 'https://direct.example/page', `<img src="${favicon('https://direct.example')}">`),
      card('Direct card', 'https://direct.example/page', `<img src="${favicon('https://direct.example')}">`))));
    expect(S.aiOverviewSources(doc)).toEqual([
      { url: 'https://direct.example/page', domain: 'direct.example', title: 'Direct card', read: 'link' }
    ]);
  });

  it('reads a card only inside the do-not-copy panel, with a label and a link through Google', () => {
    const doc = frag(box('<p>Answer.</p>' +
      `<ul><li><a aria-label="Outside the panel" href="/goto?url=C1"></a><img src="${favicon('https://outside.example')}"></li></ul>` +
      `<div data-ignore-copy><ul><li><a href="/goto?url=C2"></a><img src="${favicon('https://nolabel.example')}"></li>` +
      `<li><a aria-label="Plain link" href="/search?q=x"></a><img src="${favicon('https://plain.example')}"></li></ul></div>`));
    expect(S.aiOverviewSources(doc)).toEqual([]);
  });

  it('shortens a long label to 200 characters and collapses its spaces', () => {
    const doc = frag(box('<p>Answer.</p>' + panel(card('A   long\n title ' + 'x'.repeat(300), '/goto?url=C1', `<img src="${favicon('https://long.example')}">`))));
    const [only] = S.aiOverviewSources(doc);
    expect(only.title).toHaveLength(200);
    expect(only.title.startsWith('A long title xxx')).toBe(true);
  });

  it('leaves this extension\'s own bar out of every kind of source', () => {
    const doc = frag(box('<p>Answer.</p><div class="sbw-serp-bar"><a href="https://seobandwagon.com/pricing">Analyze</a>' +
      panel(card('Bar card', '/goto?url=C1', `<img src="${favicon('https://bar-card.example')}">`)) + '</div>'));
    expect(S.aiOverviewSources(doc)).toEqual([]);
  });
});

describe('the AI Overview citation reads and titles in the export', () => {
  const quoted = 'He said "fast, cheap" | Best';
  const csvRow = (line) => {
    const cells = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') inQuotes = false; else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cell); cell = ''; } else cell += ch;
    }
    cells.push(cell);
    return cells;
  };

  it('keeps a title with quotes, a comma and our own separator whole, one line to a result', () => {
    const doc = frag(box('<p>=SUM(A1) is a formula, not an answer.</p>' +
      panel(card(quoted, '/goto?url=C1', `<img src="${favicon('https://quoted.example')}">`))));
    const ctx = S.searchContext({ search: '?q=x' }, doc);
    const rows = [{ position: 1, url: 'https://a.example/', domain: 'a.example', title: 'A' }, { position: 2, url: 'https://b.example/', domain: 'b.example', title: 'B' }];
    const lines = S.resultsToCsv(rows, ctx).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    const header = csvRow(lines[0]);
    const at = header.indexOf('AI Overview citation titles (JSON)');
    expect(at).toBeGreaterThan(-1);
    expect(header.indexOf('AI Overview citations read from')).toBe(at - 1);
    lines.slice(1).forEach((line) => {
      const cells = csvRow(line);
      expect(cells).toHaveLength(header.length);
      expect(JSON.parse(cells[at])).toEqual([quoted]);
      expect(cells[at - 1]).toBe('card site');
      expect(cells[header.indexOf('AI Overview text')].startsWith('\'=SUM(A1)')).toBe(true);
    });
  });

  it('is empty, not "[]", where the page has no sources, and where there is no page', () => {
    expect(S.searchContext({ search: '?q=x' }, frag(box('<p>Answer with no sources.</p>'))))
      .toMatchObject({ aiCitations: '', aiCitationReads: '', aiCitationTitles: '', aiState: 'loaded' });
    expect(S.searchContext({ search: '?q=x' }, saved('serp-google-goto-links.html')))
      .toMatchObject({ aiCitations: '', aiCitationReads: '', aiCitationTitles: '', aiState: 'none' });
    expect(S.searchContext({ search: '?q=x' })).toMatchObject({ aiCitations: '', aiCitationReads: '', aiCitationTitles: '' });
  }, 30000);

  it('ends the header with the two new columns, after the extension version', () => {
    const header = S.resultsToCsv([], {}).replace(/^\uFEFF/, '').trim().split(',');
    expect(header.slice(-3)).toEqual(['Extension version', 'AI Overview citations read from', 'AI Overview citation titles (JSON)']);
    expect(Object.keys(S.collectContext({ aiCitationReads: 'link', aiCitationTitles: '["t"]' })))
      .toEqual(expect.arrayContaining(['aiCitationReads', 'aiCitationTitles']));
    expect(S.collectContext({ aiCitationReads: 'link', aiCitationTitles: '["t"]' }))
      .toMatchObject({ aiCitationReads: 'link', aiCitationTitles: '["t"]' });
  });
});

describe('a hidden stale AI Overview', () => {
  it('is no source: 1.13.2 listed the links of a box nobody could see', () => {
    const doc = frag('<div data-subtree="aimc" style="display:none"><p>Stale.</p><a href="https://stale.example/page">Stale</a>' +
      record('[["https://stale.example/record"]]') + '</div>');
    expect(S.aiOverviewCitations(doc)).toEqual([]);
    expect(S.aiOverviewSources(doc)).toEqual([]);
    expect(S.searchContext({ search: '?q=x' }, doc)).toMatchObject({ aiState: 'none', aiCitations: '', features: '' });
  });
});
