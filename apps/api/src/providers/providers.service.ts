import { Injectable, NotFoundException } from '@nestjs/common';
import type { Connection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from './credentials.service';
import { GithubAppService } from './github/github-app.service';
import { GithubProvider } from './github/github.provider';
import { ProviderError, type RepositoryProvider } from './provider.types';
import { splitRepository } from './repository-name';

/**
 * Turning a connection row into something that can read and write a repo.
 *
 * Every entry point takes an `organisationId`. That is not defensive
 * decoration: this is the object that holds another company's write
 * credentials, and a lookup by connection id alone would let one tenant name
 * another tenant's connection and edit their repository. The scope is a
 * parameter so it cannot be forgotten.
 */
@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly githubApp: GithubAppService,
  ) {}

  /**
   * A provider for one repository, via one of this organisation's connections.
   *
   * @param repository `owner/repo`.
   */
  async open(
    organisationId: string,
    connectionId: string,
    repository: string,
  ): Promise<RepositoryProvider> {
    const connection = await this.prisma.connection.findFirst({
      where: { id: connectionId, organisationId, revokedAt: null },
    });

    // Indistinguishable from a connection that does not exist, so a probe
    // cannot enumerate other organisations' connections.
    if (!connection) throw new NotFoundException('No such connection.');

    return this.fromConnection(connection, repository);
  }

  /**
   * A provider for a registered site environment.
   *
   * The common path: the extension names a hostname, the site registry says
   * which connection, repository and branch that is, and this opens it.
   */
  async openForEnvironment(
    organisationId: string,
    environmentId: string,
  ): Promise<{ provider: RepositoryProvider; branch: string | null }> {
    const environment = await this.prisma.siteEnvironment.findFirst({
      where: { id: environmentId, organisationId },
      include: { connection: true },
    });

    if (!environment) throw new NotFoundException('No such site environment.');

    // The connection is a required relation, so it always loads — but it can
    // be revoked while sites still point at it, and that must not read as a
    // GitHub outage.
    if (environment.connection.revokedAt) {
      throw new ProviderError(
        `The provider connection for ${environment.hostname} has been revoked. Reconnect it in the dashboard.`,
        'not-installed',
      );
    }

    return {
      provider: await this.fromConnection(environment.connection, environment.repository),
      branch: environment.branch,
    };
  }

  private async fromConnection(
    connection: Connection,
    repository: string,
  ): Promise<RepositoryProvider> {
    const { owner, repo } = splitRepository(repository);

    switch (connection.provider) {
      case 'github':
        return new GithubProvider(
          owner,
          repo,
          () => this.tokenFor(connection),
          connection.baseUrl ?? undefined,
        );

      // Deliberately not a silent fallback to GitHub. P1.4 and P1.5 add
      // these; until then a misconfigured connection should say so.
      case 'gitlab':
      case 'bitbucket':
        throw new ProviderError(
          `${connection.provider} connections are not supported yet.`,
          'unavailable',
        );
    }
  }

  /**
   * A token for this connection.
   *
   * GitHub App installs have nothing stored — the token is minted from our
   * App key against their installation id. Everything else (GitLab,
   * Bitbucket, GitHub Enterprise with a personal access token) carries an
   * encrypted secret in the row.
   */
  private async tokenFor(connection: Connection): Promise<string> {
    if (!connection.credentials) {
      return this.githubApp.installationToken(connection.externalId);
    }

    const credential = this.credentials.open({
      // Prisma returns Bytes as a Uint8Array; the crypto helpers work in
      // Buffers so that subarray/tag handling stays unambiguous.
      credentials: Buffer.from(connection.credentials),
      keyVersion: connection.keyVersion,
    });

    if (credential.type === 'app') {
      return this.githubApp.installationToken(connection.externalId);
    }

    if (credential.expiresAt && credential.expiresAt < Date.now()) {
      // Refreshing is provider-specific and lands with GitLab in P1.4.
      // Until then, saying the connection needs reconnecting beats a 401
      // from the provider surfacing as "could not read file".
      throw new ProviderError(
        'This connection has expired. Reconnect the provider in the dashboard.',
        'not-installed',
      );
    }

    return credential.accessToken;
  }
}
