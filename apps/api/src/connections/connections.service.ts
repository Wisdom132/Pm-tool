import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionsRepository } from './connections.repository';
import { MembershipsRepository } from '../organisations/memberships.repository';
import { GithubAppService } from '../providers/github/github-app.service';
import { ProvidersService } from '../providers/providers.service';
import { loadKeys } from '../common/crypto';
import { deriveStateKey, signState, verifyState } from '../common/signed-state';

/**
 * Provider connections.
 *
 * This is the object the whole platform turns on: one admin connects GitHub
 * once, and every editor in the organisation then works without a provider
 * account of their own. Two things therefore have to be right —
 *
 *   1. An installation lands in the organisation that *asked* for it. That is
 *      the signed state, not the session alone, because the callback arrives
 *      from GitHub and its query string is attacker-controllable.
 *   2. A revoked connection stops working immediately, including for tokens
 *      already minted and cached in memory.
 */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);
  private stateKey?: Buffer;

  constructor(
    private readonly repository: ConnectionsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly githubApp: GithubAppService,
    private readonly providers: ProvidersService,
  ) {}

  private key(): Buffer {
    if (!this.stateKey) this.stateKey = deriveStateKey(loadKeys()[0]);
    return this.stateKey;
  }

  list(organisationId: string) {
    return this.repository.listForOrganisation(organisationId);
  }

  /**
   * Where to send an admin to install the GitHub App.
   *
   * The state is what the callback verifies. It expires in ten minutes, so a
   * link pasted into a chat is not a standing offer to attach an
   * installation to this organisation.
   */
  installUrl(organisationId: string, userId: string): { url: string; expiresInSeconds: number } {
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) {
      throw new BadRequestException(
        'GITHUB_APP_SLUG is not configured, so the GitHub App install URL cannot be built.',
      );
    }

    const state = signState({ organisationId, userId }, this.key());
    const url = new URL(`https://github.com/apps/${slug}/installations/new`);
    url.searchParams.set('state', state);

    return { url: url.toString(), expiresInSeconds: 600 };
  }

  /**
   * GitHub's callback after an install.
   *
   * @param sessionUserId the signed-in user, if any. Checked *against* the
   *        state rather than instead of it: the state proves which
   *        organisation asked, the session proves who is holding the
   *        browser, and requiring both means a leaked state alone is not
   *        enough to plant a connection.
   */
  async completeGithubInstall(params: {
    installationId: string;
    state: string;
    setupAction?: string;
    sessionUserId?: string;
  }) {
    // verifyState is framework-free so it can be unit-tested without Nest;
    // translating its one error here keeps that true.
    let organisationId: string;
    let userId: string;
    try {
      ({ organisationId, userId } = verifyState(params.state, this.key()));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    if (params.sessionUserId && params.sessionUserId !== userId) {
      throw new BadRequestException(
        'This connection was started by a different person. Sign in as them, or start again.',
      );
    }

    if (!params.installationId) {
      throw new BadRequestException('GitHub did not return an installation id.');
    }

    // Still confirm membership: the state could have been signed before the
    // user was removed from the organisation.
    const membership = await this.memberships.find(organisationId, userId);
    if (!membership || membership.role !== 'admin') {
      throw new BadRequestException('Only an admin of this organisation can connect a provider.');
    }

    const installation = await this.githubApp.describeInstallation(params.installationId);

    // Reinstalling produces a new installation id for the same account, and
    // "request" is GitHub telling us an owner has to approve first — neither
    // should create a second live connection.
    const { connection, reconnected } = await this.repository.recordGithubInstall({
      organisationId,
      userId,
      installationId: params.installationId,
      accountLogin: installation.accountLogin,
      repositoryCount: installation.repositoryCount,
      setupAction: params.setupAction,
    });

    // A reinstall reuses the id, so a token cached against it may have been
    // minted for the previous grant.
    this.githubApp.forget(params.installationId);

    this.logger.log(
      `${reconnected ? 'Reconnected' : 'Connected'} github installation ` +
        `${params.installationId} (${installation.accountLogin}) to org ${organisationId}`,
    );

    return {
      id: connection.id,
      provider: connection.provider,
      accountLogin: connection.accountLogin,
      repositories: installation.repositoryCount,
    };
  }

  /** Repositories this connection can reach, for the register-a-site form. */
  async repositories(organisationId: string, connectionId: string) {
    const connection = await this.repository.findActive(organisationId, connectionId);
    if (!connection) throw new NotFoundException('No such connection.');

    if (connection.provider !== 'github') {
      throw new BadRequestException(`${connection.provider} is not supported yet.`);
    }

    return this.githubApp.listRepositories(connection.externalId);
  }

  /**
   * Revoke a connection.
   *
   * Refused while sites still point at it. Cascading would silently break
   * every editor on those sites, and the admin doing this is the only person
   * who can tell whether that is intended.
   */
  async revoke(organisationId: string, userId: string, id: string) {
    const connection = await this.repository.findWithDependantCount(organisationId, id);
    if (!connection) throw new NotFoundException('No such connection.');

    if (connection._count.environments > 0) {
      throw new ConflictException(
        `${connection._count.environments} site(s) still use this connection. ` +
          'Remove or re-point them first.',
      );
    }

    const revoked = await this.repository.revoke({
      organisationId,
      userId,
      id,
      subject: `${connection.provider} · ${connection.accountLogin}`,
    });

    // Otherwise a cached installation token keeps working for up to an hour
    // after the admin was told the connection was revoked.
    this.githubApp.forget(connection.externalId);

    return { id: revoked.id, revokedAt: revoked.revokedAt };
  }

  /**
   * Prove a connection still works, by asking the provider something cheap.
   *
   * Exists because a connection can die silently: the App uninstalled on
   * GitHub's side leaves our row looking healthy, and the first sign is an
   * editor being told their file does not exist.
   */
  async check(organisationId: string, connectionId: string, repository: string) {
    const provider = await this.providers.open(organisationId, connectionId, repository);

    const branches = await provider.listBranches();
    return { ok: true, repository: provider.fullName, branches: branches.length };
  }
}
