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

  // What a /v1/me answer (SBW.verifyKey()) means for "signed in". 1.10.3:
  // only a refused key (401) or no key signs the user out. A rate limit, an
  // outage, the network or any other failure keeps them signed in, and the
  // call that follows says what went wrong (ctErrorMessage). Until then a
  // 429, a 503 or a dropped connection showed the "Connect your account"
  // screen to someone whose key was fine.
  function signedInAfterVerify(res) {
    if (!res) return false;
    if (res.ok) return true;
    return res.code !== 'unauthorized' && res.code !== 'no_key';
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
      case 'no_key':
        return 'Connect your SEO Bandwagon account in the extension options first';
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

  // The side panel's footer once a campaign trigger (or the poll after it)
  // ends. 1.10.3: the site answers a campaign its engine failed with a 201
  // and `status: 'failed'`, which read "Campaign complete" until then.
  function campaignOutcome(status) {
    if (status === 'completed') return 'Campaign complete';
    if (status === 'failed') return 'Campaign failed. Open the dashboard for the reason, then run it again.';
    return 'Still running — check back soon';
  }

  function campaignBadgeTone(status) {
    if (status === 'completed') return 'b-ok';
    if (status === 'running') return 'b-pink';
    if (status === 'failed') return 'b-err';
    return 'b-warn';
  }

  // ============================================
  // Citation scores
  // ============================================

  // A citation's nap_match_score as a number, or null. The site returns the
  // numeric column as a string ("0.850"), so adding two of them joined the
  // strings and the side panel's average read "NaN%" (1.10.3).
  function napScore(c) {
    if (!c || c.nap_match_score == null || c.nap_match_score === '') return null;
    const n = Number(c.nap_match_score);
    return Number.isFinite(n) ? n : null;
  }

  // The average NAP match of the citations that have a score, as a whole
  // percent, or null when none has one.
  function averageNapPct(citations) {
    const scores = (citations || []).map(napScore).filter(n => n !== null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((s, n) => s + n, 0) / scores.length * 100);
  }

  // The newest citations first, by when each was last checked or filed. The
  // site lists them by priority rank, so the popup's first three were not
  // the latest three (1.10.3).
  function latestCitations(citations, n) {
    const at = c => Date.parse(c.last_checked_at || c.created_at) || 0;
    return (citations || []).slice().sort((a, b) => at(b) - at(a)).slice(0, n);
  }

  // ============================================
  // Citation filing
  // ============================================

  // Every filing carries a NAP check since 1.10.3 (the popup runs one when
  // none was), so a status always comes from a score. The site has no status
  // for an unchecked listing yet ('unverified' is not in its list), and an
  // unchecked filing was saved as 'active', which says it matches; now there
  // is no unchecked filing, and a null score is refused here rather than
  // guessed.
  function citationStatusFromScore(pct) {
    if (pct == null) return null;
    return pct >= 80 ? 'active' : 'inconsistent';
  }

  // Builds the POST .../citations body per the site contract — never
  // includes screenshot_url; the field doesn't exist in that schema.
  // `screenshotDownloaded` only changes the notes text, recording that the
  // user downloaded a local PNG (there is nowhere else to point to it).
  // Null without a score (1.10.3): an unchecked listing is not filed.
  function buildCitationPayload({
    directoryName,
    directoryUrl,
    nap = null,
    scoreTotal = null,
    screenshotDownloaded = false,
    now = new Date()
  }) {
    if (scoreTotal == null) return null;
    const pct = Math.round(scoreTotal * 100);
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

  // `ext` is 'jpg' for a full-page proof since 1.7.8 (#51), 'png' for the
  // visible area.
  function screenshotFilename(url, now = new Date(), ext = 'png') {
    let host = 'page';
    try {
      host = new URL(url).hostname.replace(/^www\./, '') || 'page';
    } catch {
      host = 'page';
    }
    const dateStr = now.toISOString().slice(0, 10);
    return `citation-${host}-${dateStr}.${ext}`;
  }

  return {
    SBW_USER_CACHE_TTL_MS,
    isUserCacheFresh,
    signedInAfterVerify,
    ctErrorMessage,
    shouldPollAfterTrigger,
    pollUntilDone,
    newestCampaign,
    isCampaignDone,
    campaignOutcome,
    campaignBadgeTone,
    napScore,
    averageNapPct,
    latestCitations,
    citationStatusFromScore,
    buildCitationPayload,
    screenshotFilename
  };
});
