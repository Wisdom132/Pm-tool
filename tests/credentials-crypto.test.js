import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, loadKeys } from '../apps/api/src/common/crypto';

const key = () => randomBytes(32).toString('base64');

describe('loadKeys', () => {
  it('refuses to run without a key', () => {
    // Failing loudly at boot beats silently storing credentials in the clear.
    expect(() => loadKeys({})).toThrow(/CREDENTIALS_KEY is not set/);
  });

  it('rejects a key of the wrong length', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => loadKeys({ CREDENTIALS_KEY: short })).toThrow(/AES-256 needs 32/);
  });

  it('names which key is wrong', () => {
    const env = { CREDENTIALS_KEY: `${key()},${randomBytes(8).toString('base64')}` };
    expect(() => loadKeys(env)).toThrow(/entry 2/);
  });

  it('reads several keys for rotation', () => {
    expect(loadKeys({ CREDENTIALS_KEY: `${key()}, ${key()}` })).toHaveLength(2);
  });
});

describe('encrypt and decrypt', () => {
  const keys = loadKeys({ CREDENTIALS_KEY: key() });

  it('round-trips a secret', () => {
    const secret = 'ghs_verySecretInstallationToken';
    const { ciphertext, keyVersion } = encrypt(secret, keys);
    expect(decrypt(ciphertext, keyVersion, keys)).toBe(secret);
  });

  it('round-trips a multi-line private key', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC\n-----END RSA PRIVATE KEY-----\n';
    const { ciphertext, keyVersion } = encrypt(pem, keys);
    expect(decrypt(ciphertext, keyVersion, keys)).toBe(pem);
  });

  it('does not leave the secret readable in the ciphertext', () => {
    const { ciphertext } = encrypt('ghs_verySecretInstallationToken', keys);
    expect(ciphertext.toString('utf8')).not.toContain('ghs_');
    expect(ciphertext.toString('base64')).not.toContain('verySecret');
  });

  it('produces different ciphertext each time', () => {
    // A fresh IV per write; identical output would leak that two customers
    // share a credential.
    const a = encrypt('same', keys).ciphertext.toString('hex');
    const b = encrypt('same', keys).ciphertext.toString('hex');
    expect(a).not.toBe(b);
  });

  it('refuses a credential encrypted with a different key', () => {
    const other = loadKeys({ CREDENTIALS_KEY: key() });
    const { ciphertext, keyVersion } = encrypt('secret', other);
    expect(() => decrypt(ciphertext, keyVersion, keys)).toThrow(/Could not decrypt/);
  });

  it('detects a tampered ciphertext', () => {
    // GCM authenticates, so an edited row fails rather than decrypting to
    // something an attacker chose.
    const { ciphertext, keyVersion } = encrypt('secret', keys);
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(tampered, keyVersion, keys)).toThrow(/Could not decrypt/);
  });

  it('detects a swapped IV', () => {
    const { ciphertext, keyVersion } = encrypt('secret', keys);
    const tampered = Buffer.from(ciphertext);
    tampered[3] ^= 0xff;
    expect(() => decrypt(tampered, keyVersion, keys)).toThrow(/Could not decrypt/);
  });

  it('rejects a truncated value', () => {
    expect(() => decrypt(Buffer.from([1, 2, 3]), 1, keys)).toThrow(/too short/);
  });

  it('rejects an unknown format version', () => {
    const { ciphertext, keyVersion } = encrypt('secret', keys);
    const future = Buffer.from(ciphertext);
    future[0] = 9;
    expect(() => decrypt(future, keyVersion, keys)).toThrow(/version 9/);
  });
});

describe('key rotation', () => {
  const oldKey = key();
  const newKey = key();

  it('still reads a credential written before the new key was added', () => {
    const before = loadKeys({ CREDENTIALS_KEY: oldKey });
    const { ciphertext, keyVersion } = encrypt('written-earlier', before);

    // A new key is prepended; the old one stays to decrypt.
    const after = loadKeys({ CREDENTIALS_KEY: `${newKey},${oldKey}` });
    expect(decrypt(ciphertext, keyVersion, after)).toBe('written-earlier');
  });

  it('writes new credentials with the newest key', () => {
    const after = loadKeys({ CREDENTIALS_KEY: `${newKey},${oldKey}` });
    const { ciphertext, keyVersion } = encrypt('written-now', after);

    // Readable with both configured, and with the new key alone — proving
    // the old key can eventually be retired.
    expect(decrypt(ciphertext, keyVersion, after)).toBe('written-now');
    expect(decrypt(ciphertext, 1, loadKeys({ CREDENTIALS_KEY: newKey }))).toBe('written-now');
  });
});
