// SEO Bandwagon — Connect: when a key the site hands over may be stored
// (1.13.7)
//
// seobandwagon.com connects the extension by sending it a newly minted key
// (service-worker.js answerSiteMessage, over externally_connectable or the
// Connect bridge). Until 1.13.6 the worker stored any key /v1/me accepted,
// with nothing shown, so any script running on any seobandwagon.com page
// could switch the extension to an account of its choosing, which then got
// the analyses saved from that point on, and the ones still waiting to be sent.
//
// From 1.13.7 the person approves. The worker checks the key with /v1/me
// without storing it, then:
//   - the key already stored: nothing changes;
//   - the stored key's account, by /v1/me's email, compared exactly as the
//     site returns it (a new key for the same account, as the API keys page
//     makes): stored without asking, since no data changes hands;
//   - anything else (no key yet, or another account): the extension's own
//     page src/connect/connect.html asks, in a window of its own, naming the
//     account and the one it replaces. Nothing is stored until the person
//     clicks Connect there.
//
// The site waits 8 seconds for an answer (keepkalm/platform,
// EXTENSION_CONNECT_TIMEOUT_MS in src/lib/extension/browser-messaging.ts),
// so the worker answers within ANSWER_WITHIN_MS: connected, declined, or
// still waiting for the person (the window stays open and still connects).
//
// Dual-export pattern (see src/lib/sync-state.js): attaches
// `globalThis.SBWSiteConnect` as a classic script or through importScripts,
// and exports through CommonJS for vitest.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSiteConnect = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // The page that asks, and the storage.session record it reads (session
  // storage is for the extension's own pages and its worker only).
  const CONFIRM_PAGE = 'src/connect/connect.html';
  const PENDING_KEY = 'sbwConnectPending';

  // Under the site's 8 seconds, the /v1/me checks included.
  const ANSWER_WITHIN_MS = 7000;
  // A request nobody answered is dropped after this.
  const PENDING_TTL_MS = 10 * 60 * 1000;

  const KEY_RE = /^sbw_[0-9a-f]{48}$/;

  function isKeyFormat(apiKey) {
    return typeof apiKey === 'string' && KEY_RE.test(apiKey);
  }

  // The email to show the person.
  function emailOf(me) {
    const email = me && typeof me.email === 'string' ? me.email.trim() : '';
    return email || null;
  }

  // Both answers name the same account. /v1/me carries no account ID, so the
  // email decides, compared exactly as the site returns it: no case folding
  // or trimming, which could match two accounts the site keeps apart.
  function sameAccount(meA, meB) {
    const a = meA && meA.email;
    const b = meB && meB.email;
    return typeof a === 'string' && a !== '' && a === b;
  }

  // What to do with a candidate the site sent, once /v1/me accepted it.
  //   storedKey  the key in chrome.storage.sync ('' when none)
  //   storedMe   /v1/me's answer for the stored key, read just now (null
  //              when there is no stored key or it was not accepted)
  //   candidate  the key the site sent
  //   candidateMe  /v1/me's answer for it
  // Returns 'keep' (already stored), 'store' (same account, no question) or
  // 'ask'.
  function connectPlan({ storedKey, storedMe, candidate, candidateMe }) {
    if (storedKey && storedKey === candidate) return 'keep';
    if (storedKey && storedMe && sameAccount(storedMe, candidateMe)) return 'store';
    return 'ask';
  }

  // The record the confirmation page is shown. `replacing` is the email the
  // extension is connected to now, null when no key is stored, and '' when
  // a key is stored but /v1/me did not name its account.
  function pendingRecord({ id, candidate, candidateMe, storedKey, storedMe, now }) {
    return {
      id,
      apiKey: candidate,
      email: emailOf(candidateMe) || '',
      replacing: storedKey ? (emailOf(storedMe) || '') : null,
      at: now
    };
  }

  function isExpired(pending, now) {
    return !pending || typeof pending.at !== 'number' || now - pending.at > PENDING_TTL_MS;
  }

  // Only the confirmation page may answer for the person: this extension's
  // own page, by the URL the browser reports (content scripts report the web
  // page's).
  function isConfirmSender(sender, extensionId, pageUrl) {
    if (!sender || sender.id !== extensionId || typeof sender.url !== 'string') return false;
    const bare = sender.url.split('#')[0].split('?')[0];
    return bare === pageUrl;
  }

  // The confirmation buttons take a click only after the window has been
  // shown and focused this long, again after every focus change, so a click
  // meant for the page underneath (a page can time a connect to the person's
  // double click) never lands on Connect.
  const ARM_MS = 1000;

  // How long the site's answer may still wait, given when the connect came in.
  function answerDelay(startedAt, now) {
    return Math.max(0, ANSWER_WITHIN_MS - (now - startedAt));
  }

  return {
    CONFIRM_PAGE,
    PENDING_KEY,
    ANSWER_WITHIN_MS,
    PENDING_TTL_MS,
    ARM_MS,
    isKeyFormat,
    emailOf,
    sameAccount,
    connectPlan,
    pendingRecord,
    isExpired,
    isConfirmSender,
    answerDelay
  };
});
