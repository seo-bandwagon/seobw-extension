// SEO Bandwagon - API Client

const API_DEFAULT_URL = 'https://seobandwagon.com/api';

/**
 * Get API settings from sync storage
 */
async function getApiSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get({
      apiKey: '',
      apiUrl: API_DEFAULT_URL
    }, resolve);
  });
}

/**
 * Check if data collection is enabled (default: true)
 */
async function isDataCollectionEnabled() {
  const result = await chrome.storage.local.get('dataCollection');
  return result.dataCollection !== false;
}

/**
 * Send analysis to API (fire-and-forget)
 * Gated by data collection preference
 */
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

/**
 * Save capture to local storage with dedup and cleanup
 */
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
