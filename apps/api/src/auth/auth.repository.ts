import { Injectable } from '@nestjs/common';
import { Prisma, Role, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every database call for sign-in links, sessions and users.
 *
 * `AuthService` decides what is allowed; this decides how it is stored. The
 * split matters most here, because two of these methods are the difference
 * between a correct login and a replayable one, and that is easier to
 * review when it is not interleaved with policy.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── sign-in links ──────────────────────────────────────────────

  createLoginToken(params: { email: string; tokenHash: string; expiresAt: Date }) {
    return this.prisma.loginToken.create({ data: params });
  }

  /**
   * Consume a sign-in link, returning the address it was issued for.
   *
   * The claim is a single conditional write: `consumedAt: null` and an
   * unexpired `expiresAt` are in the *filter*, so the database picks the
   * winner and a second attempt updates nothing. Reading, checking in
   * application code, then updating — which is what this replaced — leaves
   * a window where a link forwarded to someone else passes the check twice.
   */
  async consumeLoginToken(tokenHash: string): Promise<{ email: string } | null> {
    const login = await this.prisma.loginToken.findUnique({ where: { tokenHash } });
    if (!login) return null;

    const claimed = await this.prisma.loginToken.updateMany({
      where: { id: login.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    return claimed.count === 1 ? { email: login.email } : null;
  }

  // ── sessions ───────────────────────────────────────────────────

  createSession(params: {
    userId: string;
    kind: string;
    tokenHash: string;
    userAgent?: string;
    ip?: string;
    expiresAt: Date;
  }) {
    return this.prisma.session.create({ data: params });
  }

  /**
   * A usable session, or null.
   *
   * Revoked and expired are conditions on the query rather than checks on
   * the result: a revoked session must never be *returned* to a caller who
   * might forget to look.
   */
  /**
   * Long-lived tokens the browser extension holds.
   *
   * Listed so they can be revoked individually: the extension runs on the
   * customer's own pages, so its token is the one most likely to be sitting
   * in a profile somebody else now uses.
   */
  listExtensionSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, kind: 'extension', revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        userAgent: true,
        expiresAt: true,
      },
    });
  }

  /** Scoped by user, so one person cannot revoke another's token. */
  async revokeSessionById(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  findLiveSession(tokenHash: string) {
    return this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
  }

  /**
   * Fire and forget. This runs on every authenticated request, and a failed
   * timestamp must not be what fails one.
   */
  touchSession(id: string): void {
    void this.prisma.session
      .update({ where: { id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string, exceptTokenHash?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptTokenHash ? { NOT: { tokenHash: exceptTokenHash } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  // ── users ──────────────────────────────────────────────────────

  findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  updateName(id: string, name: string | null) {
    return this.prisma.user.update({
      where: { id },
      data: { name },
      select: { id: true, email: true, name: true },
    });
  }

  async touchUser(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  /** The dashboard's boot call: who am I, and which organisations do I see. */
  findUserWithOrganisations(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: {
        memberships: {
          // A soft-deleted organisation must not appear in the switcher —
          // OrgGuard would refuse every request made in it.
          where: { organisation: { deletedAt: null } },
          include: {
            organisation: {
              select: {
                id: true,
                name: true,
                slug: true,
                _count: { select: { sites: true, memberships: true } },
              },
            },
          },
        },
      },
    });
  }

  /** Whether an unexpired, unaccepted invitation is waiting for this address. */
  async hasPendingInvitation(email: string): Promise<boolean> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return invitation !== null;
  }

  /**
   * Accept every invitation waiting for this address.
   *
   * Called on every sign-in, not just the first. Two reasons:
   *
   *   - An *existing* user invited to a second organisation would otherwise
   *     never receive that membership — nothing else ever looks at their
   *     invitations again.
   *   - Matching on the address is safe because a magic link proves control
   *     of it. The invitation token makes the emailed link meaningful, but
   *     it is not what authorises the join.
   *
   * Each invitation is one transaction: membership, team places and the
   * `acceptedAt` stamp together, so a half-accepted invitation cannot leave
   * someone in an organisation with no team or a team with no membership.
   *
   * @returns how many were accepted.
   */
  async acceptPendingInvitations(userId: string, email: string): Promise<number> {
    const pending = await this.prisma.invitation.findMany({
      where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, organisationId: true, role: true, teamIds: true },
    });

    for (const invitation of pending) {
      await this.prisma.$transaction(async (tx) => {
        // Upsert, not create: someone invited twice, or invited to an
        // organisation they already belong to, should not see an error. An
        // existing role is left alone — an invitation must not quietly
        // demote an admin.
        await tx.memberships.upsert({
          where: {
            organisationId_userId: { organisationId: invitation.organisationId, userId },
          },
          create: { organisationId: invitation.organisationId, userId, role: invitation.role },
          update: {},
        });

        // Only teams that still exist in that organisation — one named in
        // the invitation may have been deleted since it was sent.
        const named = await tx.team.findMany({
          where: { organisationId: invitation.organisationId, id: { in: invitation.teamIds } },
          select: { id: true },
        });

        // Plus the default team, so an invitee can always reach something.
        const fallback = await tx.team.findFirst({
          where: { organisationId: invitation.organisationId, isDefault: true },
          select: { id: true },
        });

        const teamIds = new Set(named.map((t) => t.id));
        if (fallback) teamIds.add(fallback.id);

        if (teamIds.size) {
          await tx.teamMember.createMany({
            data: [...teamIds].map((teamId) => ({ teamId, userId })),
            skipDuplicates: true,
          });
        }

        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });

        await tx.auditEvent.create({
          data: {
            organisationId: invitation.organisationId,
            actorUserId: userId,
            action: 'invitation.accepted',
            subject: email,
            detail: { role: invitation.role },
          },
        });
      });
    }

    return pending.length;
  }

  createUser(email: string): Promise<User> {
    return this.prisma.user.create({ data: { email, lastSeenAt: new Date() } });
  }

  /**
   * A first sign-in: the person, their organisation, their membership, the
   * default team and the audit row — all five, or none.
   *
   * A user with no organisation signs in to a dashboard that can show them
   * nothing and offers no way forward, and an organisation with no
   * "Everyone" team is one that every later invitation fails against. The
   * name is supplied by the caller: guessing it from an email address is
   * policy, and policy is not this file's job.
   */
  createUserWithOrganisation(email: string, organisationName: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, lastSeenAt: new Date() } });

      const organisation = await tx.organisation.create({
        data: { name: organisationName, slug: await uniqueSlug(tx, organisationName) },
      });

      await tx.memberships.create({
        data: { organisationId: organisation.id, userId: user.id, role: Role.admin },
      });

      const team = await tx.team.create({
        data: { organisationId: organisation.id, name: 'Everyone', isDefault: true },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId: user.id } });

      await tx.auditEvent.create({
        data: {
          organisationId: organisation.id,
          actorUserId: user.id,
          action: 'organisation.created',
          subject: organisation.name,
        },
      });

      return user;
    });
  }
}

/**
 * Inside the transaction, so a slug cannot be taken between the check and
 * the insert by another first sign-in from the same domain.
 */
async function uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'org';

  for (let n = 0; ; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`;
    const taken = await tx.organisation.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
}
