// SEO Bandwagon - Background Service Worker

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
  
  console.log('SEO Bandwagon extension installed');
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'analyze-page') {
    // Open popup for current page
    chrome.action.openPopup();
  } else if (info.menuItemId === 'analyze-link') {
    // Open the linked page in a new tab, then analyze
    chrome.tabs.create({ url: info.linkUrl }, (newTab) => {
      // Wait for page to load, then open popup
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            chrome.action.openPopup();
          }, 500);
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    const colors = {
      'A': '#06d6a0',
      'B': '#4cc9f0', 
      'C': '#ffd166',
      'D': '#f77f00',
      'F': '#ef476f'
    };
    
    chrome.action.setBadgeText({ text: grade, tabId: request.tabId });
    chrome.action.setBadgeBackgroundColor({ color: colors[grade] || '#888', tabId: request.tabId });
  }
});
