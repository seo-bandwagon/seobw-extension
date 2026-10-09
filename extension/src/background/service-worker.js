// SEO Bandwagon - Background Service Worker

importScripts('../lib/sync-state.js', '../lib/api.js', '../lib/directory-matcher.js', '../lib/link-check.js', '../lib/perms.js', '../lib/redirect-chain.js', '../lib/hreflang.js', '../lib/html-diff.js', '../lib/ua-switch.js', '../lib/tool-links.js', '../lib/site-links.js');

// Cache: tabId -> { url, data, timestamp }
const tabCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Fix round 1, item 4: every `create()` gets a callback that reads and
// discards `chrome.runtime.lastError` — without one, a duplicate-id
// create() (extension update/reload re-firing onInstalled) surfaces as an
// "Unchecked runtime.lastError" console warning even though the menu still
// works. The `removeAll()` wrapper around every create() below is the real
// fix for the underlying cause: onInstalled can fire more than once for a
// single install (e.g. an update), and a plain create() with a duplicate id
// the second time would otherwise leave stale items in place with their
// OLD title if this listener's item list ever changes between versions.
function createMenuItem(options) {
  chrome.contextMenus.create(options, () => void chrome.runtime.lastError);
}

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;

    createMenuItem({
      id: 'analyze-page',
      title: 'Analyze this page with SEO Bandwagon',
      contexts: ['page']
    });

    createMenuItem({
      id: 'analyze-link',
      title: 'Analyze linked page',
      contexts: ['link']
    });

    createMenuItem({
      id: 'seo-count-selection',
      title: 'Count words & characters',
      contexts: ['selection']
    });

    // --- "SEO Bandwagon tools" submenu (Task 7, item C) ---
    //
    // Every child opens a new tab via chrome.tabs.create — none of this needs
    // the optional <all_urls> permission (nothing here fetches a third-party
    // URL from the extension itself; the new tab does its own normal
    // navigation, like clicking a link). URLs are built by
    // SBWToolLinks.toolUrl() (src/lib/tool-links.js), which parses pageUrl
    // via `new URL()` and returns null for a non-http(s) page or an empty
    // selection — onClicked below does nothing when that happens, so a
    // context-menu click on an internal chrome:// page, for instance, is a
    // silent no-op rather than opening something broken.
    //
    // The parent carries both 'page' and 'selection' contexts so it (and,
    // via inherited context, the page-scoped children) still shows up when
    // the click originated on selected text — Chrome's 'selection' context
    // does not also imply 'page'.
    createMenuItem({
      id: 'sbw-tools',
      title: 'SEO Bandwagon tools',
      contexts: ['page', 'selection']
    });
    createMenuItem({
      id: 'sbw-tools-gsc',
      parentId: 'sbw-tools',
      title: 'Open in Google Search Console (URL inspection)',
      contexts: ['page', 'selection']
    });
    createMenuItem({
      id: 'sbw-tools-wayback',
      parentId: 'sbw-tools',
      title: 'Open in Wayback Machine',
      contexts: ['page', 'selection']
    });
    createMenuItem({
      id: 'sbw-tools-pagespeed',
      parentId: 'sbw-tools',
      title: 'Open in PageSpeed Insights',
      contexts: ['page', 'selection']
    });
    createMenuItem({
      id: 'sbw-tools-rich-results',
      parentId: 'sbw-tools',
      title: 'Test with Rich Results Test',
      contexts: ['page', 'selection']
    });
    createMenuItem({
      id: 'sbw-tools-site-search',
      parentId: 'sbw-tools',
      title: 'site: search for this domain',
      contexts: ['page', 'selection']
    });
    createMenuItem({
      id: 'sbw-tools-selection-search',
      parentId: 'sbw-tools',
      title: 'Search Google for the selected text in quotes',
      contexts: ['selection']
    });
    createMenuItem({
      id: 'sbw-tools-sitemap',
      parentId: 'sbw-tools',
      title: 'Open sitemap.xml',
      contexts: ['page', 'selection']
    });
    createMenuItem({
      id: 'sbw-tools-robots',
      parentId: 'sbw-tools',
      title: 'Open robots.txt',
      contexts: ['page', 'selection']
    });
  });
});

// Maps a "SEO Bandwagon tools" submenu id to the SBWToolLinks kind it
// builds. Kept as a flat lookup (rather than a switch) so onClicked's
// handling is a single branch regardless of which child fired.
const SBW_TOOLS_MENU_KIND = {
  'sbw-tools-gsc': 'gsc',
  'sbw-tools-wayback': 'wayback',
  'sbw-tools-pagespeed': 'pagespeed',
  'sbw-tools-rich-results': 'rich-results',
  'sbw-tools-site-search': 'site-search',
  'sbw-tools-selection-search': 'quoted-search',
  'sbw-tools-sitemap': 'sitemap',
  'sbw-tools-robots': 'robots'
};

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
  clearRedirectBuffer(tabId);
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
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/content-analysis.js', 'lib/dom-extraction.js', 'src/lib/link-check.js', 'src/lib/hreflang.js', 'src/lib/structured-data.js', 'src/content/analyzer.js'] });
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
  } else if (SBW_TOOLS_MENU_KIND[info.menuItemId]) {
    const kind = SBW_TOOLS_MENU_KIND[info.menuItemId];
    // info.pageUrl is the page the context menu was opened on (the main
    // frame's URL even for a click inside an iframe); tab?.url is the
    // fallback for the rare case a click handler runs without it.
    const pageUrl = info.pageUrl || tab?.url;
    const url = SBWToolLinks.toolUrl(kind, { pageUrl, selection: info.selectionText });
    if (url) {
      chrome.tabs.create({ url });
    }
    // A null url (non-http(s) page, or an empty/whitespace-only selection
    // for the quoted-search item) means the click does nothing — no tab
    // opens, no error surfaced, per the brief.
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

// Onboarding: the welcome page opens on a first install only, never on an
// update; the uninstall survey URL is set on every install and update, so
// people updating from a version without it get it too (Chrome keeps it).
// Both URLs come from SBWSiteLinks.installActions (src/lib/site-links.js).
chrome.runtime.onInstalled.addListener(async (details) => {
  const actions = SBWSiteLinks.installActions(details.reason, chrome.runtime.getManifest().version);
  try {
    await chrome.runtime.setUninstallURL(actions.uninstallUrl);
  } catch (e) {
    console.warn('setUninstallURL failed:', e);
  }
  if (actions.welcomeUrl) {
    try {
      await chrome.tabs.create({ url: actions.welcomeUrl });
    } catch (e) {
      console.warn('Welcome tab failed to open:', e);
    }
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
  let started = false;
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
    const inflightTotal = Object.values(inflightByHost).reduce((a, b) => a + b, 0);
    if (!cancelled && SBWLinkCheck.isComplete(doneCount, total, inflightTotal)) {
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

    // The popup only ever opens one port per check and posts one 'start' on
    // it, but a second 'start' on an already-running port (e.g. a stray
    // double-click before the button re-renders) must not restart the queue
    // out from under in-flight probes — reject it instead.
    if (started) {
      port.postMessage({ type: 'error', code: 'already_started' });
      return;
    }
    started = true;

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

// --- Redirect tracer: webRequest/webNavigation → Indexability panel (Task 2) ---
//
// Observing another origin's response headers and Location hops needs the
// same optional <all_urls> host permission the link checker gates on
// (SBWPerms) — webRequest/webNavigation see nothing without it. This block
// never requests that permission itself; it only tracks whether the grant
// is currently there.
//
// Ruling I-1: the four listeners below are registered UNCONDITIONALLY and
// SYNCHRONOUSLY at worker top level, not after an `await SBWPerms.hasAllUrls()`
// — a listener added after an await can miss events that fire in the gap
// between the worker waking up and that await resolving. Instead, a
// module-level `allUrlsGranted` flag gates every handler body; each one
// returns immediately when it's false. This is belt-and-braces (webRequest/
// webNavigation already deliver nothing without the host permission), but it
// means a grant that lands mid-session via permissions.onAdded starts being
// observed on the very next event, with nothing to (re)register, and a
// revoked grant (permissions.onRemoved) stops observing immediately.
const REDIRECTS_MAX_EVENTS = 25;
const TRACE_TIMEOUT_MS = 20000;

let allUrlsGranted = false;
SBWPerms.hasAllUrls().then((v) => { allUrlsGranted = v; });

const lastMainFrameRequestId = {}; // tabId -> requestId, so a duplicate onBeforeRequest call for the same navigation can't wipe a buffer mid-capture

// Per-tab buffer: a module-level Map is the source of truth — instant to
// read/write and immune to the read-modify-write races a bare
// chrome.storage.session.get()-then-set() has under overlapping calls.
// chrome.storage.session is a mirror only, kept up to date through a single
// promise chain (`writeQueue`) so mirror writes land in the order they were
// queued instead of racing each other. Reads prefer the Map; only a worker
// restart (Map empty for that tab) falls back to reading the mirror.
const redirectBuffers = new Map(); // tabId -> events[]
let writeQueue = Promise.resolve();

function redirectsKey(tabId) {
  return `redirects:${tabId}`;
}

async function readRedirectBuffer(tabId) {
  if (redirectBuffers.has(tabId)) return redirectBuffers.get(tabId);
  const key = redirectsKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const entry = stored && stored[key];
  const events = (entry && Array.isArray(entry.events)) ? entry.events : [];
  redirectBuffers.set(tabId, events);
  return events;
}

function queueBufferWrite(tabId, events) {
  const key = redirectsKey(tabId);
  writeQueue = writeQueue
    .then(() => chrome.storage.session.set({ [key]: { events, updatedAt: Date.now() } }))
    .catch(() => { /* a failed mirror write must not wedge the queue for later tabs */ });
  return writeQueue;
}

function appendRedirectEvent(tabId, event) {
  if (tabId === undefined || tabId === null || tabId < 0) return; // -1 = not a real tab (prerender/service worker requests)
  const events = (redirectBuffers.get(tabId) || []).concat([event]).slice(-REDIRECTS_MAX_EVENTS);
  redirectBuffers.set(tabId, events);
  queueBufferWrite(tabId, events);
}

function resetRedirectBuffer(tabId) {
  if (tabId === undefined || tabId === null || tabId < 0) return;
  redirectBuffers.set(tabId, []);
  queueBufferWrite(tabId, []);
}

function clearRedirectBuffer(tabId) {
  redirectBuffers.delete(tabId);
  delete lastMainFrameRequestId[tabId];
  chrome.storage.session.remove(redirectsKey(tabId));
}

// permissions.onRemoved (below): a revoked grant should leave nothing
// behind for any tab, not just the active one, so this sweeps every
// `redirects:*` key rather than the single current tab's.
function clearAllRedirectBuffers() {
  redirectBuffers.clear();
  chrome.storage.session.get(null, (items) => {
    const keys = Object.keys(items || {}).filter(k => k.startsWith('redirects:'));
    if (keys.length) chrome.storage.session.remove(keys);
  });
}

const REDIRECT_FILTER = { urls: ['<all_urls>'], types: ['main_frame'] };

chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (!allUrlsGranted) return;
  const tabId = details.tabId;
  if (tabId < 0) return;
  if (lastMainFrameRequestId[tabId] === details.requestId) return;
  lastMainFrameRequestId[tabId] = details.requestId;
  resetRedirectBuffer(tabId);
}, REDIRECT_FILTER);

chrome.webRequest.onBeforeRedirect.addListener((details) => {
  if (!allUrlsGranted) return;
  appendRedirectEvent(details.tabId, {
    kind: 'redirect',
    url: details.url,
    statusCode: details.statusCode,
    location: details.redirectUrl,
    headers: SBWRedirects.pickHeaders(details.responseHeaders)
  });
}, REDIRECT_FILTER, ['responseHeaders']);

// Only the statuses a browser actually auto-follows are "hops" captured by
// onBeforeRedirect above (301/302/303/307/308). 304 Not Modified, and the
// rarely-seen 300/305, are terminal responses the browser hands back as-is
// — they must land here as the chain's final entry, not be swallowed by a
// blanket "3xx" check.
const BROWSER_FOLLOWED_REDIRECTS = [301, 302, 303, 307, 308];

chrome.webRequest.onHeadersReceived.addListener((details) => {
  if (!allUrlsGranted) return;
  if (BROWSER_FOLLOWED_REDIRECTS.includes(details.statusCode)) return;
  appendRedirectEvent(details.tabId, {
    kind: 'response',
    url: details.url,
    statusCode: details.statusCode,
    headers: SBWRedirects.pickHeaders(details.responseHeaders)
  });
}, REDIRECT_FILTER, ['responseHeaders']);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (!allUrlsGranted) return;
  if (details.frameId !== 0) return;
  if (Array.isArray(details.transitionQualifiers) && details.transitionQualifiers.includes('client_redirect')) {
    appendRedirectEvent(details.tabId, { kind: 'client_redirect', url: details.url });
  }
});

chrome.permissions.onAdded.addListener((perms) => {
  if (perms && Array.isArray(perms.origins) && perms.origins.includes('<all_urls>')) {
    allUrlsGranted = true;
  }
});

chrome.permissions.onRemoved.addListener((perms) => {
  if (perms && Array.isArray(perms.origins) && perms.origins.includes('<all_urls>')) {
    allUrlsGranted = false;
    clearAllRedirectBuffers();
    // clearAllUaRules (Task 4, defined near the UA-switcher block below —
    // hoisted, so its physical position doesn't matter here) — a revoked
    // grant means every active "View as" rule stops actually being able to
    // rewrite anything, so it must not go on claiming UA OVERRIDE ACTIVE.
    clearAllUaRules();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getRedirectChain') {
    (async () => {
      const events = await readRedirectBuffer(request.tabId);
      if (!events.length) {
        sendResponse({ chain: null });
        return;
      }
      sendResponse({ chain: SBWRedirects.chainSummary(events), events });
    })();
    return true;
  }

  if (request.action === 'traceUrl') {
    (async () => {
      const url = request.url;
      if (!/^https?:\/\//i.test(url || '')) {
        sendResponse({ error: 'invalid_url' });
        return;
      }

      const allowed = await SBWPerms.hasAllUrls();
      if (!allowed) {
        sendResponse({ error: 'no_permission' });
        return;
      }

      let newTab;
      try {
        newTab = await chrome.tabs.create({ url, active: false });
      } catch (e) {
        sendResponse({ error: 'tab_open_failed' });
        return;
      }
      const tabId = newTab.id;
      // No explicit reset here (item 3 of the fix round): the new tab's own
      // first navigation fires onBeforeRequest with a requestId this tab has
      // never seen, which resets its buffer on its own. An explicit reset
      // right here raced that natural one — whichever ran last could wipe a
      // redirect event the other had just appended.

      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          chrome.webNavigation.onCompleted.removeListener(onCompleted);
          chrome.tabs.onRemoved.removeListener(onRemoved);
          resolve();
        };
        const timer = setTimeout(finish, TRACE_TIMEOUT_MS);
        function onCompleted(details) {
          if (details.tabId === tabId && details.frameId === 0) finish();
        }
        // The traced tab can disappear before it finishes loading (closed by
        // the user, a policy block, a crash) — without this, a closed tab
        // would sit waiting for the full 20s timeout instead of resolving
        // the moment there's nothing left to wait for.
        function onRemoved(removedTabId) {
          if (removedTabId === tabId) finish();
        }
        chrome.webNavigation.onCompleted.addListener(onCompleted);
        chrome.tabs.onRemoved.addListener(onRemoved);
      });

      let events = [];
      try {
        events = await readRedirectBuffer(tabId);
      } finally {
        // Close the tab and drop its buffer even if the read above throws —
        // an open background tab or a leaked buffer entry must not outlive
        // a failed read.
        try { await chrome.tabs.remove(tabId); } catch (e) { /* tab already gone */ }
        clearRedirectBuffer(tabId);
      }

      sendResponse({ chain: SBWRedirects.chainSummary(events), events });
    })();
    return true;
  }
});

// --- Hreflang return-tag check (Task 3) ---
//
// User-initiated only — the popup's "Check return tags (N)" button, never
// automatic. Gated on the same optional <all_urls> permission as the link
// checker and redirect tracer (SBWPerms.hasAllUrls()); this never requests
// it itself. Fetches each candidate alternate URL (deduped, capped at 50),
// reading at most 256 KB of the body via a streamed reader so a huge page
// can't be dragged in whole, then hands the raw HTML + Link header off to
// SBWHreflang for parsing — this file owns only the network I/O.
const HREFLANG_TIMEOUT_MS = 10000;
const HREFLANG_MAX_BYTES = 256 * 1024;
const HREFLANG_MAX_URLS = 50;
const HREFLANG_PER_HOST = 2;
const HREFLANG_GLOBAL = 4;

// Reads at most `maxBytes` of `res`'s body via its ReadableStream reader,
// then cancels the stream — the rest of a large response is never pulled
// over the wire into memory. The final chunk is sliced down to exactly the
// remaining budget (rather than appending it whole) so `received` — and the
// returned text — never overshoots `maxBytes`; without that, one oversized
// read landing right at the cap could push the total past it. Falls back to
// res.text() (whole body) only if this environment's Response has no
// streaming body reader (not expected in a real Chrome service worker, kept
// for robustness).
//
// Returns { text, truncated } — `truncated` is true exactly when the read
// stopped because `received` hit `maxBytes`, not because the body actually
// ended (`done`). Both current callers (fetchHreflangAlternate below, and
// the fetchRawHtml handler further down) surface this so a comparison built
// on a cut-off response can say so instead of silently treating a partial
// document as the whole page.
async function readCappedBody(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    try {
      const text = await res.text();
      return { text, truncated: text.length >= maxBytes };
    } catch (e) {
      return { text: '', truncated: false };
    }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = value;
      if (received + chunk.byteLength > maxBytes) {
        chunk = chunk.slice(0, maxBytes - received);
      }
      received += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
  } finally {
    try { reader.cancel(); } catch (e) { /* already drained/closed */ }
  }
  return { text, truncated: received >= maxBytes };
}

// One GET, capped/timed exactly like probeLink() above but reading (a
// bounded amount of) the body, since this check needs the alternate's own
// declared hreflang set, not just a status code.
//
// The fetch itself and the body read are in separate try/catches: if the
// fetch throws (DNS failure, connection refused, the 10s abort firing before
// headers ever arrive), there's genuinely no response — status 0 is honest.
// But if headers DID arrive and only the body read aborts partway through
// (a slow/large response hitting the same AbortController on a big page),
// collapsing that to status 0 would misreport a real, known status as
// unreachable. That case keeps the real `res.status` and flags
// `bodyTruncated: true` instead — whatever <link>/Link-header entries were
// found in the partial body are still used, just possibly incomplete.
async function fetchHreflangAlternate(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HREFLANG_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    return { url, finalUrl: url, status: 0, entries: [], linkHeaderEntries: [] };
  }

  let html = '';
  let bodyTruncated = false;
  try {
    const capped = await readCappedBody(res, HREFLANG_MAX_BYTES);
    html = capped.text;
    // A body cut off by the 256 KB cap is just as much "possibly
    // incomplete" as one cut off by a read error below — both feed the
    // same bodyTruncated flag on the result.
    if (capped.truncated) bodyTruncated = true;
  } catch (e) {
    bodyTruncated = true;
  }
  clearTimeout(timer);

  const finalUrl = res.url || url;
  const entries = SBWHreflang.extractHreflangFromHtml(html, finalUrl);
  const linkHeaderValue = (typeof res.headers.get === 'function') ? res.headers.get('link') : null;
  const linkHeaderEntries = (SBWRedirects.parseLinkHeader(linkHeaderValue) || [])
    .filter(e => (e.rel || '').toLowerCase().split(/\s+/).includes('alternate') && e.hreflang);

  const result = { url, finalUrl, status: res.status, entries, linkHeaderEntries };
  if (bodyTruncated) result.bodyTruncated = true;
  return result;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkHreflangAlternates') {
    (async () => {
      const allowed = await SBWPerms.hasAllUrls();
      if (!allowed) {
        sendResponse({ error: 'no_permission' });
        return;
      }

      const urls = Array.from(new Set((request.urls || []).filter(Boolean))).slice(0, HREFLANG_MAX_URLS);
      if (!urls.length) {
        sendResponse({ fetched: [] });
        return;
      }

      const queue = urls.map(u => ({ url: u }));
      const inflightByHost = {};
      const fetched = [];
      let doneCount = 0;

      await new Promise((resolve) => {
        function pump() {
          let next;
          while ((next = SBWLinkCheck.pickNext(queue, inflightByHost, { perHost: HREFLANG_PER_HOST, global: HREFLANG_GLOBAL }))) {
            queue.splice(queue.indexOf(next), 1);
            runOne(next);
          }
          const inflightTotal = Object.values(inflightByHost).reduce((a, b) => a + b, 0);
          if (SBWLinkCheck.isComplete(doneCount, urls.length, inflightTotal)) resolve();
        }

        async function runOne(item) {
          const host = SBWLinkCheck.hostKey(item.url);
          inflightByHost[host] = (inflightByHost[host] || 0) + 1;

          const result = await fetchHreflangAlternate(item.url);

          inflightByHost[host] -= 1;
          if (inflightByHost[host] <= 0) delete inflightByHost[host];
          fetched.push(result);
          doneCount += 1;
          pump();
        }

        pump();
      });

      sendResponse({ fetched });
    })();
    return true;
  }
});

// --- Raw-HTML fetch: HTML vs rendered DOM diff (Task 4) ---
//
// User-initiated only — the popup's "Compare raw HTML with rendered DOM"
// button. Gated on the same optional <all_urls> permission as every other
// third-party fetch in this file. This handler only fetches and returns the
// raw bytes/status; SBWHtmlDiff.summarizeHtml/summarizeDom/diffSummaries
// (src/lib/html-diff.js) run in the popup, which already holds the
// rendered-DOM analysis (pageData) this handler never sees.
//
// `userAgent` is accepted on the message but not used to set a header here
// — a fetch() issued from a service worker cannot override its own
// User-Agent (Chrome treats it as a forbidden header on outgoing fetches,
// same as XHR). When a UA-switch DNR session rule (below) is active for the
// tab this fetch is standing in for, Chrome rewrites the User-Agent header
// on every request FROM THAT TAB at the network layer, before this fetch
// (issued from the extension's own worker context, not the tab) would ever
// be affected by it anyway — so there is deliberately no code path here
// that reads `userAgent` and sets a header from it. The field only documents
// that intent for a future reader wondering where it went.
const RAW_HTML_TIMEOUT_MS = 10000;
const RAW_HTML_MAX_BYTES = 1024 * 1024;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchRawHtml') {
    (async () => {
      const allowed = await SBWPerms.hasAllUrls();
      if (!allowed) {
        sendResponse({ error: 'no_permission' });
        return;
      }

      const url = request.url;
      if (!/^https?:\/\//i.test(url || '')) {
        sendResponse({ error: 'invalid_url' });
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RAW_HTML_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: controller.signal });
      } catch (e) {
        clearTimeout(timer);
        sendResponse({ error: e && e.name === 'AbortError' ? 'timeout' : 'network' });
        return;
      }

      // readCappedBody is defined below (Task 3's hreflang block) but is a
      // hoisted function declaration, so its physical position in the file
      // doesn't matter — reused as-is rather than duplicating a second
      // streamed-body reader with the same 1 MB-vs-256 KB-shaped logic.
      let html = '';
      let truncated = false;
      try {
        const capped = await readCappedBody(res, RAW_HTML_MAX_BYTES);
        html = capped.text;
        truncated = capped.truncated;
      } catch (e) {
        // A partial body (the abort firing mid-read, after headers already
        // arrived) is still useful to diff against — fall through with
        // whatever was read rather than discarding it. Not marked
        // `truncated` here: that flag means specifically "the 1 MB cap cut
        // this off", not "something else went wrong reading it" — the popup
        // (src/popup/render-check.js) still has the partial html to work
        // with either way.
      }
      clearTimeout(timer);

      // `truncated` lets SBWHtmlDiff.summarizeHtml/diffSummaries (via the
      // popup) avoid claiming 'js-rendered' off a comparison built on a
      // response that got cut off before the real end of the document.
      sendResponse({ status: res.status, finalUrl: res.url || url, html, truncated });
    })();
    return true;
  }
});

// --- User-agent switcher: DNR session rules (Task 4) ---
//
// "View as" in the Rendering section. User-initiated only (changing the
// popup's select) — this never arms itself and never persists past the
// browser session: chrome.declarativeNetRequest SESSION rules are already
// scoped to the current browser session, and the tab-close listener below
// removes a tab's rule (and its chrome.storage.session mirror) the moment
// that tab closes, rather than waiting for the session to end on its own.
// Rewriting the User-Agent header needs the optional <all_urls> permission
// the same way every other fetch/observe feature in this file does — a
// declarativeNetRequestWithHostAccess modifyHeaders rule only actually
// takes effect on hosts the extension currently has host access to.
const uaPresetForTab = new Map(); // tabId -> presetId, mirrored to chrome.storage.session so a worker restart can recover it

function uaStorageKey(tabId) {
  return `ua:${tabId}`;
}

async function setUserAgentForTab(tabId, presetId) {
  const preset = SBWUaSwitch.presetById(presetId);
  const ruleId = SBWUaSwitch.ruleIdForTab(tabId);
  const addRules = [];
  if (preset && preset.ua) {
    addRules.push(SBWUaSwitch.ruleFor(tabId, preset.ua));
  }

  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId], addRules });

  if (preset && preset.ua) {
    uaPresetForTab.set(tabId, preset.id);
    await chrome.storage.session.set({ [uaStorageKey(tabId)]: preset.id });
    return preset.id;
  }
  uaPresetForTab.delete(tabId);
  await chrome.storage.session.remove(uaStorageKey(tabId));
  return 'default';
}

async function getUserAgentForTab(tabId) {
  if (uaPresetForTab.has(tabId)) return uaPresetForTab.get(tabId);
  const key = uaStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const presetId = stored && stored[key];
  if (presetId) uaPresetForTab.set(tabId, presetId);
  return presetId || 'default';
}

async function clearUserAgentForTab(tabId) {
  const ruleId = SBWUaSwitch.ruleIdForTab(tabId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  } catch (e) { /* rule already gone, or DNR unavailable in this context */ }
  uaPresetForTab.delete(tabId);
  chrome.storage.session.remove(uaStorageKey(tabId));
}

// permissions.onRemoved (wired further up the file, in the same top-level
// listener the redirect tracer's clearAllRedirectBuffers() uses — a regular
// function declaration hoists, so the call site coming first in the file
// than this definition is fine): a revoked <all_urls>
// grant means every active UA-override rule can no longer actually rewrite
// anything (declarativeNetRequestWithHostAccess's modifyHeaders only takes
// effect on hosts the extension currently has host access to), so it must
// not go on claiming "UA OVERRIDE ACTIVE" in the popup badge — every tab's
// rule and its chrome.storage.session mirror are cleared at once, not just
// the current tab's.
function clearAllUaRules() {
  const ruleIds = Array.from(uaPresetForTab.keys()).map(id => SBWUaSwitch.ruleIdForTab(id));
  uaPresetForTab.clear();
  if (ruleIds.length) {
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds }).catch(() => {});
  }
  chrome.storage.session.get(null, (items) => {
    const keys = Object.keys(items || {}).filter(k => k.startsWith('ua:'));
    if (keys.length) chrome.storage.session.remove(keys);
  });
}

// A tab closing while a UA override is active must not leave an orphaned
// session rule keyed to a tabId Chrome could someday reuse.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearUserAgentForTab(tabId);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setUserAgent') {
    (async () => {
      const tabId = request.tabId;
      // Number.isInteger + non-negative — see SBWUaSwitch.isValidTabId's
      // comment: a DNR rule id / condition.tabIds entry must be a real
      // Chrome tab id, and the old `undefined`/`null`-only check let
      // through anything else (a string, a float, -1) that would only fail
      // much later inside declarativeNetRequest.updateSessionRules.
      if (!SBWUaSwitch.isValidTabId(tabId)) {
        sendResponse({ error: 'invalid_tab' });
        return;
      }

      // Switching back to Default never needs the permission check — it
      // only ever removes a rule, it can't rewrite a header without host
      // access it may no longer have (e.g. revoked mid-session).
      if (request.presetId !== 'default') {
        const allowed = await SBWPerms.hasAllUrls();
        if (!allowed) {
          sendResponse({ error: 'no_permission' });
          return;
        }
      }

      let appliedPresetId;
      try {
        appliedPresetId = await setUserAgentForTab(tabId, request.presetId);
      } catch (e) {
        sendResponse({ error: 'dnr_failed' });
        return;
      }

      // The tab can have closed in the moment between the click and this
      // reload call (a slow DNR round-trip, a fast user) — chrome.tabs.reload
      // rejects for a tabId that no longer exists, and that must not surface
      // as an unhandled promise rejection in the worker.
      chrome.tabs.reload(tabId).catch(() => {});
      sendResponse({ ok: true, presetId: appliedPresetId });
    })();
    return true;
  }

  if (request.action === 'getUserAgent') {
    (async () => {
      const tabId = request.tabId;
      if (tabId === undefined || tabId === null) {
        sendResponse({ presetId: 'default' });
        return;
      }
      sendResponse({ presetId: await getUserAgentForTab(tabId) });
    })();
    return true;
  }
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
