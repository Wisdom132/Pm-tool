import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every database call for members and invitations.
 *
 * The two live together because the People page shows one list: someone who
 * has accepted and someone who has been asked are the same row to a reader,
 * differing only in `status`.
 */
@Injectable()
export class MembersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── members ────────────────────────────────────────────────────

  listMembers(organisationId: string) {
    return this.prisma.memberships.findMany({
      where: { organisationId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            lastSeenAt: true,
            teamMemberships: {
              where: { team: { organisationId } },
              select: { team: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
  }

  findMembership(organisationId: string, userId: string) {
    return this.prisma.memberships.findUnique({
      where: { organisationId_userId: { organisationId, userId } },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  /** How many admins the organisation has. Guards the last-admin case. */
  countAdmins(organisationId: string): Promise<number> {
    return this.prisma.memberships.count({ where: { organisationId, role: Role.admin } });
  }

  changeRole(params: {
    organisationId: string;
    actorUserId: string;
    userId: string;
    subject: string;
    from: Role;
    to: Role;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.memberships.update({
        where: {
          organisationId_userId: {
            organisationId: params.organisationId,
            userId: params.userId,
          },
        },
        data: { role: params.to },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.actorUserId,
          action: 'member.role_changed',
          subject: params.subject,
          detail: { from: params.from, to: params.to },
        },
      });

      return updated;
    });
  }

  /**
   * Remove someone from an organisation.
   *
   * Their team memberships go too, in the same transaction — a person left
   * in `team_member` after losing their membership would still satisfy the
   * team-access check in `authoriseEnvironment`.
   */
  removeMember(params: {
    organisationId: string;
    actorUserId: string;
    userId: string;
    subject: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({
        where: { userId: params.userId, team: { organisationId: params.organisationId } },
      });

      await tx.memberships.delete({
        where: {
          organisationId_userId: {
            organisationId: params.organisationId,
            userId: params.userId,
          },
        },
      });

      // Their sessions are not revoked here: a session is not scoped to one
      // organisation, and they may legitimately belong to others. OrgGuard
      // refuses them for this one on the next request.
      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.actorUserId,
          action: 'member.removed',
          subject: params.subject,
        },
      });
    });
  }

  // ── invitations ────────────────────────────────────────────────

  listInvitations(organisationId: string) {
    return this.prisma.invitation.findMany({
      where: { organisationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        teamIds: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  findPendingByEmail(organisationId: string, email: string) {
    return this.prisma.invitation.findFirst({
      where: { organisationId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  findInvitation(organisationId: string, id: string) {
    return this.prisma.invitation.findFirst({ where: { id, organisationId } });
  }

  createInvitation(params: {
    organisationId: string;
    actorUserId: string;
    email: string;
    role: Role;
    teamIds: string[];
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Supersede any earlier pending invitation for the same address rather
      // than leaving two live tokens for one person.
      await tx.invitation.deleteMany({
        where: { organisationId: params.organisationId, email: params.email, acceptedAt: null },
      });

      const invitation = await tx.invitation.create({
        data: {
          organisationId: params.organisationId,
          email: params.email,
          role: params.role,
          teamIds: params.teamIds,
          tokenHash: params.tokenHash,
          expiresAt: params.expiresAt,
        },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.actorUserId,
          action: 'invitation.created',
          subject: params.email,
          detail: { role: params.role, teams: params.teamIds.length },
        },
      });

      return invitation;
    });
  }

  revokeInvitation(params: {
    organisationId: string;
    actorUserId: string;
    id: string;
    email: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.invitation.delete({ where: { id: params.id } });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.actorUserId,
          action: 'invitation.revoked',
          subject: params.email,
        },
      });
    });
  }

  // Acceptance lives in AuthRepository, not here: it happens during
  // sign-in, before any organisation context exists, and one
  // implementation is the only way it stays consistent with the
  // membership and team rules it has to satisfy.
}
