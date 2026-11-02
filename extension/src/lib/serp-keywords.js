// SEO Bandwagon — keyword data on Google (1.13.0, #68)
//
// Pure logic shared by the keyword strip on Google (src/overlay/serp-keywords.js:
// what it asks for and what it says), the worker (src/lib/serp-keywords-service.js:
// what it sends and keeps for the session) and the popup. No chrome.*, no
// fetch.
//
// The routes (website, extension contract of 2026-11-02), under the key's
// `keywords` scope; a key minted before that scope answers 403 (Reconnect):
//   POST /api/v1/keywords/metrics  { keywords: [the search, ...related
//     searches and People also ask, 50 at most], gl?, hl? } →
//     { source: 'DataForSEO', market: { locationCode, languageCode },
//       results: [{ keyword (as sent), volume, cpc, competition (0 to 1),
//                   difficulty, trend: [{ month: 'YYYY-MM', volume }], fetchedAt }],
//       tracked: { keyword, trackerId, domain, history: [{ date, position }] } | null,
//       plan, allowance, lookups }   (the last three as the figures route's,
//     and `lookups: 'unsupported_market'` for a country DataForSEO has no
//     keyword data for; a `gl` or `hl` the site doesn't know is a 400)
//   POST /api/v1/keywords  { keyword, gl?, hl?, trackerId? } →
//     201 { trackerId, keyword } · 200 { alreadyTracked: true, trackerId } ·
//     409 { error: 'no_tracker' } · 409 { error: 'choose_tracker', trackers: [{ id, domain, label }] } ·
//     404 { error: 'tracker_not_found' } · 403 { error: 'limit_reached', limit }
//   (website change 1d2ba972). The site reads each keyword in its own lookup
//   form (lowercase, punctuation dropped) and tracks it as sent, so the
//   extension sends what Google shows, lowercased: "c# jobs" stays itself.
//
// This is the first thing the extension sends that carries the search
// itself, so it goes only with its own consent (src/lib/consent.js,
// `keywordData`, Firefox's `searchTerms`), accepted with a specific yes.
// Copy rules: volume, cost per click, competition, difficulty and trend are
// labeled as DataForSEO's; the rank history is the person's own tracker's.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpKeywords` when loaded as a content script, classic
// <script> or via importScripts, and exports via CommonJS when loaded by
// Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpKeywords = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const MAX_KEYWORDS = 50;
  // Google Ads, behind DataForSEO's volumes, refuses longer keywords.
  const MAX_CHARS = 80;
  const MAX_WORDS = 10;
  const SOURCE = 'DataForSEO';

  // The figures module (plan, allowance, `lookups`, compact numbers): loaded
  // before this one wherever this one is.
  function figuresLib() {
    if (globalThis.SBWSerpFigures) return globalThis.SBWSerpFigures;
    return typeof require === 'function' ? require('./serp-figures.js') : null;
  }

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function str(v) {
    return typeof v === 'string' && v ? v : null;
  }

  // ---------- what is asked ----------

  // A search with an operator is a query about a site or a file, not a
  // keyword anyone buys or tracks: no keyword data is asked for it.
  const OPERATOR_RE = /(^|\s)-?(site|inurl|allinurl|intitle|allintitle|intext|allintext|filetype|ext|related|cache|info|before|after|define|source|link):/i;

  function hasOperator(text) {
    return OPERATOR_RE.test(String(text || ''));
  }

  /**
   * The site's lookup form of a keyword (website `lookupForm`): lowercase,
   * apostrophes dropped, a question mark and other punctuation read as a
   * space, a period ending a word dropped. Two shown texts with one
   * lookup form are one keyword; past 80 characters or 10 words in it,
   * Google Ads has none.
   */
  function lookupOf(text) {
    return String(text || '').normalize('NFKC').toLowerCase()
      .replace(/['’‘`´]/g, '')
      .replace(/[?¿!¡,;:"“”«»()[\]{}<>|\\^=~@%*]/g, ' ')
      .replace(/\.+(?=\s|$)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * A shown search, question or refinement as it is sent: NFKC, lowercase,
   * whitespace collapsed, its punctuation kept (the site looks it up in its
   * own lookup form and tracks it as sent). '' when it can't be one: empty,
   * an operator search, or past 80 characters or 10 words in lookup form.
   * Answers are matched to what was asked by this same function.
   */
  function keywordOf(text) {
    const s = String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s || hasOperator(s)) return '';
    const look = lookupOf(s);
    if (!look || look.length > MAX_CHARS || look.split(' ').length > MAX_WORDS) return '';
    return s;
  }

  /**
   * The request for one results page: the search first, then its related
   * searches and People also ask questions, each once, 50 in all.
   *   { search: { text, keyword, source: 'search' } | null,
   *     items: [{ text, keyword, source }]   (the search first)
   *     keywords: [keyword, ...]            (what the body carries)
   *     skipped: [{ text, source }] }       (too long, or not a keyword)
   */
  function request(query, related, paa) {
    const keyword = keywordOf(query);
    const search = keyword ? { text: String(query).trim(), keyword, source: 'search' } : null;
    const out = { search, items: [], keywords: [], skipped: [] };
    if (!search) return out;
    const seen = new Set([lookupOf(keyword)]);
    out.items.push(search);
    out.keywords.push(keyword);
    const add = (text, source) => {
      const k = keywordOf(text);
      if (!k) { out.skipped.push({ text: String(text || '').trim(), source }); return; }
      if (seen.has(lookupOf(k)) || out.keywords.length >= MAX_KEYWORDS) return;
      seen.add(lookupOf(k));
      out.items.push({ text: String(text).trim(), keyword: k, source });
      out.keywords.push(k);
    };
    (related || []).forEach((t) => add(t, 'related'));
    (paa || []).forEach((t) => add(t, 'paa'));
    return out;
  }

  // Each Google's own country, for a search without `gl=`: google.co.uk is
  // Britain (gb), google.com.au Australia. google.com names none.
  function countryOfHost(host) {
    const m = /^www\.google\.(.+)$/.exec(String(host || '').toLowerCase());
    if (!m) return '';
    const tld = m[1];
    if (tld === 'com') return '';
    const last = tld.split('.').pop();
    if (!/^[a-z]{2}$/.test(last)) return '';
    return last === 'uk' ? 'gb' : last;
  }

  // A language as the site takes it: "pt-BR", "zh-TW", "es-419", "en";
  // its region kept, since the rank tracker files pt-BR and pt-PT apart.
  const HL_RE = /^([a-z]{2,3})(?:[-_]([a-z0-9]{2,4}))?$/i;

  function languageOf(v) {
    const m = HL_RE.exec(String(v || '').trim());
    if (!m) return '';
    return m[1].toLowerCase() + (m[2] ? '-' + (/^\d+$/.test(m[2]) ? m[2] : m[2].length === 2 ? m[2].toUpperCase() : m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()) : '');
  }

  /**
   * The market of a results page: { gl, hl }, or absent. `gl` two lowercase
   * letters, `hl` a language with its region ("pt-BR"). `gl=` and `hl=` in
   * its address first, then the Google's own country and the page's
   * language.
   */
  function marketOf(loc, doc) {
    let params;
    try { params = new URLSearchParams((loc && loc.search) || ''); } catch (e) { params = new URLSearchParams(); }
    const two = (v) => { const m = /^([a-z]{2})$/i.exec(String(v || '').trim()); return m ? m[1].toLowerCase() : ''; };
    const out = {};
    const gl = two(params.get('gl')) || countryOfHost(loc && loc.hostname);
    const lang = doc && doc.documentElement ? doc.documentElement.getAttribute('lang') : '';
    const hl = languageOf(params.get('hl')) || languageOf(lang);
    if (gl) out.gl = gl;
    if (hl) out.hl = hl;
    return out;
  }

  /** The session cache's market part: "gb|en", "|" for none. */
  function marketKey(market) {
    const m = market || {};
    return (m.gl || '') + '|' + (m.hl || '');
  }

  // ---------- the answer ----------

  const COMPETITION_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

  function competitionOf(v) {
    if (typeof v === 'string') {
      const up = v.trim().toUpperCase();
      return COMPETITION_LEVELS.includes(up) ? up : null;
    }
    const n = num(v);
    return n !== null && n >= 0 && n <= 100 ? n : null;
  }

  function trendOf(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((t) => t && typeof t.month === 'string' && /^\d{4}-\d{2}$/.test(t.month))
      .map((t) => ({ month: t.month, volume: num(t.volume) }))
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
      .slice(-12);
  }

  /** One keyword's figures as kept, from the route's entry; null without one. */
  function keywordFigures(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
      volume: num(entry.volume),
      cpc: num(entry.cpc),
      competition: competitionOf(entry.competition),
      difficulty: num(entry.difficulty),
      trend: trendOf(entry.trend),
      fetchedAt: typeof entry.fetchedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.fetchedAt) ? entry.fetchedAt : null
    };
  }

  // The figures route's `lookups` values, and keyword data's own: a country
  // DataForSEO has no keyword data for.
  const LOOKUPS = ['not_needed', 'done', 'failed', 'limit_reached', 'paused', 'unavailable', 'unsupported_market'];

  /**
   * The answer's `{ plan, allowance, lookups }`, each checked (the figures'
   * standing, plus `unsupported_market`, and the allowance's `period`, 'day'
   * or 'week', should the site count keyword data by the week).
   */
  function standing(data) {
    const F = figuresLib();
    const s = F ? F.standing(data) : { plan: null, allowance: null, lookups: null };
    const l = data && data.lookups;
    const period = data && data.allowance && data.allowance.period;
    const allowance = s.allowance && period === 'week' ? Object.assign({}, s.allowance, { period: 'week' }) : s.allowance;
    return Object.assign({}, s, { allowance, lookups: LOOKUPS.includes(l) ? l : null });
  }

  /** The answer's `results`, by keywordOf(keyword). */
  function resultsByKeyword(data) {
    const out = {};
    const list = data && Array.isArray(data.results) ? data.results : [];
    list.forEach((entry) => {
      const k = entry && keywordOf(entry.keyword);
      const f = keywordFigures(entry);
      if (k && f && !(k in out)) out[k] = f;
    });
    return out;
  }

  function bareHost(v) {
    return String(v || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  }

  /** The search as the account's rank tracker tracks it, or null. */
  function trackedOf(t) {
    if (!t || typeof t !== 'object') return null;
    const domain = bareHost(t.domain);
    if (!domain) return null;
    const history = (Array.isArray(t.history) ? t.history : [])
      .filter((h) => h && typeof h.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(h.date))
      .map((h) => {
        const p = num(h.position);
        return { date: h.date.slice(0, 10), position: p !== null && p > 0 ? Math.round(p) : null };
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const id = typeof t.trackerId === 'string' || typeof t.trackerId === 'number' ? t.trackerId : null;
    return { keyword: str(t.keyword), trackerId: id, domain, history };
  }

  /** The market DataForSEO answered for: { locationCode, languageCode } or null. */
  function marketAnswered(data) {
    const m = data && data.market;
    if (!m || typeof m !== 'object') return null;
    const loc = num(m.locationCode);
    const lang = str(m.languageCode);
    return loc === null && !lang ? null : { locationCode: loc, languageCode: lang };
  }

  /** Is `domain` (a result's bare host) the tracked site, or under it? */
  function isTrackedSite(domain, tracked) {
    const d = bareHost(domain);
    const t = tracked && tracked.domain;
    return !!(d && t && (d === t || d.endsWith('.' + t)));
  }

  /**
   * "Add to my keywords", from the sbwFetch answer of POST /api/v1/keywords:
   *   { state: 'added' | 'already', trackerId }
   *   { state: 'no_tracker' } · { state: 'choose_tracker', trackers: [{ id, domain }] }
   *   { state: 'error', code }
   */
  function addResult(res) {
    if (!res) return { state: 'error', code: 'error' };
    const d = res.data && typeof res.data === 'object' ? res.data : {};
    if (res.ok) {
      const trackerId = d.trackerId === undefined ? null : d.trackerId;
      return d.alreadyTracked === true ? { state: 'already', trackerId } : { state: 'added', trackerId };
    }
    if (res.code === 'conflict' && d.error === 'no_tracker') return { state: 'no_tracker' };
    if (res.code === 'conflict' && d.error === 'choose_tracker') {
      const trackers = (Array.isArray(d.trackers) ? d.trackers : [])
        .filter((t) => t && (typeof t.id === 'string' || typeof t.id === 'number') && bareHost(t.domain))
        .slice(0, 20)
        .map((t) => ({ id: t.id, domain: bareHost(t.domain), label: typeof t.label === 'string' && t.label.trim() ? t.label.trim().slice(0, 80) : null }));
      if (trackers.length) return { state: 'choose_tracker', trackers };
    }
    // The plan's tracked-keyword limit (a 403 that is not the key's scope),
    // and a tracker deleted since it was offered.
    if (res.status === 403 && d.error === 'limit_reached') return { state: 'tracker_full', limit: num(d.limit) };
    if (res.status === 404 && d.error === 'tracker_not_found') return { state: 'tracker_gone' };
    return { state: 'error', code: res.code || 'error' };
  }

  // ---------- words ----------

  function compact(n) {
    const F = figuresLib();
    return F ? F.compact(n) : String(n);
  }

  function volumeText(v) {
    const n = num(v);
    return n === null ? '—' : `${compact(n)}/mo`;
  }

  function cpcText(v) {
    const n = num(v);
    if (n === null) return '—';
    return '$' + (n >= 100 ? String(Math.round(n)) : n.toFixed(2));
  }

  // Google Ads' competition: LOW, MEDIUM or HIGH, or as a number (0 to 1,
  // or the 0 to 100 index), named by the same thirds.
  function competitionText(c) {
    if (typeof c === 'string') return c.charAt(0) + c.slice(1).toLowerCase();
    const n = num(c);
    if (n === null) return '—';
    const share = n <= 1 ? n : n / 100;
    const word = share < 0.34 ? 'Low' : share < 0.67 ? 'Medium' : 'High';
    return `${word} (${n <= 1 ? n.toFixed(2) : Math.round(n)})`;
  }

  function difficultyText(d) {
    const n = num(d);
    return n === null ? '—' : `${Math.round(n)}/100`;
  }

  /**
   * The year in a phrase: { text: '▲ 23% on a year before', title: every
   * month, values }. The change compares the last month with the first of
   * the twelve; '' when either is missing or zero.
   */
  function trendWords(trend) {
    const t = Array.isArray(trend) ? trend : [];
    const values = t.map((m) => m.volume);
    const known = t.filter((m) => num(m.volume) !== null);
    const title = known.length
      ? `${SOURCE}: searches a month, ${known.map((m) => `${m.month} ${Math.round(m.volume).toLocaleString('en-US')}`).join(', ')}.`
      : '';
    let text = '';
    if (known.length >= 2) {
      const first = known[0].volume;
      const last = known[known.length - 1].volume;
      if (first > 0) {
        const pct = Math.round(((last - first) / first) * 100);
        text = pct === 0 ? 'flat on the year' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% over ${known.length} months`;
      }
    }
    return { text, title, values };
  }

  /**
   * An SVG path through `values` in a `width` × `height` box; nulls break
   * the line. `invert` puts the smallest value at the top (a rank).
   */
  function sparkPath(values, width, height, invert) {
    const list = (values || []).map(num);
    const known = list.filter((v) => v !== null);
    if (known.length < 2) return '';
    const min = Math.min(...known);
    const max = Math.max(...known);
    const span = max - min || 1;
    const step = list.length > 1 ? width / (list.length - 1) : 0;
    let d = '';
    let pen = false;
    list.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      const share = (v - min) / span;
      const y = invert ? 1 + share * (height - 2) : height - 1 - share * (height - 2);
      d += `${pen ? 'L' : 'M'}${(i * step).toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  /**
   * The rank history of a tracked search, in words:
   *   { text: 'your tracker #4', change: '▲ 3 since 2026-10-04', title, positions }
   * or null without a dated position.
   */
  function historySummary(tracked) {
    const t = tracked && Array.isArray(tracked.history) ? tracked : null;
    if (!t || !t.history.length) return null;
    const ranked = t.history.filter((h) => h.position !== null);
    const last = t.history[t.history.length - 1];
    const latest = last.position === null ? 'not in the top 100' : `#${last.position}`;
    let change = '';
    if (ranked.length >= 2 && last.position !== null) {
      const first = ranked[0];
      const moved = first.position - last.position;
      change = moved === 0 ? `no change since ${first.date}` : `${moved > 0 ? '▲' : '▼'} ${Math.abs(moved)} since ${first.date}`;
    }
    const points = t.history.slice(-12).map((h) => `${h.date} ${h.position === null ? '—' : '#' + h.position}`);
    return {
      text: `your tracker ${latest}`,
      change,
      title: `Your rank tracker, ${t.domain}: ${points.join(', ')}. From your own SEO Bandwagon account, not DataForSEO.`,
      positions: t.history.slice(-30).map((h) => h.position)
    };
  }

  // The day's allowance and what stopped new keyword data: the figures
  // route's words, for keyword data.
  function allowanceLine(s) {
    if (!s || !s.allowance) return '';
    const F = figuresLib();
    const plan = F ? F.planName(s.plan) : '';
    const { limit, remaining, period } = s.allowance;
    return `${plan ? plan + ' plan: ' : ''}${remaining} of ${limit} searches with new keyword data left ${period === 'week' ? 'this week' : 'today'} (UTC).`;
  }

  function lookupNotice(s) {
    const lookups = s && s.lookups;
    const plan = s && s.plan;
    if (lookups === 'limit_reached') {
      return {
        kind: 'limit_reached',
        text: `${s.allowance && s.allowance.period === 'week' ? 'This week’s' : 'Today’s'} ${s.allowance ? s.allowance.limit + ' ' : ''}searches with new keyword data are used. Keyword data already looked up still shows, and everything else works.`,
        upgrade: plan !== 'pro' && plan !== 'enterprise'
      };
    }
    if (lookups === 'paused') {
      return {
        kind: 'paused',
        text: 'New keyword data is paused for everyone until next month: SEO Bandwagon’s monthly budget for it is spent. Keyword data already looked up still shows.',
        upgrade: false
      };
    }
    if (lookups === 'failed') {
      return { kind: 'failed', text: 'DataForSEO didn’t answer for some keywords. They’re asked again next time.', upgrade: false };
    }
    if (lookups === 'unavailable') {
      return { kind: 'unavailable', text: 'New keyword data is not available from SEO Bandwagon right now. Keyword data already looked up still shows.', upgrade: false };
    }
    if (lookups === 'unsupported_market') {
      return { kind: 'unsupported_market', text: 'DataForSEO has no keyword data for this Google’s country yet. Everything else works.', upgrade: false };
    }
    return null;
  }

  const ERROR_WORDS = {
    no_key: { text: 'Connect free to see keyword data', action: 'connect' },
    needs_consent: { text: 'Keyword data sends this search to SEO Bandwagon, and asks you first', action: 'consent' },
    forbidden: { text: 'Reconnect to see keyword data: your key was made before keyword data existed', action: 'connect' },
    unauthorized: { text: 'Your SEO Bandwagon key was refused. Reconnect to see keyword data', action: 'connect' },
    rate_limited: { text: 'Too many keyword requests in a minute. Try again shortly', action: 'retry' },
    unavailable: { text: 'SEO Bandwagon is busy. Try again shortly', action: 'retry' },
    network: { text: 'Offline: no keyword data until SEO Bandwagon can be reached', action: 'retry' },
    error: { text: 'Keyword data didn’t load', action: 'retry' },
    reloaded: { text: 'SEO Bandwagon was updated. Reload this page for keyword data', action: null },
    not_a_keyword: { text: 'No keyword data for a search with an operator such as site:', action: null },
    // A 400 naming `gl` or `hl`: a country or language the site doesn't know.
    unsupported_market: { text: 'No keyword data for this Google’s country or language', action: null }
  };

  function errorWords(code) {
    return ERROR_WORDS[code] || ERROR_WORDS.error;
  }

  const ADD_WORDS = {
    added: 'Added to your rank tracker',
    already: 'Already in your rank tracker',
    no_tracker: 'You have no rank tracker yet: create one on your dashboard, then add this',
    choose_tracker: 'Which rank tracker?',
    tracker_full: 'Your rank tracker is at your plan’s keyword limit',
    tracker_gone: 'That rank tracker is gone; add it again to choose another'
  };

  // ---------- exports ----------

  const SOURCE_NAMES = { search: 'Search', related: 'Related search', paa: 'People also ask' };

  function trendCell(trend) {
    return (trend || []).filter((m) => num(m.volume) !== null).map((m) => `${m.month}: ${Math.round(m.volume)}`).join(' | ');
  }

  function cellOf(v) {
    return v === null || v === undefined ? '' : v;
  }

  function competitionCell(c) {
    return c === null || c === undefined ? '' : typeof c === 'string' ? c.toLowerCase() : c;
  }

  const KEYWORD_CSV_COLUMNS = [
    ['Query', (it, f, ctx) => ctx.query || ''],
    ['Keyword', (it) => it.keyword],
    ['Shown on Google as', (it) => it.text],
    ['Source', (it) => SOURCE_NAMES[it.source] || it.source],
    ['Search volume a month (DataForSEO)', (it, f) => cellOf(f && f.volume)],
    ['CPC USD (DataForSEO)', (it, f) => cellOf(f && f.cpc)],
    ['Competition (DataForSEO)', (it, f) => competitionCell(f && f.competition)],
    ['Keyword difficulty 0-100 (DataForSEO)', (it, f) => cellOf(f && f.difficulty)],
    ['Trend 12 months (DataForSEO)', (it, f) => (f ? trendCell(f.trend) : '')],
    ['Country', (it, f, ctx) => ctx.country || ''],
    ['Language', (it, f, ctx) => ctx.language || ''],
    ['Captured', (it, f, ctx) => ctx.capturedAt || '']
  ];

  function csvCell(value) {
    const S = globalThis.SBWSerp || (typeof require === 'function' ? require('./serp.js') : null);
    const s = S ? S.guardCell(value) : String(value === null || value === undefined ? '' : value);
    return /["\r\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * One row a keyword (the search, its related searches, its People also
   * ask questions), blank where no figure was loaded; blank is not zero.
   */
  function keywordsToCsv(items, figuresOf, context) {
    const ctx = context || {};
    const lines = [KEYWORD_CSV_COLUMNS.map((c) => csvCell(c[0])).join(',')];
    (items || []).forEach((it) => {
      const f = figuresOf(it.keyword);
      lines.push(KEYWORD_CSV_COLUMNS.map((c) => csvCell(c[1](it, f, ctx))).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /**
   * The search's keyword data for the results exports, page-level like the
   * related searches column (src/lib/serp.js RESULT_CSV_COLUMNS):
   * `keywordVolume` … `paaVolumes`, '' where not loaded.
   */
  function exportContext(items, figuresOf) {
    const out = { keywordVolume: '', keywordCpc: '', keywordCompetition: '', keywordDifficulty: '', keywordTrend: '', relatedVolumes: '', paaVolumes: '' };
    const list = items || [];
    const search = list.find((it) => it.source === 'search');
    const f = search ? figuresOf(search.keyword) : null;
    if (f) {
      out.keywordVolume = cellOf(f.volume);
      out.keywordCpc = cellOf(f.cpc);
      out.keywordCompetition = competitionCell(f.competition);
      out.keywordDifficulty = cellOf(f.difficulty);
      out.keywordTrend = trendCell(f.trend);
    }
    const joined = (source) => list.filter((it) => it.source === source).map((it) => {
      const g = figuresOf(it.keyword);
      return g && num(g.volume) !== null ? `${it.text} (${Math.round(g.volume)})` : '';
    }).filter(Boolean).join(' | ');
    out.relatedVolumes = joined('related');
    out.paaVolumes = joined('paa');
    return out;
  }

  return {
    MAX_KEYWORDS,
    MAX_CHARS,
    MAX_WORDS,
    SOURCE,
    ERROR_WORDS,
    ADD_WORDS,
    KEYWORD_CSV_COLUMNS,
    LOOKUPS,
    hasOperator,
    languageOf,
    lookupOf,
    keywordOf,
    request,
    countryOfHost,
    marketOf,
    marketKey,
    keywordFigures,
    standing,
    resultsByKeyword,
    trackedOf,
    marketAnswered,
    isTrackedSite,
    addResult,
    volumeText,
    cpcText,
    competitionText,
    difficultyText,
    trendWords,
    sparkPath,
    historySummary,
    allowanceLine,
    lookupNotice,
    errorWords,
    keywordsToCsv,
    exportContext
  };
});
