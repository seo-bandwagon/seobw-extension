// SEO Bandwagon — collect Google result pages into one ranked list (#45)
//
// Google ignores &num=, so a top 50 means five pages, and each page numbers
// its results from 1. A person adds each page with "Add this page" on the
// results overlay, and moves on with Google's own Next link: nothing here
// fetches or walks pages by itself (the owner's rule: a human in the loop,
// since Google's terms rule out automated scraping). This module only keeps
// what was added and combines it:
//   - pages are ordered by Google's offset (`start=`), whatever order they
//     were added in;
//   - a result that already appeared on an earlier page is a repeat (pages
//     overlap and reshuffle between loads) and is left out of the list.
//     1.10.2: matched on the result's link (`matchKey`): its URL when Google
//     shows it, else the link Google rendered. Signed out, Google links most
//     results through an opaque redirect and only the site's home address is
//     known, so two results from one site looked like one and the second
//     was dropped;
//   - every kept row gets an absolute position, counted in page order. It's
//     exact while every page before it was added, and blank after a missing
//     page. The approximate column counts the organic results on the earlier
//     pages, 10 for a page that wasn't added (`earlierOrganic`; until 1.10.2
//     it was Google's offset plus the position);
//   - adding a page again replaces it, and the rows whose position changed
//     say from where: the "second pass" that shows how stable the results are.
// The worker keeps collections in chrome.storage.session
// (src/background/service-worker.js, `serpCollect`); nothing is sent.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpCollect = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const MAX_PAGES = 10;
  const PAGE_SIZE = 10; // Google's `start` step; only used to name a page

  // The search a page belongs to: the same query, market and filter. Pages of
  // "Web results only" and of all results never mix. Google's Web filter has
  // been written both `udm=14` and `udm=web` (1.10.2): one filter, one key.
  function collectionKey(search) {
    const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const q = (p.get('q') || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!q) return null;
    return JSON.stringify({
      q,
      gl: (p.get('gl') || '').toLowerCase(),
      hl: (p.get('hl') || '').toLowerCase(),
      uule: p.get('uule') || '',
      udm: (p.get('udm') || '').toLowerCase().replace(/^14$/, 'web')
    });
  }

  function emptyCollection(key) {
    return { key, pages: [], updatedAt: 0 };
  }

  function pageNumber(start) {
    return Math.floor((Number(start) || 0) / PAGE_SIZE) + 1;
  }

  // What makes two rows the same result. A row whose URL is only the site's
  // home address (`urlResolved: false`) or isn't known at all
  // (`siteUnknown`) is told apart by its link; the overlay adds `link`, the
  // href Google rendered, to every row it sends.
  function matchKey(r) {
    if (!r) return '';
    if (r.url && r.urlResolved !== false && !r.siteUnknown) return r.url;
    return r.link || r.url || '';
  }

  // Organic results on the pages before `start`: each added page's own
  // count, and Google's 10 for one that wasn't added.
  function earlierOrganic(collection, start) {
    const page = pageNumber(start);
    const added = new Map(((collection && collection.pages) || []).map(p => [p.page, p.rows.length]));
    let n = 0;
    for (let k = 1; k < page; k++) n += added.has(k) ? added.get(k) : PAGE_SIZE;
    return n;
  }

  // `page`: { start, rows: [{ position, url, domain, title, … }], context: { capturedAt, resultStats, … } }
  // → { collection, added: 'new' | 'replaced', moved, error? }
  function addPage(collection, page, now = Date.now()) {
    const c = collection && Array.isArray(collection.pages) ? collection : emptyCollection(collection && collection.key);
    const start = Math.max(0, Number(page && page.start) || 0);
    const rows = (page && Array.isArray(page.rows) ? page.rows : [])
      .filter(r => matchKey(r))
      .map((r, i) => Object.assign({}, r, { position: Number(r.position) || i + 1 }));
    if (!rows.length) return { collection: c, error: 'empty' };

    const existing = c.pages.find(p => p.start === start);
    if (!existing && c.pages.length >= MAX_PAGES) return { collection: c, error: 'full' };

    let moved = 0;
    if (existing) {
      const before = new Map(existing.rows.map(r => [matchKey(r), r.position]));
      rows.forEach(r => {
        const was = before.get(matchKey(r));
        if (was === undefined) { r.previously = 'new'; moved += 1; }
        else if (was !== r.position) { r.previously = was; moved += 1; }
      });
    }
    const next = {
      start,
      page: pageNumber(start),
      addedAt: now,
      times: existing ? existing.times + 1 : 1,
      moved,
      rows,
      context: Object.assign({}, page.context || {})
    };
    const pages = c.pages.filter(p => p.start !== start).concat(next).sort((a, b) => a.start - b.start);
    return { collection: Object.assign({}, c, { pages, updatedAt: now }), added: existing ? 'replaced' : 'new', moved };
  }

  function removePage(collection, start) {
    return Object.assign({}, collection, { pages: (collection.pages || []).filter(p => p.start !== start) });
  }

  // → { rows, summary }. Rows carry their page's own context (captured time,
  // result stats, related searches, PAA), so one export describes each page.
  function combine(collection) {
    const pages = (collection && collection.pages ? collection.pages.slice() : []).sort((a, b) => a.start - b.start);
    const seen = new Map(); // matchKey -> page number it was kept from
    const out = [];
    const missing = [];
    let absolute = 0;
    let exact = true;
    let expected = 1;
    let repeats = 0;
    const repeatsByPage = new Map();

    pages.forEach(pg => {
      for (let n = expected; n < pg.page; n++) missing.push(n);
      if (pg.page > expected) exact = false;
      expected = pg.page + 1;
      let pageRepeats = 0;
      const before = earlierOrganic(collection, pg.start);
      pg.rows.forEach(r => {
        const key = matchKey(r);
        if (seen.has(key)) { pageRepeats += 1; return; }
        seen.set(key, pg.page);
        absolute += 1;
        const notes = [];
        if (!exact) notes.push('After a page that was not added: absolute position unknown');
        if (r.previously === 'new') notes.push('New on this page since it was last added');
        else if (r.previously !== undefined) notes.push(`Was position ${r.previously} on this page before it was added again`);
        out.push(Object.assign({}, pg.context, r, {
          page: pg.page,
          start: pg.start,
          absoluteExact: exact ? absolute : '',
          absoluteApprox: before + r.position,
          notes: notes.join('; ')
        }));
      });
      repeats += pageRepeats;
      repeatsByPage.set(pg.start, pageRepeats);
    });

    return {
      rows: out,
      summary: {
        pages: pages.map(p => ({ page: p.page, start: p.start, results: p.rows.length, repeats: repeatsByPage.get(p.start), times: p.times, moved: p.moved })),
        results: out.length,
        repeats,
        missing,
        exact: out.filter(r => r.absoluteExact !== '').length
      }
    };
  }

  // One line for the toolbar and the popup.
  function describe(summary) {
    if (!summary || !summary.pages.length) return 'No pages added yet.';
    const nums = summary.pages.map(p => p.page);
    const parts = [`Page${nums.length === 1 ? '' : 's'} ${nums.join(', ')} added: ${summary.results} result${summary.results === 1 ? '' : 's'}`];
    if (summary.repeats) parts.push(`${summary.repeats} repeat${summary.repeats === 1 ? '' : 's'} from earlier pages left out`);
    if (summary.missing.length) parts.push(`page ${summary.missing.join(', ')} not added, so positions after it are unknown`);
    return parts.join(' · ') + '.';
  }

  return { MAX_PAGES, collectionKey, emptyCollection, addPage, removePage, combine, describe, pageNumber, matchKey, earlierOrganic };
});
