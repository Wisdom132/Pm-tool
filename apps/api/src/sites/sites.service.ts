import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSiteDto, UpdateSiteDto } from './dto';
import { bestMatch, validateHostnamePattern } from './hostname';
import { randomBytes } from 'node:crypto';

@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every method takes organisationId and filters on it. Not because the
   * guard is untrusted, but because a service that can be called without a
   * tenant is one refactor away from being called without one.
   */
  list(organisationId: string) {
    return this.prisma.siteEnvironment.findMany({
      where: { organisationId },
      orderBy: [{ label: 'asc' }, { hostname: 'asc' }],
      include: {
        site: { select: { id: true, name: true, verifiedAt: true } },
        connection: { select: { id: true, provider: true, accountLogin: true } },
      },
    });
  }

  async get(organisationId: string, id: string) {
    const environment = await this.prisma.siteEnvironment.findFirst({
      where: { id, organisationId },
      include: {
        site: true,
        connection: { select: { id: true, provider: true, accountLogin: true } },
      },
    });
    if (!environment) throw new NotFoundException('No such site.');
    return environment;
  }

  async create(organisationId: string, userId: string, dto: CreateSiteDto) {
    const invalid = validateHostnamePattern(dto.hostname);
    if (invalid) throw new BadRequestException(invalid);

    const hostname = dto.hostname.trim().toLowerCase();

    const connection = await this.prisma.connection.findFirst({
      where: { id: dto.connectionId, organisationId, revokedAt: null },
    });
    if (!connection) throw new BadRequestException('That connection does not exist.');

    const clash = await this.prisma.siteEnvironment.findFirst({
      where: { organisationId, hostname },
    });
    if (clash) throw new BadRequestException(`${hostname} is already registered.`);

    return this.prisma.$transaction(async (tx) => {
      const site = await tx.site.create({
        data: {
          organisationId,
          name: dto.name.trim() || hostname,
          verificationToken: `ie-verify-${randomBytes(8).toString('hex')}`,
        },
      });

      const environment = await tx.siteEnvironment.create({
        data: {
          siteId: site.id,
          organisationId,
          connectionId: dto.connectionId,
          hostname,
          label: dto.label,
          repository: dto.repository.trim(),
          branch: dto.branch?.trim() || null,
        },
        include: { site: true },
      });

      // Every team covering all sites should cover this one too, or a site
      // registered after someone joined would be invisible to them.
      const defaultTeam = await tx.team.findFirst({
        where: { organisationId, isDefault: true },
      });
      if (defaultTeam) {
        await tx.teamSite.create({ data: { teamId: defaultTeam.id, siteId: site.id } });
      }

      await tx.auditEvent.create({
        data: {
          organisationId,
          actorUserId: userId,
          action: 'site.registered',
          subject: hostname,
          detail: { repository: dto.repository, branch: dto.branch ?? null },
        },
      });

      return environment;
    });
  }

  async update(organisationId: string, userId: string, id: string, dto: UpdateSiteDto) {
    const existing = await this.get(organisationId, id);

    const branchChanged = dto.branch !== undefined && dto.branch !== existing.branch;

    const updated = await this.prisma.siteEnvironment.update({
      where: { id: existing.id },
      data: {
        ...(dto.branch !== undefined ? { branch: dto.branch?.trim() || null } : {}),
        ...(dto.name ? { site: { update: { name: dto.name.trim() } } } : {}),
      },
      include: { site: true },
    });

    // Re-pointing a branch decides where every future edit on this hostname
    // lands, so it is recorded on its own rather than as a generic update.
    if (branchChanged) {
      await this.prisma.auditEvent.create({
        data: {
          organisationId,
          actorUserId: userId,
          action: 'branch.changed',
          subject: existing.hostname,
          detail: { from: existing.branch, to: updated.branch },
        },
      });
    }

    return updated;
  }

  async remove(organisationId: string, userId: string, id: string) {
    const existing = await this.get(organisationId, id);
    await this.prisma.siteEnvironment.delete({ where: { id: existing.id } });
    await this.prisma.auditEvent.create({
      data: {
        organisationId,
        actorUserId: userId,
        action: 'site.removed',
        subject: existing.hostname,
      },
    });
    return { removed: true };
  }

  /**
   * What the extension asks: "this page is on staging.acme.com — what am I
   * editing?"
   *
   * Only sites the caller can reach are considered, so an unregistered host
   * and someone else's host are the same answer.
   */
  async resolve(userId: string, hostname: string) {
    const memberships = await this.prisma.memberships.findMany({
      where: { userId },
      select: { organisationId: true, role: true },
    });
    if (!memberships.length) return null;

    const environments = await this.prisma.siteEnvironment.findMany({
      where: { organisationId: { in: memberships.map((m) => m.organisationId) } },
      include: {
        site: { select: { id: true, name: true, verifiedAt: true } },
        connection: { select: { provider: true, accountLogin: true, baseUrl: true } },
      },
    });

    const match = bestMatch(environments, hostname);
    if (!match) return null;

    const membership = memberships.find((m) => m.organisationId === match.organisationId)!;

    // An admin reaches every site; an editor only what their teams cover.
    if (membership.role !== 'admin') {
      const viaTeam = await this.prisma.teamSite.findFirst({
        where: { siteId: match.siteId, team: { members: { some: { userId } } } },
      });
      if (!viaTeam) return null;
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
