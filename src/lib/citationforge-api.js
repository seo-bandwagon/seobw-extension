// CitationForge API Client — vanilla JS, no dependencies

const CF_DEFAULT_URL = 'http://localhost:8000';
const CF_STORAGE_KEY = 'citationforge';
const CF_DEV_MODE = true; // Set false for production OAuth flow
const CF_DEV_EMAIL = 'test@example.com';

async function getCfSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(CF_STORAGE_KEY, (result) => {
      resolve(result[CF_STORAGE_KEY] || {});
    });
  });
}

async function saveCfSettings(data) {
  const existing = await getCfSettings();
  return new Promise(resolve => {
    chrome.storage.local.set({
      [CF_STORAGE_KEY]: { ...existing, ...data }
    }, resolve);
  });
}

function getCfApiUrl() {
  return CF_DEFAULT_URL;
}

// --- Auth ---

async function cfLogin() {
  if (CF_DEV_MODE) {
    await saveCfSettings({
      jwt: 'dev-mode',
      expiresAt: Date.now() + (24 * 60 * 60 * 1000),
      email: CF_DEV_EMAIL,
      name: 'Dev User',
      picture: null
    });
    return { access_token: 'dev-mode', expires_in: 86400 };
  }

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'No token'));
        return;
      }

      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const userInfo = await userInfoRes.json();

        const res = await fetch(`${getCfApiUrl()}/api/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            google_id_token: token,
            google_access_token: token
          })
        });

        if (!res.ok) {
          throw new Error(`Auth failed: ${res.status}`);
        }

        const data = await res.json();
        await saveCfSettings({
          jwt: data.access_token,
          expiresAt: Date.now() + (data.expires_in * 1000),
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture
        });

        resolve(data);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function cfLogout() {
  await saveCfSettings({ jwt: null, expiresAt: null, email: null, name: null, picture: null });
}

async function cfIsLoggedIn() {
  const settings = await getCfSettings();
  return !!(settings.jwt && settings.expiresAt && Date.now() < settings.expiresAt);
}

async function cfGetUser() {
  const settings = await getCfSettings();
  if (!settings.jwt) return null;
  return { email: settings.email, name: settings.name, picture: settings.picture };
}

// --- Fetch wrapper ---

async function cfFetch(path, opts = {}) {
  const settings = await getCfSettings();
  if (!settings.jwt) {
    throw new Error('Not authenticated with CitationForge');
  }

  const url = `${getCfApiUrl()}${path}`;
  const headers = { ...(opts.headers || {}) };

  if (CF_DEV_MODE) {
    headers['X-Dev-User'] = CF_DEV_EMAIL;
  } else {
    headers['Authorization'] = `Bearer ${settings.jwt}`;
  }

  if (!(opts.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    await cfLogout();
    throw new Error('Session expired — please sign in again');
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// --- Businesses ---

async function cfGetBusinesses() {
  return cfFetch('/api/businesses');
}

async function cfGetBusiness(id) {
  return cfFetch(`/api/businesses/${id}`);
}

async function cfGetBusinessStats(id) {
  return cfFetch(`/api/businesses/${id}/stats`);
}

// --- Campaigns ---

async function cfTriggerCampaign(businessId) {
  return cfFetch(`/api/businesses/${businessId}/campaigns`, { method: 'POST' });
}

async function cfGetCampaigns(businessId) {
  return cfFetch(`/api/businesses/${businessId}/campaigns`);
}

async function cfGetCampaign(id) {
  return cfFetch(`/api/campaigns/${id}`);
}

// --- Citations ---

async function cfGetCitations(businessId, status) {
  const params = status ? `?status=${status}` : '';
  return cfFetch(`/api/businesses/${businessId}/citations${params}`);
}

async function cfCreateCitation(businessId, data) {
  return cfFetch(`/api/businesses/${businessId}/citations`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// --- Screenshots ---

async function cfUploadScreenshot(businessId, dataUrl, pageUrl, citationId) {
  const blob = await (await fetch(dataUrl)).blob();
  const form = new FormData();
  form.append('file', blob, 'screenshot.png');
  form.append('business_id', businessId);
  form.append('page_url', pageUrl);
  if (citationId) {
    form.append('citation_id', citationId);
  }

  return cfFetch('/api/screenshots/upload', { method: 'POST', body: form });
}

async function cfGetScreenshots(businessId) {
  return cfFetch(`/api/businesses/${businessId}/screenshots`);
}

// --- Directories ---

async function cfGetDirectories() {
  return cfFetch('/api/directories');
}
