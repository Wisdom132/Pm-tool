import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import { Octokit } from '@octokit/rest';
import { ProviderError } from '../provider.types';

/**
 * GitHub App authentication.
 *
 * One App, ours, installed by many customers. Two credentials are in play:
 *
 *   app JWT             signed with *our* private key. Identifies the App.
 *                       Only used to mint the next thing.
 *   installation token  scoped to one customer's installation, lives one
 *                       hour, and is what every read and write actually
 *                       uses. This is why an editor with no push access can
 *                       still open a pull request.
 *
 * The installation id is the per-customer part, and it is not a secret — it
 * is stored in `Connection.externalId` in the clear. Nothing here is
 * encrypted because there is nothing per-customer to encrypt.
 */
@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);

  /**
   * Installation tokens, cached until shortly before expiry.
   *
   * Per process, not shared. Several API instances will each mint their own,
   * which GitHub permits and which costs one extra call per instance per
   * hour — cheaper than the coordination, and it means a restart cannot
   * hand out a token it has already outlived.
   */
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  private key?: KeyObject;

  /**
   * The PEM may arrive raw, with literal `\n` sequences, or base64-encoded.
   * All three are what hosting UIs produce, and all three are common enough
   * that rejecting two of them just produces a confusing deploy failure.
   */
  static normalisePrivateKey(raw: string | undefined): string {
    if (!raw) throw new Error('GITHUB_APP_PRIVATE_KEY is not set');

    let key = raw.trim();
    if (!key.includes('BEGIN')) key = Buffer.from(key, 'base64').toString('utf8').trim();
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
    if (!key.includes('BEGIN')) throw new Error('GITHUB_APP_PRIVATE_KEY is not a valid PEM');

    return key;
  }

  /**
   * GitHub issues App keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"), while jose's
   * importPKCS8 only reads PKCS#8. Node's createPrivateKey reads both.
   */
  private signingKey(): KeyObject {
    if (!this.key) {
      this.key = createPrivateKey(GithubAppService.normalisePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY));
    }
    return this.key;
  }

  /** Short-lived JWT identifying the App. `iat` is backdated for clock skew. */
  async appJwt(): Promise<string> {
    const appId = process.env.GITHUB_APP_ID;
    if (!appId) throw new Error('GITHUB_APP_ID is not set');

    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(appId)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60) // GitHub rejects anything past 10 minutes
      .sign(this.signingKey());
  }

  /** An Octokit acting as the App itself. Cannot touch repository contents. */
  async asApp(): Promise<Octokit> {
    return new Octokit({ auth: await this.appJwt() });
  }

  async installationToken(installationId: string): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const app = await this.asApp();
    let token: string;
    let expiresAt: string;

    try {
      const { data } = await app.apps.createInstallationAccessToken({
        installation_id: Number(installationId),
      });
      token = data.token;
      expiresAt = data.expires_at;
    } catch (err) {
      throw this.translate(err, `installation ${installationId}`);
    }

    this.tokens.set(installationId, { token, expiresAt: new Date(expiresAt).getTime() });
    this.logger.debug(`Minted installation token for ${installationId}, expires ${expiresAt}`);
    return token;
  }

  /** Forget a cached token — after a connection is revoked or reinstalled. */
  forget(installationId: string) {
    this.tokens.delete(installationId);
  }

  /**
   * Details of an installation, for the connection record.
   * Called once, when an admin finishes the install flow.
   */
  async describeInstallation(installationId: string): Promise<{
    accountLogin: string;
    repositoryCount: number | null;
  }> {
    const app = await this.asApp();

    try {
      const { data } = await app.apps.getInstallation({ installation_id: Number(installationId) });
      const account = data.account as { login?: string; slug?: string } | null;

      return {
        accountLogin: account?.login ?? account?.slug ?? 'unknown',
        // Null when the install covers every repository: GitHub reports no
        // count, and inventing one would be worse than showing nothing.
        repositoryCount:
          data.repository_selection === 'all' ? null : (data as { repositories_count?: number }).repositories_count ?? null,
      };
    } catch (err) {
      throw this.translate(err, `installation ${installationId}`);
    }
  }

  /** Repositories an installation can reach. */
  async listRepositories(installationId: string): Promise<{ fullName: string; private: boolean }[]> {
    const token = await this.installationToken(installationId);
    const octokit = new Octokit({ auth: token });

    const repos: { fullName: string; private: boolean }[] = [];
    // Paginated: an installation granted "all repositories" on a large org
    // easily exceeds one page, and a truncated list looks like a permissions
    // problem to whoever cannot find their repo in it.
    for await (const { data } of octokit.paginate.iterator(
      octokit.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    )) {
      const page = Array.isArray(data) ? data : (data as { repositories: typeof data }).repositories;
      for (const r of page as { full_name: string; private: boolean }[]) {
        repos.push({ fullName: r.full_name, private: r.private });
      }
    }

    return repos;
  }

  private translate(err: unknown, subject: string): ProviderError {
    const status = (err as { status?: number }).status;
    const message = (err as { message?: string }).message ?? 'unknown error';

    if (status === 404) {
      return new ProviderError(
        `The Inline Edit GitHub App is no longer installed on ${subject}. Reconnect it from Connections.`,
        'not-installed',
        err,
      );
    }
    if (status === 403) return new ProviderError(`Access to ${subject} was refused.`, 'forbidden', err);
    return new ProviderError(`GitHub could not be reached for ${subject}: ${message}`, 'unavailable', err);
  }
}
