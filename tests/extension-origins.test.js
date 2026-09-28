import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseAllowedExtensionIds,
  isWellFormedExtensionId,
  checkExtensionId,
  allowedOrigins,
  resolveCorsOrigin,
} from '../apps/api/src/editing/extension-origins.js';

// A syntactically valid extension ID: 32 characters from a-p.
const EXT_A = 'a'.repeat(32);
const EXT_B = 'b'.repeat(32);

const ORIGINAL_ENV = { ...process.env };
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
