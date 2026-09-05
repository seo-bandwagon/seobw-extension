// Unit tests for the pure capture-sync state machine (src/lib/sync-state.js).
// Covers: initialSync, every nextSyncState transition (including the exact
// backoff sequence), isDue, pickDue ordering/limits, and resetFailed.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/api.js, lib/content-analysis.js) — the
// module attaches itself to `globalThis.SBWSync` rather than relying on an
// ESM default export, so tests read it off globalThis after importing.
await import('../../src/lib/sync-state.js');
const SBWSync = globalThis.SBWSync;

const NOW = 1_700_000_000_000;

describe('SBWSync namespace', () => {
  it('attaches to globalThis.SBWSync', () => {
    expect(SBWSync).toBeTruthy();
    expect(typeof SBWSync.nextSyncState).toBe('function');
  });

  it('exposes the backoff constants', () => {
    expect(SBWSync.RETRY_BASE_MS).toBe(15 * 60 * 1000);
    expect(SBWSync.RETRY_MAX_MS).toBe(6 * 60 * 60 * 1000);
    expect(SBWSync.MAX_ATTEMPTS).toBe(5);
  });
});

describe('initialSync', () => {
  it('returns a fresh pending state', () => {
    expect(SBWSync.initialSync()).toEqual({ status: 'pending', attempts: 0, nextAt: 0 });
  });
});

describe('nextSyncState', () => {
  it('ok/201 -> synced, carries remoteId and syncedAt', () => {
    const prev = SBWSync.initialSync();
    const result = { ok: true, status: 201, data: { id: 'abc123' }, retryAfter: null, code: 'ok' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({
      status: 'synced', remoteId: 'abc123', syncedAt: NOW
    });
  });

  it('409 -> duplicate', () => {
    const prev = SBWSync.initialSync();
    const result = { ok: false, status: 409, data: { error: 'exists' }, retryAfter: null, code: 'conflict' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({ status: 'duplicate', syncedAt: NOW });
  });

  it('401 -> skipped with error code, never retried', () => {
    const prev = SBWSync.initialSync();
    const result = { ok: false, status: 401, data: null, retryAfter: null, code: 'unauthorized' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({ status: 'skipped', error: 'unauthorized' });
  });

  it('403 -> skipped with error code, never retried', () => {
    const prev = SBWSync.initialSync();
    const result = { ok: false, status: 403, data: null, retryAfter: null, code: 'forbidden' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({ status: 'skipped', error: 'forbidden' });
  });

  it('429 -> pending, attempts unchanged, nextAt = now + retryAfter*1000', () => {
    const prev = { status: 'pending', attempts: 2, nextAt: 0 };
    const result = { ok: false, status: 429, data: null, retryAfter: 30, code: 'rate_limited' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({
      status: 'pending', attempts: 2, nextAt: NOW + 30000
    });
  });

  it('429 with no prior attempts stays at zero attempts', () => {
    const prev = SBWSync.initialSync();
    const result = { ok: false, status: 429, data: null, retryAfter: 60, code: 'rate_limited' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({
      status: 'pending', attempts: 0, nextAt: NOW + 60000
    });
  });

  it('network failure falls into the same retry bucket as 503', () => {
    const prev = SBWSync.initialSync();
    const result = { ok: false, status: 0, data: null, retryAfter: null, code: 'network' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({
      status: 'pending', attempts: 1, nextAt: NOW + 15 * 60 * 1000
    });
  });

  it('a generic error status falls into the same retry bucket as 503', () => {
    const prev = SBWSync.initialSync();
    const result = { ok: false, status: 500, data: null, retryAfter: null, code: 'error' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({
      status: 'pending', attempts: 1, nextAt: NOW + 15 * 60 * 1000
    });
  });

  it('the exact backoff sequence: 15m, 30m, 1h, 2h, then failed on the 5th attempt', () => {
    let sync = SBWSync.initialSync();
    const result = { ok: false, status: 503, data: null, retryAfter: null, code: 'unavailable' };

    sync = SBWSync.nextSyncState(sync, result, NOW);
    expect(sync).toEqual({ status: 'pending', attempts: 1, nextAt: NOW + 15 * 60 * 1000 });

    sync = SBWSync.nextSyncState(sync, result, NOW);
    expect(sync).toEqual({ status: 'pending', attempts: 2, nextAt: NOW + 30 * 60 * 1000 });

    sync = SBWSync.nextSyncState(sync, result, NOW);
    expect(sync).toEqual({ status: 'pending', attempts: 3, nextAt: NOW + 60 * 60 * 1000 });

    sync = SBWSync.nextSyncState(sync, result, NOW);
    expect(sync).toEqual({ status: 'pending', attempts: 4, nextAt: NOW + 120 * 60 * 1000 });

    sync = SBWSync.nextSyncState(sync, result, NOW);
    expect(sync).toEqual({ status: 'failed', error: 'unavailable' });
  });

  it('a fresh 429 does not reset an in-progress backoff attempt count', () => {
    const prev = { status: 'pending', attempts: 3, nextAt: 0 };
    const result = { ok: false, status: 429, data: null, retryAfter: 45, code: 'rate_limited' };
    expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({
      status: 'pending', attempts: 3, nextAt: NOW + 45000
    });
  });

  it('clamps the backoff delay at RETRY_MAX_MS', () => {
    const originalMax = SBWSync.MAX_ATTEMPTS;
    SBWSync.MAX_ATTEMPTS = 100; // isolate the delay-clamp math from the attempt ceiling
    try {
      const prev = { status: 'pending', attempts: 5, nextAt: 0 }; // -> attempts 6, 15m*2^5 = 8h, clamps to 6h
      const result = { ok: false, status: 503, data: null, retryAfter: null, code: 'unavailable' };
      expect(SBWSync.nextSyncState(prev, result, NOW)).toEqual({
        status: 'pending', attempts: 6, nextAt: NOW + 6 * 60 * 60 * 1000
      });
    } finally {
      SBWSync.MAX_ATTEMPTS = originalMax;
    }
  });
});

describe('isDue', () => {
  it('is due when pending and nextAt has passed', () => {
    expect(SBWSync.isDue({ status: 'pending', attempts: 0, nextAt: 100 }, 200)).toBe(true);
  });

  it('is not due when pending and nextAt is in the future', () => {
    expect(SBWSync.isDue({ status: 'pending', attempts: 0, nextAt: 300 }, 200)).toBe(false);
  });

  it('is due exactly at nextAt', () => {
    expect(SBWSync.isDue({ status: 'pending', attempts: 0, nextAt: 200 }, 200)).toBe(true);
  });

  it('non-pending statuses are never due', () => {
    for (const status of ['synced', 'duplicate', 'skipped', 'failed']) {
      expect(SBWSync.isDue({ status, attempts: 0, nextAt: 0 }, 200)).toBe(false);
    }
  });

  it('a missing sync is treated as pending and due', () => {
    expect(SBWSync.isDue(undefined, 200)).toBe(true);
    expect(SBWSync.isDue(null, 200)).toBe(true);
  });
});

describe('pickDue', () => {
  it('sorts due entries oldest-first by key timestamp', () => {
    const pending = { status: 'pending', attempts: 0, nextAt: 0 };
    const captures = [
      { key: 'capture_300', data: { sync: pending } },
      { key: 'capture_100', data: { sync: pending } },
      { key: 'capture_200', data: { sync: pending } }
    ];
    const due = SBWSync.pickDue(captures, 1000, 10);
    expect(due.map(c => c.key)).toEqual(['capture_100', 'capture_200', 'capture_300']);
  });

  it('excludes captures that are not due', () => {
    const captures = [
      { key: 'capture_100', data: { sync: { status: 'pending', attempts: 0, nextAt: 5000 } } }, // not due yet
      { key: 'capture_200', data: { sync: { status: 'synced', remoteId: 'r1', syncedAt: 100 } } },
      { key: 'capture_300', data: { sync: { status: 'pending', attempts: 0, nextAt: 0 } } }
    ];
    const due = SBWSync.pickDue(captures, 1000, 10);
    expect(due.map(c => c.key)).toEqual(['capture_300']);
  });

  it('caps the result at max', () => {
    const captures = [100, 200, 300, 400, 500].map(ts => ({
      key: `capture_${ts}`,
      data: { sync: SBWSync.initialSync() }
    }));
    const due = SBWSync.pickDue(captures, 1000, 2);
    expect(due.map(c => c.key)).toEqual(['capture_100', 'capture_200']);
  });

  it('treats legacy captures without a sync field as pending and due', () => {
    const captures = [{ key: 'capture_500', data: { url: 'https://example.com' } }];
    const due = SBWSync.pickDue(captures, 1000, 10);
    expect(due.map(c => c.key)).toEqual(['capture_500']);
  });

  it('ignores captures markLegacyPending stamped skipped/legacy (they need an explicit opt-in, not a drain)', () => {
    const captures = [
      { key: 'capture_100', data: { sync: { status: 'skipped', error: 'legacy', attempts: 0, nextAt: 0 } } },
      { key: 'capture_200', data: { sync: SBWSync.initialSync() } }
    ];
    const due = SBWSync.pickDue(captures, 1000, 10);
    expect(due.map(c => c.key)).toEqual(['capture_200']);
  });
});

describe('resetFailed', () => {
  it('resets a failed sync back to a fresh pending state', () => {
    expect(SBWSync.resetFailed({ status: 'failed', error: 'unavailable' })).toEqual({
      status: 'pending', attempts: 0, nextAt: 0
    });
  });

  it('leaves a non-failed sync unchanged', () => {
    const synced = { status: 'synced', remoteId: '1', syncedAt: 100 };
    expect(SBWSync.resetFailed(synced)).toEqual(synced);
  });
});

describe('unskipLegacy', () => {
  it('converts a legacy-skipped sync back to a fresh pending state', () => {
    const sync = { status: 'skipped', error: 'legacy', attempts: 0, nextAt: 0 };
    expect(SBWSync.unskipLegacy(sync)).toEqual({ status: 'pending', attempts: 0, nextAt: 0 });
  });

  it('leaves a non-legacy skip unchanged (e.g. an unauthorized key)', () => {
    const sync = { status: 'skipped', error: 'unauthorized' };
    expect(SBWSync.unskipLegacy(sync)).toEqual(sync);
  });

  it('leaves a non-skipped sync unchanged', () => {
    const synced = { status: 'synced', remoteId: '1', syncedAt: 100 };
    expect(SBWSync.unskipLegacy(synced)).toEqual(synced);
  });
});
