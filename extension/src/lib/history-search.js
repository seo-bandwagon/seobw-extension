// SEO Bandwagon — History search (#62)
//
// Until 1.7.9 the History page matched the typed text against the URL only,
// as one substring: "local seo" missed https://seobandwagon.com/local-seo
// (a space isn't a hyphen) and no title was searched. Now every word typed
// must appear in the capture's URL, host or page title, with spaces,
// hyphens, underscores, dots and slashes treated alike.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWHistorySearch = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  function fold(s) {
    return String(s || '').toLowerCase().replace(/[\s\-_./]+/g, ' ').trim();
  }

  function haystack(c) {
    const title = (c && ((c.meta && c.meta.title && c.meta.title.text) || (c.content && c.content.title))) || '';
    let host = '';
    try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch (_) { /* not a URL */ }
    return ' ' + fold([c && c.url, host, title].join(' ')) + ' ';
  }

  function matches(capture, query) {
    const words = fold(query).split(' ').filter(Boolean);
    if (!words.length) return true;
    const hay = haystack(capture);
    return words.every(w => hay.includes(w));
  }

  function filter(captures, query) {
    return (captures || []).filter(c => matches(c, query));
  }

  return { matches, filter, fold };
});
