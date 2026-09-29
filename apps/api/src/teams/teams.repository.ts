import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every database call for teams.
 *
 * A team is how an editor reaches a site at all — `authoriseEnvironment`
 * consults `team_site` on every edit — so the writes here decide who can
 * change what. Each one records an audit event in the same transaction for
 * that reason.
 */

const MEMBER_SUMMARY = {
  select: {
    user: { select: { id: true, name: true, email: true } },
  },
} as const;

const SITE_SUMMARY = {
  select: {
    site: {
      select: {
        id: true,
        name: true,
        environments: { select: { id: true, hostname: true, label: true } },
      },
    },
  },
} as const;

@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForOrganisation(organisationId: string) {
    return this.prisma.team.findMany({
      where: { organisationId },
      // The default team first, then alphabetically: "Everyone" is the one
      // people look for.
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        members: MEMBER_SUMMARY,
        sites: SITE_SUMMARY,
        _count: { select: { members: true, sites: true } },
      },
    });
  }

  find(organisationId: string, id: string) {
    return this.prisma.team.findFirst({
      where: { id, organisationId },
      include: { members: MEMBER_SUMMARY, sites: SITE_SUMMARY },
    });
  }

  findByName(organisationId: string, name: string) {
    return this.prisma.team.findFirst({ where: { organisationId, name } });
  }

  create(params: { organisationId: string; userId: string; name: string }) {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { organisationId: params.organisationId, name: params.name },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'team.created',
          subject: team.name,
        },
      });

      return team;
    });
  }

  rename(params: { organisationId: string; userId: string; id: string; from: string; to: string }) {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.update({
        where: { id: params.id },
        data: { name: params.to },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'team.renamed',
          subject: params.to,
          detail: { from: params.from, to: params.to },
        },
      });

      return team;
    });
  }

  /**
   * Delete a team.
   *
   * `team_member` and `team_site` cascade, so this revokes access as well as
   * removing the grouping — which is why it is audited with the counts it
   * took away.
   */
  remove(params: {
    organisationId: string;
    userId: string;
    id: string;
    name: string;
    members: number;
    sites: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.team.delete({ where: { id: params.id } });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'team.deleted',
          subject: params.name,
          detail: { members: params.members, sites: params.sites },
        },
      });
    });
  }

  /** Replace a team's membership wholesale. */
  setMembers(params: {
    organisationId: string;
    userId: string;
    teamId: string;
    teamName: string;
    memberIds: string[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Delete-then-insert rather than diffing: the set is small, and the
      // result does not depend on getting the diff right.
      await tx.teamMember.deleteMany({ where: { teamId: params.teamId } });
      if (params.memberIds.length) {
        await tx.teamMember.createMany({
          data: params.memberIds.map((userId) => ({ teamId: params.teamId, userId })),
        });
      }

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'team.members_changed',
          subject: params.teamName,
          detail: { members: params.memberIds.length },
        },
      });

      return tx.team.findFirstOrThrow({
        where: { id: params.teamId },
        include: { members: MEMBER_SUMMARY, sites: SITE_SUMMARY },
      });
    });
  }

  /** Replace which sites a team may edit. */
  setSites(params: {
    organisationId: string;
    userId: string;
    teamId: string;
    teamName: string;
    siteIds: string[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.teamSite.deleteMany({ where: { teamId: params.teamId } });
      if (params.siteIds.length) {
        await tx.teamSite.createMany({
          data: params.siteIds.map((siteId) => ({ teamId: params.teamId, siteId })),
        });
      }

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          // Its own action, not a generic update: this is the event that
          // explains why an editor could suddenly change a given site.
          action: 'team.site_access_changed',
          subject: params.teamName,
          detail: { sites: params.siteIds.length },
        },
      });

      return tx.team.findFirstOrThrow({
        where: { id: params.teamId },
        include: { members: MEMBER_SUMMARY, sites: SITE_SUMMARY },
      });
    });
  }

  /** Which of these user ids actually belong to the organisation. */
  async membersOf(organisationId: string, userIds: string[]): Promise<string[]> {
    const rows = await this.prisma.memberships.findMany({
      where: { organisationId, userId: { in: userIds } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** Which of these site ids actually belong to the organisation. */
  async sitesOf(organisationId: string, siteIds: string[]): Promise<string[]> {
    const rows = await this.prisma.site.findMany({
      where: { organisationId, id: { in: siteIds } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
