// SEO Bandwagon — Link Building UI helpers
//
// Pure logic shared by the side panel's LINKS mode (src/sidepanel/sidepanel.js)
// and the popup's "Add as outlet" button (src/popup/popup.js): the sbwFetch
// error-code -> user-facing message mapping for SBW.lb.* calls (which,
// unlike SBW.ct.*, do NOT throw — every caller branches on `.ok`/`.code`),
// the "Add current tab as outlet" result message, the pitch-review /
// dispatch 409-failures / 400-offenders message, the Gmail compose URL
// builder (copied verbatim from the dashboard), and the results funnel's
// table rows.
//
// Dual-export pattern (see src/lib/citations-ui.js / src/lib/api.js):
// attaches to `globalThis.SBWLinkBuildingUI` when loaded as a classic
// <script>, and exports via CommonJS when loaded by Vitest / Node. No
// chrome/fetch/DOM dependency here — that wiring stays in the panel/popup
// files.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWLinkBuildingUI = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // ============================================
  // sbwFetch code -> user-facing message (generic, link-building scope)
  // ============================================

  // `unauthorized` returns null on purpose: callers flip straight to the
  // signed-out view rather than showing an error string.
  //
  // `fallback` is guarded to a string here rather than at each call site: a
  // 400 from Zod's .flatten() comes back as `{ error: {fieldErrors, ...} }`,
  // an object, not a string — callers that do `res.data.error || 'default'`
  // pass that object straight through (it's truthy, so the `||` never reaches
  // their string literal) and it would otherwise render as "[object Object]".
  function lbErrorMessage(code, fallback) {
    const safeFallback = typeof fallback === 'string' && fallback ? fallback : 'Something went wrong';
    switch (code) {
      case 'unauthorized':
        return null;
      case 'forbidden':
        return 'Your key lacks the link-building scope — re-create it at /dashboard/api-keys';
      case 'rate_limited':
        return 'Rate limited — try again in a moment';
      case 'unavailable':
        return 'SEO Bandwagon is temporarily unavailable';
      case 'network':
        return "Can't reach SEO Bandwagon — check your connection";
      default:
        return safeFallback;
    }
  }

  // ============================================
  // Add current tab as outlet — POST /api/link-building/prospects
  // ============================================

  // `result` is the raw SBW.lb.addOutlet() return: { ok, status, data, code }.
  function outletAddMessage(result) {
    if (!result) return 'Something went wrong';

    if (result.ok) {
      const data = result.data || {};
      if (data.created === false) {
        return `Already tracked (${data.status})`;
      }
      return `Added as outlet (${data.status})`;
    }

    // The route 400s with "Invalid outlet URL" for a URL that doesn't
    // normalize to a domain — sbwFetch has no dedicated code for 400, it
    // falls into the generic 'error' bucket, so status is what distinguishes
    // it from a 500.
    if (result.code === 'error' && result.status === 400) {
      return 'Not a usable outlet URL';
    }

    const serverError = result.data && typeof result.data === 'object' ? result.data.error : null;
    return lbErrorMessage(result.code, serverError || 'Failed to add outlet');
  }

  // ============================================
  // Pitch review / dispatch — POST .../pitches/review, .../pitches/dispatch
  // ============================================

  // `result` is the raw SBW.lb.reviewPitch() / SBW.lb.markSent() return.
  // 409 -> standing-checks / send-gate failures[]; 400 -> unsourced-number
  // offenders[] (review only). Both are string arrays from the site.
  function pitchReviewErrorMessage(result) {
    if (!result || result.ok) return null;

    const data = result.data || {};
    if (result.status === 409 && Array.isArray(data.failures) && data.failures.length) {
      return `Can't proceed: ${data.failures.join('; ')}`;
    }
    if (result.status === 400 && Array.isArray(data.offenders) && data.offenders.length) {
      return `Unsourced numbers — rephrase freely, but numbers must trace to the Angle Sheet: ${data.offenders.join(', ')}`;
    }

    return lbErrorMessage(result.code, typeof data.error === 'string' ? data.error : 'Failed to record review');
  }

  // ============================================
  // Pitch card model — GET /api/link-building/pitches rows are FLAT (contact
  // and prospect columns are aliased straight onto the row, not nested —
  // see docs/API.md and the site's route.ts), not `{ contact: {...},
  // prospect: {...} }`. This is the single place that reads those flat
  // fields, so the side panel's card renderers and the Gmail compose action
  // can't drift back into assuming a nested shape.
  // ============================================

  function pitchCardModel(p) {
    return {
      name: (p && p.full_name) || 'Unknown contact',
      email: (p && p.email) || null,
      verified: (p && p.verification_status) || 'unverified',
      domain: (p && p.domain) || '',
      subject: (p && p.subject_line) || '',
      body: (p && p.body_markdown) || ''
    };
  }

  // ============================================
  // Gmail compose URL — copied exactly from the dashboard
  // ============================================

  function gmailComposeUrl({ senderAddress, email, subject, body }) {
    return `https://mail.google.com/mail/u/${encodeURIComponent(senderAddress)}/?view=cm&fm=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // ============================================
  // Results funnel — GET /api/link-building/results
  // ============================================

  const FUNNEL_FIELDS = [
    ['prospects_total', 'Prospects'],
    ['awaiting_review', 'Awaiting review'],
    ['approved_outlets', 'Approved outlets'],
    ['held', 'Held'],
    ['archived', 'Archived'],
    ['journalists', 'Journalists'],
    ['with_email', 'With email'],
    ['verified_valid', 'Verified'],
    ['drafts', 'Drafts'],
    ['approved_pitches', 'Approved pitches'],
    ['rejected_pitches', 'Rejected pitches'],
    ['sent', 'Sent'],
    ['placements', 'Placements'],
    ['placements_from_pitches', 'Placements from pitches']
  ];

  // `results` is the raw GET .../results body: { funnel, spend, placements, sends }.
  // Every funnel value is coerced through Number() — count(*) casts come back
  // as JS numbers from postgres-js for int4, but this stays defensive against
  // a string or missing field rather than rendering NaN.
  function funnelRows(results) {
    const f = (results && results.funnel) || {};
    return FUNNEL_FIELDS.map(([key, label]) => ({ label, value: Number(f[key]) || 0 }));
  }

  return {
    lbErrorMessage,
    outletAddMessage,
    pitchReviewErrorMessage,
    pitchCardModel,
    gmailComposeUrl,
    funnelRows
  };
});
