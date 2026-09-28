import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { decrypt, encrypt, loadKeys } from '../common/crypto';

/**
 * A provider credential, as stored.
 *
 * Deliberately a discriminated union rather than a bag of optional strings:
 * a GitHub App connection has *no* secret to keep, and that should be
 * representable rather than expressed as three nulls.
 *
 *   app    We hold the App's private key once, in the environment. What is
 *          per-customer is the installation id, which is not sensitive — it
 *          lives in `Connection.externalId` and `credentials` stays null.
 *   token  A long-lived secret belonging to one customer: a GitLab or
 *          Bitbucket OAuth token, or a GitHub Enterprise access token. This
 *          is the case encryption at rest exists for.
 */
export type Credential =
  | { type: 'app' }
  | {
      type: 'token';
      accessToken: string;
      refreshToken?: string;
      /** Epoch milliseconds. Absent for tokens that do not expire. */
      expiresAt?: number;
    };

export interface SealedCredential {
  credentials: Buffer;
  keyVersion: number;
}

/**
 * Sealing and opening provider credentials.
 *
 * Thin on purpose. It owns exactly two things — that keys are loaded once at
 * boot, and that a credential is JSON before it is ciphertext — so that the
 * cryptography itself stays in `common/crypto.ts`, where it is unit-tested
 * without a Nest container.
 */
@Injectable()
export class CredentialsService implements OnModuleInit {
  private readonly logger = new Logger(CredentialsService.name);
  private keys: Buffer[] = [];

  /**
   * Fail at boot, not at first use.
   *
   * A missing key discovered when an admin connects GitHub is a confusing
   * 500 in front of a customer; discovered at startup it is a deployment
   * that never goes live.
   */
  onModuleInit() {
    this.keys = loadKeys();
    this.logger.log(`Credential encryption ready (${this.keys.length} key(s) loaded)`);
  }

  seal(credential: Credential): SealedCredential {
    const { ciphertext, keyVersion } = encrypt(JSON.stringify(credential), this.keys);
    return { credentials: ciphertext, keyVersion };
  }

  open(sealed: SealedCredential): Credential {
    const json = decrypt(sealed.credentials, sealed.keyVersion, this.keys);
    return JSON.parse(json) as Credential;
  }

  /**
   * Whether a stored credential was written with the newest key.
   *
   * Rotation does not need a migration — `decrypt` falls back through older
   * keys — but a connection that is re-sealed on next use drifts forward on
   * its own, which is what eventually lets an old key be retired.
   */
  isCurrent(keyVersion: number): boolean {
    return keyVersion === this.keys.length;
  }
}
