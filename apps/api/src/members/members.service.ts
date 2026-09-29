import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MembersRepository } from './members.repository';
import { MailerService } from '../auth/mailer.service';
import { createToken } from '../common/tokens';
import { ChangeRoleDto, InviteDto } from './dto';

const INVITE_TTL_DAYS = 14;

/**
 * People and invitations.
 *
 * **An organisation cannot lose its last admin.** Nobody could then connect
 * a provider, register a site or invite anyone, and there would be no way
 * back. Two rules together produce that, and it is worth being precise about
 * which one does the work:
 *
 *   - **You cannot change your own role or remove yourself.** This is the
 *     load-bearing one. The sole admin can only be demoted by themselves —
 *     blocked here — or by another admin, which means they were not the sole
 *     admin. So this single rule already makes the bad state unreachable.
 *   - **`assertNotLastAdmin`** therefore never fires today; it is defence in
 *     depth, kept because it stops being redundant the moment anything else
 *     can change a membership — an ownership transfer, a support tool, a
 *     background job. Do not read it as the guarantee; read the self-check
 *     as the guarantee.
 *
 * Both have the same obvious alternative: ask another admin.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly members: MembersRepository,
    private readonly mailer: MailerService,
  ) {}

  /**
   * The People page: accepted members and pending invitations in one list.
   *
   * Merged here rather than in the client because "who is in this
   * organisation" is one question, and two endpoints would make every
   * consumer join them.
   */
  async list(organisationId: string) {
    const [members, invitations] = await Promise.all([
      this.members.listMembers(organisationId),
      this.members.listInvitations(organisationId),
    ]);

    return [
      ...members.map((m) => ({
        id: m.user.id,
        kind: 'member' as const,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        status: 'active' as const,
        lastSeenAt: m.user.lastSeenAt,
        joinedAt: m.createdAt,
        teams: m.user.teamMemberships.map((t) => t.team),
      })),
      ...invitations.map((i) => ({
        id: i.id,
        kind: 'invitation' as const,
        name: null,
        email: i.email,
        role: i.role,
        status: 'invited' as const,
        lastSeenAt: null,
        joinedAt: i.createdAt,
        expiresAt: i.expiresAt,
        teams: [],
      })),
    ];
  }

  async invite(organisationId: string, actorUserId: string, appUrl: string, dto: InviteDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.members.listMembers(organisationId);
    if (existing.some((m) => m.user.email === email)) {
      throw new ConflictException(`${email} is already in this organisation.`);
    }

    const { token, hash } = createToken();

    const invitation = await this.members.createInvitation({
      organisationId,
      actorUserId,
      email,
      role: dto.role,
      teamIds: dto.teamIds ?? [],
      tokenHash: hash,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    });

    await this.mailer.sendInvitation(email, `${appUrl}/invitations/${token}`);

    // The token is not returned. It goes to the invitee's address and
    // nowhere else, so an admin cannot accidentally paste a working
    // credential into a chat.
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  async revokeInvitation(organisationId: string, actorUserId: string, id: string) {
    const invitation = await this.members.findInvitation(organisationId, id);
    if (!invitation) throw new NotFoundException('No such invitation.');
    if (invitation.acceptedAt) {
      throw new ConflictException(
        `${invitation.email} has already accepted. Remove them instead.`,
      );
    }

    await this.members.revokeInvitation({
      organisationId,
      actorUserId,
      id,
      email: invitation.email,
    });

    return { revoked: true };
  }

  async changeRole(
    organisationId: string,
    actorUserId: string,
    userId: string,
    dto: ChangeRoleDto,
  ) {
    if (userId === actorUserId) {
      throw new BadRequestException(
        'You cannot change your own role. Ask another admin to do it.',
      );
    }

    const membership = await this.members.findMembership(organisationId, userId);
    if (!membership) throw new NotFoundException('They are not in this organisation.');
    if (membership.role === dto.role) return membership;

    if (membership.role === Role.admin && dto.role !== Role.admin) {
      await this.assertNotLastAdmin(organisationId);
    }

    return this.members.changeRole({
      organisationId,
      actorUserId,
      userId,
      subject: membership.user.email,
      from: membership.role,
      to: dto.role,
    });
  }

  async remove(organisationId: string, actorUserId: string, userId: string) {
    if (userId === actorUserId) {
      throw new BadRequestException(
        'You cannot remove yourself. Ask another admin, or delete the organisation.',
      );
    }

    const membership = await this.members.findMembership(organisationId, userId);
    if (!membership) throw new NotFoundException('They are not in this organisation.');

    if (membership.role === Role.admin) await this.assertNotLastAdmin(organisationId);

    await this.members.removeMember({
      organisationId,
      actorUserId,
      userId,
      subject: membership.user.email,
    });

    return { removed: true };
  }

  private async assertNotLastAdmin(organisationId: string) {
    const admins = await this.members.countAdmins(organisationId);
    if (admins <= 1) {
      throw new ConflictException(
        'This is the only admin. Promote someone else first — an organisation ' +
          'with no admin cannot connect a provider, register a site or invite anyone.',
      );
    }
  }
}
