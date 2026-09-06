// Unit tests for the pure one-time review-prompt state machine
// (src/lib/review-prompt.js). Ledger ruling: prompt once, un-incentivized,
// after the 5th analysis, no outcome-based gating — shouldPrompt() must
// depend only on `analyses` and `prompted`, never on a score or error.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWReview` rather than an ESM default export.
await import('../../src/lib/review-prompt.js');
const SBWReview = globalThis.SBWReview;

describe('SBWReview namespace', () => {
  it('attaches to globalThis.SBWReview', () => {
    expect(SBWReview).toBeTruthy();
    expect(typeof SBWReview.shouldPrompt).toBe('function');
    expect(typeof SBWReview.nextState).toBe('function');
    expect(typeof SBWReview.REVIEW_URL).toBe('string');
  });

  it('points at the real Chrome Web Store listing reviews tab', () => {
    expect(SBWReview.REVIEW_URL).toBe(
      'https://chromewebstore.google.com/detail/seo-bandwagon/dphmaddiedhkejfhabkfdenfphjljioj/reviews'
    );
  });
});

describe('shouldPrompt', () => {
  it('is false below 5 analyses', () => {
    expect(SBWReview.shouldPrompt({ analyses: 0, prompted: false })).toBe(false);
    expect(SBWReview.shouldPrompt({ analyses: 4, prompted: false })).toBe(false);
  });

  it('is true at exactly 5 analyses when never prompted', () => {
    expect(SBWReview.shouldPrompt({ analyses: 5, prompted: false })).toBe(true);
  });

  it('stays true above 5 analyses when never prompted', () => {
    expect(SBWReview.shouldPrompt({ analyses: 40, prompted: false })).toBe(true);
  });

  it('is false once prompted, no matter how high analyses climbs', () => {
    expect(SBWReview.shouldPrompt({ analyses: 5, prompted: true })).toBe(false);
    expect(SBWReview.shouldPrompt({ analyses: 999, prompted: true })).toBe(false);
  });

  it('never re-prompts after a dismissal even if analyses keeps counting', () => {
    let state = { analyses: 5, prompted: false };
    expect(SBWReview.shouldPrompt(state)).toBe(true);
    state = SBWReview.nextState(state, { type: 'dismissed' });
    state = SBWReview.nextState(state, { type: 'analyzed' });
    state = SBWReview.nextState(state, { type: 'analyzed' });
    expect(SBWReview.shouldPrompt(state)).toBe(false);
  });

  it('is never gated on score, outcome, or error state — only analyses/prompted matter', () => {
    // Deliberately pass fields a naive implementation might key off of;
    // shouldPrompt must ignore anything beyond analyses/prompted.
    expect(SBWReview.shouldPrompt({ analyses: 5, prompted: false, score: 12, grade: 'F', error: true })).toBe(true);
    expect(SBWReview.shouldPrompt({ analyses: 5, prompted: false, score: 98, grade: 'A' })).toBe(true);
  });

  it('handles a missing/undefined state as never-analyzed, never-prompted', () => {
    expect(SBWReview.shouldPrompt(undefined)).toBe(false);
    expect(SBWReview.shouldPrompt({})).toBe(false);
  });
});

describe('nextState', () => {
  it('increments analyses on an "analyzed" event', () => {
    const next = SBWReview.nextState({ analyses: 3, prompted: false }, { type: 'analyzed' });
    expect(next.analyses).toBe(4);
    expect(next.prompted).toBe(false);
  });

  it('defaults a missing/undefined state to zero analyses before incrementing', () => {
    const next = SBWReview.nextState(undefined, { type: 'analyzed' });
    expect(next.analyses).toBe(1);
  });

  it('sets prompted: true on a "reviewed" event without touching analyses', () => {
    const next = SBWReview.nextState({ analyses: 7, prompted: false }, { type: 'reviewed' });
    expect(next.prompted).toBe(true);
    expect(next.analyses).toBe(7);
  });

  it('sets prompted: true on a "dismissed" event without touching analyses', () => {
    const next = SBWReview.nextState({ analyses: 7, prompted: false }, { type: 'dismissed' });
    expect(next.prompted).toBe(true);
    expect(next.analyses).toBe(7);
  });

  it('does not mutate the input state object', () => {
    const state = { analyses: 3, prompted: false };
    const next = SBWReview.nextState(state, { type: 'analyzed' });
    expect(state.analyses).toBe(3);
    expect(next).not.toBe(state);
  });

  it('is a no-op passthrough for an unrecognized event type', () => {
    const state = { analyses: 3, prompted: false };
    const next = SBWReview.nextState(state, { type: 'something-else' });
    expect(next.analyses).toBe(3);
    expect(next.prompted).toBe(false);
  });
});
