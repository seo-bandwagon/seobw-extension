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

// True if `newKey` (already trimmed by the caller) differs from what's
// currently in storage.sync — the shared "did the key rotate?" check for
// both Save and Verify (SBWOptions.keyChanged, tested in isolation). A
// changed key means any cached sbwUser/sbwKeyStatus belongs to the OLD key
// and must be dropped before anything re-verifies, or a stale "Connected
// as …" from key A would keep showing for up to sbwUser's 10-minute TTL
// after switching to key B.
async function keyChangedFromStorage(newKey) {
  const stored = await chrome.storage.sync.get({ apiKey: '' });
  return SBWOptions.keyChanged(stored.apiKey, newKey);
}

// On load: show the cached result if it's still fresh, otherwise re-verify —
// same rule as checkSignedIn() in src/popup/citations-tab.js. Takes the
// already-loaded apiKey (from the single storage.sync read in
// DOMContentLoaded below) instead of re-reading storage via
// SBW.getApiSettings().
async function showStoredKeyStatus(apiKey) {
  const statusEl = document.getElementById('keyStatus');
  if (!apiKey) return;

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

// Always verifies the FIELD's current value — saving it to storage.sync
// first (clearing any cache left over from a different key) so Verify and
// Save can never disagree about which key is actually in effect.
async function verifyKeyFromField() {
  const statusEl = document.getElementById('keyStatus');
  const key = document.getElementById('apiKey').value.trim();
  if (!key) {
    setStatus(statusEl, 'Enter a key first', 'error');
    return;
  }

  if (await keyChangedFromStorage(key)) {
    await chrome.storage.local.remove(['sbwUser', 'sbwKeyStatus']);
  }
  await new Promise(resolve => chrome.storage.sync.set({ apiKey: key }, resolve));

  setStatus(statusEl, 'Verifying…', 'pending');
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
    setStatus(statusEl, 'Only seobandwagon.com, its deploy previews, or localhost are allowed', 'error');
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

document.addEventListener('DOMContentLoaded', async () => {
  // Single storage.sync read — also backs showStoredKeyStatus below, instead
  // of it separately calling SBW.getApiSettings() (which would just re-read
  // the same apiKey out of the same storage area a second time).
  const items = await new Promise(resolve => chrome.storage.sync.get({
    apiKey: '',
    apiUrl: 'https://seobandwagon.com/api'
  }, resolve));

  document.getElementById('apiKey').value = items.apiKey;
  document.getElementById('apiUrl').value = items.apiUrl;

  showStoredKeyStatus(items.apiKey);
  initDataToggle();

  wireLink('linkHistory', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/history/history.html') });
  });
  wireLink('linkCaptures', () => openDashboardPath('/captures'));
  // Appearance (Night / Day / Auto) + links to the matching Chrome themes.
  // The links stay hidden until THEME_IDS in src/lib/theme-mode.js holds the
  // real Web Store item ids (placeholders make listingUrl() return null).
  if (globalThis.SBWTheme) {
    SBWTheme.bindControl(document.getElementById('optAppearance'));
    const night = SBWTheme.listingUrl('dark'), day = SBWTheme.listingUrl('light');
    if (night && day) {
      document.getElementById('linkThemeNight').href = night;
      document.getElementById('linkThemeDay').href = day;
      document.getElementById('themeLinks').hidden = false;
    }
  }
  wireLink('linkCitations', () => openDashboardPath('/dashboard/citations'));
  wireLink('linkLinkBuilding', () => openDashboardPath('/dashboard/link-building'));
});

document.getElementById('verifyBtn').addEventListener('click', verifyKeyFromField);
document.getElementById('disconnectBtn').addEventListener('click', disconnect);
document.getElementById('saveAdvancedBtn').addEventListener('click', saveAdvancedApiUrl);

// Save settings. The key field is included here too (not just Verify) so a
// user who pastes a new key and clicks "Save Settings" without noticing the
// Verify button still gets a correct, non-stale key status — a changed key
// drops the old key's cached sbwUser/sbwKeyStatus, and a non-empty key is
// always re-verified after saving, so Save effectively verifies too.
document.getElementById('saveBtn').addEventListener('click', async () => {
  const keyField = document.getElementById('apiKey').value.trim();
  const changed = await keyChangedFromStorage(keyField);
  if (changed) {
    await chrome.storage.local.remove(['sbwUser', 'sbwKeyStatus']);
  }

  await new Promise(resolve => chrome.storage.sync.set({ apiKey: keyField }, resolve));

  const status = document.getElementById('status');
  status.textContent = '✓ Settings saved successfully';
  status.className = 'status success';
  setTimeout(() => {
    status.className = 'status';
  }, 3000);

  if (keyField) {
    setStatus(document.getElementById('keyStatus'), 'Verifying…', 'pending');
    const res = await SBW.verifyKey();
    await renderVerifyResult(res);
  } else if (changed) {
    // The key field was cleared — say so explicitly rather than leaving the
    // status blank, which reads as "nothing happened" instead of "you're
    // disconnected now".
    setStatus(document.getElementById('keyStatus'), 'Disconnected', 'pending');
  }
});

// "Rate it on the Chrome Web Store" uses the review prompt's URL
// (src/lib/review-prompt.js), the one place it is defined.
document.querySelectorAll('[data-review-link]').forEach(a => { a.href = SBWReview.REVIEW_URL; });
