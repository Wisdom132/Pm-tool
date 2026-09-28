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
}
