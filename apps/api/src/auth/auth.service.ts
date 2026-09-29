import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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

  /**
   * What an invitation link is offering.
   *
   * Public, because the person holding the link may have no account yet —
   * which is the whole point of an invitation. So it is deliberately thin:
   * the organisation's name, who asked, the role, and the address it was
   * sent to. No member list, no site list, nothing that would make a
   * guessed token worth having.
   *
   * `status` rather than an exception for expired and already-accepted: the
   * page has something useful to say in both cases, and a 404 would make
   * them indistinguishable from a typo.
   */
  async describeInvitation(token: string) {
    const invitation = await this.repository.findInvitationByToken(hashToken(token));

    if (!invitation || invitation.organisation.deletedAt) {
      throw new NotFoundException('That invitation link is not valid.');
    }

    const status = invitation.acceptedAt
      ? ('accepted' as const)
      : invitation.expiresAt < new Date()
        ? ('expired' as const)
        : ('pending' as const);

    return {
      status,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      organisation: { id: invitation.organisation.id, name: invitation.organisation.name },
    };
  }

  /**
   * Accept an invitation as the signed-in user.
   *
   * The address must match. An invitation is sent *to a person*, so letting
   * whoever holds a forwarded link join instead would make the address on it
   * meaningless — and it is the only thing tying the invitation to anyone.
   */
  async acceptInvitation(token: string, userId: string, userEmail: string) {
    const invitation = await this.repository.findInvitationByToken(hashToken(token));

    if (!invitation || invitation.organisation.deletedAt) {
      throw new NotFoundException('That invitation link is not valid.');
    }
    if (invitation.email !== userEmail) {
      throw new ForbiddenException(
        `This invitation was sent to ${invitation.email}. Sign in as them to accept it.`,
      );
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('That invitation has expired. Ask for a new one.');
    }

    const accepted = await this.repository.acceptInvitation({
      invitationId: invitation.id,
      organisationId: invitation.organisationId,
      userId,
      email: invitation.email,
      role: invitation.role,
      teamIds: invitation.teamIds,
    });

    // Already accepted — by their own earlier sign-in, most likely. They are
    // a member either way, so this is not a failure.
    return { organisationId: invitation.organisationId, alreadyAccepted: !accepted };
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

  /** Set or clear a display name. */
  async updateProfile(userId: string, name: string) {
    const trimmed = name.trim();
    const user = await this.repository.updateName(userId, trimmed || null);
    return { user };
  }

  /**
   * Mint a token for the browser extension.
   *
   * The extension cannot receive a magic link — it has no inbox — so an
   * already-signed-in person creates one here and pastes it in. It is a
   * session like any other, which means it appears in the list below and can
   * be revoked on its own.
   *
   * Returned exactly once. Only the hash is stored, so there is no way to
   * show it again, which is the property that makes losing it safe.
   */
  async createExtensionToken(userId: string, label?: string) {
    const token = await this.createSession(userId, 'extension', {
      userAgent: label?.slice(0, 255) ?? 'Browser extension',
    });

    return { token, expiresInDays: SESSION_TTL_DAYS };
  }

  listExtensionTokens(userId: string) {
    return this.repository.listExtensionSessions(userId);
  }

  async revokeToken(userId: string, id: string) {
    const revoked = await this.repository.revokeSessionById(userId, id);
    if (!revoked) throw new NotFoundException('No such token.');
    return { revoked: true };
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
      // Also on returning sign-ins: someone already registered who is later
      // invited to a second organisation would otherwise never join it.
      await this.acceptInvitations(existing.id, email);
      return existing;
    }

    // An invited person joins what they were invited to. Creating them a
    // second, empty organisation as well would be a confusing first
    // impression — and before this was wired, they got a user row with no
    // membership at all and a dashboard that could show them nothing.
    if (await this.repository.hasPendingInvitation(email)) {
      const user = await this.repository.createUser(email);
      await this.acceptInvitations(user.id, email);
      return user;
    }

    return this.repository.createUserWithOrganisation(email, organisationNameFor(email));
  }

  /**
   * Accepting invitations must never be what stops someone signing in.
   *
   * If a team referenced by an invitation has been deleted mid-transaction,
   * or the organisation is gone, the right outcome is a sign-in with one
   * fewer membership and a log line — not a failed login with no
   * explanation.
   */
  private async acceptInvitations(userId: string, email: string) {
    try {
      const accepted = await this.repository.acceptPendingInvitations(userId, email);
      if (accepted > 0) {
        this.logger.log(`${email} accepted ${accepted} invitation(s) on sign-in`);
      }
    } catch (err) {
      this.logger.error(`Could not accept invitations for ${email}: ${(err as Error).message}`);
    }
  }
}

/** "ada@acme.com" → "Acme". A guess, and renameable in settings. */
export function organisationNameFor(email: string): string {
  const domain = email.split('@')[1] ?? '';
  const label = domain.split('.')[0] ?? '';
  if (!label) return 'My organisation';
  return label.charAt(0).toUpperCase() + label.slice(1);
}
