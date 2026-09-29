import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SitesRepository } from './sites.repository';
import { ConnectionsRepository } from '../connections/connections.repository';
import { MembershipsRepository } from '../organisations/memberships.repository';
import { CreateSiteDto, UpdateSiteDto } from './dto';
import { bestMatch, validateHostnamePattern } from './hostname';

@Injectable()
export class SitesService {
  constructor(
    private readonly sites: SitesRepository,
    private readonly connections: ConnectionsRepository,
    private readonly memberships: MembershipsRepository,
  ) {}

  list(organisationId: string) {
    return this.sites.listForOrganisation(organisationId);
  }

  async get(organisationId: string, id: string) {
    const environment = await this.sites.findEnvironment(organisationId, id);
    if (!environment) throw new NotFoundException('No such site.');
    return environment;
  }

  async create(organisationId: string, userId: string, dto: CreateSiteDto) {
    const invalid = validateHostnamePattern(dto.hostname);
    if (invalid) throw new BadRequestException(invalid);

    const hostname = dto.hostname.trim().toLowerCase();

    const connection = await this.connections.findActive(organisationId, dto.connectionId);
    if (!connection) throw new BadRequestException('That connection does not exist.');

    const clash = await this.sites.findByHostname(organisationId, hostname);
    if (clash) throw new BadRequestException(`${hostname} is already registered.`);

    return this.sites.registerSite({
      organisationId,
      userId,
      name: dto.name.trim() || hostname,
      hostname,
      label: dto.label,
      repository: dto.repository.trim(),
      branch: dto.branch?.trim() || null,
      connectionId: dto.connectionId,
      verificationToken: `ie-verify-${randomBytes(8).toString('hex')}`,
    });
  }

  async update(organisationId: string, userId: string, id: string, dto: UpdateSiteDto) {
    const existing = await this.get(organisationId, id);

    const branch = dto.branch !== undefined ? dto.branch?.trim() || null : undefined;
    const branchChanged = branch !== undefined && branch !== existing.branch;

    return this.sites.updateEnvironment({
      organisationId,
      userId,
      id: existing.id,
      hostname: existing.hostname,
      branch,
      name: dto.name?.trim(),
      branchChange: branchChanged ? { from: existing.branch, to: branch } : null,
    });
  }

  async remove(organisationId: string, userId: string, id: string) {
    const existing = await this.get(organisationId, id);

    await this.sites.removeEnvironment({
      organisationId,
      userId,
      id: existing.id,
      hostname: existing.hostname,
    });

    return { removed: true };
  }

  /**
   * May this person edit through this environment, and what does it point at?
   *
   * The editing endpoints all start here. It exists because the extension
   * sends an `environmentId` and nothing else: the repository, the branch
   * and the connection are all derived server-side, so a page cannot name a
   * repository its editors were never granted.
   *
   * @throws NotFoundException when the environment does not exist *or* the
   *         caller cannot reach it — the same answer for both, so this
   *         cannot be used to discover other organisations' sites.
   */
  async authoriseEnvironment(userId: string, environmentId: string) {
    const environment = await this.sites.findEnvironmentForUser(userId, environmentId);
    if (!environment) throw new NotFoundException('No such site.');

    const membership = await this.memberships.find(environment.organisationId, userId);
    if (!membership) throw new NotFoundException('No such site.');

    // An admin reaches every site in their organisation; an editor only
    // what their teams cover.
    if (membership.role !== 'admin') {
      const reachable = await this.sites.userReachesSiteViaTeam(userId, environment.siteId);
      if (!reachable) throw new NotFoundException('No such site.');
    }

    if (environment.connection.revokedAt) {
      throw new BadRequestException(
        `The provider connection for ${environment.hostname} has been revoked. ` +
          'Reconnect it in the dashboard.',
      );
    }

    return { environment, role: membership.role };
  }

  /**
   * What the extension asks: "this page is on staging.acme.com — what am I
   * editing?"
   *
   * Only sites the caller can reach are considered, so an unregistered host
   * and someone else's host give the same answer.
   */
  async resolve(userId: string, hostname: string) {
    const memberships = await this.memberships.listForUser(userId);
    if (!memberships.length) return null;

    const environments = await this.sites.listForOrganisations(
      memberships.map((m) => m.organisationId),
    );

    const match = bestMatch(environments, hostname);
    if (!match) return null;

    const membership = memberships.find((m) => m.organisationId === match.organisationId)!;

    // An admin reaches every site; an editor only what their teams cover.
    if (membership.role !== 'admin') {
      const reachable = await this.sites.userReachesSiteViaTeam(userId, match.siteId);
      if (!reachable) return null;
    }

    return {
      siteId: match.siteId,
      environmentId: match.id,
      hostname: match.hostname,
      label: match.label,
      repository: match.repository,
      /** Null means the page carries its own branch — preview deploys. */
      branch: match.branch,
      provider: match.connection.provider,
      accountLogin: match.connection.accountLogin,
      baseUrl: match.connection.baseUrl,
      verified: Boolean(match.site.verifiedAt),
      organisationId: match.organisationId,
    };
  }

  /**
   * Resolve a hostname for the *public* feedback widget.
   *
   * No session, so none of the team-reachability checks above apply. Two
   * gates stand in their place, and both must pass:
   *
   * - **The widget is switched on.** Off by default. Registering a site
   *   should not quietly open an endpoint that accepts screenshots from
   *   anyone who can load the page.
   * - **The domain is verified.** This is the check `verificationToken` was
   *   always for. Without it, anyone can register `acme.com`, turn the
   *   widget on, and collect feedback meant for its owner — which is
   *   exactly what the schema comment warned about.
   *
   * @returns null for every failure, without saying which. An anonymous
   *          caller learning that a hostname is registered but unverified
   *          is a free reconnaissance answer.
   */
  async resolvePublic(hostname: string) {
    const candidates = await this.sites.findPublicCandidates(hostname.toLowerCase());
    const match = bestMatch(candidates, hostname.toLowerCase());

    if (!match) return null;
    if (!match.site.feedbackWidget) return null;
    if (!match.site.verifiedAt) return null;

    return {
      siteId: match.siteId,
      environmentId: match.id,
      organisationId: match.organisationId,
      hostname: match.hostname,
    };
  }
}
