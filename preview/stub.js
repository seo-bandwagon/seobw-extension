// Preview harness — stubs Chrome + the SEO Bandwagon citations API (SBW.ct.*,
// src/lib/api.js) so the real popup/side-panel render code can be exercised
// in a plain browser tab. Dev only; never shipped.

const PREVIEW_STATE = new URLSearchParams(location.search).get('state') || 'main-known';

/* ---------- fixtures ---------- */

const FX = {
  user: { email: 'dana@northsidedental.com', name: 'Dana Mercer', picture: null },

  businesses: [
    { id: 'b1', name: 'Northside Dental Co.', address_line1: '412 Burnet Rd', address_line2: 'Suite 200',
      city: 'Austin', state: 'TX', zip_code: '78757', country: 'US',
      phone: '(512) 555-0134', website: 'https://northsidedental.com', category: 'Dentist' },
    { id: 'b2', name: 'Acme Plumbing', address_line1: '123 Main Street', address_line2: null,
      city: 'Austin', state: 'TX', zip_code: '78701', country: 'US',
      phone: '(512) 555-1234', website: 'https://acmeplumbing.com', category: 'Plumber' },
    { id: 'b3', name: 'Rivera Family Law', address_line1: '900 Congress Ave', address_line2: null,
      city: 'Austin', state: 'TX', zip_code: '78701', country: 'US',
      phone: '(512) 555-7788', website: 'https://riverafamilylaw.com', category: 'Attorney' },
    { id: 'b4', name: 'Bluebonnet Auto Care', address_line1: '55 Lamar Blvd', address_line2: null,
      city: 'Austin', state: 'TX', zip_code: '78704', country: 'US',
      phone: '(512) 555-3300', website: 'https://bluebonnetauto.com', category: 'Auto Repair' }
  ],

  stats: {
    b1: { total_citations: 34, active_citations: 26, inconsistent_citations: 6, missing_citations: 2, avg_nap_score: 0.86, last_campaign_at: '2026-08-02T10:00:00' },
    b2: { total_citations: 12, active_citations: 7, inconsistent_citations: 4, missing_citations: 1, avg_nap_score: 0.71, last_campaign_at: null },
    b3: { total_citations: 21, active_citations: 19, inconsistent_citations: 1, missing_citations: 1, avg_nap_score: 0.93, last_campaign_at: '2026-07-28T10:00:00' },
    b4: { total_citations: 5, active_citations: 2, inconsistent_citations: 2, missing_citations: 1, avg_nap_score: 0.54, last_campaign_at: null }
  },

  citations: [
    { id: 'c1', directory_name: 'Yelp', directory_url: 'https://yelp.com/biz/northside-dental', status: 'inconsistent', nap_match_score: 0.62, last_checked_at: '2026-08-12T14:00:00', created_at: '2026-08-01T10:00:00', found_name: 'Northside Dental', found_phone: '(512) 555-0134' },
    { id: 'c2', directory_name: 'Better Business Bureau', directory_url: 'https://bbb.org/us/tx/austin/profile/northside', status: 'active', nap_match_score: 0.97, last_checked_at: '2026-08-11T09:00:00', created_at: '2026-07-30T10:00:00', found_name: 'Northside Dental Co.', found_phone: '(512) 555-0134' },
    { id: 'c3', directory_name: 'Yellow Pages', directory_url: 'https://yellowpages.com/austin-tx/mip/northside', status: 'active', nap_match_score: 0.91, last_checked_at: '2026-08-10T09:00:00', created_at: '2026-07-29T10:00:00', found_name: 'Northside Dental Co', found_phone: '(512) 555-0134' },
    { id: 'c4', directory_name: 'Foursquare', directory_url: 'https://foursquare.com/v/northside', status: 'inconsistent', nap_match_score: 0.48, last_checked_at: '2026-08-09T09:00:00', created_at: '2026-07-28T10:00:00', found_name: 'Northside Dental Partners', found_phone: '(512) 555-9999' },
    { id: 'c5', directory_name: 'Apple Maps', directory_url: 'https://maps.apple.com/northside', status: 'active', nap_match_score: 0.88, last_checked_at: '2026-08-08T09:00:00', created_at: '2026-07-27T10:00:00', found_name: 'Northside Dental Co.', found_phone: '(512) 555-0134' },
    { id: 'c6', directory_name: 'MapQuest', directory_url: 'https://mapquest.com/us/tx/austin/northside', status: 'missing', nap_match_score: null, last_checked_at: null, created_at: '2026-07-26T10:00:00', found_name: null, found_phone: null },
    { id: 'c7', directory_name: 'Manta', directory_url: 'https://manta.com/c/northside', status: 'active', nap_match_score: 0.84, last_checked_at: '2026-08-06T09:00:00', created_at: '2026-07-25T10:00:00', found_name: 'Northside Dental Co.', found_phone: '(512) 555-0134' },
    { id: 'c8', directory_name: 'Healthgrades', directory_url: 'https://healthgrades.com/dentist/northside', status: 'active', nap_match_score: 0.95, last_checked_at: '2026-08-05T09:00:00', created_at: '2026-07-24T10:00:00', found_name: 'Northside Dental Co.', found_phone: '(512) 555-0134' },
    { id: 'c9', directory_name: 'Citysearch', directory_url: 'https://citysearch.com/profile/northside', status: 'inconsistent', nap_match_score: 0.66, last_checked_at: '2026-08-04T09:00:00', created_at: '2026-07-23T10:00:00', found_name: 'Northside Dental', found_phone: '(512) 555-0100' },
    { id: 'c10', directory_name: 'Nextdoor', directory_url: 'https://nextdoor.com/pages/northside', status: 'active', nap_match_score: 0.9, last_checked_at: '2026-08-03T09:00:00', created_at: '2026-07-22T10:00:00', found_name: 'Northside Dental Co.', found_phone: '(512) 555-0134' },
    { id: 'c11', directory_name: 'Hotfrog', directory_url: 'https://hotfrog.com/company/northside', status: 'active', nap_match_score: 0.81, last_checked_at: '2026-08-02T09:00:00', created_at: '2026-07-21T10:00:00', found_name: 'Northside Dental Co.', found_phone: '(512) 555-0134' },
    { id: 'c12', directory_name: 'Alignable', directory_url: 'https://alignable.com/austin-tx/northside', status: 'active', nap_match_score: 0.87, last_checked_at: '2026-08-01T09:00:00', created_at: '2026-07-20T10:00:00', found_name: 'Northside Dental Co.', found_phone: '(512) 555-0134' }
  ],

  campaigns: [
    { id: 'k1', status: 'running', campaign_type: 'discovery', created_at: '2026-08-13T09:00:00' },
    { id: 'k2', status: 'completed', campaign_type: 'discovery', created_at: '2026-08-02T09:00:00' },
    { id: 'k3', status: 'completed', campaign_type: 'monitor', created_at: '2026-07-26T09:00:00' },
    { id: 'k4', status: 'failed', campaign_type: 'discovery', created_at: '2026-07-19T09:00:00' }
  ],

  napDrift: { name: 'Northside Dental', address: '412 Burnet Road, Austin, TX 78757', phone: '(512) 555-0134', website: 'https://northsidedental.com/offers', source: 'json-ld' },
  napPerfect: { name: 'Northside Dental Co.', address: '412 Burnet Rd, Suite 200, Austin, TX 78757', phone: '(512) 555-0134', website: 'https://northsidedental.com', source: 'json-ld' },

  // Domain history (Task 3 / Task 7 `domain-history` state): SBW.quickDomain /
  // SBW.capturesForUrl fixtures. capturedAt is fixed well in the past so it
  // clears summarize()'s just-posted skew window regardless of when the
  // preview loads.
  quickDomain: { domain: 'northsidedental.com', avgWordCount: 780, schemaPercentage: 40, avgScore: 71, age: '6 months', sampleSize: 5 },
  capturesForUrl: {
    url: 'https://northsidedental.com/austin/family-dentistry',
    domain: 'northsidedental.com',
    totalCaptures: 3,
    captures: [
      { id: 'cap1', createdAt: '2026-08-13T10:00:00.000Z', overallScore: 70 },
      { id: 'cap2', createdAt: '2026-07-30T10:00:00.000Z', overallScore: 66 },
      { id: 'cap3', createdAt: '2026-07-16T10:00:00.000Z', overallScore: 62 }
    ]
  },

  // Link building (Task 5): outlets, pitches, and results. All rows use the
  // exact field names the site's /api/link-building/* routes return.
  outlets: [
    { id: 'o1', domain: 'austinlocalnews.com', prospect_type: 'blog', quality_score: '78.5',
      score_breakdown: { authority: 22, relevance: 26, data_friendliness: 15, warmth: 10.5, unmeasured: [], heuristic: [] },
      is_warm_target: true, is_competitor: false, status: 'qualified',
      journalist_count: 2, journalists: [
        { full_name: 'Priya Shah', priority: 'primary', has_email: true, verification_status: 'valid' },
        { full_name: 'Marcus Lee', priority: 'secondary', has_email: true, verification_status: 'unverified' }
      ] },
    { id: 'o2', domain: 'texashomeservicesreport.com', prospect_type: 'trade_press', quality_score: '61.0',
      score_breakdown: { authority: 18, relevance: 20, data_friendliness: 8, warmth: 15, unmeasured: [], heuristic: ['relevance'] },
      is_warm_target: false, is_competitor: true, status: 'qualified',
      journalist_count: 1, journalists: [
        { full_name: 'Owen Cole', priority: 'secondary', has_email: false, verification_status: null }
      ] },
    { id: 'o3', domain: 'atxsmallbiz.org', prospect_type: 'nonprofit', quality_score: '57.2',
      score_breakdown: { authority: 14, relevance: 22, data_friendliness: 8, warmth: 13.2, unmeasured: [], heuristic: [] },
      is_warm_target: false, is_competitor: false, status: 'qualified', journalist_count: 0, journalists: [] }
  ],

  // Flat rows — matches the real GET /api/link-building/pitches shape (the
  // site's route.ts aliases contact/prospect columns straight onto the row,
  // it does not nest them under `.contact`/`.prospect`).
  pitchesDraft: [
    { id: 'p1', angle_type: 'data_story', subject_line: 'A dataset your churn story is missing',
      body_markdown: 'Hi Priya,\n\nYour piece on North Austin home services touched on listing churn — we track exactly that across 53 metros weekly. Top-3 retention on Maps sits at 2.6% churn this edition, dated within the last 14 days.\n\nHappy to share the full methodology and the underlying numbers if useful for a follow-up.\n\nBest,\nDana',
      status: 'draft',
      full_name: 'Priya Shah', email: 'priya@austinlocalnews.com', verification_status: 'valid',
      domain: 'austinlocalnews.com', quality_score: '78.5' },
    { id: 'p2', angle_type: 'correction', subject_line: 'Correction data for your last home-services roundup',
      body_markdown: 'Hi Owen,\n\nYour home-services roundup cited a stat that has since moved — happy to send the current measured figure and source if it helps a correction or update.\n\nBest,\nDana',
      status: 'draft',
      full_name: 'Owen Cole', email: null, verification_status: 'unverified',
      domain: 'texashomeservicesreport.com', quality_score: '61.0' }
  ],

  pitchesApproved: [
    { id: 'p3', angle_type: 'data_story', subject_line: 'Follow-up: local SEO churn dataset for nonprofits',
      body_markdown: 'Hi Dana,\n\nFollowing up on the churn dataset for small-business listings — full numbers attached below.\n\nBest,\nDana',
      status: 'approved',
      full_name: 'Dana Ruiz', email: 'dana.ruiz@atxsmallbiz.org', verification_status: 'valid',
      domain: 'atxsmallbiz.org', quality_score: '57.2' }
  ],

  lbResults: {
    funnel: {
      prospects_total: 46, awaiting_review: 9, approved_outlets: 14, held: 4, archived: 19,
      journalists: 22, with_email: 15, verified_valid: 11, drafts: 3, approved_pitches: 2,
      rejected_pitches: 5, sent: 6, placements: 3, placements_from_pitches: 2
    },
    spend: { totalUsd: 18.42 },
    placements: [
      { outlet_domain: 'austinlocalnews.com', anchor_text: 'local SEO churn data', published_at: '2026-08-20T10:00:00', dofollow: true },
      { outlet_domain: 'texashomeservicesreport.com', anchor_text: 'ranking report', published_at: '2026-07-30T10:00:00', dofollow: false },
      { outlet_domain: 'atxsmallbiz.org', anchor_text: 'listing churn study', published_at: '2026-07-12T10:00:00', dofollow: true }
    ],
    sends: [
      { domain: 'atxsmallbiz.org', full_name: 'Dana Ruiz', sent_at: '2026-08-22T09:00:00' },
      { domain: 'austinlocalnews.com', full_name: 'Priya Shah', sent_at: '2026-08-18T09:00:00' }
    ]
  }
};

// A small PNG rendered on the fly so the proof-card thumbnail (and Download
// PNG link) have real pixels/bytes.
function makeShot(w = 320, h = 220) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#0d1030'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#F53796'; x.fillRect(0, 0, w, 26);
  x.fillStyle = 'rgba(245,245,245,.85)'; x.font = 'bold 12px sans-serif';
  x.fillText('Northside Dental Co.', 12, 18);
  x.fillStyle = 'rgba(245,245,245,.20)';
  for (let i = 0; i < 9; i++) x.fillRect(12, 44 + i * 18, (w - 40) * (0.4 + Math.abs(Math.sin(i)) * 0.5), 7);
  x.fillStyle = 'rgba(245,55,150,.30)'; x.fillRect(12, 44 + 3 * 18, 120, 7);
  return c.toDataURL('image/png');
}
const SHOT = makeShot();

/* ---------- chrome API stub ---------- */

// Read the real manifest synchronously so the preview reports the true version
// rather than a copy that can go stale.
const MANIFEST = (() => {
  try {
    const r = new XMLHttpRequest();
    r.open('GET', '../manifest.json', false);
    r.send();
    return JSON.parse(r.responseText);
  } catch (e) {
    return { version: '0.0.0', version_name: 'preview (manifest unreadable)' };
  }
})();

const store = {};
const TAB_URLS = {
  'main-unknown': 'https://example.com/some-page',
  default: 'https://www.yelp.com/biz/northside-dental-austin'
};
const TAB_TITLES = {
  'main-unknown': 'Some Page',
  default: 'Northside Dental Co. - Yelp'
};

// Side panel preview states drive the LINKS mode straight from a query
// param — pre-seed the persisted mode before sidepanel.js's initSidePanel()
// reads chrome.storage.local.spMode (see preview/sidepanel.html: the stub
// must be fully in place before that script runs).
if (PREVIEW_STATE.startsWith('lb-')) {
  store.spMode = 'links';
}

// `key-invalid` simulates a stored key that a prior /v1/me call already
// rejected — options.js's showStoredKeyStatus() and citations-tab.js's
// checkSignedIn() both short-circuit on sbwKeyStatus === 'invalid' without
// another round trip, so this must be in place before either runs.
if (PREVIEW_STATE === 'key-invalid') {
  store.sbwKeyStatus = 'invalid';
}

// `capture-<status>` (history.html preview) seeds one local capture with
// that sync status so history.js's real syncBadge() renders the matching
// pill (see src/lib/sync-state.js for the status vocabulary). `capture-legacy`
// is the one exception: it seeds a pre-1.5.0 capture (`skipped`/`legacy`, see
// SBW.markLegacyPending()) so history.js's real renderLegacyBanner() shows
// the "Include them in sync" banner.
if (PREVIEW_STATE === 'capture-legacy') {
  store.capture_1755700000000 = {
    url: 'https://northsidedental.com/austin/family-dentistry',
    capturedAt: '2026-08-20T14:00:00.000Z',
    content: { wordCount: 842 },
    links: { internal: { count: 34 }, external: { count: 8 } },
    images: { total: 14 },
    sync: { status: 'skipped', error: 'legacy', attempts: 0, nextAt: 0 }
  };
} else if (PREVIEW_STATE.startsWith('capture-')) {
  const status = PREVIEW_STATE.slice('capture-'.length);
  store.capture_1755700000000 = {
    url: 'https://northsidedental.com/austin/family-dentistry',
    capturedAt: '2026-08-20T14:00:00.000Z',
    content: { wordCount: 842 },
    links: { internal: { count: 34 }, external: { count: 8 } },
    images: { total: 14 },
    sync: { status, attempts: status === 'failed' ? 5 : 0 }
  };
}

const sessionStore = {};

window.chrome = {
  runtime: {
    lastError: null,
    sendMessage(msg, cb) {
      const reply = handleMessage(msg);
      setTimeout(() => cb && cb(reply), 90);   // visible async, exercises loading states
    },
    getURL: p => p,
    getManifest: () => MANIFEST,
    onMessage: { addListener() {} },
    openOptionsPage() { console.log('[preview] would open options page'); }
  },
  storage: {
    local: {
      get(keys, cb) {
        const out = {};
        if (keys === null) Object.assign(out, store);
        else if (typeof keys === 'string') out[keys] = store[keys];
        else if (Array.isArray(keys)) keys.forEach(k => out[k] = store[k]);
        else Object.keys(keys).forEach(k => out[k] = store[k] ?? keys[k]);
        const r = Promise.resolve(out);
        if (cb) { cb(out); return; }
        return r;
      },
      set(obj, cb) { Object.assign(store, obj); if (cb) cb(); return Promise.resolve(); },
      remove(k, cb) { (Array.isArray(k) ? k : [k]).forEach(key => delete store[key]); if (cb) cb(); return Promise.resolve(); }
    },
    // `session` mirrors `local` — used by resolveCached() (popup.js's
    // domain-history cache) via SBWDomainHistory.cacheKey. Real chrome.storage
    // areas don't share a namespace with each other; neither does this stub.
    session: {
      get(keys, cb) {
        const out = {};
        if (keys === null || keys === undefined) Object.assign(out, sessionStore);
        else if (typeof keys === 'string') out[keys] = sessionStore[keys];
        else if (Array.isArray(keys)) keys.forEach(k => out[k] = sessionStore[k]);
        else Object.keys(keys).forEach(k => out[k] = sessionStore[k] ?? keys[k]);
        const r = Promise.resolve(out);
        if (cb) { cb(out); return; }
        return r;
      },
      set(obj, cb) { Object.assign(sessionStore, obj); if (cb) cb(); return Promise.resolve(); },
      remove(k, cb) { (Array.isArray(k) ? k : [k]).forEach(key => delete sessionStore[key]); if (cb) cb(); return Promise.resolve(); }
    },
    // Every state except `signed-out` / `key-missing` pretends a key is
    // already saved, so checkSignedIn() (citations-tab.js / sidepanel.js) /
    // showStoredKeyStatus() (options.js) treat the preview as signed in
    // without a real /v1/me round trip (SBW.verifyKey is stubbed below to
    // resolve immediately). `key-invalid` also has a key saved — it's the
    // cached sbwKeyStatus above, not a missing key, that renders it as
    // rejected.
    sync: {
      get(defaults, cb) {
        const result = Object.assign({}, defaults);
        if (PREVIEW_STATE !== 'signed-out' && PREVIEW_STATE !== 'key-missing') {
          result.apiKey = 'sbw_' + '0'.repeat(48);
        }
        cb(result);
      },
      set(items, cb) { if (cb) cb(); }
    }
  },
  tabs: {
    query(_, cb) {
      const url = TAB_URLS[PREVIEW_STATE] || TAB_URLS.default;
      const title = TAB_TITLES[PREVIEW_STATE] || TAB_TITLES.default;
      const tabs = [{ id: 1, url, title, windowId: 1 }];
      if (cb) { cb(tabs); return; }
      return Promise.resolve(tabs);
    },
    sendMessage(id, msg, cb) { const r = handleMessage(msg); if (cb) cb(r); return Promise.resolve(r); },
    create(o) { console.log('[preview] would open', o.url); },
    captureVisibleTab(_, __, cb) { cb(SHOT); }
  },
  scripting: { executeScript: () => Promise.resolve([]) },
  sidePanel: { open() {}, setPanelBehavior() {} },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  contextMenus: { create() {}, onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  windows: { create() {} }
};

function handleMessage(msg) {
  switch (msg.action) {
    case 'captureScreenshot': return { ok: true, dataUrl: SHOT };
    case 'checkDirectory': return { match: matchDirectory(msg.url) };
    case 'extractNap':
      if (PREVIEW_STATE === 'nap-error') return { error: 'No NAP block found on this page.' };
      return PREVIEW_STATE === 'nap-perfect' ? FX.napPerfect : FX.napDrift;
    case 'getCachedAnalysis': return { hit: true, data: SEO_FIXTURE };
    case 'storeAnalysis': return { ok: true };
    case 'openSidePanel': return { ok: true };
    case 'analyze': return SEO_FIXTURE;
    default: return {};
  }
}

/* ---------- SBW.ct.* stub (overrides the real src/lib/api.js methods once
   it has loaded — see the DOMContentLoaded handler below) ---------- */

function installSbwStubs() {
  const delay = (v, ms = 120) => new Promise(r => setTimeout(() => r(v), ms));
  // Never let the real network-hitting bits fire in a preview.
  SBW.verifyKey = () => delay({ ok: true, status: 200, data: FX.user, code: 'ok' });
  // Domain history (popup.js's loadDomainHistory, `domain-history` state):
  // every other state gets an empty/never-seen response so the strip stays
  // hidden without touching real network stubs.
  SBW.quickDomain = () => delay({
    ok: true, status: 200, code: 'ok',
    data: PREVIEW_STATE === 'domain-history' ? FX.quickDomain : { domain: null, avgWordCount: null, schemaPercentage: null, avgScore: null, age: null, sampleSize: 0 }
  });
  SBW.capturesForUrl = () => delay({
    ok: true, status: 200, code: 'ok',
    data: PREVIEW_STATE === 'domain-history' ? FX.capturesForUrl : { url: null, domain: null, totalCaptures: 0, captures: [] }
  });
  SBW.ct.businesses = () => delay(PREVIEW_STATE === 'no-businesses' ? [] : FX.businesses);
  SBW.ct.business = id => delay(FX.businesses.find(b => b.id === id));
  SBW.ct.stats = id => delay(FX.stats[id] || FX.stats.b1, 260);
  SBW.ct.citations = () => delay(PREVIEW_STATE === 'no-citations' ? [] : FX.citations);
  SBW.ct.createCitation = (_, d) => delay(Object.assign({ id: 'new' }, d, { created: true }));
  SBW.ct.campaigns = () => delay(PREVIEW_STATE === 'no-campaigns' ? [] : FX.campaigns);
  SBW.ct.triggerCampaign = () => delay({
    id: 'k0', status: 'completed', campaign_type: 'discovery', created_at: new Date().toISOString()
  });

  // SBW.lb.* never throws — every method resolves the same
  // { ok, status, data, code } shape sbwFetch returns for a real call.
  SBW.lb.addOutlet = ({ url, name, status }) => {
    let domain = 'added-outlet.example.com';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep fallback */ }
    return delay({ ok: true, status: 201, data: { id: 'new-outlet', domain, status, created: true }, code: 'ok' });
  };
  SBW.lb.prospects = (status) => delay({
    ok: true, status: 200,
    data: { prospects: status === 'qualified' || !status ? FX.outlets : [], counts: [{ status: 'qualified', n: FX.outlets.length }] },
    code: 'ok'
  });
  SBW.lb.reviewProspects = (ids, action) => delay({ ok: true, status: 200, data: { action, requested: ids.length, updated: ids.length }, code: 'ok' });
  SBW.lb.pitches = (status) => {
    const list = status === 'approved' ? FX.pitchesApproved : status === 'sent' ? [] : FX.pitchesDraft;
    return delay({ ok: true, status: 200, data: { pitches: list, counts: [], senderAddress: 'dana@northsidedental.com' }, code: 'ok' });
  };
  SBW.lb.reviewPitch = (id, action) => delay({ ok: true, status: 200, data: { action, id, status: action === 'approve' ? 'approved' : 'rejected' }, code: 'ok' });
  SBW.lb.markSent = (id) => delay({ ok: true, status: 200, data: { id, status: 'sent' }, code: 'ok' });
  SBW.lb.results = () => delay({ ok: true, status: 200, data: FX.lbResults, code: 'ok' });

  window.sendToApi = () => {};
  window.autoSaveLocal = () => {};
}

/* ---------- SEO analyzer fixture ---------- */

const SEO_FIXTURE = {
  url: 'https://northsidedental.com/austin/family-dentistry',
  seoScore: { score: 78, grade: 'B', issues: ['Description too short', 'Some images missing alt', 'No structured data'] },
  meta: {
    title: { text: 'Family Dentistry in North Austin | Northside Dental Co.', length: 54 },
    description: { text: 'Gentle family dentistry in North Austin. Same-week appointments.', length: 64 },
    canonical: 'https://northsidedental.com/austin/family-dentistry',
    robots: 'index, follow',
    openGraph: { title: 'Family Dentistry in North Austin' },
    twitter: { card: 'summary_large_image' },
    schema: []
  },
  content: {
    wordCount: 842, charCount: 5310, sentenceCount: 47,
    readability: { level: 'Fairly easy', fleschKincaid: 8.2, fleschEase: 68 },
    topWords: [
      { word: 'dental', count: 24 }, { word: 'austin', count: 18 }, { word: 'family', count: 15 },
      { word: 'appointment', count: 12 }, { word: 'care', count: 11 }, { word: 'patients', count: 9 },
      { word: 'cleaning', count: 8 }, { word: 'insurance', count: 7 }
    ],
    topPhrases: [
      { phrase: 'family dentistry', count: 11 }, { phrase: 'north austin', count: 9 },
      { phrase: 'dental care', count: 7 }, { phrase: 'same week', count: 5 }
    ]
  },
  headings: {
    h1: ['Family Dentistry in North Austin'],
    h2: ['Our Services', 'Meet the Team', 'Insurance We Accept', 'Book an Appointment'],
    h3: ['Cleanings', 'Fillings', 'Whitening', 'Emergency Care', 'Pediatric', 'Invisalign'],
    h4: [], h5: [], h6: [], multipleH1: false
  },
  links: { internal: { count: 34 }, external: { count: 8 }, nofollow: 3 },
  images: { total: 14, missingAlt: { count: 3 } },
  technical: { domElements: 1240, scripts: 12, stylesheets: 4, urlDepth: 2, loadTimeMs: 1840 },
  webVitals: { lcp: 2180, inp: 640, cls: 0.04, fcp: 1210, ttfb: 420 },
  textToHtml: { ratio: 18, textSize: 5310, htmlSize: 29500, status: 'good' },
  mixedContent: { isHttps: true, mixedCount: 0, items: [] },
  techStack: [
    { name: 'WordPress', category: 'CMS', icon: '' }, { name: 'Cloudflare', category: 'CDN', icon: '' },
    { name: 'Google Analytics', category: 'Analytics', icon: '' }, { name: 'jQuery', category: 'JS', icon: '' },
    { name: 'Elementor', category: 'Builder', icon: '' }
  ]
};

/* ---------- drive the requested state after the real code boots ---------- */

window.addEventListener('DOMContentLoaded', () => {
  installSbwStubs();

  const go = async () => {
    const citTab = document.querySelector('.switcher button[data-tab="citations"]');
    // `domain-history` exercises the SEO Analysis tab (the strip renders
    // under its score ring), same as `seo` — everything else lands on
    // Citations.
    const needsCitations = PREVIEW_STATE !== 'seo' && PREVIEW_STATE !== 'domain-history';

    if (needsCitations && citTab) citTab.click();

    // Pre-select a business for every state except the picker itself
    if (!['picker', 'signed-out', 'no-businesses'].includes(PREVIEW_STATE)) {
      store.cfSelectedBusiness = 'b1';
      if (typeof cfInit !== 'undefined') { window.cfInit = false; }
      if (typeof refreshCitations === 'function' && needsCitations) await refreshCitations();
    }

    await new Promise(r => setTimeout(r, 500));

    switch (PREVIEW_STATE) {
      case 'nap-drift':
      case 'nap-perfect':
      case 'nap-error':
        document.getElementById('cfNap')?.click();
        break;
      case 'proof':
        document.getElementById('cfShot')?.click();
        break;
      case 'nap-loading':
        window.cfResult = { kind: 'loading', label: 'Reading listing…' };
        renderResult();
        break;
      case 'filed':
        document.getElementById('cfReport')?.click();
        break;
    }
  };

  setTimeout(go, 240);
});
