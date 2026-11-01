// Unit tests for the pure Citations helpers (src/lib/citations-ui.js).
// Covers: the sbwUser 10-minute cache freshness check, status/code → UI
// message mapping, the campaign-trigger poll-until-done helper, campaign
// badge/done classification, the citation payload builder (screenshot_url
// deliberately excluded), and the download filename builder.

import { describe, it, expect, vi } from 'vitest';

await import('../../extension/src/lib/citations-ui.js');
const SBWCitations = globalThis.SBWCitations;

describe('SBWCitations — dual export', () => {
  it('attaches to globalThis and exports via CommonJS', () => {
    expect(SBWCitations).toBeTruthy();
    expect(typeof SBWCitations.isUserCacheFresh).toBe('function');
  });
});

describe('isUserCacheFresh', () => {
  it('is false for a missing/undefined entry', () => {
    expect(SBWCitations.isUserCacheFresh(undefined, 1000)).toBe(false);
    expect(SBWCitations.isUserCacheFresh(null, 1000)).toBe(false);
  });

  it('is true within the 10-minute window', () => {
    const now = 1_000_000;
    const entry = { data: { email: 'a@b.com' }, at: now - 5 * 60 * 1000 };
    expect(SBWCitations.isUserCacheFresh(entry, now)).toBe(true);
  });

  it('is false once the 10-minute window has elapsed', () => {
    const now = 1_000_000;
    const entry = { data: {}, at: now - 10 * 60 * 1000 - 1 };
    expect(SBWCitations.isUserCacheFresh(entry, now)).toBe(false);
  });
});

describe('ctErrorMessage', () => {
  it('returns null for unauthorized (caller flips to signed-out, no message shown)', () => {
    expect(SBWCitations.ctErrorMessage('unauthorized', 'server said no')).toBeNull();
  });

  it('returns the fixed scope message for forbidden regardless of fallback', () => {
    expect(SBWCitations.ctErrorMessage('forbidden', 'insufficient_scope')).toBe(
      'Your key lacks the citations scope — re-create it at /dashboard/api-keys'
    );
  });

  it('maps rate_limited, unavailable, and network to fixed friendly copy', () => {
    expect(SBWCitations.ctErrorMessage('rate_limited')).toMatch(/rate limit/i);
    expect(SBWCitations.ctErrorMessage('unavailable')).toMatch(/unavailable/i);
    expect(SBWCitations.ctErrorMessage('network')).toMatch(/reach/i);
  });

  it('falls back to the given message for an unknown/generic code', () => {
    expect(SBWCitations.ctErrorMessage('error', 'Failed to fetch businesses')).toBe(
      'Failed to fetch businesses'
    );
  });

  it('has a generic default when no fallback is given for an unknown code', () => {
    expect(SBWCitations.ctErrorMessage('error')).toBeTruthy();
  });
});

describe('shouldPollAfterTrigger', () => {
  it('is true for a network/timeout failure', () => {
    expect(SBWCitations.shouldPollAfterTrigger({ code: 'network', status: 0 })).toBe(true);
  });

  it('is true for a 504 gateway timeout', () => {
    expect(SBWCitations.shouldPollAfterTrigger({ code: 'error', status: 504 })).toBe(true);
  });

  it('is true for a 502 bad gateway', () => {
    expect(SBWCitations.shouldPollAfterTrigger({ code: 'error', status: 502 })).toBe(true);
  });

  it('is false for any other error code/status', () => {
    expect(SBWCitations.shouldPollAfterTrigger({ code: 'forbidden', status: 403 })).toBe(false);
    expect(SBWCitations.shouldPollAfterTrigger({ code: 'error', status: 500 })).toBe(false);
    expect(SBWCitations.shouldPollAfterTrigger({ code: 'unauthorized', status: 401 })).toBe(false);
  });

  it('handles a missing argument without throwing', () => {
    expect(SBWCitations.shouldPollAfterTrigger()).toBe(false);
  });
});

describe('newestCampaign', () => {
  it('returns null for an empty or missing list', () => {
    expect(SBWCitations.newestCampaign([])).toBeNull();
    expect(SBWCitations.newestCampaign(undefined)).toBeNull();
  });

  it('picks the campaign with the latest created_at regardless of array order', () => {
    const campaigns = [
      { id: 'a', created_at: '2026-08-01T09:00:00Z', status: 'completed' },
      { id: 'b', created_at: '2026-08-13T09:00:00Z', status: 'running' },
      { id: 'c', created_at: '2026-08-05T09:00:00Z', status: 'completed' }
    ];
    expect(SBWCitations.newestCampaign(campaigns).id).toBe('b');
  });
});

describe('isCampaignDone', () => {
  it('is true for completed and failed', () => {
    expect(SBWCitations.isCampaignDone('completed')).toBe(true);
    expect(SBWCitations.isCampaignDone('failed')).toBe(true);
  });

  it('is false for pending/running/unknown', () => {
    expect(SBWCitations.isCampaignDone('pending')).toBe(false);
    expect(SBWCitations.isCampaignDone('running')).toBe(false);
    expect(SBWCitations.isCampaignDone(undefined)).toBe(false);
  });
});

describe('campaignBadgeTone', () => {
  it('maps each known status to its badge class', () => {
    expect(SBWCitations.campaignBadgeTone('completed')).toBe('b-ok');
    expect(SBWCitations.campaignBadgeTone('running')).toBe('b-pink');
    expect(SBWCitations.campaignBadgeTone('failed')).toBe('b-err');
    expect(SBWCitations.campaignBadgeTone('pending')).toBe('b-warn');
    expect(SBWCitations.campaignBadgeTone('anything-else')).toBe('b-warn');
  });
});

describe('pollUntilDone', () => {
  it('stops as soon as isDone is true, without waiting past that attempt', async () => {
    let calls = 0;
    const wait = vi.fn(() => Promise.resolve());
    const fetchOnce = () => { calls++; return Promise.resolve(calls); };
    const result = await SBWCitations.pollUntilDone({
      fetchOnce,
      isDone: v => v === 3,
      attempts: 12,
      intervalMs: 5000,
      wait
    });
    expect(result).toEqual({ done: true, value: 3, attempts: 3 });
    expect(calls).toBe(3);
    // Waited between attempts (2 waits for 3 attempts), not after the final one
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(5000);
  });

  it('gives up after the max attempts and reports done:false', async () => {
    const wait = vi.fn(() => Promise.resolve());
    const fetchOnce = vi.fn(() => Promise.resolve('still-running'));
    const result = await SBWCitations.pollUntilDone({
      fetchOnce,
      isDone: () => false,
      attempts: 12,
      intervalMs: 5000,
      wait
    });
    expect(result).toEqual({ done: false, value: 'still-running', attempts: 12 });
    expect(fetchOnce).toHaveBeenCalledTimes(12);
    expect(wait).toHaveBeenCalledTimes(11);
  });

  it('defaults to 12 attempts / 5000ms when not given', async () => {
    vi.useFakeTimers();
    try {
      const fetchOnce = vi.fn(() => Promise.resolve('nope'));
      const promise = SBWCitations.pollUntilDone({ fetchOnce, isDone: () => false });
      for (let i = 0; i < 11; i++) {
        await vi.advanceTimersByTimeAsync(5000);
      }
      const result = await promise;
      expect(result.attempts).toBe(12);
      expect(fetchOnce).toHaveBeenCalledTimes(12);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('citationStatusFromScore', () => {
  it('has no status without a score (1.10.3: an unchecked filing was saved as active)', () => {
    expect(SBWCitations.citationStatusFromScore(null)).toBeNull();
    expect(SBWCitations.citationStatusFromScore(undefined)).toBeNull();
  });

  it('is active at or above 80%, inconsistent below it', () => {
    expect(SBWCitations.citationStatusFromScore(80)).toBe('active');
    expect(SBWCitations.citationStatusFromScore(95)).toBe('active');
    expect(SBWCitations.citationStatusFromScore(79)).toBe('inconsistent');
    expect(SBWCitations.citationStatusFromScore(0)).toBe('inconsistent');
  });
});

describe('buildCitationPayload', () => {
  const now = new Date('2026-09-03T12:00:00Z');

  it('builds the POST body with no screenshot_url field at all', () => {
    const payload = SBWCitations.buildCitationPayload({
      directoryName: 'Yelp',
      directoryUrl: 'https://yelp.com/biz/x',
      nap: { name: 'Acme', address: '1 Main St', phone: '555-1234', website: 'https://acme.com' },
      scoreTotal: 0.91,
      screenshotDownloaded: false,
      now
    });
    expect(payload).not.toHaveProperty('screenshot_url');
    expect(payload).toEqual({
      directory_name: 'Yelp',
      directory_url: 'https://yelp.com/biz/x',
      status: 'active',
      found_name: 'Acme',
      found_address: '1 Main St',
      found_phone: '555-1234',
      found_website: 'https://acme.com',
      nap_match_score: 0.91,
      notes: 'Filed from the extension on 2026-09-03'
    });
  });

  it('sets status inconsistent under an 80% score', () => {
    const payload = SBWCitations.buildCitationPayload({
      directoryName: 'Yelp', directoryUrl: 'https://yelp.com/biz/x',
      nap: null, scoreTotal: 0.5, now
    });
    expect(payload.status).toBe('inconsistent');
  });

  it('builds nothing without a NAP check: an unchecked listing is not filed (1.10.3)', () => {
    expect(SBWCitations.buildCitationPayload({
      directoryName: 'Unknown Site', directoryUrl: 'https://example.com/biz', now
    })).toBeNull();
    expect(SBWCitations.buildCitationPayload({
      directoryName: 'Yelp', directoryUrl: 'https://yelp.com/biz/x', nap: null, scoreTotal: null, now
    })).toBeNull();
  });

  it('keeps a 0% score: zero is a checked listing that matches nothing', () => {
    const payload = SBWCitations.buildCitationPayload({
      directoryName: 'Yelp', directoryUrl: 'https://yelp.com/biz/x', nap: null, scoreTotal: 0, now
    });
    expect(payload).toMatchObject({ status: 'inconsistent', nap_match_score: 0 });
  });

  it('notes a locally-downloaded screenshot only when screenshotDownloaded is true', () => {
    const withShot = SBWCitations.buildCitationPayload({
      directoryName: 'Yelp', directoryUrl: 'https://yelp.com/biz/x',
      nap: null, scoreTotal: 0.9, screenshotDownloaded: true, now
    });
    expect(withShot.notes).toBe('Filed from the extension on 2026-09-03 — screenshot downloaded locally');

    const without = SBWCitations.buildCitationPayload({
      directoryName: 'Yelp', directoryUrl: 'https://yelp.com/biz/x',
      nap: null, scoreTotal: 0.9, screenshotDownloaded: false, now
    });
    expect(without.notes).toBe('Filed from the extension on 2026-09-03');
  });
});

describe('screenshotFilename', () => {
  const now = new Date('2026-09-03T12:00:00Z');

  it('builds citation-<host>-<date>.png, stripping www.', () => {
    expect(SBWCitations.screenshotFilename('https://www.yelp.com/biz/x', now))
      .toBe('citation-yelp.com-2026-09-03.png');
  });

  it('falls back to "page" for an unparseable URL', () => {
    expect(SBWCitations.screenshotFilename('not a url', now)).toBe('citation-page-2026-09-03.png');
  });
});

/* ------------------------------ 1.10.3 ------------------------------ */

describe('signedInAfterVerify (1.10.3)', () => {
  it('only a refused key, or none, is signed out', () => {
    expect(SBWCitations.signedInAfterVerify({ ok: true, code: 'ok' })).toBe(true);
    expect(SBWCitations.signedInAfterVerify({ ok: false, status: 401, code: 'unauthorized' })).toBe(false);
    expect(SBWCitations.signedInAfterVerify({ ok: false, status: 0, code: 'no_key' })).toBe(false);
    expect(SBWCitations.signedInAfterVerify(null)).toBe(false);
  });

  it('a 429, a 503, the network or a 500 keeps the user signed in', () => {
    for (const code of ['rate_limited', 'unavailable', 'network', 'error', 'forbidden']) {
      expect(SBWCitations.signedInAfterVerify({ ok: false, code })).toBe(true);
    }
  });
});

describe('ctErrorMessage — no key', () => {
  it('says to connect, not "no_key"', () => {
    expect(SBWCitations.ctErrorMessage('no_key', 'no_key')).toMatch(/Connect your SEO Bandwagon account/);
  });
});

describe('campaignOutcome (1.10.3)', () => {
  it('a failed campaign says failed, not "Campaign complete"', () => {
    expect(SBWCitations.campaignOutcome('failed')).toMatch(/^Campaign failed/);
    expect(SBWCitations.campaignOutcome('completed')).toBe('Campaign complete');
  });

  it('anything else is still running', () => {
    expect(SBWCitations.campaignOutcome('running')).toMatch(/Still running/);
    expect(SBWCitations.campaignOutcome(undefined)).toMatch(/Still running/);
  });
});

describe('napScore and averageNapPct (1.10.3)', () => {
  // The site returns nap_match_score, a numeric column, as a string.
  const rows = [
    { nap_match_score: '0.850' },
    { nap_match_score: '0.650' },
    { nap_match_score: null },
    { nap_match_score: '' },
    { nap_match_score: 'n/a' }
  ];

  it('reads the string the site sends as a number', () => {
    expect(SBWCitations.napScore(rows[0])).toBe(0.85);
    expect(SBWCitations.napScore({ nap_match_score: 0.5 })).toBe(0.5);
    expect(SBWCitations.napScore({ nap_match_score: '0' })).toBe(0);
    expect(SBWCitations.napScore(rows[2])).toBeNull();
    expect(SBWCitations.napScore(rows[3])).toBeNull();
    expect(SBWCitations.napScore(rows[4])).toBeNull();
  });

  it('averages two string scores to a number, where the old sum read "NaN%"', () => {
    const old = rows.filter(c => c.nap_match_score != null).slice(0, 2);
    const oldAvg = Math.round(old.reduce((s, c) => s + c.nap_match_score, 0) / old.length * 100);
    expect(Number.isNaN(oldAvg)).toBe(true); // the 1.10.2 footer's arithmetic
    expect(SBWCitations.averageNapPct(rows)).toBe(75);
  });

  it('is null when no citation has a score', () => {
    expect(SBWCitations.averageNapPct([{ nap_match_score: null }])).toBeNull();
    expect(SBWCitations.averageNapPct([])).toBeNull();
  });
});

describe('latestCitations (1.10.3)', () => {
  it('the newest three by last check or filing, not the site\'s priority order', () => {
    const list = [
      { id: 'a', priority_rank: 1, created_at: '2026-01-01T00:00:00Z' },
      { id: 'b', priority_rank: 2, created_at: '2026-03-01T00:00:00Z', last_checked_at: '2026-10-30T00:00:00Z' },
      { id: 'c', priority_rank: 3, created_at: '2026-10-01T00:00:00Z' },
      { id: 'd', priority_rank: null, created_at: '2026-10-31T00:00:00Z' }
    ];
    expect(SBWCitations.latestCitations(list, 3).map(c => c.id)).toEqual(['d', 'b', 'c']);
    expect(list.map(c => c.id)).toEqual(['a', 'b', 'c', 'd']); // not sorted in place
  });
});
