import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  deriveStateKey,
  signState,
  verifyState,
  STATE_TTL_MS,
} from '../apps/api/src/common/signed-state';

const key = deriveStateKey(randomBytes(32));
const payload = { organisationId: 'org-1', userId: 'user-1' };

describe('deriveStateKey', () => {
  it('does not hand back the encryption key', () => {
    const encryptionKey = randomBytes(32);
    expect(deriveStateKey(encryptionKey).equals(encryptionKey)).toBe(false);
  });

  it('is stable for the same key', () => {
    const encryptionKey = randomBytes(32);
    expect(deriveStateKey(encryptionKey)).toEqual(deriveStateKey(encryptionKey));
  });
});

describe('signState / verifyState', () => {
  it('round-trips the organisation and user', () => {
    expect(verifyState(signState(payload, key), key)).toEqual(payload);
  });

  it('rejects a state signed with another key', () => {
    // The attack this exists to stop: forging a state that names someone
    // else's organisation, so an installation lands in their account.
    const forged = signState({ organisationId: 'victim-org', userId: 'attacker' }, deriveStateKey(randomBytes(32)));
    expect(() => verifyState(forged, key)).toThrow(/expired or is not valid/);
  });

  it('rejects a tampered payload', () => {
    const state = signState(payload, key);
    const [body, signature] = state.split('.');
    const swapped = Buffer.from(
      JSON.stringify({ organisationId: 'victim-org', userId: 'attacker', exp: Date.now() + STATE_TTL_MS }),
    ).toString('base64url');
    expect(() => verifyState(`${swapped}.${signature}`, key)).toThrow();
    expect(verifyState(`${body}.${signature}`, key)).toEqual(payload);
  });

  it('rejects an expired state', () => {
    const issued = Date.now();
    const state = signState(payload, key, issued);
    expect(() => verifyState(state, key, issued + STATE_TTL_MS + 1)).toThrow();
    expect(verifyState(state, key, issued + STATE_TTL_MS - 1)).toEqual(payload);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'nonsense', 'a.b.c', undefined, null]) {
      expect(() => verifyState(bad, key)).toThrow();
    }
  });

  it('rejects a well-signed state with no expiry', () => {
    // An unauthenticated JSON blob must never be parsed for meaning, and a
    // signed one with no exp must not be treated as valid forever.
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const state = signState(payload, key);
    const signature = state.split('.')[1];
    expect(() => verifyState(`${body}.${signature}`, key)).toThrow();
  });
});
