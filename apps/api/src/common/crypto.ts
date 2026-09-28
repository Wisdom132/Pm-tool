import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypting provider credentials at rest.
 *
 * These are access tokens and private keys belonging to *other companies'*
 * repositories. A database dump must not be a set of working credentials for
 * every customer, so the column holds ciphertext and the key lives outside
 * the database entirely.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a row edited in the
 * database fails to decrypt rather than decrypting to something attacker
 * chosen.
 *
 * Layout: [1 byte version][12 byte iv][16 byte tag][ciphertext]
 * The version prefix is what lets a key be rotated without one migration
 * having to re-encrypt every row at once.
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedValue {
  ciphertext: Buffer;
  keyVersion: number;
}

/**
 * Keys by version, newest first, from the environment.
 *
 * CREDENTIALS_KEY holds base64 32-byte keys, comma separated. The first is
 * used for new writes; the rest only decrypt, so an old key can be retired
 * once nothing references it.
 */
export function loadKeys(env: NodeJS.ProcessEnv = process.env): Buffer[] {
  const raw = env.CREDENTIALS_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIALS_KEY is not set. Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => Buffer.from(k, 'base64'));

  if (!keys.length) throw new Error('CREDENTIALS_KEY is empty.');

  const wrong = keys.findIndex((k) => k.length !== 32);
  if (wrong !== -1) {
    throw new Error(
      `CREDENTIALS_KEY entry ${wrong + 1} is ${keys[wrong].length} bytes; AES-256 needs 32.`,
    );
  }

  return keys;
}

export function encrypt(plaintext: string, keys: Buffer[]): EncryptedValue {
  const key = keys[0];
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, tag, body]),
    // 1-based, and counting from the newest key, so it survives adding one.
    keyVersion: keys.length,
  };
}

/**
 * Decrypt, trying the recorded key first and then the others.
 *
 * The fallback exists because keyVersion is relative to how many keys were
 * configured at write time; adding a key shifts it. Trying the rest means
 * rotation does not need a migration to be correct.
 */
export function decrypt(value: Buffer, keyVersion: number, keys: Buffer[]): string {
  if (value.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('Stored credential is too short to be valid ciphertext.');
  }
  if (value[0] !== VERSION) {
    throw new Error(`Unknown credential format (version ${value[0]}).`);
  }

  const iv = value.subarray(1, 1 + IV_BYTES);
  const tag = value.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = value.subarray(1 + IV_BYTES + TAG_BYTES);

  const ordered = orderKeys(keys, keyVersion);

  for (const key of ordered) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key: the auth tag fails. Try the next rather than give up —
      // and never report which one failed.
    }
  }

  throw new Error('Could not decrypt this credential with any configured key.');
}

function orderKeys(keys: Buffer[], keyVersion: number): Buffer[] {
  const index = keys.length - keyVersion;
  if (index < 0 || index >= keys.length) return keys;
  return [keys[index], ...keys.filter((_, i) => i !== index)];
}
