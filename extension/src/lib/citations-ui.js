// SEO Bandwagon — Citations UI helpers
//
// Pure logic shared by the popup's Citations tab (src/popup/citations-tab.js)
// and the side panel (src/sidepanel/sidepanel.js): the sbwUser cache-freshness
// check backing the "signed in" definition, status/code → user-facing message
// mapping, the campaign-trigger poll-until-done loop, campaign badge/done
// classification, the citation payload builder (screenshot_url is
// deliberately never part of it — the site's POST .../citations contract
// doesn't accept one), and the "Download PNG" filename builder.
//
// Dual-export pattern (see src/lib/api.js / src/lib/domain-history.js):
// attaches to `globalThis.SBWCitations` when loaded as a classic <script>,
// and exports via CommonJS when loaded by Vitest / Node. No chrome/fetch/DOM
// dependency here — that wiring stays in the tab/panel files.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWCitations = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // ============================================
  // Auth: "signed in" = an API key AND a fresh/verified /v1/me result.
  // ============================================

  const SBW_USER_CACHE_TTL_MS = 10 * 60 * 1000;

  // `entry` is the { data, at } shape stored at chrome.storage.local.sbwUser.
  function isUserCacheFresh(entry, now = Date.now()) {
    if (!entry || typeof entry.at !== 'number') return false;
    return (now - entry.at) < SBW_USER_CACHE_TTL_MS;
  }

  // ============================================
  // sbwFetch/ct.* code → user-facing message
  // ============================================

  // `unauthorized` returns null on purpose: callers flip straight to the
  // signed-out view rather than showing an error string.
  function ctErrorMessage(code, fallback) {
    switch (code) {
      case 'unauthorized':
        return null;
      case 'forbidden':
        return 'Your key lacks the citations scope — re-create it at /dashboard/api-keys';
      case 'rate_limited':
        return 'Rate limited — try again in a moment';
      case 'unavailable':
        return 'SEO Bandwagon is temporarily unavailable';
      case 'network':
        return "Can't reach SEO Bandwagon — check your connection";
      default:
        return fallback || 'Something went wrong';
    }
  }

  // ============================================
  // Campaign trigger: network/timeout, a 504, or a 502 means the campaign is
  // probably still running server-side (it runs synchronously and can
  // outlast the client's timeout, or briefly bounce off a proxy while it
  // does) — worth polling rather than failing.
  // ============================================

  function shouldPollAfterTrigger({ code, status } = {}) {
    return code === 'network' || (code === 'error' && (status === 504 || status === 502));
  }

  // Calls `fetchOnce()` up to `attempts` times, `intervalMs` apart, stopping
  // as soon as `isDone(value)` is true. `wait` is injectable so tests don't
  // burn real time; defaults to a real setTimeout-based delay.
  async function pollUntilDone({
    fetchOnce,
    isDone,
    attempts = 12,
    intervalMs = 5000,
    wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  }) {
    let value;
    for (let i = 1; i <= attempts; i++) {
      value = await fetchOnce();
      if (isDone(value)) {
        return { done: true, value, attempts: i };
      }
      if (i < attempts) {
        await wait(intervalMs);
      }
    }
    return { done: false, value, attempts };
  }

  // ============================================
  // Campaigns
  // ============================================

  function newestCampaign(campaigns) {
    if (!campaigns || !campaigns.length) return null;
    return campaigns.reduce((newest, c) => {
      if (!newest) return c;
      const a = Date.parse(c.created_at) || 0;
      const b = Date.parse(newest.created_at) || 0;
      return a > b ? c : newest;
    }, null);
  }

  function isCampaignDone(status) {
    return status === 'completed' || status === 'failed';
  }

  function campaignBadgeTone(status) {
    if (status === 'completed') return 'b-ok';
    if (status === 'running') return 'b-pink';
    if (status === 'failed') return 'b-err';
    return 'b-warn';
  }

  // ============================================
  // Citation filing
  // ============================================

  function citationStatusFromScore(pct) {
    if (pct == null) return 'active';
    return pct >= 80 ? 'active' : 'inconsistent';
  }

  // Builds the POST .../citations body per the site contract — never
  // includes screenshot_url; the field doesn't exist in that schema.
  // `screenshotDownloaded` only changes the notes text, recording that the
  // user downloaded a local PNG (there is nowhere else to point to it).
  function buildCitationPayload({
    directoryName,
    directoryUrl,
    nap = null,
    scoreTotal = null,
    screenshotDownloaded = false,
    now = new Date()
  }) {
    const pct = scoreTotal != null ? Math.round(scoreTotal * 100) : null;
    const dateStr = now.toISOString().slice(0, 10);
    const notes = screenshotDownloaded
      ? `Filed from the extension on ${dateStr} — screenshot downloaded locally`
      : `Filed from the extension on ${dateStr}`;

    return {
      directory_name: directoryName,
      directory_url: directoryUrl,
      status: citationStatusFromScore(pct),
      found_name: nap?.name || null,
      found_address: nap?.address || null,
      found_phone: nap?.phone || null,
      found_website: nap?.website || null,
      nap_match_score: scoreTotal,
      notes
    };
  }

  // ============================================
  // Screenshot download
  // ============================================

  function screenshotFilename(url, now = new Date()) {
    let host = 'page';
    try {
      host = new URL(url).hostname.replace(/^www\./, '') || 'page';
    } catch {
      host = 'page';
    }
    const dateStr = now.toISOString().slice(0, 10);
    return `citation-${host}-${dateStr}.png`;
  }

  return {
    SBW_USER_CACHE_TTL_MS,
    isUserCacheFresh,
    ctErrorMessage,
    shouldPollAfterTrigger,
    pollUntilDone,
    newestCampaign,
    isCampaignDone,
    campaignBadgeTone,
    citationStatusFromScore,
    buildCitationPayload,
    screenshotFilename
  };
});
