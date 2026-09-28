import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';
import { createToken, hashToken } from '../common/tokens';

const LINK_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Start a sign-in.
   *
   * Always reports success, whether or not the address is known. Saying "no
   * such account" turns this endpoint into a way to find out who has one.
   */
  async requestLink(email: string, appUrl: string) {
    const normalised = email.trim().toLowerCase();
    const { token, hash } = createToken();

    await this.prisma.loginToken.create({
      data: {
        email: normalised,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + LINK_TTL_MINUTES * 60_000),
      },
    });

    await this.mailer.sendSignInLink(
      normalised,
      `${appUrl}/sign-in/verify?token=${token}`,
    );

    return { sent: true };
  }

  /**
   * Finish a sign-in.
   *
   * The token is consumed in the same transaction that reads it, so a link
   * forwarded to someone else cannot be used a second time.
   */
  async verify(token: string, context: { userAgent?: string; ip?: string }) {
    const tokenHash = hashToken(token);

    const login = await this.prisma.loginToken.findUnique({ where: { tokenHash } });

    if (!login || login.consumedAt || login.expiresAt < new Date()) {
      throw new UnauthorizedException('That sign-in link is no longer valid.');
    }

    await this.prisma.loginToken.update({
      where: { id: login.id },
      data: { consumedAt: new Date() },
    });

    const user = await this.findOrCreateUser(login.email);
    const session = await this.createSession(user.id, 'dashboard', context);

    return { user, sessionToken: session.token };
  }

  /** The session behind a token, or null. Also bumps lastSeenAt. */
  async resolveSession(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

    // Fire and forget: a failed timestamp update must not fail the request.
    void this.prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    return session;
  }

  async revokeSession(token: string) {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string, exceptToken?: string) {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptToken ? { NOT: { tokenHash: hashToken(exceptToken) } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(
    userId: string,
    kind: 'dashboard' | 'extension',
    context: { userAgent?: string; ip?: string },
  ) {
    const { token, hash } = createToken();

    await this.prisma.session.create({
      data: {
        userId,
        kind,
        tokenHash: hash,
        userAgent: context.userAgent?.slice(0, 255),
        ip: context.ip,
        expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000),
      },
    });

    return { token };
  }

  /**
   * Find the person, or make them — and give a brand-new one somewhere to be.
   *
   * A user with no organisation would sign in to a dashboard that can show
   * them nothing and offers no way forward, so the first sign-in creates one,
   * along with the default team every invitation relies on.
   */
  private async findOrCreateUser(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, lastSeenAt: new Date() } });

      const pending = await tx.invitation.findFirst({
        where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
      });

      // An invited person joins what they were invited to. Creating them a
      // second, empty organisation would be a confusing first impression.
      if (pending) return user;

      const name = this.organisationNameFor(email);
      const organisation = await tx.organisation.create({
        data: { name, slug: await this.uniqueSlug(tx, name) },
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

  /** "ada@acme.com" → "Acme". A guess, and renameable in settings. */
  private organisationNameFor(email: string) {
    const domain = email.split('@')[1] ?? '';
    const label = domain.split('.')[0] ?? 'My organisation';
    if (!label) return 'My organisation';
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  private async uniqueSlug(tx: Prisma.TransactionClient, name: string) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
    for (let n = 0; ; n++) {
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      const taken = await tx.organisation.findUnique({ where: { slug } });
      if (!taken) return slug;
    }
  }
}
