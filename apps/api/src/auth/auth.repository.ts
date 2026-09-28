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

  async touchUser(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  /** The dashboard's boot call: who am I, and which organisations do I see. */
  findUserWithOrganisations(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: {
        memberships: {
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
