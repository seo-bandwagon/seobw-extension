// SEO Bandwagon - Background Service Worker

importScripts('../lib/sync-state.js', '../lib/api.js', '../lib/directory-matcher.js', '../lib/link-check.js', '../lib/perms.js');

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

  chrome.contextMenus.create({
    id: 'seo-count-selection',
    title: 'Count words & characters',
    contexts: ['selection']
  });
});

// --- Capture sync: alarm-driven retry drainer (Task 2) ---
const SYNC_ALARM_NAME = 'sbw-sync';

function ensureSyncAlarm() {
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 15 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSyncAlarm();
  SBW.markLegacyPending(); // one-time stamp for captures saved before sync existed
});
chrome.runtime.onStartup.addListener(ensureSyncAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    SBW.drainPendingCaptures({ max: 20 });
  }
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
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
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
  } else if (info.menuItemId === 'seo-count-selection' && tab?.id) {
    try {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/content-analysis.js', 'lib/dom-extraction.js', 'src/lib/link-check.js', 'src/content/analyzer.js'] });
      } catch (e) { /* already injected */ }

      const results = await chrome.tabs.sendMessage(tab.id, { action: 'countSelection' });

      if (results) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showCountNotification,
          args: [results]
        });
      }
    } catch (e) {
      console.error('Count selection failed:', e);
    }
  }
});

function showCountNotification(stats) {
  const existing = document.getElementById('seo-bw-count');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.id = 'seo-bw-count';

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '999999',
    background: '#16213e', color: '#eee', borderRadius: '10px',
    padding: '14px 18px', fontFamily: '-apple-system, sans-serif',
    fontSize: '13px', lineHeight: '1.6', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    minWidth: '200px', animation: 'seoBwFadeIn 0.2s ease-out'
  });

  const title = document.createElement('div');
  Object.assign(title.style, { fontWeight: '600', marginBottom: '6px', fontSize: '14px', color: '#4cc9f0' });
  title.textContent = 'Text Count';

  const line1 = document.createElement('div');
  line1.textContent = `${stats.words.toLocaleString()} words \u00B7 ${stats.characters.toLocaleString()} characters`;

  const line2 = document.createElement('div');
  line2.textContent = `${stats.charactersNoSpaces.toLocaleString()} chars (no spaces) \u00B7 ${stats.sentences.toLocaleString()} sentences`;

  const line3 = document.createElement('div');
  Object.assign(line3.style, { marginTop: '4px', color: '#888', fontSize: '12px' });
  line3.textContent = `~${stats.readingTimeMin} min read`;

  container.append(title, line1, line2, line3);

  const style = document.createElement('style');
  style.textContent = '@keyframes seoBwFadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }';

  wrapper.append(container, style);
  document.body.appendChild(wrapper);

  setTimeout(() => {
    wrapper.style.transition = 'opacity 0.3s';
    wrapper.style.opacity = '0';
    setTimeout(() => wrapper.remove(), 300);
  }, 4000);
}

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'analyze-current') {
    chrome.action.openPopup();
  }
});

// --- CitationForge: directory badge on tab navigation ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      const match = matchDirectory(tab.url);
      if (match) {
        chrome.action.setBadgeText({ text: 'DIR', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#06d6a0', tabId });
      }
    } catch (e) {
      // directory-matcher not loaded yet
    }
  }
});

// Enable side panel on extension icon click (right-click)
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
});

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // GSC row actions: open the row's query/URL as a Google Search.
  if (request.action === 'openSearch') {
    const query = (request.query || '').trim();
    if (query) {
      chrome.tabs.create({ url: 'https://www.google.com/search?q=' + encodeURIComponent(query) });
    }
    sendResponse({ ok: !!query });
    return true;
  }

  // …and in a new incognito/private window. If the browser refuses (the
  // extension is not allowed in Incognito/Private), fall back to a normal
  // window and say so — the content script shows the user how to enable it.
  if (request.action === 'openIncognitoSearch') {
    const query = (request.query || '').trim();
    if (!query) {
      sendResponse({ ok: false });
      return true;
    }
    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    chrome.windows.create({ url: searchUrl, incognito: true }, () => {
      if (chrome.runtime.lastError) {
        chrome.windows.create({ url: searchUrl }, () => {
          sendResponse({ ok: true, incognito: false });
        });
      } else {
        sendResponse({ ok: true, incognito: true });
      }
    });
    return true;
  }

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

  if (request.action === 'captureScreenshot') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }

  if (request.action === 'checkDirectory') {
    const match = matchDirectory(request.url);
    sendResponse({ match });
    return true;
  }

  if (request.action === 'extractNap') {
    chrome.scripting.executeScript({
      target: { tabId: request.tabId },
      files: ['src/content/nap-extractor.js']
    }).then(() => {
      chrome.tabs.sendMessage(request.tabId, { action: 'extractNap' }, (result) => {
        sendResponse(result || { error: 'No NAP data found' });
      });
    }).catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.action === 'openSidePanel') {
    if (chrome.sidePanel) {
      chrome.sidePanel.open({ windowId: sender.tab?.windowId });
    }
    sendResponse({ ok: true });
    return true;
  }

  // Generic bridge: content scripts (no chrome.storage/fetch access of their
  // own in isolated-world contexts) route SBW API calls through here.
  if (request.action === 'sbwFetch') {
    SBW.sbwFetch(request.path, request.init).then(sendResponse);
    return true;
  }
});

// --- Broken-link checker: long-lived port, one per popup session (Task 1) ---
//
// The popup opens a `link-check` port and posts { type: 'start', links }.
// This never runs on its own — no auto-run on install or on analyze — and
// never requests the <all_urls> permission itself (SBWPerms.requestAllUrls()
// only ever runs from the popup's own click handler, a user gesture). If the
// permission isn't already granted when 'start' arrives, this replies with
// an error and does nothing else.
const LINK_CHECK_TIMEOUT_MS = 10000;
const LINK_CHECK_PER_HOST = 2;
const LINK_CHECK_GLOBAL = 6;

// One HEAD probe (retried once as GET on a 405/501 or a thrown non-abort
// error). `controller` is owned by the caller so a port disconnect can abort
// it from outside. Never sends cookies, never caches, always drains/cancels
// the body — nothing here reads response content. Result shape matches what
// src/lib/link-check.js's classify()/resultRows() expect: status 0 on any
// failure, with `error` set to 'timeout' (the AbortController fired) or
// 'network' (anything else — DNS, refused connection, opaque CORS, etc).
async function probeLink(url, controller) {
  const start = Date.now();
  const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
  const baseInit = { redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: controller.signal };

  async function attempt(method) {
    const res = await fetch(url, Object.assign({ method }, baseInit));
    if (res.body) { try { res.body.cancel(); } catch (e) { /* already drained */ } }
    return res;
  }

  try {
    let res;
    try {
      res = await attempt('HEAD');
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      res = await attempt('GET'); // thrown non-abort error on HEAD -> retry once with GET
    }
    if (res.status === 405 || res.status === 501) {
      res = await attempt('GET');
    }
    clearTimeout(timer);
    return { url, status: res.status, finalUrl: res.url, redirected: res.redirected, ms: Date.now() - start };
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err && err.name === 'AbortError';
    return { url, status: 0, finalUrl: null, redirected: false, ms: Date.now() - start, error: timedOut ? 'timeout' : 'network' };
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'link-check') return;

  let cancelled = false;
  let queue = [];
  let total = 0;
  let doneCount = 0;
  const results = [];
  const inflightByHost = {};
  const inflightControllers = new Set();

  port.onDisconnect.addListener(() => {
    cancelled = true;
    inflightControllers.forEach(c => { try { c.abort(); } catch (e) { /* already settled */ } });
    inflightControllers.clear();
  });

  function pump() {
    if (cancelled) return;
    let next;
    while ((next = SBWLinkCheck.pickNext(queue, inflightByHost, { perHost: LINK_CHECK_PER_HOST, global: LINK_CHECK_GLOBAL }))) {
      queue.splice(queue.indexOf(next), 1);
      runOne(next);
    }
    if (!cancelled && doneCount >= total) {
      port.postMessage({ type: 'done', results });
    }
  }

  async function runOne(item) {
    const host = SBWLinkCheck.hostKey(item.url);
    inflightByHost[host] = (inflightByHost[host] || 0) + 1;

    const controller = new AbortController();
    inflightControllers.add(controller);

    const probe = await probeLink(item.url, controller);

    inflightControllers.delete(controller);
    inflightByHost[host] -= 1;
    if (inflightByHost[host] <= 0) delete inflightByHost[host];

    if (cancelled) return;

    const result = Object.assign({}, item, probe);
    results.push(result);
    doneCount += 1;
    port.postMessage({ type: 'progress', done: doneCount, total, result });

    pump();
  }

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'start') return;

    const allowed = await SBWPerms.hasAllUrls();
    if (cancelled) return;
    if (!allowed) {
      port.postMessage({ type: 'error', code: 'no_permission' });
      return;
    }

    const planned = SBWLinkCheck.planChecks(msg.links || []);
    queue = planned.queue.slice();
    total = queue.length;
    doneCount = 0;
    results.length = 0;

    pump();
  });
});

// --- External connect handler (Chrome extension "connect" flow from the
// seobandwagon.com dashboard) — inert until the manifest declares
// externally_connectable (Task 7). ---
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== 'https://seobandwagon.com') {
    sendResponse({ ok: false });
    return false;
  }

  if (message.type === 'ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }

  if (message.type === 'connect') {
    const apiKey = message.apiKey;
    if (!/^sbw_[0-9a-f]{48}$/.test(apiKey || '')) {
      sendResponse({ ok: false, error: 'Invalid API key format' });
      return true;
    }

    // Verify BEFORE persisting: stash whatever key (if any) is currently
    // stored, stage the candidate just long enough for SBW.verifyKey() to
    // check it (verifyKey reads the stored key, not an argument), and only
    // leave it in place on success. On any non-ok, restore the prior value
    // — including clearing the stale sbwKeyStatus/sbwUser cache a failed
    // candidate may have left behind — so a rejected key never lingers.
    chrome.storage.sync.get({ apiKey: '' }, (prior) => {
      chrome.storage.sync.set({ apiKey }, () => {
        SBW.verifyKey().then((res) => {
          if (res.ok) {
            sendResponse({ ok: true, email: res.data?.email });
          } else {
            chrome.storage.sync.set({ apiKey: prior.apiKey }, () => {
              chrome.storage.local.remove(['sbwKeyStatus', 'sbwUser'], () => {
                sendResponse({ ok: false, error: res.data?.error || res.code });
              });
            });
          }
        });
      });
    });
    return true;
  }

  sendResponse({ ok: false });
  return false;
});
