import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseAllowedExtensionIds,
  isWellFormedExtensionId,
  checkExtensionId,
  allowedOrigins,
  resolveCorsOrigin,
} from '../overlay/pr-service/lib/extensions.js';
import { encrypt, decrypt, randomId } from '../overlay/pr-service/lib/crypto.js';
import { createMemoryStore, setStore } from '../overlay/pr-service/lib/store.js';
import { issueState, consumeState } from '../overlay/pr-service/lib/oauth-state.js';
import {
  createSession,
  readSession,
  destroySession,
} from '../overlay/pr-service/lib/sessions.js';
import { consume, LIMITS } from '../overlay/pr-service/lib/rate-limit.js';
import {
  normalizePrivateKey,
  loadPrivateKey,
  createAppJwt,
} from '../overlay/pr-service/lib/github-app.js';
import { generateKeyPairSync } from 'node:crypto';

/** Decode a JWT segment without verifying — jose lives in the service's deps. */
const jwtPart = (token, index) =>
  JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString('utf8'));

// A syntactically valid extension ID: 32 characters from a–p.
const EXT_A = 'a'.repeat(32);
const EXT_B = 'b'.repeat(32);

let store;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  store = createMemoryStore();
  setStore(store);
  process.env.TOKEN_SECRET = 'test-secret-for-unit-tests';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('extension id allowlist', () => {
  it('accepts only well-formed ids', () => {
    expect(isWellFormedExtensionId(EXT_A)).toBe(true);
    expect(isWellFormedExtensionId('tooshort')).toBe(false);
    expect(isWellFormedExtensionId('z'.repeat(32))).toBe(false); // outside a–p
    expect(isWellFormedExtensionId('A'.repeat(32))).toBe(false); // uppercase
    expect(isWellFormedExtensionId(null)).toBe(false);
  });

  it('parses and filters a comma-separated list', () => {
    expect(parseAllowedExtensionIds(`${EXT_A}, ${EXT_B}`)).toEqual([EXT_A, EXT_B]);
    expect(parseAllowedExtensionIds(`${EXT_A},garbage`)).toEqual([EXT_A]);
    expect(parseAllowedExtensionIds('')).toEqual([]);
    expect(parseAllowedExtensionIds(undefined)).toEqual([]);
  });

  it('rejects an id that is not on the list', () => {
    const env = { ALLOWED_EXTENSION_IDS: EXT_A, NODE_ENV: 'production' };
    expect(checkExtensionId(EXT_A, env).ok).toBe(true);
    expect(checkExtensionId(EXT_B, env).ok).toBe(false);
  });

  it('rejects a malformed id even when the list is empty', () => {
    // The redirect target is built from this value, so it must never be
    // attacker-controlled free text.
    expect(checkExtensionId('../../evil', {}).ok).toBe(false);
    expect(checkExtensionId('evil.com', {}).ok).toBe(false);
  });

  it('requires configuration in production', () => {
    const result = checkExtensionId(EXT_A, { NODE_ENV: 'production' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ALLOWED_EXTENSION_IDS/);
  });

  it('allows any well-formed id outside production so setup is possible', () => {
    expect(checkExtensionId(EXT_A, { NODE_ENV: 'development' }).ok).toBe(true);
  });
});

describe('CORS origins', () => {
  it('builds origins from the allowlist', () => {
    expect(allowedOrigins({ ALLOWED_EXTENSION_IDS: EXT_A })).toEqual([
      `chrome-extension://${EXT_A}`,
    ]);
  });

  it('includes the service origin when configured', () => {
    const origins = allowedOrigins({ ALLOWED_EXTENSION_IDS: EXT_A, APP_URL: 'https://prs.acme.com/' });
    expect(origins).toContain('https://prs.acme.com');
  });

  it('echoes an allowed extension origin', () => {
    const env = { ALLOWED_EXTENSION_IDS: EXT_A, NODE_ENV: 'production' };
    expect(resolveCorsOrigin(`chrome-extension://${EXT_A}`, env)).toBe(
      `chrome-extension://${EXT_A}`
    );
  });

  it('refuses an origin that is not allowed', () => {
    const env = { ALLOWED_EXTENSION_IDS: EXT_A, NODE_ENV: 'production' };
    expect(resolveCorsOrigin('https://evil.com', env)).toBeNull();
    expect(resolveCorsOrigin(`chrome-extension://${EXT_B}`, env)).toBeNull();
  });

  it('refuses a website origin even when unconfigured in development', () => {
    // The permissive development path must never extend to arbitrary sites.
    const env = { NODE_ENV: 'development' };
    expect(resolveCorsOrigin('https://evil.com', env)).toBeNull();
    expect(resolveCorsOrigin(`chrome-extension://${EXT_A}`, env)).toBe(
      `chrome-extension://${EXT_A}`
    );
  });

  it('returns null when there is no Origin header', () => {
    expect(resolveCorsOrigin(null, { ALLOWED_EXTENSION_IDS: EXT_A })).toBeNull();
  });
});

describe('token encryption', () => {
  it('round-trips a value', () => {
    expect(decrypt(encrypt('gho_secret_token'))).toBe('gho_secret_token');
  });

  it('never emits the plaintext', () => {
    expect(encrypt('gho_secret_token')).not.toContain('gho_secret_token');
  });

  it('produces a different ciphertext each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects a tampered payload', () => {
    const payload = encrypt('gho_secret_token');
    const parts = payload.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a payload encrypted under a different secret', () => {
    const payload = encrypt('gho_secret_token');
    process.env.TOKEN_SECRET = 'a-different-secret';
    expect(() => decrypt(payload)).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => decrypt('nonsense')).toThrow(/Malformed/);
  });

  it('fails clearly when TOKEN_SECRET is unset', () => {
    delete process.env.TOKEN_SECRET;
    expect(() => encrypt('x')).toThrow(/TOKEN_SECRET/);
  });

  it('generates distinct ids', () => {
    expect(randomId()).not.toBe(randomId());
  });
});

describe('oauth state nonce', () => {
  it('round-trips the extension id', async () => {
    const nonce = await issueState({ extensionId: EXT_A });
    expect(await consumeState(nonce)).toEqual({ extensionId: EXT_A });
  });

  it('is single-use', async () => {
    // A replayed callback must not be able to mint a second session.
    const nonce = await issueState({ extensionId: EXT_A });
    await consumeState(nonce);
    expect(await consumeState(nonce)).toBeNull();
  });

  it('rejects a nonce it never issued', async () => {
    expect(await consumeState('forged-nonce')).toBeNull();
  });

  it('rejects empty input', async () => {
    expect(await consumeState('')).toBeNull();
    expect(await consumeState(undefined)).toBeNull();
  });

  it('issues unpredictable values', async () => {
    const a = await issueState({ extensionId: EXT_A });
    const b = await issueState({ extensionId: EXT_A });
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});

describe('sessions', () => {
  const data = { githubToken: 'gho_abc', login: 'octocat', userId: 42 };

  it('round-trips a session', async () => {
    const { sessionId } = await createSession(data);
    expect(await readSession(sessionId)).toMatchObject({
      githubToken: 'gho_abc',
      login: 'octocat',
      userId: '42',
    });
  });

  it('stores the GitHub token encrypted', async () => {
    const { sessionId } = await createSession(data);
    const raw = await store.get(`sess:${sessionId}`);
    expect(JSON.stringify(raw)).not.toContain('gho_abc');
  });

  it('issues an opaque id, not a decodable token', async () => {
    const { sessionId } = await createSession(data);
    expect(sessionId).not.toContain('.');
    expect(sessionId).not.toContain('gho_abc');
  });

  it('returns null for an unknown id', async () => {
    expect(await readSession('nope')).toBeNull();
    expect(await readSession('')).toBeNull();
  });

  it('can be destroyed', async () => {
    const { sessionId } = await createSession(data);
    await destroySession(sessionId);
    expect(await readSession(sessionId)).toBeNull();
  });

  it('expires in days, not a year', async () => {
    const { expiresAt } = await createSession(data);
    const days = (expiresAt - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(1);
    expect(days).toBeLessThan(30);
  });

  it('refuses to create a session with no token', async () => {
    await expect(createSession({ login: 'x', userId: 1 })).rejects.toThrow();
  });

  it('treats an undecryptable record as no session', async () => {
    const { sessionId } = await createSession(data);
    process.env.TOKEN_SECRET = 'rotated-secret';
    expect(await readSession(sessionId)).toBeNull();
  });
});

describe('rate limiting', () => {
  const config = { limit: 3, windowSeconds: 60 };

  it('allows requests up to the limit', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await consume('test', 'user-1', config)).allowed).toBe(true);
    }
  });

  it('blocks past the limit', async () => {
    for (let i = 0; i < 3; i++) await consume('test', 'user-1', config);
    const result = await consume('test', 'user-1', config);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('counts each identifier separately', async () => {
    for (let i = 0; i < 3; i++) await consume('test', 'user-1', config);
    expect((await consume('test', 'user-2', config)).allowed).toBe(true);
  });

  it('counts each bucket separately', async () => {
    for (let i = 0; i < 3; i++) await consume('bucket-a', 'user-1', config);
    expect((await consume('bucket-b', 'user-1', config)).allowed).toBe(true);
  });

  it('reports remaining budget', async () => {
    expect((await consume('test', 'user-1', config)).remaining).toBe(2);
    expect((await consume('test', 'user-1', config)).remaining).toBe(1);
  });

  it('bounds PR creation per hour', () => {
    expect(LIMITS.createPr.limit).toBeLessThanOrEqual(50);
    expect(LIMITS.createPr.windowSeconds).toBe(3600);
  });
});

describe('normalizePrivateKey', () => {
  const PEM = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';

  it('passes a raw PEM through', () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });

  it('accepts a PEM with literal backslash-n sequences', () => {
    expect(normalizePrivateKey(PEM.replace(/\n/g, '\\n'))).toBe(PEM);
  });

  it('accepts a base64-encoded PEM', () => {
    expect(normalizePrivateKey(Buffer.from(PEM).toString('base64'))).toBe(PEM);
  });

  it('rejects a missing key', () => {
    expect(() => normalizePrivateKey('')).toThrow(/not set/);
  });

  it('rejects something that is not a PEM', () => {
    expect(() => normalizePrivateKey('bm90LWEta2V5')).toThrow(/valid PEM/);
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
