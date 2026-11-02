// SEO Bandwagon — the figures under each Google result (1.11.0)
//
// Pure logic shared by the overlay (what a bar says), the worker (what it
// asks POST /api/v1/serp/metrics for, and keeps for the session) and the
// popup (the plan and today's allowance). No chrome.*, no fetch.
//
// The route (website change 66d2083f): up to 10 `{ url, domain }` a call,
// under the key's `serp` scope; a result Google hid from a signed-out user
// goes with `url: null` and gets its site's figures only. The answer carries
// DataForSEO's figures for the page and the site (referring domains,
// backlinks, rank on its 0 to 100 scale, estimated organic traffic `etv`,
// ranking keywords), RDAP's registration of the site, the caller's own
// on-page checklist for that exact page, the plan, the day's allowance and
// what became of the paid lookups (`lookups`).
//
// Copy rules (vault Extension_Roadmap_To_2_0_Design, 1.11.0): link and
// traffic figures are labelled as DataForSEO's, on its 0 to 100 rank scale;
// no authority score of our own; the checklist is the person's "on-page
// checklist", never worded or placed as a ranking factor.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWSerpFigures` when loaded as a classic <script>, content
// script or via importScripts, and exports via CommonJS when loaded by
// Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSerpFigures = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const MAX_PER_CALL = 10;
  const SOURCE = 'DataForSEO';

  // ---------- the request ----------

  /**
   * What one result is asked for: `{ key, url, domain }`. `key` tells the
   * results apart on the page (the parser's `_key`). A row Google hid behind
   * a redirect (`urlResolved: false`) is asked for by its site only; a row
   * whose site is unknown is not asked for at all.
   */
  function requestItem(row) {
    if (!row || row.siteUnknown || !row.domain) return null;
    const key = row._key || row.url || row.domain;
    if (row.urlResolved === false) return { key, url: null, domain: row.domain };
    let url = null;
    try {
      const u = new URL(row.url);
      const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password &&
          (host === row.domain || host.endsWith('.' + row.domain))) {
        u.hash = '';
        url = u.href;
      }
    } catch (e) { /* not an address: the site's figures only */ }
    return { key, url, domain: row.domain };
  }

  function requestItems(rows) {
    const seen = new Set();
    const out = [];
    (rows || []).forEach((row) => {
      const item = requestItem(row);
      if (!item || seen.has(item.key)) return;
      seen.add(item.key);
      out.push(item);
    });
    return out;
  }

  /** The session cache's key for one result: its page, or its site alone. */
  function cacheKey(item) {
    return item.url ? 'page:' + item.url : 'site:' + item.domain;
  }

  function batches(items, size) {
    const n = size || MAX_PER_CALL;
    const out = [];
    for (let i = 0; i < (items || []).length; i += n) out.push(items.slice(i, i + n));
    return out;
  }

  // ---------- the answer ----------

  const LOOKUPS = ['not_needed', 'done', 'failed', 'limit_reached', 'paused', 'unavailable'];

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function figuresBlock(b) {
    if (!b || typeof b !== 'object') return null;
    return {
      referringDomains: num(b.referringDomains),
      backlinks: num(b.backlinks),
      rank: num(b.rank),
      etv: num(b.etv),
      keywords: num(b.keywords),
      fetchedAt: typeof b.fetchedAt === 'string' ? b.fetchedAt : null
    };
  }

  function str(v) {
    return typeof v === 'string' && v ? v : null;
  }

  /** One result's figures as the overlay keeps them, from the route's entry. */
  function resultFigures(entry) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const w = e.whois && typeof e.whois === 'object' ? e.whois : null;
    const c = e.checklist && typeof e.checklist === 'object' && num(e.checklist.score) !== null ? e.checklist : null;
    return {
      page: figuresBlock(e.page),
      domain: figuresBlock(e.domain),
      whois: w ? {
        domain: str(w.domain),
        createdDate: str(w.createdDate),
        registrar: str(w.registrar),
        expiresDate: str(w.expiresDate),
        age: str(w.age)
      } : null,
      checklist: c ? { score: num(c.score), capturedAt: str(c.capturedAt) } : null
    };
  }

  /** The answer's account part: `{ plan, allowance, lookups }`, each checked. */
  function standing(data) {
    const d = data && typeof data === 'object' ? data : {};
    const a = d.allowance && typeof d.allowance === 'object' ? d.allowance : null;
    return {
      plan: typeof d.plan === 'string' ? d.plan : null,
      allowance: a && num(a.limit) !== null ? { limit: num(a.limit), used: num(a.used) || 0, remaining: num(a.remaining) || 0 } : null,
      lookups: LOOKUPS.includes(d.lookups) ? d.lookups : null
    };
  }

  /**
   * Whether a result's figures may be kept for the rest of the session: only
   * when the route got every figure it was going to (a search that hit the
   * limit, the ceiling or a failed lookup is asked again next time).
   */
  function keepable(lookups) {
    return lookups === 'done' || lookups === 'not_needed';
  }

  // ---------- words ----------

  // 412 · 9.1K · 412K · 1.2M · 3.4B. Tabular, short, never "0" for unknown.
  function compact(n) {
    const v = num(n);
    if (v === null) return '';
    const abs = Math.abs(v);
    const fmt = (x, unit) => {
      const r = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
      return String(r).replace(/\.0$/, '') + unit;
    };
    if (abs < 1000) return String(Math.round(v));
    if (abs < 1e6) return fmt(v / 1e3, 'K');
    if (abs < 1e9) return fmt(v / 1e6, 'M');
    return fmt(v / 1e9, 'B');
  }

  function day(iso) {
    return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
  }

  const PLAN_NAMES = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };

  function planName(plan) {
    return PLAN_NAMES[plan] || (plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '');
  }

  // Each figure a bar can show: which block it reads, its short label on the
  // bar and its whole name in the tooltip.
  const FIGURE_WORDS = {
    pageReferringDomains: { block: 'page', field: 'referringDomains', short: 'ref. domains', long: 'domains linking to this page' },
    pageBacklinks: { block: 'page', field: 'backlinks', short: 'backlinks', long: 'backlinks to this page' },
    pageRank: { block: 'page', field: 'rank', short: 'rank', long: 'page rank, on DataForSEO’s 0 to 100 scale' },
    pageTraffic: { block: 'page', field: 'etv', short: 'visits/mo', long: 'estimated organic visits a month to this page' },
    pageKeywords: { block: 'page', field: 'keywords', short: 'keywords', long: 'keywords this page ranks for' },
    siteRank: { block: 'domain', field: 'rank', short: 'rank', long: 'site rank, on DataForSEO’s 0 to 100 scale' },
    siteReferringDomains: { block: 'domain', field: 'referringDomains', short: 'ref. domains', long: 'domains linking to this site' },
    siteTraffic: { block: 'domain', field: 'etv', short: 'visits/mo', long: 'estimated organic visits a month to this site' },
    siteKeywords: { block: 'domain', field: 'keywords', short: 'keywords', long: 'keywords this site ranks for' }
  };

  function figureText(key, value) {
    const w = FIGURE_WORDS[key];
    if (w.field === 'rank') return `rank ${Math.round(value)}`;
    return `${compact(value)} ${w.short}`;
  }

  /**
   * What one bar shows, as groups of `{ key, text, title }` items:
   *   { page: [...], site: [...], age: item|null, checklist: item|null,
   *     notes: ['sign in to Google to see page figures'] }
   * `choice` is the settings' `figures`; `row` the parsed result.
   */
  function barItems(figures, choice, row) {
    const f = figures || {};
    const on = choice || {};
    const out = { page: [], site: [], age: null, checklist: null, notes: [] };
    const hiddenPage = !!(row && row.urlResolved === false);
    Object.keys(FIGURE_WORDS).forEach((key) => {
      if (!on[key]) return;
      const w = FIGURE_WORDS[key];
      const block = f[w.block];
      const value = block ? num(block[w.field]) : null;
      if (value === null) return;
      const group = w.block === 'page' ? out.page : out.site;
      const asOf = block.fetchedAt ? ` As of ${day(block.fetchedAt)}.` : '';
      const said = w.field === 'rank'
        ? `${w.long.replace(/, on .*$/, '')} ${Math.round(value)}, on its 0 to 100 scale`
        : `${Math.round(value).toLocaleString('en-US')} ${w.long}`;
      group.push({ key, text: figureText(key, value), title: `${SOURCE}: ${said}.${asOf}` });
    });
    if (hiddenPage && Object.keys(FIGURE_WORDS).some((k) => on[k] && FIGURE_WORDS[k].block === 'page')) {
      out.notes.push('sign in to Google to see page figures');
    }
    if (on.domainAge && f.whois && f.whois.age) {
      const w = f.whois;
      const parts = [];
      if (w.createdDate) parts.push(`Registered ${day(w.createdDate)}`);
      if (w.registrar) parts.push(`registrar ${w.registrar}`);
      if (w.expiresDate) parts.push(`expires ${day(w.expiresDate)}`);
      out.age = {
        key: 'domainAge',
        text: `age ${w.age}`,
        title: `${w.domain || 'Domain'}: ${parts.join(', ') || 'registration dates not given'}. From RDAP, the domain registries’ own record.`
      };
    }
    if (on.checklist && f.checklist && num(f.checklist.score) !== null) {
      const when = day(f.checklist.capturedAt);
      out.checklist = {
        key: 'checklist',
        text: `your checklist ${Math.round(f.checklist.score)}/100`,
        title: `Your on-page checklist for this page${when ? `, from your capture of ${when}` : ''}: title, description, headings, images, links, schema and the rest of the report. It is not a ranking factor and does not predict where a page ranks.`
      };
    }
    return out;
  }

  /** True when `items` from barItems has nothing to show. */
  function isEmpty(items) {
    return !items || (!items.page.length && !items.site.length && !items.age && !items.checklist);
  }

  /**
   * The plan and today's allowance, in one line, or '' without them:
   * "Free plan: 17 of 20 searches with new figures left today."
   */
  function allowanceLine(s) {
    if (!s || !s.allowance) return '';
    const { limit, remaining } = s.allowance;
    const plan = planName(s.plan);
    return `${plan ? plan + ' plan: ' : ''}${remaining} of ${limit} searches with new figures left today (UTC).`;
  }

  /**
   * Why a search got no new figures, from `lookups`, or null when it did.
   * `upgrade` asks for the upgrade link. Cached figures still show in all.
   */
  function lookupNotice(s) {
    const lookups = s && s.lookups;
    const plan = s && s.plan;
    if (lookups === 'limit_reached') {
      return {
        kind: 'limit_reached',
        text: `Today’s ${s.allowance ? s.allowance.limit + ' ' : ''}searches with new figures are used. Figures already looked up still show, and everything else works.`,
        upgrade: plan !== 'pro' && plan !== 'enterprise'
      };
    }
    if (lookups === 'paused') {
      return {
        kind: 'paused',
        text: 'New figures are paused for everyone until next month: SEO Bandwagon’s monthly budget for them is spent. Figures already looked up still show.',
        upgrade: false
      };
    }
    if (lookups === 'failed') {
      return { kind: 'failed', text: 'DataForSEO didn’t answer for some results. They’re asked again on your next search.', upgrade: false };
    }
    if (lookups === 'unavailable') {
      return { kind: 'unavailable', text: 'New figures are not available from SEO Bandwagon right now. Figures already looked up still show.', upgrade: false };
    }
    return null;
  }

  // The words for a call that got no answer, by sbwFetch's code. 1.10.2
  // moved the 403 and 429 here: each has its own words, never "Could not
  // reach SEO Bandwagon".
  const ERROR_WORDS = {
    no_key: { text: 'Connect free to see figures', action: 'connect' },
    needs_consent: { text: 'Turn on figures in Settings: they send each result’s address to SEO Bandwagon', action: 'settings' },
    forbidden: { text: 'Reconnect to see figures: your key was made before figures existed', action: 'connect' },
    unauthorized: { text: 'Your SEO Bandwagon key was refused. Reconnect to see figures', action: 'connect' },
    rate_limited: { text: 'Too many figure requests in a minute. They load again shortly', action: null },
    unavailable: { text: 'SEO Bandwagon is busy. Figures load again shortly', action: null },
    network: { text: 'Offline: no figures until SEO Bandwagon can be reached', action: null },
    error: { text: 'Figures didn’t load. Reload the page to try again', action: null },
    reloaded: { text: 'SEO Bandwagon was updated. Reload this page for figures', action: null }
  };

  function errorWords(code) {
    return ERROR_WORDS[code] || ERROR_WORDS.error;
  }

  return {
    MAX_PER_CALL,
    SOURCE,
    LOOKUPS,
    FIGURE_WORDS,
    requestItem,
    requestItems,
    cacheKey,
    batches,
    resultFigures,
    standing,
    keepable,
    compact,
    planName,
    barItems,
    isEmpty,
    allowanceLine,
    lookupNotice,
    errorWords
  };
});
