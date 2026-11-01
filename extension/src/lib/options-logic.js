// SEO Bandwagon — Options page pure logic
//
// Pure logic backing src/options/options.js: API URL validation/normalisation
// for the Advanced section, and mapping a SBW.verifyKey() result to the
// status message + CSS class the page shows. No chrome/fetch/DOM dependency
// here — that wiring (chrome.storage, chrome.permissions, chrome.tabs) stays
// in options.js.
//
// Dual-export pattern (see src/lib/api.js / src/lib/citations-ui.js):
// attaches to `globalThis.SBWOptions` when loaded as a classic <script>, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWOptions = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // Mirrors API_DEFAULT_URL in src/lib/api.js — kept as a separate constant
  // here so this file has zero dependency on api.js and can be unit tested
  // on its own.
  const API_DEFAULT_URL = 'https://seobandwagon.com/api';

  // ============================================
  // Advanced API URL: validation + normalisation
  // ============================================

  // Accepts an http:// URL to localhost/127.0.0.1 (the two hosts the
  // optional_host_permissions grant covers) — everything else (plain http to
  // a real host, garbage input) is rejected.
  function isLocalhostUrl(url) {
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(url || '').trim());
  }

  // Allowlist, not a blocklist: the Advanced field accepts only
  // seobandwagon.com (and any subdomain, such as the staging Worker at
  // cf.seobandwagon.com) or a local dev server (see isLocalhostUrl above).
  // 1.10.3 dropped the Netlify deploy-preview hosts
  // (`<name>--seobandwagon.netlify.app`): the site left Netlify on
  // 2026-10-05 and has no deploy previews. Every other https:// host — including
  // a lookalike domain, a credentials trick like
  // `https://seobandwagon.com@evil.com`, or any other real site — is
  // rejected. Parsed with `new URL()` rather than a prefix regex specifically
  // so userinfo/host tricks land on the real hostname, not a spoofed prefix.
  function isValidApiUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return false;
    if (isLocalhostUrl(trimmed)) return true;

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;

    const host = parsed.hostname.toLowerCase();
    return host === 'seobandwagon.com' || host.endsWith('.seobandwagon.com');
  }

  // Same rule as the private normalizeApiUrl() inside SBW.getApiSettings
  // (src/lib/api.js): strip trailing slashes, fall back to the default when
  // empty, and ensure the path ends in /api.
  function normalizeApiUrl(url, fallback = API_DEFAULT_URL) {
    let normalized = String(url || '').trim().replace(/\/+$/, '');
    if (!normalized) normalized = fallback;
    if (!/\/api$/.test(normalized)) normalized += '/api';
    return normalized;
  }

  // The dashboard site's origin for a stored API URL — apiUrl always ends in
  // /api (see normalizeApiUrl above), so stripping that suffix recovers the
  // site root the links section points into. Mirrors the same derivation in
  // src/sidepanel/sidepanel.js's openSetSenderPage().
  function dashboardOrigin(apiUrl) {
    return String(apiUrl || API_DEFAULT_URL).replace(/\/api$/, '');
  }

  // ============================================
  // Verify key: SBW.verifyKey() result → status message + CSS class
  // ============================================

  function verifyStatusMessage(res) {
    if (res && res.ok) {
      const data = res.data || {};
      const keyName = (data.key && data.key.name) || 'unnamed';
      const scopes = Array.isArray(data.scopes) ? data.scopes.join(', ') : '';
      return `Connected as ${data.email || 'unknown'} · key "${keyName}" · scopes: ${scopes}`;
    }

    switch (res && res.code) {
      case 'unauthorized':
        return 'This key was rejected — create a new one';
      case 'unavailable':
      case 'network':
        return 'Could not reach SEO Bandwagon (try again)';
      default:
        return 'Could not verify key (try again)';
    }
  }

  function verifyStatusClass(res) {
    return res && res.ok ? 'success' : 'error';
  }

  // ============================================
  // Key rotation: did the field's value actually change from storage?
  // ============================================
  //
  // Drives whether Save/Verify need to drop the cached sbwUser/sbwKeyStatus
  // before re-verifying — rotating from key A to key B (or clearing the
  // field) must not leave key A's cached "Connected as …" showing for the
  // rest of its 10-minute TTL. Trimmed on both sides so trailing whitespace
  // in the field doesn't count as a change; empty vs. empty is unchanged.
  function keyChanged(prev, next) {
    return String(prev || '').trim() !== String(next || '').trim();
  }

  return {
    API_DEFAULT_URL,
    isLocalhostUrl,
    isValidApiUrl,
    normalizeApiUrl,
    dashboardOrigin,
    verifyStatusMessage,
    verifyStatusClass,
    keyChanged
  };
});
