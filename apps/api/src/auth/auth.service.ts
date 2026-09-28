import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { MailerService } from './mailer.service';
import { createToken, hashToken } from '../common/tokens';

const LINK_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
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

    await this.repository.createLoginToken({
      email: normalised,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + LINK_TTL_MINUTES * 60_000),
    });

    await this.mailer.sendSignInLink(normalised, `${appUrl}/sign-in/verify?token=${token}`);

    return { sent: true };
  }

  /**
   * Finish a sign-in.
   *
   * Expired, already used and never issued are one error on purpose: which
   * of the three it was is not something the person holding the link needs,
   * and it is something an attacker probing forwarded links would like.
   */
  async verify(token: string, context: { userAgent?: string; ip?: string }) {
    const claimed = await this.repository.consumeLoginToken(hashToken(token));
    if (!claimed) throw new UnauthorizedException('That sign-in link is no longer valid.');

    const user = await this.findOrCreateUser(claimed.email);
    const sessionToken = await this.createSession(user.id, 'dashboard', context);

    return { user, sessionToken };
  }

  /** The session behind a token, or null. Also bumps lastSeenAt. */
  async resolveSession(token: string) {
    const session = await this.repository.findLiveSession(hashToken(token));
    if (!session) return null;

    this.repository.touchSession(session.id);
    return session;
  }

  revokeSession(token: string) {
    return this.repository.revokeSession(hashToken(token));
  }

  revokeAllSessions(userId: string, exceptToken?: string) {
    return this.repository.revokeAllSessions(
      userId,
      exceptToken ? hashToken(exceptToken) : undefined,
    );
  }

  /** Who am I, and what can I see. The dashboard calls this on boot. */
  async describe(userId: string) {
    const user = await this.repository.findUserWithOrganisations(userId);

    return {
      user: { id: user.id, email: user.email, name: user.name },
      organisations: user.memberships.map((m) => ({
        id: m.organisation.id,
        name: m.organisation.name,
        slug: m.organisation.slug,
        role: m.role,
        meta: `${m.organisation._count.sites} sites · ${m.organisation._count.memberships} members`,
      })),
    };
  }

  private async createSession(
    userId: string,
    kind: 'dashboard' | 'extension',
    context: { userAgent?: string; ip?: string },
  ) {
    const { token, hash } = createToken();

    await this.repository.createSession({
      userId,
      kind,
      tokenHash: hash,
      userAgent: context.userAgent?.slice(0, 255),
      ip: context.ip,
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000),
    });

    return token;
  }

  /**
   * Find the person, or make them — and give a brand-new one somewhere to be.
   *
   * An invited person joins what they were invited to; creating them a
   * second, empty organisation would be a confusing first impression. Anyone
   * else gets an organisation of their own, because a user with none signs in
   * to a dashboard that can show them nothing.
   */
  private async findOrCreateUser(email: string) {
    const existing = await this.repository.findUserByEmail(email);
    if (existing) {
      await this.repository.touchUser(existing.id);
      return existing;
    }

    if (await this.repository.hasPendingInvitation(email)) {
      return this.repository.createUser(email);
    }

    return this.repository.createUserWithOrganisation(email, organisationNameFor(email));
  }
}

/** "ada@acme.com" → "Acme". A guess, and renameable in settings. */
export function organisationNameFor(email: string): string {
  const domain = email.split('@')[1] ?? '';
  const label = domain.split('.')[0] ?? '';
  if (!label) return 'My organisation';
  return label.charAt(0).toUpperCase() + label.slice(1);
}
