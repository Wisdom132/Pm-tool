import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MembersService } from './members.service';
import { ChangeRoleDto, InviteDto } from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { Roles } from '../organisations/roles.decorator';
import { CurrentSession, Session } from '../auth/session.decorator';

@Controller('members')
@UseGuards(OrgGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Accepted members and pending invitations, in one list. */
  @Get()
  list(@Org() org: OrgContext) {
    return this.members.list(org.organisationId);
  }

  @Post('invitations')
  @Roles(Role.admin)
  invite(@Org() org: OrgContext, @Session() s: CurrentSession, @Body() dto: InviteDto) {
    const appUrl = process.env.DASHBOARD_URL ?? 'http://localhost:4200';
    return this.members.invite(org.organisationId, s.userId, appUrl, dto);
  }

  @Delete('invitations/:id')
  @Roles(Role.admin)
  revokeInvitation(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.members.revokeInvitation(org.organisationId, s.userId, id);
  }

  @Patch(':userId/role')
  @Roles(Role.admin)
  changeRole(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.members.changeRole(org.organisationId, s.userId, userId, dto);
  }

  @Delete(':userId')
  @Roles(Role.admin)
  remove(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.members.remove(org.organisationId, s.userId, userId);
  }
}
