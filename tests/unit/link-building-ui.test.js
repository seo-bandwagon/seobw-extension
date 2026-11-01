// Unit tests for the pure Link Building helpers (src/lib/link-building-ui.js).
// Covers: sbwFetch code -> user-facing message mapping for SBW.lb.* calls
// (non-throwing, unlike SBW.ct.*), the "Add current tab as outlet" result
// message, the pitch review/dispatch 409-failures / 400-offenders message,
// the Gmail compose URL builder, and the results funnel's table rows.

import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/link-building-ui.js');
const LB = globalThis.SBWLinkBuildingUI;

describe('SBWLinkBuildingUI — dual export', () => {
  it('attaches to globalThis and exports via CommonJS', () => {
    expect(LB).toBeTruthy();
    expect(typeof LB.outletAddMessage).toBe('function');
  });
});

describe('lbErrorMessage', () => {
  it('returns null for unauthorized (caller flips to signed-out, no message shown)', () => {
    expect(LB.lbErrorMessage('unauthorized', 'server said no')).toBeNull();
  });

  it('returns the fixed scope message for forbidden regardless of fallback', () => {
    expect(LB.lbErrorMessage('forbidden', 'insufficient_scope')).toBe(
      'Your key lacks the link-building scope — re-create it at /dashboard/api-keys'
    );
  });

  it('maps rate_limited, unavailable, and network to fixed friendly copy', () => {
    expect(LB.lbErrorMessage('rate_limited')).toMatch(/rate limit/i);
    expect(LB.lbErrorMessage('unavailable')).toMatch(/unavailable/i);
    expect(LB.lbErrorMessage('network')).toMatch(/reach/i);
  });

  it('falls back to the given message for an unknown/generic code', () => {
    expect(LB.lbErrorMessage('error', 'Failed to fetch prospects')).toBe('Failed to fetch prospects');
  });

  it('falls back to a generic message when no fallback is given', () => {
    expect(LB.lbErrorMessage('error')).toBe('Something went wrong');
  });

  it('falls back to a generic message when the fallback is a non-string (e.g. a Zod .flatten() object)', () => {
    const zodFlattenedError = { fieldErrors: { reason: ['reason is required'] }, formErrors: [] };
    expect(LB.lbErrorMessage('error', zodFlattenedError)).toBe('Something went wrong');
  });
});

describe('outletAddMessage', () => {
  it('reports a fresh add with its status', () => {
    const result = { ok: true, status: 201, data: { id: 'p1', domain: 'example.com', status: 'candidate', created: true }, code: 'ok' };
    expect(LB.outletAddMessage(result)).toBe('Added as outlet (candidate)');
  });

  it('reports an already-tracked outlet with its current status', () => {
    const result = { ok: true, status: 200, data: { id: 'p1', domain: 'example.com', status: 'approved', created: false }, code: 'ok' };
    expect(LB.outletAddMessage(result)).toBe('Already tracked (approved)');
  });

  it('reports a 400 as "not a usable outlet URL"', () => {
    const result = { ok: false, status: 400, data: { error: 'Invalid outlet URL' }, code: 'error' };
    expect(LB.outletAddMessage(result)).toBe('Not a usable outlet URL');
  });

  it('does not misreport a 500 as an invalid URL', () => {
    const result = { ok: false, status: 500, data: { error: 'Failed to add outlet' }, code: 'error' };
    expect(LB.outletAddMessage(result)).toBe('Failed to add outlet');
  });

  it('shows the scope message on forbidden', () => {
    const result = { ok: false, status: 403, data: null, code: 'forbidden' };
    expect(LB.outletAddMessage(result)).toMatch(/link-building scope/);
  });

  it('returns null on unauthorized so the caller can flip to signed-out', () => {
    const result = { ok: false, status: 401, data: null, code: 'unauthorized' };
    expect(LB.outletAddMessage(result)).toBeNull();
  });

  it('handles a missing/undefined result', () => {
    expect(LB.outletAddMessage(undefined)).toBe('Something went wrong');
  });
});

describe('pitchReviewErrorMessage', () => {
  it('returns null for a successful result', () => {
    expect(LB.pitchReviewErrorMessage({ ok: true, status: 200, data: { status: 'approved' }, code: 'ok' })).toBeNull();
  });

  it('lists 409 standing-check failures', () => {
    const result = {
      ok: false, status: 409, code: 'conflict',
      data: { error: 'standing checks failed', failures: ['no stats_used recorded', 'outlet already has an active pitch'] }
    };
    expect(LB.pitchReviewErrorMessage(result)).toBe(
      "Can't proceed: no stats_used recorded; outlet already has an active pitch"
    );
  });

  it('lists 409 send-gate failures from dispatch', () => {
    const result = {
      ok: false, status: 409, code: 'conflict',
      data: { error: 'send gates failed', failures: ["status is 'draft', not 'approved'"] }
    };
    expect(LB.pitchReviewErrorMessage(result)).toContain("status is 'draft', not 'approved'");
  });

  it('lists 400 unsourced-number offenders', () => {
    const result = {
      ok: false, status: 400, code: 'error',
      data: { error: 'edited body introduces numbers not sourced by stats_used', offenders: ['47%', '3.2x'] }
    };
    expect(LB.pitchReviewErrorMessage(result)).toContain('47%, 3.2x');
  });

  it('falls back to the generic code mapping for other statuses', () => {
    const result = { ok: false, status: 404, code: 'error', data: { error: 'Draft not found' } };
    expect(LB.pitchReviewErrorMessage(result)).toBe('Draft not found');
  });

  it('shows the scope message on forbidden', () => {
    const result = { ok: false, status: 403, code: 'forbidden', data: null };
    expect(LB.pitchReviewErrorMessage(result)).toMatch(/link-building scope/);
  });

  it('returns null on unauthorized', () => {
    expect(LB.pitchReviewErrorMessage({ ok: false, status: 401, code: 'unauthorized', data: null })).toBeNull();
  });

  it('does not choke on an empty failures/offenders array', () => {
    const result = { ok: false, status: 409, code: 'conflict', data: { error: 'nope', failures: [] } };
    expect(LB.pitchReviewErrorMessage(result)).toBe('nope');
  });
});

describe('pitchCardModel', () => {
  // GET /api/link-building/pitches rows are FLAT — contact and prospect
  // columns are aliased straight onto the row (full_name, email,
  // verification_status, domain), not nested under `.contact`/`.prospect`.
  // See site route.ts L34-47.
  const flatRow = {
    id: 'p1', angle_type: 'data_story', subject_line: 'A dataset your churn story is missing',
    body_markdown: 'Hi Priya,\n\nSee attached.', status: 'draft',
    full_name: 'Priya Shah', email: 'priya@austinlocalnews.com', verification_status: 'valid',
    domain: 'austinlocalnews.com', quality_score: '78.5'
  };

  it('extracts name/email/verified/domain/subject/body from a flat row', () => {
    expect(LB.pitchCardModel(flatRow)).toEqual({
      name: 'Priya Shah',
      email: 'priya@austinlocalnews.com',
      verified: 'valid',
      domain: 'austinlocalnews.com',
      subject: 'A dataset your churn story is missing',
      body: 'Hi Priya,\n\nSee attached.'
    });
  });

  it('defaults a missing contact name to "Unknown contact"', () => {
    expect(LB.pitchCardModel(Object.assign({}, flatRow, { full_name: null })).name).toBe('Unknown contact');
  });

  it('defaults a missing verification_status to "unverified"', () => {
    expect(LB.pitchCardModel(Object.assign({}, flatRow, { verification_status: null })).verified).toBe('unverified');
  });

  it('reports a missing email as null rather than an empty string', () => {
    expect(LB.pitchCardModel(Object.assign({}, flatRow, { email: null })).email).toBeNull();
  });

  it('does not read a nested .contact/.prospect shape even if present (flat fields win)', () => {
    const withStaleNesting = Object.assign({}, flatRow, {
      contact: { full_name: 'Wrong Name', email: 'wrong@example.com' },
      prospect: { domain: 'wrong.example.com' }
    });
    const model = LB.pitchCardModel(withStaleNesting);
    expect(model.name).toBe('Priya Shah');
    expect(model.email).toBe('priya@austinlocalnews.com');
    expect(model.domain).toBe('austinlocalnews.com');
  });

  it('handles null/undefined input without throwing', () => {
    expect(LB.pitchCardModel(null)).toEqual({
      name: 'Unknown contact', email: null, verified: 'unverified', domain: '', subject: '', body: ''
    });
  });
});

describe('gmailComposeUrl — inputs derived from pitchCardModel', () => {
  it('builds the compose URL from a flat pitch row via pitchCardModel', () => {
    const flatRow = {
      full_name: 'Priya Shah', email: 'priya@austinlocalnews.com', verification_status: 'valid',
      domain: 'austinlocalnews.com', subject_line: 'A dataset your churn story is missing',
      body_markdown: 'Hi Priya,\n\nSee attached.'
    };
    const m = LB.pitchCardModel(flatRow);
    const url = LB.gmailComposeUrl({
      senderAddress: 'dana@northsidedental.com',
      email: m.email,
      subject: m.subject,
      body: m.body
    });
    expect(url).toContain('to=priya%40austinlocalnews.com');
    expect(url).toContain('su=A%20dataset%20your%20churn%20story%20is%20missing');
  });
});

describe('gmailComposeUrl', () => {
  it('matches the dashboard URL shape exactly, percent-encoding every field', () => {
    const url = LB.gmailComposeUrl({
      senderAddress: 'dana+outreach@northsidedental.com',
      email: 'priya@austinlocalnews.com',
      subject: 'A dataset & your churn story',
      body: 'Hi Priya,\n\nSee attached — 47% churn.'
    });

    expect(url).toBe(
      'https://mail.google.com/mail/u/dana%2Boutreach%40northsidedental.com/?view=cm&fm=1' +
      '&to=priya%40austinlocalnews.com' +
      '&su=A%20dataset%20%26%20your%20churn%20story' +
      '&body=Hi%20Priya%2C%0A%0ASee%20attached%20%E2%80%94%2047%25%20churn.'
    );
  });
});

describe('funnelRows', () => {
  it('maps every funnel field to a labeled row, coercing to numbers', () => {
    const results = {
      funnel: {
        prospects_total: 46, awaiting_review: '9', approved_outlets: 14, held: 4, archived: 19,
        journalists: 22, with_email: 15, verified_valid: 11, drafts: 3, approved_pitches: 2,
        rejected_pitches: 5, sent: 6, placements: 3, placements_from_pitches: 2
      }
    };
    const rows = LB.funnelRows(results);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({ label: 'Prospects', value: 46 });
    expect(rows.find(r => r.label === 'Awaiting review')).toEqual({ label: 'Awaiting review', value: 9 });
    expect(rows.find(r => r.label === 'Sent')).toEqual({ label: 'Sent', value: 6 });
    expect(rows.find(r => r.label === 'Placements from pitches')).toEqual({ label: 'Placements from pitches', value: 2 });
  });

  it('defaults missing/non-numeric fields to 0 rather than NaN', () => {
    const rows = LB.funnelRows({ funnel: {} });
    expect(rows.every(r => r.value === 0)).toBe(true);
  });

  it('handles a missing funnel key entirely', () => {
    const rows = LB.funnelRows({});
    expect(rows.every(r => r.value === 0)).toBe(true);
    expect(LB.funnelRows(undefined).every(r => r.value === 0)).toBe(true);
  });
});

describe('outletActions (1.10.3)', () => {
  // POST /api/link-building/prospects/review changes only qualified and held rows.
  it('shows review buttons only where the route acts', () => {
    expect(LB.outletActions('qualified')).toEqual(['approve', 'hold', 'reject']);
    expect(LB.outletActions('held')).toEqual(['approve', 'reject']);
    expect(LB.outletActions('approved')).toEqual([]);
    expect(LB.outletActions('candidate')).toEqual([]);
    expect(LB.outletActions('archived')).toEqual([]);
    expect(LB.outletActions(undefined)).toEqual([]);
  });
});

describe('lbErrorMessage — no key', () => {
  it('says to connect', () => {
    expect(LB.lbErrorMessage('no_key')).toMatch(/Connect your SEO Bandwagon account/);
  });
});
