// Unit tests for src/lib/site-connect.js (1.13.7): when a key seobandwagon.com
// hands over may be stored without asking, what the confirmation page is
// shown, and who may answer for the person.

import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/site-connect.js');
const C = globalThis.SBWSiteConnect;

const KEY_A = 'sbw_' + 'a'.repeat(48);
const KEY_B = 'sbw_' + 'b'.repeat(48);
const ME_OWNER = { email: 'owner@example.com', name: 'Owner' };
const ME_OTHER = { email: 'someone@example.net', name: 'Someone' };

describe('isKeyFormat', () => {
  it('takes only a string sbw_ key of 48 hex digits', () => {
    expect(C.isKeyFormat(KEY_A)).toBe(true);
    expect(C.isKeyFormat('sbw_nope')).toBe(false);
    expect(C.isKeyFormat(KEY_A.toUpperCase())).toBe(false);
    expect(C.isKeyFormat(KEY_A + 'a')).toBe(false);
    // A one-element array passed the old check (RegExp.test coerces it).
    expect(C.isKeyFormat([KEY_A])).toBe(false);
    expect(C.isKeyFormat(undefined)).toBe(false);
  });
});

describe('connectPlan', () => {
  it('keeps the key already stored', () => {
    expect(C.connectPlan({ storedKey: KEY_A, storedMe: null, candidate: KEY_A, candidateMe: ME_OWNER })).toBe('keep');
  });

  it('stores a new key for the same account without asking (email, any case)', () => {
    expect(C.connectPlan({ storedKey: KEY_A, storedMe: ME_OWNER, candidate: KEY_B, candidateMe: { email: ' Owner@Example.com ' } })).toBe('store');
  });

  it('asks when nothing is connected yet', () => {
    expect(C.connectPlan({ storedKey: '', storedMe: null, candidate: KEY_B, candidateMe: ME_OWNER })).toBe('ask');
  });

  it('asks before switching to another account', () => {
    expect(C.connectPlan({ storedKey: KEY_A, storedMe: ME_OWNER, candidate: KEY_B, candidateMe: ME_OTHER })).toBe('ask');
  });

  it('asks when the stored key\'s account could not be read', () => {
    expect(C.connectPlan({ storedKey: KEY_A, storedMe: null, candidate: KEY_B, candidateMe: ME_OWNER })).toBe('ask');
  });

  it('asks when an answer names no email', () => {
    expect(C.connectPlan({ storedKey: KEY_A, storedMe: {}, candidate: KEY_B, candidateMe: {} })).toBe('ask');
  });
});

describe('pendingRecord', () => {
  it('names the account and the one it replaces', () => {
    expect(C.pendingRecord({ id: 'x', candidate: KEY_B, candidateMe: ME_OTHER, storedKey: KEY_A, storedMe: ME_OWNER, now: 5 }))
      .toEqual({ id: 'x', apiKey: KEY_B, email: 'someone@example.net', replacing: 'owner@example.com', at: 5 });
  });

  it('replacing is null with no key stored, and empty when the stored key named nobody', () => {
    expect(C.pendingRecord({ id: 'x', candidate: KEY_B, candidateMe: ME_OWNER, storedKey: '', storedMe: null, now: 1 }).replacing).toBeNull();
    expect(C.pendingRecord({ id: 'x', candidate: KEY_B, candidateMe: ME_OWNER, storedKey: KEY_A, storedMe: null, now: 1 }).replacing).toBe('');
  });
});

describe('isConfirmSender', () => {
  const ID = 'abcdefghijklmnopabcdefghijklmnop';
  const PAGE = `chrome-extension://${ID}/src/connect/connect.html`;

  it('is the extension\'s own confirmation page, with or without its hash', () => {
    expect(C.isConfirmSender({ id: ID, url: `${PAGE}#req-1` }, ID, PAGE)).toBe(true);
    expect(C.isConfirmSender({ id: ID, url: PAGE }, ID, PAGE)).toBe(true);
  });

  it('is never a content script, another page of the extension, or another extension', () => {
    expect(C.isConfirmSender({ id: ID, url: 'https://seobandwagon.com/dashboard/api-keys/', tab: { id: 3 } }, ID, PAGE)).toBe(false);
    expect(C.isConfirmSender({ id: ID, url: `chrome-extension://${ID}/src/options/options.html` }, ID, PAGE)).toBe(false);
    expect(C.isConfirmSender({ id: 'other', url: PAGE }, ID, PAGE)).toBe(false);
    expect(C.isConfirmSender({ id: ID }, ID, PAGE)).toBe(false);
    expect(C.isConfirmSender(null, ID, PAGE)).toBe(false);
  });
});

describe('timing', () => {
  it('answers the site inside its 8 seconds', () => {
    expect(C.ANSWER_WITHIN_MS).toBeLessThan(8000);
    expect(C.answerDelay(1000, 1000)).toBe(C.ANSWER_WITHIN_MS);
    expect(C.answerDelay(1000, 3000)).toBe(C.ANSWER_WITHIN_MS - 2000);
    expect(C.answerDelay(1000, 99999)).toBe(0);
  });

  it('a request expires after ten minutes, and one without a time at once', () => {
    expect(C.isExpired({ at: 0 }, C.PENDING_TTL_MS)).toBe(false);
    expect(C.isExpired({ at: 0 }, C.PENDING_TTL_MS + 1)).toBe(true);
    expect(C.isExpired({}, 1)).toBe(true);
    expect(C.isExpired(null, 1)).toBe(true);
  });
});
