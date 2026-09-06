// SEO Bandwagon — user-agent switcher: pure preset/rule logic
//
// "View as" (Rendering section) lets you reload a tab with a different
// User-Agent header to test server-side rendering and cloaking — never a
// paywall/gate bypass, never "see Google as a bot" (see the ledger's binding
// copy rulings). This module only knows the preset list and how to shape a
// chrome.declarativeNetRequest session rule for one; the actual
// updateSessionRules()/tabs.reload() calls live in the background service
// worker (src/background/service-worker.js), which needs the live chrome.*
// API this module deliberately has no dependency on.
//
// Preset UA strings are sourced from:
//   Google Search Central, "Googlebot" (full/compatible-form UA strings,
//   including the smartphone variant):
//     https://developers.google.com/search/docs/crawling-indexing/googlebot
//   Bing Webmaster Tools, "Which crawlers does Bing use?" (bingbot's
//   documented compatible-form UA string):
//     https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0
// The iPhone Safari preset is a representative, currently-shipping iOS
// Safari UA string rather than a citation of an official spec — Apple
// doesn't publish one canonical "the" iOS Safari UA the way Google/Bing
// document their crawlers' — included so "View as" can also exercise a real
// mobile browser for the same rendering/cloaking test, not only search
// crawlers. Version numbers on all of these drift over time; treat them as
// illustrative of the documented FORM, not a promise of exact freshness.
//
// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWUaSwitch` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWUaSwitch = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // `ua: null` on 'default' is the sentinel for "no override" — ruleFor()
  // below returns null for it, which the worker reads as "remove this tab's
  // rule, don't add a new one."
  const PRESETS = [
    { id: 'default', label: 'Default (off)', ua: null },
    {
      id: 'googlebot-desktop',
      label: 'Googlebot Desktop',
      ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/125.0.0.0 Safari/537.36'
    },
    {
      id: 'googlebot-smartphone',
      label: 'Googlebot Smartphone',
      ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    },
    {
      id: 'bingbot',
      label: 'Bingbot',
      ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/125.0.0.0 Safari/537.36'
    },
    {
      id: 'iphone-safari',
      label: 'iPhone Safari',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    }
  ];

  // Every resourceType this rule can match — a request the browser makes for
  // this tab's frame, its sub-frames, and everything a page typically loads.
  // Keeping this exhaustive (rather than main_frame-only) matters for
  // cloaking checks specifically: a site that cloaks based on UA can key off
  // ANY request from the tab, not just the top-level navigation. `ping`,
  // `websocket`, and `object` are deliberately left out: a UA-cloaking check
  // cares about rendered document/asset requests, and none of those three
  // resource types carry content a "raw vs rendered" or "view as" check
  // would ever need to see rewritten.
  const RESOURCE_TYPES = ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'media', 'other'];

  function presetById(id) {
    return PRESETS.find(p => p.id === id) || null;
  }

  // A DNR rule id / condition.tabIds entry must be a real Chrome tab id —
  // a non-negative integer. Lives here (rather than only inline in the
  // worker's setUserAgent handler) so the validation itself is unit-
  // testable without any chrome.* stubbing.
  function isValidTabId(tabId) {
    return Number.isInteger(tabId) && tabId >= 0;
  }

  // Deterministic per-tab DNR session rule id. DNR rule ids must be positive
  // integers, unique within the session ruleset this extension owns; tabId
  // is already a small non-negative integer Chrome assigns per tab.
  // Offsetting into a dedicated range keeps this the only thing that could
  // ever produce these ids, so two different tabs' rules can never collide
  // with each other or with a rule id some other feature might add later.
  function ruleIdForTab(tabId) {
    return 900000 + Number(tabId);
  }

  // DNR session rule that rewrites the outgoing User-Agent header on every
  // request FROM this one tab to `ua`. Returns null for a falsy `ua` (the
  // 'default' preset's ua, or a caller that already resolved an unknown
  // preset id to null) — there's nothing to set the header to, and the
  // worker reads null as "just remove whatever rule this tab has."
  function ruleFor(tabId, ua) {
    if (!ua) return null;
    return {
      id: ruleIdForTab(tabId),
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'User-Agent', operation: 'set', value: ua }]
      },
      condition: {
        tabIds: [tabId],
        resourceTypes: RESOURCE_TYPES
      }
    };
  }

  return {
    PRESETS,
    presetById,
    isValidTabId,
    ruleIdForTab,
    ruleFor
  };
});
