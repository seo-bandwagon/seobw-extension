// SEO Bandwagon — Unified API Client (SBW)
//
// Dual-export pattern: attaches `SBW` to `globalThis` when loaded as a
// classic <script> (popup/options/history/sidepanel pages) or via
// importScripts (service worker), and exports via CommonJS when loaded by
// Vitest / Node. See lib/content-analysis.js for the same pattern.
//
// Two legacy globals — `getApiSettings` and `autoSaveLocal` — are kept as
// thin aliases at the bottom of this file for files not yet migrated to the
// SBW namespace.
//
// Capture sync (Task 2): `SBW.syncCapture` / `SBW.drainPendingCaptures` /
// `SBW.markLegacyPending` post a saved capture and record the outcome via
// `SBWSync` (src/lib/sync-state.js) on the stored record's `sync` field.
// Any file that loads this script must load sync-state.js first — see
// service-worker.js's importScripts order and history.html's <script> order.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBW = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const API_DEFAULT_URL = 'https://seobandwagon.com/api';

  // ============================================
  // Settings
  // ============================================

  function normalizeApiUrl(url) {
    let normalized = String(url || '').trim().replace(/\/+$/, '');
    if (!normalized) normalized = API_DEFAULT_URL;
    if (!/\/api$/.test(normalized)) normalized += '/api';
    return normalized;
  }

  async function getApiSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get({
        apiKey: '',
        apiUrl: API_DEFAULT_URL
      }, (result) => {
        resolve({
          apiKey: result.apiKey,
          apiUrl: normalizeApiUrl(result.apiUrl)
        });
      });
    });
  }

  async function isDataCollectionEnabled() {
    const result = await chrome.storage.local.get('dataCollection');
    return result.dataCollection !== false;
  }

  // ============================================
  // Core fetch wrapper
  // ============================================

  function buildUrl(base, path, query) {
    let url = base + (path.startsWith('/') ? path : `/${path}`);
    if (query && Object.keys(query).length) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) params.append(key, value);
      });
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  async function sbwFetch(path, options = {}) {
    const { method = 'GET', body, query, timeoutMs = 15000 } = options;

    let settings;
    try {
      settings = await getApiSettings();
    } catch (e) {
      return { ok: false, status: 0, data: null, retryAfter: null, code: 'network' };
    }

    const url = buildUrl(settings.apiUrl, path, query);
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, status: 0, data: null, retryAfter: null, code: 'network' };
    }
    clearTimeout(timer);

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (res.ok) {
      if (settings.apiKey) {
        chrome.storage.local.set({ sbwKeyStatus: 'valid' });
      }
      return { ok: true, status: res.status, data, retryAfter: null, code: 'ok' };
    }

    let code;
    let retryAfter = null;
    switch (res.status) {
      case 401:
        code = 'unauthorized';
        chrome.storage.local.set({ sbwKeyStatus: 'invalid' });
        break;
      case 403:
        code = 'forbidden';
        break;
      case 409:
        code = 'conflict';
        break;
      case 429:
        code = 'rate_limited';
        retryAfter = Number(res.headers.get('Retry-After')) || 60;
        break;
      case 503:
        code = 'unavailable';
        break;
      default:
        code = 'error';
    }

    return { ok: false, status: res.status, data, retryAfter, code };
  }

  // ============================================
  // No key, no request
  // ============================================
  //
  // Every account endpoint below short-circuits BEFORE calling fetch when no
  // apiKey is stored — sbwFetch() itself still allows a keyless call (it just
  // omits the Authorization header), because it's also used as the generic
  // bridge for content scripts (service-worker.js's 'sbwFetch' message) where
  // that's a deliberate passthrough. The wrappers are where "nothing leaves
  // the browser without a key" is actually enforced.

  function noKeyResult() {
    return { ok: false, status: 0, data: null, retryAfter: null, code: 'no_key' };
  }

  async function hasApiKey() {
    const settings = await getApiSettings();
    return !!settings.apiKey;
  }

  // ============================================
  // Captures / domain
  // ============================================

  async function verifyKey() {
    if (!(await hasApiKey())) return noKeyResult();
    return sbwFetch('/v1/me');
  }

  async function postCapture(payload) {
    if (!(await hasApiKey())) return noKeyResult();
    const manifest = chrome.runtime.getManifest();
    const body = Object.assign({}, payload, {
      extensionVersion: manifest.version,
      userAgent: navigator.userAgent
    });
    return sbwFetch('/v1/captures', { method: 'POST', body });
  }

  async function capturesForUrl(url) {
    if (!(await hasApiKey())) return noKeyResult();
    return sbwFetch('/v1/captures', { query: { url } });
  }

  async function quickDomain(domain) {
    if (!(await hasApiKey())) return noKeyResult();
    return sbwFetch(`/domain/${encodeURIComponent(domain)}/quick`);
  }

  // The account's rank tracking summary and derived tasks, for the new tab
  // page (GET /api/extension/progress, scope `progress`). A key minted before
  // that scope existed answers 403 ('forbidden'); a site without the route
  // answers 404 ('error').
  async function progress(query) {
    if (!(await hasApiKey())) return noKeyResult();
    return sbwFetch('/extension/progress', { query });
  }

  async function quickBatch(domains) {
    if (!(await hasApiKey())) return noKeyResult();
    return sbwFetch('/domain/quick-batch', { method: 'POST', body: { domains } });
  }

  // ============================================
  // Capture sync (Task 2)
  // ============================================
  //
  // Storage shape: each `capture_<ts>` value in chrome.storage.local gains a
  // `sync` field shaped by SBWSync (src/lib/sync-state.js) —
  // { status, attempts, nextAt, ... } — that records the outcome of trying
  // to post that capture to the server.

  // Posts one stored capture and records the result. Returns the sync state
  // that was written to storage, plus a `code` (the sbwFetch()/skip code
  // that produced it) so callers like drainPendingCaptures can tell a
  // rate limit apart from a duplicate without re-deriving it.
  async function syncCapture(key) {
    const enabled = await isDataCollectionEnabled();
    if (!enabled) return { status: 'skipped', error: 'collection_off', code: 'collection_off' };

    const settings = await getApiSettings();
    if (!settings.apiKey) return { status: 'skipped', error: 'no_key', code: 'no_key' };

    const items = await chrome.storage.local.get(key);
    const data = items[key];
    if (!data) return { status: 'skipped', error: 'not_found', code: 'not_found' };

    const payload = Object.assign({}, data);
    delete payload.sync;

    const result = await postCapture(payload);
    const now = Date.now();
    const prevSync = data.sync || SBWSync.initialSync();
    const newSync = SBWSync.nextSyncState(prevSync, result, now);

    await chrome.storage.local.set({ [key]: Object.assign({}, data, { sync: newSync }) });

    return Object.assign({}, newSync, { code: result.code });
  }

  // Drains up to `max` due captures (oldest first), sequentially. Stops
  // early on a rate limit (429), an outage (503), an auth problem
  // (missing/invalid key), or data collection being off — those affect
  // every remaining item the same way, so there's no point burning through
  // the rest of the batch.
  async function drainPendingCaptures({ max = 20, now = Date.now() } = {}) {
    const items = await chrome.storage.local.get(null);
    const captures = Object.entries(items)
      .filter(([k]) => k.startsWith('capture_'))
      .map(([key, data]) => ({ key, data }));

    const due = SBWSync.pickDue(captures, now, max);

    let sent = 0;
    let synced = 0;
    let duplicates = 0;
    let stoppedOn = null;
    let nextAt = null;

    for (const entry of due) {
      const result = await syncCapture(entry.key);
      sent++;

      if (result.status === 'synced') synced++;
      else if (result.status === 'duplicate') duplicates++;

      if (result.code === 'rate_limited' || result.code === 'unavailable' ||
          result.code === 'unauthorized' || result.code === 'no_key' ||
          result.code === 'collection_off') {
        stoppedOn = result.code;
        nextAt = result.nextAt || null;
        break;
      }
    }

    return { sent, synced, duplicates, stoppedOn, nextAt };
  }

  // One-time stamp for captures saved before this feature existed. These are
  // marked `skipped`/`legacy` rather than `pending` — a 1.4.0 upgrader who
  // never opted into sync shouldn't have up to 500 historical captures
  // silently bulk-uploaded the first time the drainer alarm fires. `pickDue`
  // ignores `skipped` captures, so nothing happens to them until the History
  // page's "Include them in sync" button calls `SBWSync.unskipLegacy()` to
  // opt them back into the normal pending/due flow.
  async function markLegacyPending() {
    const items = await chrome.storage.local.get(null);
    const updates = {};

    Object.entries(items).forEach(([key, data]) => {
      if (key.startsWith('capture_') && data && !data.sync) {
        updates[key] = Object.assign({}, data, {
          sync: { status: 'skipped', error: 'legacy', attempts: 0, nextAt: 0 }
        });
      }
    });

    const keys = Object.keys(updates);
    if (keys.length) {
      await chrome.storage.local.set(updates);
    }
    return keys.length;
  }

  // ============================================
  // Link building
  // ============================================

  const lb = {
    async addOutlet({ url, name, status, note }) {
      if (!(await hasApiKey())) return noKeyResult();
      const manifest = chrome.runtime.getManifest();
      return sbwFetch('/link-building/prospects', {
        method: 'POST',
        body: { url, name, status, note, extension_version: manifest.version }
      });
    },

    async prospects(status, limit = 200) {
      if (!(await hasApiKey())) return noKeyResult();
      return sbwFetch('/link-building/prospects', { query: { status, limit } });
    },

    async reviewProspects(ids, action, reason) {
      if (!(await hasApiKey())) return noKeyResult();
      return sbwFetch('/link-building/prospects/review', {
        method: 'POST',
        body: { ids, action, reason }
      });
    },

    async pitches(status, limit = 50) {
      if (!(await hasApiKey())) return noKeyResult();
      return sbwFetch('/link-building/pitches', { query: { status, limit } });
    },

    async reviewPitch(id, action, extra = {}) {
      if (!(await hasApiKey())) return noKeyResult();
      return sbwFetch('/link-building/pitches/review', {
        method: 'POST',
        body: Object.assign({ id, action }, extra)
      });
    },

    async markSent(id) {
      if (!(await hasApiKey())) return noKeyResult();
      return sbwFetch('/link-building/pitches/dispatch', {
        method: 'POST',
        body: { id, action: 'mark_sent' }
      });
    },

    async results() {
      if (!(await hasApiKey())) return noKeyResult();
      return sbwFetch('/link-building/results');
    }
  };

  // ============================================
  // Citations (formerly CitationForge's ct* wrappers)
  // ============================================

  // ct* wrappers unwrap the server's `{ data }` envelope into the raw data
  // for callers, rather than returning the full sbwFetch result — but that
  // means a non-ok response has nowhere to carry its status/code once
  // unwrapped. CtError (thrown by unwrapCtData below on !res.ok) carries
  // `.code`/`.status`/`.data` forward, mirroring how the removed
  // CitationForge client's wrappers threw on failure — citations-tab.js and
  // sidepanel.js (Task 4) use `.code` to flip to signed-out on `unauthorized`,
  // show a scope message on `forbidden`, and poll on a campaign-trigger
  // timeout/504.
  class CtError extends Error {
    constructor(res) {
      const serverMessage = res && res.data && typeof res.data === 'object' ? res.data.error : null;
      super(serverMessage || (res && res.code) || 'Request failed');
      this.name = 'CtError';
      this.code = res ? res.code : 'network';
      this.status = res ? res.status : 0;
      this.data = res ? res.data : null;
    }
  }

  function unwrapCtData(res) {
    if (!res || !res.ok) {
      throw new CtError(res);
    }
    if (res.data && typeof res.data === 'object' && !Array.isArray(res.data) && 'data' in res.data) {
      return res.data.data;
    }
    return res.data;
  }

  async function requireKeyForCt() {
    if (!(await hasApiKey())) throw new CtError(noKeyResult());
  }

  const ct = {
    async businesses() {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch('/citations/businesses'));
    },

    async business(id) {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}`));
    },

    async stats(id) {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/stats`));
    },

    async citations(id, status) {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/citations`, { query: { status } }));
    },

    async createCitation(id, payload) {
      await requireKeyForCt();
      const res = await sbwFetch(`/citations/businesses/${id}/citations`, {
        method: 'POST',
        body: payload
      });
      const unwrapped = unwrapCtData(res);
      const created = !!(res && res.data && res.data.created);
      if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
        return Object.assign({}, unwrapped, { created });
      }
      return unwrapped;
    },

    async updateCitation(citationId, patch) {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch(`/citations/${citationId}`, { method: 'PATCH', body: patch }));
    },

    async campaigns(id) {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/campaigns`));
    },

    async triggerCampaign(id) {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/campaigns`, {
        method: 'POST',
        timeoutMs: 60000
      }));
    },

    async campaign(id) {
      await requireKeyForCt();
      return unwrapCtData(await sbwFetch(`/citations/campaigns/${id}`));
    }
  };

  // ============================================
  // Legacy: fire-and-forget local save
  // Relocated from the old lib/api.js. Kept as a thin alias below for files
  // not yet migrated to the SBW namespace. Its counterpart `sendToApi` was
  // removed in Task 2 — capture posting now goes through `syncCapture`,
  // which records a real sync outcome instead of firing and forgetting.
  // ============================================

  // Fix round 1, IMPORTANT 5: the whole body is wrapped in try/catch — a
  // storage.local write can fail (most commonly QUOTA_BYTES exceeded once
  // 500 captures' worth of full-page analyses, now schema `properties`-
  // stripped by the caller but still substantial, pile up) and the caller
  // (popup.js's autoSaveCapture, called fire-and-forget with no catch of
  // its own) must never see that as an unhandled rejection. Logged, not
  // thrown; the freshly-minted key is still returned so a caller that goes
  // on to call syncCapture(key) doesn't also need a null check — that sync
  // will just no-op against a key storage never actually wrote.
  // Leaves ~2 MB of the 10 MB local quota for everything else.
  const CAPTURE_BYTES_BUDGET = 8 * 1024 * 1024;
  const CAPTURE_MAX_COUNT = 500;

  // Keys of the oldest captures to remove so a new record of `newBytes`
  // fits. `items` is all of chrome.storage.local; sizes are measured the way
  // Chrome counts them (key + JSON of the value).
  function capturesToPrune(items, newBytes) {
    let total = newBytes;
    const captures = [];
    for (const [k, v] of Object.entries(items)) {
      const bytes = k.length + JSON.stringify(v === undefined ? null : v).length;
      total += bytes;
      if (k.startsWith('capture_')) captures.push({ k, bytes, ts: parseInt(k.slice(8), 10) || 0 });
    }
    captures.sort((a, b) => a.ts - b.ts); // oldest first
    const out = [];
    let count = captures.length + 1;
    for (const c of captures) {
      if (total <= CAPTURE_BYTES_BUDGET && count <= CAPTURE_MAX_COUNT) break;
      out.push(c.k);
      total -= c.bytes;
      count -= 1;
    }
    return out;
  }

  async function autoSaveLocal(data) {
    const key = `capture_${Date.now()}`;

    try {
      const items = await chrome.storage.local.get(null);
      const recentCapture = Object.entries(items)
        .filter(([k]) => k.startsWith('capture_'))
        .find(([k, v]) => v.url === data.url && (Date.now() - parseInt(k.split('_')[1])) < 60000);

      if (!recentCapture) {
        const record = Object.assign({}, data, { sync: SBWSync.initialSync() });
        // #90: room is made before writing. A capture is 17-77 KB (35 KB on
        // average across real pages), so chrome.storage.local's 10 MB quota
        // filled at about 290, under the old 500-capture cap, and from then
        // on every save failed. The oldest captures go until the new one fits
        // in CAPTURE_BYTES_BUDGET and at most CAPTURE_MAX_COUNT remain,
        // counting the new one.
        const stale = capturesToPrune(items, key.length + JSON.stringify(record).length);
        if (stale.length) await chrome.storage.local.remove(stale);
        await chrome.storage.local.set({ [key]: record });
      }

      // Return the storage key holding this capture — the just-created one,
      // or the existing recent duplicate's, so callers can still sync it.
      return recentCapture ? recentCapture[0] : key;
    } catch (e) {
      console.error('autoSaveLocal failed:', e);
      return key;
    }
  }

  return {
    getApiSettings,
    isDataCollectionEnabled,
    sbwFetch,
    verifyKey,
    postCapture,
    capturesForUrl,
    quickDomain,
    progress,
    quickBatch,
    syncCapture,
    drainPendingCaptures,
    markLegacyPending,
    lb,
    ct,
    CtError,
    autoSaveLocal,
    capturesToPrune,
    CAPTURE_BYTES_BUDGET,
    CAPTURE_MAX_COUNT
  };
});

// Thin aliases for files not yet migrated to the SBW namespace (Task 2+).
if (typeof globalThis !== 'undefined' && globalThis.SBW) {
  globalThis.getApiSettings = globalThis.SBW.getApiSettings;
  globalThis.autoSaveLocal = globalThis.SBW.autoSaveLocal;
}
