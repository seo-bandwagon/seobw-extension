// SEO Bandwagon - Background Service Worker

// Cache: tabId -> { url, data, timestamp }
const tabCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'analyze-page',
    title: 'Analyze this page with SEO Bandwagon',
    contexts: ['page']
  });
  
  chrome.contextMenus.create({
    id: 'analyze-link',
    title: 'Analyze linked page',
    contexts: ['link']
  });
});

// Clear cache when tab navigates to a new URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    delete tabCache[tabId];
  }
});

// Clear cache when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCache[tabId];
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'analyze-page') {
    chrome.action.openPopup();
  } else if (info.menuItemId === 'analyze-link') {
    chrome.tabs.create({ url: info.linkUrl }, (newTab) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => { chrome.action.openPopup(); }, 500);
        }
      });
    });
  }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'analyze-current') {
    chrome.action.openPopup();
  }
});

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Cache check: popup asks if we have fresh data for this tab
  if (request.action === 'getCachedAnalysis') {
    const { tabId, url } = request;
    const cached = tabCache[tabId];
    if (cached && cached.url === url && (Date.now() - cached.timestamp) < CACHE_TTL) {
      sendResponse({ hit: true, data: cached.data });
    } else {
      sendResponse({ hit: false });
    }
    return true;
  }

  // Cache store: popup tells us it got fresh analysis data
  if (request.action === 'storeAnalysis') {
    const { tabId, url, data } = request;
    tabCache[tabId] = { url, data, timestamp: Date.now() };
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'getLocalCaptures') {
    chrome.storage.local.get(null, (items) => {
      const captures = Object.entries(items)
        .filter(([k]) => k.startsWith('capture_'))
        .map(([k, v]) => ({ key: k, ...v }))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      sendResponse(captures);
    });
    return true;
  }
  
  if (request.action === 'updateBadge') {
    const { score, grade } = request;
    const colors = { 'A': '#06d6a0', 'B': '#4cc9f0', 'C': '#ffd166', 'D': '#f77f00', 'F': '#ef476f' };
    chrome.action.setBadgeText({ text: grade, tabId: request.tabId });
    chrome.action.setBadgeBackgroundColor({ color: colors[grade] || '#888', tabId: request.tabId });
  }
});
