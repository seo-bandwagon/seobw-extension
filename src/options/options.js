// SEO Bandwagon — Options page
//
// Wiring for src/options/options.html. Pure logic (API URL validation/
// normalisation, verify-result → message/class) lives in
// src/lib/options-logic.js (SBWOptions) so it's unit-testable without
// chrome/DOM. The "signed in" cache (sbwUser / sbwKeyStatus, 10-minute TTL)
// is the same shape and freshness check the popup's Citations tab uses
// (SBWCitations.isUserCacheFresh, src/lib/citations-ui.js) — kept in sync
// here so both surfaces agree on whether a re-verify round trip is needed.

function setStatus(el, message, cls) {
  if (!el) return;
  el.textContent = message || '';
  el.className = 'status' + (cls ? ' ' + cls : '');
}

/* ---------- key: load / verify / disconnect ---------- */

async function renderVerifyResult(res) {
  if (res.ok) {
    await chrome.storage.local.set({ sbwUser: { data: res.data, at: Date.now() } });
  }
  setStatus(
    document.getElementById('keyStatus'),
    SBWOptions.verifyStatusMessage(res),
    SBWOptions.verifyStatusClass(res)
  );
}

// On load: show the cached result if it's still fresh, otherwise re-verify —
// same rule as checkSignedIn() in src/popup/citations-tab.js.
async function showStoredKeyStatus() {
  const statusEl = document.getElementById('keyStatus');
  const settings = await SBW.getApiSettings();
  if (!settings.apiKey) return;

  const stored = await chrome.storage.local.get(['sbwUser', 'sbwKeyStatus']);
  if (stored.sbwKeyStatus === 'invalid') {
    setStatus(statusEl, SBWOptions.verifyStatusMessage({ ok: false, code: 'unauthorized' }), 'error');
    return;
  }
  if (SBWCitations.isUserCacheFresh(stored.sbwUser)) {
    setStatus(statusEl, SBWOptions.verifyStatusMessage({ ok: true, data: stored.sbwUser.data }), 'success');
    return;
  }

  setStatus(statusEl, 'Verifying…', 'pending');
  const res = await SBW.verifyKey();
  await renderVerifyResult(res);
}

async function verifyKeyFromField() {
  const statusEl = document.getElementById('keyStatus');
  const key = document.getElementById('apiKey').value.trim();
  if (!key) {
    setStatus(statusEl, 'Enter a key first', 'error');
    return;
  }

  setStatus(statusEl, 'Verifying…', 'pending');
  await new Promise(resolve => chrome.storage.sync.set({ apiKey: key }, resolve));
  const res = await SBW.verifyKey();
  await renderVerifyResult(res);
}

async function disconnect() {
  document.getElementById('apiKey').value = '';
  await new Promise(resolve => chrome.storage.sync.set({ apiKey: '' }, resolve));
  await chrome.storage.local.remove(['sbwUser', 'sbwKeyStatus']);
  setStatus(document.getElementById('keyStatus'), 'Disconnected', 'pending');
}

/* ---------- dashboard links ---------- */

async function openDashboardPath(path) {
  const settings = await SBW.getApiSettings();
  const origin = SBWOptions.dashboardOrigin(settings.apiUrl);
  chrome.tabs.create({ url: origin + path });
}

function wireLink(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    handler();
  });
}

/* ---------- advanced: API endpoint ---------- */

async function saveAdvancedApiUrl() {
  const statusEl = document.getElementById('advancedStatus');
  const field = document.getElementById('apiUrl');
  const raw = field.value.trim();

  if (!SBWOptions.isValidApiUrl(raw)) {
    setStatus(statusEl, 'Must be an https:// URL, or http://localhost / http://127.0.0.1 for local dev', 'error');
    return;
  }

  if (SBWOptions.isLocalhostUrl(raw)) {
    const granted = await chrome.permissions.request({
      origins: ['http://localhost/*', 'http://127.0.0.1/*']
    });
    if (!granted) {
      setStatus(statusEl, 'Permission denied — endpoint not saved', 'error');
      return;
    }
  }

  const normalized = SBWOptions.normalizeApiUrl(raw);
  await new Promise(resolve => chrome.storage.sync.set({ apiUrl: normalized }, resolve));
  field.value = normalized;
  setStatus(statusEl, 'Endpoint saved: ' + normalized, 'success');
}

/* ---------- data collection toggle ---------- */
// Mirrors initDataToggle() in src/popup/popup.js — same storage.local key,
// same "off means local only" semantics.

async function initDataToggle() {
  const toggle = document.getElementById('dataToggle');
  if (!toggle) return;
  const result = await chrome.storage.local.get('dataCollection');
  toggle.checked = result.dataCollection !== false;
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ dataCollection: toggle.checked });
  });
}

/* ---------- load / save ---------- */

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get({
    apiKey: '',
    apiUrl: 'https://seobandwagon.com/api',
    autoSave: false,
    showNotifications: true,
    localBackup: true
  }, (items) => {
    document.getElementById('apiKey').value = items.apiKey;
    document.getElementById('apiUrl').value = items.apiUrl;
    document.getElementById('autoSave').checked = items.autoSave;
    document.getElementById('showNotifications').checked = items.showNotifications;
    document.getElementById('localBackup').checked = items.localBackup;
  });

  showStoredKeyStatus();
  initDataToggle();

  wireLink('linkHistory', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/history/history.html') });
  });
  wireLink('linkCaptures', () => openDashboardPath('/captures'));
  wireLink('linkCitations', () => openDashboardPath('/dashboard/citations'));
  wireLink('linkLinkBuilding', () => openDashboardPath('/dashboard/link-building'));
});

document.getElementById('verifyBtn').addEventListener('click', verifyKeyFromField);
document.getElementById('disconnectBtn').addEventListener('click', disconnect);
document.getElementById('saveAdvancedBtn').addEventListener('click', saveAdvancedApiUrl);

// Save settings
document.getElementById('saveBtn').addEventListener('click', () => {
  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    autoSave: document.getElementById('autoSave').checked,
    showNotifications: document.getElementById('showNotifications').checked,
    localBackup: document.getElementById('localBackup').checked
  };

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById('status');
    status.textContent = '✓ Settings saved successfully';
    status.className = 'status success';

    setTimeout(() => {
      status.className = 'status';
    }, 3000);
  });
});
