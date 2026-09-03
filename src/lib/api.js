// SEO Bandwagon — Unified API Client (SBW)
//
// Dual-export pattern: attaches `SBW` to `globalThis` when loaded as a
// classic <script> (popup/options/history/sidepanel pages) or via
// importScripts (service worker), and exports via CommonJS when loaded by
// Vitest / Node. See lib/content-analysis.js for the same pattern.
//
// Two legacy globals — `getApiSettings` and `autoSaveLocal` — are kept as
// thin aliases at the bottom of this file for files not yet migrated to the
// SBW namespace. `sendToApi` is kept alongside them for the same reason:
// popup.js's autoSaveCapture() still calls it directly on every capture.

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
  // Captures / domain
  // ============================================

  async function verifyKey() {
    return sbwFetch('/v1/me');
  }

  async function postCapture(payload) {
    const manifest = chrome.runtime.getManifest();
    const body = Object.assign({}, payload, {
      extensionVersion: manifest.version,
      userAgent: navigator.userAgent
    });
    return sbwFetch('/v1/captures', { method: 'POST', body });
  }

  async function capturesForUrl(url) {
    return sbwFetch('/v1/captures', { query: { url } });
  }

  async function quickDomain(domain) {
    return sbwFetch(`/domain/${encodeURIComponent(domain)}/quick`);
  }

  async function quickBatch(domains) {
    return sbwFetch('/domain/quick-batch', { method: 'POST', body: { domains } });
  }

  // ============================================
  // Link building
  // ============================================

  const lb = {
    async addOutlet({ url, name, status, note }) {
      const manifest = chrome.runtime.getManifest();
      return sbwFetch('/link-building/prospects', {
        method: 'POST',
        body: { url, name, status, note, extension_version: manifest.version }
      });
    },

    async prospects(status, limit = 200) {
      return sbwFetch('/link-building/prospects', { query: { status, limit } });
    },

    async reviewProspects(ids, action, reason) {
      return sbwFetch('/link-building/prospects/review', {
        method: 'POST',
        body: { ids, action, reason }
      });
    },

    async pitches(status, limit = 50) {
      return sbwFetch('/link-building/pitches', { query: { status, limit } });
    },

    async reviewPitch(id, action, extra = {}) {
      return sbwFetch('/link-building/pitches/review', {
        method: 'POST',
        body: Object.assign({ id, action }, extra)
      });
    },

    async markSent(id) {
      return sbwFetch('/link-building/pitches/dispatch', {
        method: 'POST',
        body: { id, action: 'mark_sent' }
      });
    },

    async results() {
      return sbwFetch('/link-building/results');
    }
  };

  // ============================================
  // Citations (formerly CitationForge's ct* wrappers)
  // ============================================

  // ct* wrappers unwrap the server's `{ data }` envelope into the raw data
  // for callers, rather than returning the full sbwFetch result.
  function unwrapCtData(res) {
    if (res && res.data && typeof res.data === 'object' && !Array.isArray(res.data) && 'data' in res.data) {
      return res.data.data;
    }
    return res ? res.data : undefined;
  }

  const ct = {
    async businesses() {
      return unwrapCtData(await sbwFetch('/citations/businesses'));
    },

    async business(id) {
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}`));
    },

    async stats(id) {
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/stats`));
    },

    async citations(id, status) {
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/citations`, { query: { status } }));
    },

    async createCitation(id, payload) {
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
      return unwrapCtData(await sbwFetch(`/citations/${citationId}`, { method: 'PATCH', body: patch }));
    },

    async campaigns(id) {
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/campaigns`));
    },

    async triggerCampaign(id) {
      return unwrapCtData(await sbwFetch(`/citations/businesses/${id}/campaigns`, {
        method: 'POST',
        timeoutMs: 60000
      }));
    },

    async campaign(id) {
      return unwrapCtData(await sbwFetch(`/citations/campaigns/${id}`));
    }
  };

  // ============================================
  // Legacy: fire-and-forget capture send + local save
  // Unchanged behavior, relocated from the old lib/api.js. Kept as thin
  // aliases below for popup.js, which still calls them directly.
  // ============================================

  async function sendToApi(data) {
    try {
      const enabled = await isDataCollectionEnabled();
      if (!enabled) return;

      const settings = await getApiSettings();
      const headers = { 'Content-Type': 'application/json' };
      if (settings.apiKey) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
      }

      fetch(`${settings.apiUrl}/v1/captures`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
      }).catch(() => {});
    } catch (e) {
      // Silent fail — never interrupt user experience
    }
  }

  async function autoSaveLocal(data) {
    const key = `capture_${Date.now()}`;

    const items = await chrome.storage.local.get(null);
    const recentCapture = Object.entries(items)
      .filter(([k]) => k.startsWith('capture_'))
      .find(([k, v]) => v.url === data.url && (Date.now() - parseInt(k.split('_')[1])) < 60000);

    if (!recentCapture) {
      chrome.storage.local.set({ [key]: data });
      console.log('Auto-saved capture:', data.url);
    }

    // Cleanup: keep only last 500 captures
    const captureKeys = Object.keys(items)
      .filter(k => k.startsWith('capture_'))
      .sort()
      .reverse();

    if (captureKeys.length > 500) {
      chrome.storage.local.remove(captureKeys.slice(500));
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
    quickBatch,
    lb,
    ct,
    sendToApi,
    autoSaveLocal
  };
});

// Thin aliases for files not yet migrated to the SBW namespace (Task 2+).
if (typeof globalThis !== 'undefined' && globalThis.SBW) {
  globalThis.getApiSettings = globalThis.SBW.getApiSettings;
  globalThis.autoSaveLocal = globalThis.SBW.autoSaveLocal;
  globalThis.sendToApi = globalThis.SBW.sendToApi;

  // CitationForge is being removed (Task 4 repoints citations-tab.js /
  // sidepanel.js to SBW.ct.*). Until then, cfIsLoggedIn is still called by
  // both files' init paths; without this shim they'd throw a ReferenceError
  // on load since citationforge-api.js no longer defines it.
  globalThis.cfIsLoggedIn = async () => false; // removed in Task 4
}
