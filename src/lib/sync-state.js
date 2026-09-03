// SEO Bandwagon — capture sync state machine
//
// Pure logic, no chrome/fetch dependency, so it's fully unit-testable and
// shareable between the popup, service worker and history page.
//
// Dual-export pattern (see src/lib/api.js / lib/content-analysis.js):
// attaches to `globalThis.SBWSync` when loaded as a classic <script> or via
// importScripts, and exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWSync = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  function initialSync() {
    return { status: 'pending', attempts: 0, nextAt: 0 };
  }

  // result = the sbwFetch()-shaped outcome of posting this capture:
  // { ok, status, data, retryAfter, code }
  //
  // Reads RETRY_BASE_MS / RETRY_MAX_MS / MAX_ATTEMPTS off the exported
  // namespace object (rather than closing over local constants) so tests —
  // and callers — can tune them at runtime.
  function nextSyncState(prev, result, now) {
    const attempts = (prev && prev.attempts) || 0;

    if (result.ok) {
      return { status: 'synced', remoteId: result.data && result.data.id, syncedAt: now };
    }

    if (result.code === 'conflict') {
      return { status: 'duplicate', syncedAt: now };
    }

    if (result.code === 'unauthorized' || result.code === 'forbidden') {
      // Never retried automatically — the key itself is the problem.
      return { status: 'skipped', error: result.code };
    }

    if (result.code === 'rate_limited') {
      // A 429 doesn't burn an attempt; it just pushes the next try out to
      // whenever the server said to come back.
      const retryAfterMs = (result.retryAfter || 60) * 1000;
      return { status: 'pending', attempts, nextAt: now + retryAfterMs };
    }

    // Everything else (503 "unavailable", network failure, or any other
    // non-ok/non-categorized code) is a transient failure: count the
    // attempt, and either back off or give up for good.
    const nextAttempts = attempts + 1;
    if (nextAttempts >= SBWSyncNamespace.MAX_ATTEMPTS) {
      return { status: 'failed', error: result.code };
    }
    const delay = Math.min(
      SBWSyncNamespace.RETRY_BASE_MS * Math.pow(2, nextAttempts - 1),
      SBWSyncNamespace.RETRY_MAX_MS
    );
    return { status: 'pending', attempts: nextAttempts, nextAt: now + delay };
  }

  function isDue(sync, now) {
    if (!sync) return true; // legacy / missing sync record — treat as pending & due
    if (sync.status !== 'pending') return false;
    return (sync.nextAt || 0) <= now;
  }

  function keyTimestamp(key) {
    const parts = String(key).split('_');
    return parseInt(parts[1], 10) || 0;
  }

  // captures = [{ key, data }]; data.sync may be absent (legacy capture).
  function pickDue(captures, now, max) {
    return captures
      .filter(c => isDue(c.data && c.data.sync, now))
      .sort((a, b) => keyTimestamp(a.key) - keyTimestamp(b.key))
      .slice(0, max);
  }

  function resetFailed(sync) {
    if (sync && sync.status === 'failed') {
      return initialSync();
    }
    return sync;
  }

  const SBWSyncNamespace = {
    RETRY_BASE_MS: 15 * 60 * 1000,    // 15 minutes
    RETRY_MAX_MS: 6 * 60 * 60 * 1000, // 6 hours
    MAX_ATTEMPTS: 5,
    initialSync,
    nextSyncState,
    isDue,
    pickDue,
    resetFailed
  };

  return SBWSyncNamespace;
});
