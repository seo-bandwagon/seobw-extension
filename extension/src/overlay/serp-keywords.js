// SEO Bandwagon — keyword data on Google (1.13.0, #68)
//
// Runs after serp-overlay.js on the same Google results pages. Additive
// only, as the overlay is: it never hides, moves, covers or restyles an ad
// or any of Google's UI, and nothing goes above Google's top ads.
//
//   - One strip above the results, under the search box (and under any top
//     ads, which it never moves; above the panel when the panel is at the
//     top): for the search, DataForSEO's monthly searches, difficulty, cost
//     per click, competition and 12-month trend, on a click ("Show keyword
//     data", the default) or with the page, by setting.
//   - The search's related searches and People also ask questions get their
//     monthly searches in the same request (50 keywords at most): a small
//     label beside each on Google's page, and a list in the strip.
//   - "Add to my keywords" puts the search, or any related search or
//     question, into the account's rank tracker: with several trackers it
//     asks which; with none it links to making one on the dashboard.
//   - If the rank tracker already tracks the search, the result of the
//     tracked site gets its position history on its bar.
//
// The search itself leaves the browser here, for the first time in the
// extension's life, so: nothing without a key ("Connect free"), and nothing
// before the person's yes to keyword data's own disclosure, asked on the
// first click here or with the button in Options (src/lib/consent.js,
// `keywordData`). The worker sends; this script never calls a site itself.
// A search with an operator (site:, inurl: and the rest) gets no strip.
//
// 1.13.3: a tab the AI Overview study opened gets none of it: no strip, no
// labels, no request. The overlay asks the worker whether this is such a tab
// (globalThis.SBWSerpStudy.ready, set when serp-overlay.js loads) and this
// waits for the answer before it shows or asks anything.

(function () {
  'use strict';

  const S = globalThis.SBWSerp;
  const K = globalThis.SBWSerpKeywords;
  const F = globalThis.SBWSerpFigures;
  const Settings = globalThis.SBWSerpSettings;
  if (!S || !K || !F || !Settings) return;

  const DEBOUNCE_MS = 600;
  // Only what passes on its own (a 429, the site busy, offline): a 500 may
  // have counted against the allowance already, so it waits for a click.
  const RETRY_CODES = ['rate_limited', 'unavailable', 'network'];
  const MAX_RETRIES = 3;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let settings = Settings.defaults();
  // 1.13.3: the study answer is in (nothing without SBWSerpStudy to wait
  // for), and this is a study tab.
  let studyChecked = !globalThis.SBWSerpStudy;
  let studyTab = false;
  let strip = null;
  // { hasKey, accepted } from the worker (read there, nothing sent), or null.
  let ready = null;
  // 'idle' | 'loading' | 'ok' | 'no_key' | 'needs_consent' | 'consent' (the
  // disclosure shown) | 'declined' | 'error' (with `code`)
  let state = { state: 'idle' };
  let wanted = false;       // "Show keyword data" was clicked
  let inFlight = false;
  let standing = null;      // { plan, allowance, lookups, notice, market }
  let tracked = null;
  const figures = new Map(); // keyword → figures
  let asked = { search: null, items: [], keywords: [], skipped: [] };
  const adds = new Map();   // keyword → { state, trackers?, code? }
  let pendingYes = null;    // what the disclosure's yes goes on to do
  let accepting = false;    // the yes is on its way to the worker
  let epoch = 0;            // raised when the account changes: older answers are dropped
  let retries = 0;
  let retryTimer = null;
  let rescanTimer = null;
  let observer = null;
  const badges = new WeakMap(); // Google's element → our label

  // ---------- helpers ----------

  function send(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, (reply) => {
        if (chrome.runtime.lastError) { cb && cb(undefined, true); return; }
        cb && cb(reply, false);
      });
      return true;
    } catch (e) {
      cb && cb(undefined, true); // extension reloaded under this page
      return false;
    }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // A click the person made. A page script's click (or another extension's)
  // is not trusted, and never sends anything or says yes.
  function trusted(e) {
    return !!(e && e.isTrusted === true);
  }

  function button(label, cls, onClick, title) {
    const b = el('button', cls || 'sbw-btn', label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function query() {
    try { return new URLSearchParams(window.location.search).get('q') || ''; } catch (e) { return ''; }
  }

  function market() {
    return K.marketOf(window.location, document);
  }

  function currentRequest() {
    return K.request(query(), S.parseRelatedSearches(document), S.parsePaa(document));
  }

  function figuresOf(keyword) {
    return figures.get(keyword) || null;
  }

  // The overlay's look (Match Google, Night or Day), read from it.
  function lookName() {
    const O = globalThis.SBWSerpOverlay;
    return O && typeof O.lookName === 'function' ? O.lookName() : 'google-light';
  }

  function openPage(page) {
    send({ action: 'serpOpen', page });
  }

  function marketTitle() {
    const m = standing && standing.market;
    const g = market();
    const parts = [];
    if (g.gl) parts.push(`country ${g.gl.toUpperCase()}`);
    if (g.hl) parts.push(`language ${g.hl}`);
    if (m && m.locationCode) parts.push(`DataForSEO location ${m.locationCode}${m.languageCode ? ', ' + m.languageCode : ''}`);
    return parts.length ? ` For ${parts.join(', ')}.` : '';
  }

  // ---------- the strip ----------

  function enabled() {
    return studyChecked && !studyTab && settings.overlay && settings.keywordsOn && !!asked.search;
  }

  // Above the results: before #search (#rso, #rcnt on pages without it),
  // and before the panel when the panel sits at the top. Top ads come
  // before #search on Google's page, so they stay where they are.
  function placeStrip() {
    if (!strip) return;
    const container = document.querySelector('#search') || document.querySelector('#rso') || document.querySelector('#rcnt');
    if (!container || !container.parentNode) return;
    let first = container;
    while (first.previousElementSibling && first.previousElementSibling !== strip &&
      first.previousElementSibling.classList.contains('sbw-serp-tools')) {
      first = first.previousElementSibling;
    }
    if (strip.nextElementSibling !== first) first.insertAdjacentElement('beforebegin', strip);
  }

  function ensureStrip() {
    if (strip && strip.isConnected) { placeStrip(); return strip; }
    strip = el('section', 'sbw-serp-keywords');
    strip.setAttribute('aria-label', 'SEO Bandwagon keyword data');
    strip.setAttribute('data-sbw-look', lookName());
    placeStrip();
    return strip;
  }

  function removeAll() {
    if (strip) strip.remove();
    strip = null;
    document.querySelectorAll('.sbw-kw-badge, .sbw-kw-tracked').forEach((n) => n.remove());
  }

  function chip(text, title, key) {
    const c = el('span', 'sbw-kw-chip', text);
    if (title) c.title = title;
    if (key) c.setAttribute('data-kw', key);
    return c;
  }

  function spark(values, invert, label) {
    const d = K.sparkPath(values, 60, 16, invert);
    if (!d) return null;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sbw-kw-spark');
    svg.setAttribute('viewBox', '0 0 60 16');
    svg.setAttribute('width', '60');
    svg.setAttribute('height', '16');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function searchChips(box, f) {
    const mt = marketTitle();
    const asOf = f.fetchedAt ? ` As of ${f.fetchedAt.slice(0, 10)}.` : '';
    box.appendChild(chip(K.volumeText(f.volume).replace('/mo', ' searches/mo'),
      f.volume === null ? `${K.SOURCE} has no monthly search figure for this search.${mt}` : `${K.SOURCE}: about ${Math.round(f.volume).toLocaleString('en-US')} searches a month, averaged over the last 12 months.${mt}${asOf}`, 'volume'));
    box.appendChild(chip(`difficulty ${K.difficultyText(f.difficulty)}`,
      `${K.SOURCE}’s keyword difficulty, 0 to 100: how hard it estimates ranking in the top 10 is, from the links of the pages there.`, 'difficulty'));
    box.appendChild(chip(`CPC ${K.cpcText(f.cpc)}`, `${K.SOURCE} (Google Ads): what advertisers pay a click on average, in US dollars.`, 'cpc'));
    box.appendChild(chip(`competition ${K.competitionText(f.competition)}`, `${K.SOURCE} (Google Ads): how many advertisers bid on this search.`, 'competition'));
    const tw = K.trendWords(f.trend);
    const s = spark(tw.values, false, 'Searches a month over the last 12 months');
    if (s || tw.text) {
      const t = el('span', 'sbw-kw-chip sbw-kw-trend');
      t.setAttribute('data-kw', 'trend');
      t.title = tw.title || `${K.SOURCE}: no monthly trend for this search.`;
      if (s) t.appendChild(s);
      if (tw.text) t.appendChild(document.createTextNode(' ' + tw.text));
      box.appendChild(t);
    }
  }

  function addButton(item, compact) {
    const a = adds.get(item.keyword);
    const st = a && a.state;
    const label = st === 'working' ? 'Adding…'
      : st === 'added' ? 'Added'
        : st === 'already' ? 'In your tracker'
          : compact ? '+ Add' : 'Add to my keywords';
    const b = button(label, compact ? 'sbw-serp-act sbw-kw-add' : 'sbw-btn sbw-kw-add', (e) => addKeyword(item, null, e),
      `Adds “${item.text}” to your SEO Bandwagon rank tracker.`);
    b.setAttribute('data-keyword', item.keyword);
    if (st === 'working' || st === 'added' || st === 'already') b.disabled = true;
    return b;
  }

  function render() {
    if (!enabled()) { removeAll(); return; }
    const box = ensureStrip();
    box.setAttribute('data-sbw-look', lookName());
    box.setAttribute('data-state', state.state);
    box.textContent = '';

    const head = el('div', 'sbw-kw-head');
    head.appendChild(el('span', 'sbw-kw-mark', 'Keyword data'));
    const q = el('span', 'sbw-kw-query', asked.search.text);
    q.title = 'This search, as you typed it.';
    head.appendChild(q);
    const searchBox = el('span', 'sbw-kw-figs');
    searchBox.setAttribute('data-role', 'kw-search');
    head.appendChild(searchBox);
    box.appendChild(head);

    const message = el('div', 'sbw-kw-message');
    message.setAttribute('data-role', 'kw-message');
    message.setAttribute('role', 'status');

    const f = figuresOf(asked.search.keyword);
    const st = state.state;
    if (f) {
      searchChips(searchBox, f);
      const src = el('span', 'sbw-fig-source', K.SOURCE);
      src.title = `Monthly searches, difficulty, cost per click, competition and trend are ${K.SOURCE}’s.${marketTitle()}`;
      head.appendChild(src);
      head.appendChild(addButton(asked.search, false));
    } else if (st === 'loading') {
      searchBox.appendChild(el('span', 'sbw-fig-note', 'Loading keyword data…'));
    } else if (st === 'no_key' || (ready && !ready.hasKey && st !== 'error')) {
      searchBox.appendChild(el('span', 'sbw-fig-note', 'Monthly searches, difficulty, CPC, competition and trend for this search.'));
      head.appendChild(button('Connect free', 'sbw-btn', () => openPage('connect'), 'Connect a free SEO Bandwagon account to see keyword data.'));
    } else if (st === 'needs_consent' || st === 'declined') {
      searchBox.appendChild(el('span', 'sbw-fig-note', 'Keyword data is off: it sends this search to SEO Bandwagon.'));
      head.appendChild(button('Turn on keyword data', 'sbw-btn', (e) => { if (trusted(e)) showDisclosure(() => load(true), true); }));
    } else if (st === 'error') {
      const words = K.errorWords(state.code);
      searchBox.appendChild(el('span', 'sbw-fig-note', words.text + '.'));
      if (words.action === 'connect') head.appendChild(button('Reconnect', 'sbw-btn', () => openPage('connect')));
      if (words.action === 'retry') head.appendChild(button('Try again', 'sbw-btn', (e) => { if (trusted(e)) load(true, { focus: true }); }));
    } else if (st === 'ok') {
      // Answered, but nothing for the search itself: why.
      const n = standing && standing.notice;
      searchBox.appendChild(el('span', 'sbw-fig-note', !n ? `${K.SOURCE} has no figures for this search.`
        : n.kind === 'limit_reached' ? 'No keyword data: the limit is reached.'
          : n.kind === 'paused' ? 'New keyword data paused until next month.'
            : n.kind === 'unsupported_market' ? 'No keyword data for this Google’s country yet.'
              : 'No keyword data this time.'));
    } else if (st !== 'consent') {
      searchBox.appendChild(el('span', 'sbw-fig-note', 'Monthly searches, difficulty, CPC, competition and trend for this search, and volumes for its related searches and People also ask.'));
      head.appendChild(button('Show keyword data', 'sbw-btn', (e) => { if (trusted(e)) load(true, { focus: true }); },
        'Sends this search, its related searches and People also ask questions to SEO Bandwagon for DataForSEO’s figures.'));
    }

    if (st === 'consent') message.appendChild(disclosure());
    renderAddMessage(message);
    if (message.childNodes.length) box.appendChild(message);

    const line = trackedLine();
    if (line) box.appendChild(line);
    if (f) box.appendChild(moreList());
    box.appendChild(foot());

    placeBadges();
    decorateBars();
  }

  // ---------- the first-use disclosure ----------

  // `focus` only inside the person's own click: a disclosure opened any
  // other way never takes the focus, so a keystroke meant for Google's
  // search box can't land on its yes.
  function showDisclosure(then, focus) {
    pendingYes = then;
    state = { state: 'consent' };
    render();
    const yes = strip && strip.querySelector('[data-role="kw-yes"]');
    if (yes && focus === true) yes.focus();
  }

  function disclosure() {
    const d = el('div', 'sbw-kw-disclosure');
    d.setAttribute('data-role', 'kw-disclosure');
    d.appendChild(el('p', 'sbw-kw-disclosure-title', 'Send your searches for keyword data?'));
    d.appendChild(el('p', null, 'Keyword data sends SEO Bandwagon the words of this search, with its related searches and People also ask questions (up to 50), and this Google’s country and language. Each search after this sends the same when you click Show keyword data, or with the page if you choose that in Settings; “Add to my keywords” sends the one you add. Never a result’s address with them, and never a request to Google.'));
    d.appendChild(el('p', null, 'SEO Bandwagon answers with DataForSEO’s monthly searches, difficulty, cost per click, competition and 12-month trend, and your own rank tracker’s history for the search. Each search with new keyword data counts against your plan’s daily allowance. You can stop it in Settings at any time.'));
    const row = el('div', 'sbw-kw-actions');
    const yes = button('Yes, send my searches for keyword data', 'sbw-btn sbw-kw-yes', onYes);
    yes.setAttribute('data-role', 'kw-yes');
    row.appendChild(yes);
    row.appendChild(button('Not now', 'sbw-btn', () => {
      // Ends what the click asked for: a yes given later elsewhere sends
      // nothing from this page until it is clicked again.
      pendingYes = null;
      wanted = false;
      cancelRetry();
      state = { state: 'declined' };
      render();
    }));
    row.appendChild(button('Privacy and settings', 'sbw-serp-act', () => openPage('keyword-settings')));
    d.appendChild(row);
    return d;
  }

  // Only the person's own click says yes: a click a page script made
  // (`isTrusted` false) is not one.
  function onYes(e) {
    if (!e || e.isTrusted !== true) return;
    const then = pendingYes;
    pendingYes = null;
    accepting = true;
    send({ action: 'serpKeywordsAccept' }, (reply) => {
      accepting = false;
      if (reply && reply.ok) {
        ready = Object.assign({}, ready || {}, { accepted: true });
        if (inFlight) return;
        state = { state: 'idle' };
        if (then) then(); else render();
      } else {
        // The browser asks for itself (Firefox): Options' button does it.
        state = { state: 'needs_consent' };
        render();
        openPage('keyword-settings');
      }
    });
  }

  // ---------- loading ----------

  // `force`: the person asked (a click, or the popup). `opts.same`: a retry
  // sends what was asked before, never questions opened since. `opts.focus`:
  // called inside the person's own click.
  function load(force, opts) {
    const o = opts || {};
    if (force) wanted = true;
    if (!o.same || !asked.search) asked = currentRequest();
    if (!enabled()) { render(); return; }
    if (inFlight) return;
    cancelRetry();
    if (ready && !ready.hasKey) { state = { state: 'no_key' }; render(); return; }
    if (ready && !ready.accepted && force) { showDisclosure(() => load(true), o.focus === true); return; }
    inFlight = true;
    state = { state: 'loading' };
    render();
    const g = market();
    const mine = epoch;
    const sent = send({
      action: 'serpKeywords',
      query: query(),
      related: asked.items.filter((it) => it.source === 'related').map((it) => it.text),
      paa: asked.items.filter((it) => it.source === 'paa').map((it) => it.text),
      gl: g.gl,
      hl: g.hl
    }, (reply, failed) => {
      inFlight = false;
      if (mine !== epoch) { render(); return; } // another account's answer
      if (failed || !reply) {
        state = { state: 'error', code: 'reloaded' };
      } else if (reply.state === 'ok' || reply.state === 'error') {
        Object.entries(reply.results || {}).forEach(([k, v]) => figures.set(k, v));
        if (reply.tracked !== undefined) tracked = reply.tracked;
        if (reply.state === 'ok') {
          standing = { plan: reply.plan, allowance: reply.allowance, lookups: reply.lookups, notice: reply.notice, market: reply.market };
          state = { state: 'ok' };
          retries = 0;
        } else {
          state = { state: 'error', code: reply.code, retryAfter: reply.retryAfter };
          scheduleRetry(reply.code, reply.retryAfter);
        }
      } else if (reply.state === 'needs_consent') {
        ready = Object.assign({}, ready || {}, { accepted: false });
        if (force) { showDisclosure(() => load(true)); return; }
        state = { state: 'needs_consent' };
      } else if (reply.state === 'no_key') {
        ready = Object.assign({}, ready || {}, { hasKey: false });
        state = { state: 'no_key' };
      } else if (reply.state === 'not_a_keyword') {
        asked = { search: null, items: [], keywords: [], skipped: [] };
      } else {
        state = { state: 'error', code: 'error' };
      }
      render();
    });
    if (!sent) inFlight = false;
  }

  // A 429, a busy site or no connection: asked again on its own a few
  // times, after Retry-After or 30 s, 60 s, 90 s.
  function scheduleRetry(code, retryAfter) {
    if (!RETRY_CODES.includes(code) || retries >= MAX_RETRIES || retryTimer) return;
    retries += 1;
    const wait = code === 'rate_limited' && Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 30000 * retries;
    retryTimer = setTimeout(() => { retryTimer = null; load(false, { same: true }); }, wait);
  }

  // Any new send, a "Not now", a withdrawal or another account ends a
  // pending retry.
  function cancelRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  // ---------- "Add to my keywords" ----------

  // From a click (`e`, trusted only) or from the yes it waited for.
  function addKeyword(item, trackerId, e) {
    if (e !== undefined && !trusted(e)) return;
    if (!enabled()) return; // 1.13.3: never in a study tab, or with the strip off
    if (ready && !ready.accepted) { showDisclosure(() => addKeyword(item, trackerId), true); return; }
    const mine = epoch;
    adds.set(item.keyword, { state: 'working' });
    render();
    const g = market();
    const msg = { action: 'serpKeywordAdd', keyword: item.keyword, gl: g.gl, hl: g.hl };
    if (trackerId !== null && trackerId !== undefined) msg.trackerId = trackerId;
    send(msg, (reply, failed) => {
      if (mine !== epoch) { adds.delete(item.keyword); render(); return; }
      const r = failed || !reply ? { state: 'error', code: 'reloaded' } : reply;
      if (r.state === 'needs_consent') {
        adds.delete(item.keyword);
        showDisclosure(() => addKeyword(item, trackerId));
        return;
      }
      // Added: its rank history, once the tracker has checked it, comes
      // with a later load (the worker forgets the old answer).
      adds.set(item.keyword, Object.assign({ item }, r));
      render();
    });
  }

  // What an add answered that needs words: which tracker, none yet, or an
  // error. One at a time, the latest.
  function renderAddMessage(box) {
    let latest = null;
    adds.forEach((a) => { if (['choose_tracker', 'no_tracker', 'tracker_full', 'tracker_gone', 'error', 'no_key', 'not_a_keyword', 'added'].includes(a.state)) latest = a; });
    if (!latest) return;
    const p = el('div', 'sbw-kw-add-message');
    p.setAttribute('data-role', 'kw-add-message');
    const name = latest.item ? `“${latest.item.text}”` : 'This';
    if (latest.state === 'added') {
      p.appendChild(el('span', null, `${name}: ${K.ADD_WORDS.added}.`));
      p.appendChild(button('Open rank tracker', 'sbw-serp-act', () => openPage('rank-tracker')));
    } else if (latest.state === 'choose_tracker') {
      p.appendChild(el('span', null, `Add ${name} to which rank tracker?`));
      latest.trackers.forEach((t) => {
        const name = t.label && t.label.toLowerCase() !== t.domain ? `${t.label} (${t.domain})` : t.domain;
        p.appendChild(button(name, 'sbw-btn sbw-kw-tracker', (e) => addKeyword(latest.item, t.id, e), `Adds it to the tracker for ${t.domain}.`));
      });
      p.appendChild(button('Cancel', 'sbw-serp-act', () => { adds.delete(latest.item.keyword); render(); }));
    } else if (latest.state === 'no_tracker') {
      p.appendChild(el('span', null, `${K.ADD_WORDS.no_tracker}.`));
      p.appendChild(button('Create a rank tracker', 'sbw-btn', () => openPage('rank-tracker')));
    } else if (latest.state === 'tracker_full') {
      p.appendChild(el('span', null, `${name} wasn’t added: ${K.ADD_WORDS.tracker_full}${latest.limit ? ` (${latest.limit})` : ''}.`));
      p.appendChild(button('Upgrade for more keywords', 'sbw-btn', () => openPage('upgrade')));
      p.appendChild(button('Open rank tracker', 'sbw-serp-act', () => openPage('rank-tracker')));
    } else if (latest.state === 'tracker_gone') {
      p.appendChild(el('span', null, `${name} wasn’t added. ${K.ADD_WORDS.tracker_gone}.`));
    } else if (latest.state === 'no_key') {
      p.appendChild(el('span', null, 'Connect free to add keywords to a rank tracker.'));
      p.appendChild(button('Connect free', 'sbw-btn', () => openPage('connect')));
    } else if (latest.state === 'not_a_keyword') {
      p.appendChild(el('span', null, `${name} can’t be tracked: too long, or a search with an operator.`));
    } else {
      const words = K.errorWords(latest.code);
      p.appendChild(el('span', null, `${name} wasn’t added. ${words.text.replace(/keyword data/, 'keywords')}.`));
      if (words.action === 'connect') p.appendChild(button('Reconnect', 'sbw-btn', () => openPage('connect')));
    }
    box.appendChild(p);
  }

  // ---------- rank history ----------

  function trackedLine() {
    const sum = K.historySummary(tracked);
    if (!sum) return null;
    const line = el('div', 'sbw-kw-tracked-line');
    line.setAttribute('data-role', 'kw-tracked');
    line.title = sum.title;
    line.appendChild(el('span', 'sbw-fig-label', 'Your rank tracker'));
    line.appendChild(el('span', null, `${tracked.domain}: ${sum.text.replace(/^your tracker /, '')}${sum.change ? ', ' + sum.change : ''}`));
    const s = spark(sum.positions, true, 'Your position over time; higher is better');
    if (s) line.appendChild(s);
    return line;
  }

  // The tracked site's result: its position history on its bar (a bar the
  // overlay made carries its site in data-domain).
  function decorateBar(bar, row) {
    if (!bar) return;
    const old = bar.querySelector('.sbw-kw-tracked');
    if (old) old.remove();
    const domain = (row && row.domain) || bar.getAttribute('data-domain');
    if (!enabled() || !tracked || !K.isTrackedSite(domain, tracked)) return;
    const sum = K.historySummary(tracked);
    if (!sum) return;
    const t = el('span', 'sbw-kw-tracked');
    t.title = sum.title;
    t.appendChild(el('span', 'sbw-fig-label', 'Rank history'));
    t.appendChild(el('span', null, sum.text + (sum.change ? ', ' + sum.change : '')));
    const s = spark(sum.positions, true, 'Your position for this search over time; higher is better');
    if (s) t.appendChild(s);
    bar.appendChild(t);
  }

  function decorateBars() {
    document.querySelectorAll('.sbw-serp-bar').forEach((bar) => decorateBar(bar, null));
  }

  // ---------- related searches and People also ask ----------

  function moreList() {
    const items = asked.items.filter((it) => it.source !== 'search');
    const details = el('details', 'sbw-kw-more');
    details.setAttribute('data-role', 'kw-more');
    details.open = true;
    const loaded = items.filter((it) => figuresOf(it.keyword)).length;
    details.appendChild(el('summary', null, items.length
      ? `Related searches and People also ask (${items.length}${loaded < items.length ? `, ${loaded} with data` : ''})`
      : 'No related searches or People also ask on this page'));
    if (!items.length) return details;
    const wrap = el('div', 'sbw-table-wrap');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Related searches and People also ask, with keyword data');
    const table = el('table', 'sbw-table sbw-kw-table');
    const hr = el('tr');
    ['Search', 'From', 'Searches/mo', 'CPC', 'Difficulty', ''].forEach((h, i) => {
      const th = el('th', i === 0 ? 'sbw-th-text' : null, h);
      th.scope = 'col';
      if (i === 5) th.appendChild(el('span', 'sbw-sr', 'Add to my keywords'));
      hr.appendChild(th);
    });
    const thead = el('thead');
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    items.forEach((it) => {
      const f = figuresOf(it.keyword);
      const tr = el('tr');
      tr.setAttribute('data-keyword', it.keyword);
      const th = el('th', 'sbw-th-text', it.text);
      th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(el('td', null, it.source === 'paa' ? 'People also ask' : 'Related'));
      tr.appendChild(el('td', null, f ? K.volumeText(f.volume).replace('/mo', '') : '…'));
      tr.appendChild(el('td', null, f ? K.cpcText(f.cpc) : ''));
      tr.appendChild(el('td', null, f ? K.difficultyText(f.difficulty) : ''));
      const td = el('td');
      td.appendChild(addButton(it, true));
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    details.appendChild(wrap);
    if (asked.skipped.length) {
      details.appendChild(el('p', 'sbw-table-note', `${asked.skipped.length} left out: longer than Google Ads takes (80 characters or 10 words).`));
    }
    return details;
  }

  // A small label beside each related search and People also ask question
  // on Google's page, once its keyword data is in. Never inside a button
  // of Google's: beside it.
  function placeBadges() {
    if (!enabled()) return;
    const put = (entry, source) => {
      const keyword = K.keywordOf(entry.text);
      const f = keyword ? figuresOf(keyword) : null;
      let badge = badges.get(entry.el);
      if (!f) { if (badge) badge.remove(); return; }
      if (!badge || !badge.isConnected) {
        badge = el('span', 'sbw-kw-badge');
        badges.set(entry.el, badge);
        if (source === 'related' && entry.el.tagName !== 'A') entry.el.insertAdjacentElement('beforeend', badge);
        else if (source === 'paa' && entry.kind === 'data-q') entry.el.insertAdjacentElement('afterbegin', badge);
        else entry.el.insertAdjacentElement('afterend', badge);
      }
      badge.setAttribute('data-sbw-look', lookName());
      badge.textContent = K.volumeText(f.volume);
      badge.title = f.volume === null
        ? `${K.SOURCE} has no monthly search figure for “${entry.text}”.`
        : `${K.SOURCE}: about ${Math.round(f.volume).toLocaleString('en-US')} searches a month for “${entry.text}”, CPC ${K.cpcText(f.cpc)}, difficulty ${K.difficultyText(f.difficulty)}.`;
    };
    S.parseRelatedSearchElements(document).forEach((r) => put(r, 'related'));
    S.parsePaaElements(document).forEach((q) => put(q, 'paa'));
  }

  // ---------- the foot: allowance, limits, exports ----------

  function foot() {
    const f = el('div', 'sbw-kw-foot');
    f.setAttribute('data-role', 'kw-foot');
    const line = el('p', 'sbw-figures-line');
    line.setAttribute('data-role', 'kw-allowance');
    const notice = standing && standing.notice;
    const allowance = K.allowanceLine(standing);
    if (notice) {
      line.setAttribute('data-kind', notice.kind);
      line.textContent = notice.text + (allowance ? ' ' + allowance : '');
    } else if (allowance) {
      line.textContent = allowance + ' Keyword data already looked up costs nothing.';
    }
    if (line.textContent) f.appendChild(line);
    if (notice && notice.upgrade) f.appendChild(button('Upgrade for more keyword data', 'sbw-btn', () => openPage('upgrade')));
    // Questions Google opened after the data came: theirs on a click, so
    // opening People also ask never spends the allowance by itself.
    if (state.state === 'ok') {
      const fresh = moreToAsk();
      if (fresh.length) {
        const more = button(`Get volumes for ${fresh.length} more`, 'sbw-btn', (e) => { if (trusted(e)) load(true, { focus: true }); },
          'People also ask opened more questions; this asks for their keyword data.');
        more.setAttribute('data-more', 'true');
        f.appendChild(more);
      }
    }
    if (figures.size) {
      f.appendChild(button('Export keywords CSV', 'sbw-btn', () => {
        const csv = keywordsCsv();
        if (csv) download(csv.text, csv.filename);
      }));
    }
    f.appendChild(button('Settings', 'sbw-panel-link', () => openPage('settings'), 'Keyword data on or off, on a click or with the page, in SEO Bandwagon’s settings.'));
    return f;
  }

  // Keywords on the page without keyword data that a click may ask for:
  // questions opened since, and after a lookup that failed or found the site
  // unavailable, the ones it left without figures.
  function moreToAsk() {
    const again = standing && (standing.lookups === 'failed' || standing.lookups === 'unavailable');
    return currentRequest().keywords.filter((k) => !figures.has(k) && (again || !asked.keywords.includes(k)));
  }

  function download(text, name) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.className = 'sbw-download';
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- what the exports and the popup read ----------

  function keywordsCsv() {
    const items = currentRequest().items;
    if (!items.length) return null;
    const ctx = S.searchContext(window.location, document);
    const slug = (ctx.query || 'search').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'search';
    return { text: K.keywordsToCsv(items, figuresOf, ctx), filename: `serp-keywords-${slug}-${ctx.capturedAt.slice(0, 10)}.csv` };
  }

  function trackedPositionFor(domain) {
    if (!tracked || !K.isTrackedSite(domain, tracked) || !tracked.history.length) return null;
    return tracked.history[tracked.history.length - 1].position;
  }

  function status() {
    const search = asked.search ? figuresOf(asked.search.keyword) : null;
    return {
      on: enabled(),
      state: state.state,
      code: state.code || null,
      hasKey: ready ? !!ready.hasKey : null,
      accepted: ready ? !!ready.accepted : null,
      loaded: figures.size,
      search: search ? { volume: search.volume, difficulty: search.difficulty, cpc: search.cpc, competition: search.competition } : null,
      tracked: tracked ? { domain: tracked.domain, summary: K.historySummary(tracked) } : null,
      plan: standing ? standing.plan : null,
      allowance: standing ? standing.allowance : null,
      lookups: standing ? standing.lookups : null,
      notice: standing ? standing.notice : null
    };
  }

  globalThis.SBWSerpKeywordsView = {
    decorateBar,
    exportContext: () => K.exportContext(currentRequest().items, figuresOf),
    trackedPositionFor,
    keywordsCsv,
    status,
    load: () => load(true)
  };

  // ---------- settings, observe, init ----------

  function askReady(then) {
    send({ action: 'serpKeywordsReady' }, (reply) => {
      ready = reply && typeof reply.hasKey === 'boolean' ? reply : null;
      if (then) then();
    });
  }

  function autoLoad() {
    if (settings.keywordsLoad === 'auto' && ready && ready.hasKey && ready.accepted) load(false);
    else render();
  }

  function applySettings(next) {
    const before = settings;
    settings = next;
    asked = currentRequest();
    if (!enabled()) { removeAll(); return; }
    if (before.keywordsLoad !== next.keywordsLoad || !before.keywordsOn || !before.overlay) {
      if (state.state !== 'ok') { autoLoad(); return; }
    }
    render();
  }

  function rescan() {
    if (!enabled()) return;
    placeStrip();
    placeBadges();
    decorateBars();
    // New questions after the data came: the foot offers them on a click.
    if (state.state === 'ok' && strip) {
      const fresh = moreToAsk().length > 0;
      const offered = !!strip.querySelector('[data-role="kw-foot"] button[data-more]');
      if (fresh !== offered) render();
    }
  }

  function isOwnNode(node) {
    if (!node) return false;
    if (node.nodeType !== 1) return isOwnNode(node.parentElement || node.parentNode);
    if (/(^|\s)sbw-/.test(typeof node.className === 'string' ? node.className : '')) return true;
    return !!(node.closest && node.closest('.sbw-serp-keywords, .sbw-kw-badge, .sbw-serp-bar, .sbw-serp-tools'));
  }

  function startObserver() {
    const target = document.querySelector('#rcnt') || document.body;
    if (!target || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((records) => {
      const own = records.every((r) => isOwnNode(r.target) || (r.addedNodes.length + r.removedNodes.length > 0 &&
        Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).every(isOwnNode)));
      if (own) return;
      if (rescanTimer) clearTimeout(rescanTimer);
      rescanTimer = setTimeout(rescan, DEBOUNCE_MS);
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  async function init() {
    try { settings = await Settings.load(chrome.storage.local); } catch (e) { settings = Settings.defaults(); }
    asked = currentRequest();
    if (!studyChecked) {
      try {
        const study = await globalThis.SBWSerpStudy.ready;
        studyTab = !!(study && study.study === true);
      } catch (e) { studyTab = false; }
      studyChecked = true;
    }
    // A study tab: no strip, no request, and no listener that could ask.
    if (studyTab) return;
    if (enabled()) render();
    askReady(() => { if (enabled()) autoLoad(); });
    startObserver();
    try {
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes[Settings.STORAGE_KEY]) {
            applySettings(Settings.normalize(changes[Settings.STORAGE_KEY].newValue));
          } else if ((area === 'local' && changes.sbwConsent) || (area === 'sync' && changes.apiKey)) {
            // Keyword data accepted or withdrawn in Options, or an account
            // connected: asked again without a reload. A new account never
            // shows the old one's rank history.
            if (area === 'sync') {
              // Another account: the old one's answers in flight are dropped.
              epoch += 1;
              inFlight = false;
              tracked = null;
              standing = null;
              adds.clear();
            }
            cancelRetry();
            retries = 0;
            askReady(() => {
              if (state.state === 'loading' || accepting) return;
              const yes = !!(ready && ready.accepted && ready.hasKey);
              // Said yes in Options while the disclosure the person opened
              // here was waiting: go on with what it was opened for.
              if (yes && state.state === 'consent' && pendingYes) {
                const then = pendingYes;
                pendingYes = null;
                state = { state: 'idle' };
                then();
                return;
              }
              // On a click (the default) a change elsewhere never sends;
              // with the page, it loads as a new page would.
              if (yes && settings.keywordsLoad === 'auto' && state.state !== 'ok' && state.state !== 'declined') load(false);
              else { if (state.state !== 'ok' && state.state !== 'consent' && state.state !== 'declined') state = { state: 'idle' }; render(); }
            });
          }
        });
      }
    } catch (e) { /* no storage events in this context */ }
  }

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'serpLoadKeywords') {
        load(true);
        sendResponse({ ok: true });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
