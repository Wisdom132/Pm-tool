import { describe, it, expect, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  normalisePrivateKey,
  loadPrivateKey,
  createAppJwt,
} from '../apps/api/src/providers/github/app-jwt';

/** Decode a JWT segment without verifying — we only assert on the claims. */
const jwtPart = (token, index) =>
  JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString('utf8'));

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('normalisePrivateKey', () => {
  const PEM = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';

  it('passes a raw PEM through', () => {
    expect(normalisePrivateKey(PEM)).toBe(PEM);
  });

  it('accepts a PEM with literal backslash-n sequences', () => {
    expect(normalisePrivateKey(PEM.replace(/\n/g, '\\n'))).toBe(PEM);
  });

  it('accepts a base64-encoded PEM', () => {
    expect(normalisePrivateKey(Buffer.from(PEM).toString('base64'))).toBe(PEM);
  });

  it('rejects a missing key', () => {
    expect(() => normalisePrivateKey('')).toThrow(/not set/);
  });

  it('rejects something that is not a PEM', () => {
    expect(() => normalisePrivateKey('bm90LWEta2V5')).toThrow(/valid PEM/);
  });
});

describe('GitHub App JWT', () => {
  // GitHub issues App keys as PKCS#1; some hosts re-encode them as PKCS#8.
  const pkcs1 = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;

  const pkcs8 = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;

  it('loads a PKCS#1 key, which is what GitHub hands out', () => {
    expect(pkcs1).toContain('BEGIN RSA PRIVATE KEY');
    expect(() => loadPrivateKey(pkcs1)).not.toThrow();
  });

  it('loads a PKCS#8 key', () => {
    expect(pkcs8).toContain('BEGIN PRIVATE KEY');
    expect(() => loadPrivateKey(pkcs8)).not.toThrow();
  });

  it('loads a base64-wrapped PKCS#1 key', () => {
    expect(() => loadPrivateKey(Buffer.from(pkcs1).toString('base64'))).not.toThrow();
  });

  it('signs a JWT GitHub would accept', async () => {
    const jwt = await createAppJwt({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY: pkcs1,
    });

    expect(jwtPart(jwt, 0).alg).toBe('RS256');

    const claims = jwtPart(jwt, 1);
    const now = Math.floor(Date.now() / 1000);
    expect(claims.iss).toBe('12345');
    expect(claims.iat).toBeLessThanOrEqual(now - 55); // backdated for clock skew
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60); // GitHub's cap
  });

  it('fails clearly without an app id', async () => {
    await expect(
      createAppJwt({ GITHUB_APP_PRIVATE_KEY: pkcs1 })
    ).rejects.toThrow(/GITHUB_APP_ID/);
  });
});
