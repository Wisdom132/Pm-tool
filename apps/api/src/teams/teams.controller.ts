import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeamsService } from './teams.service';
import { CreateTeamDto, RenameTeamDto, SetMembersDto, SetSitesDto } from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { Roles } from '../organisations/roles.decorator';
import { CurrentSession, Session } from '../auth/session.decorator';

/**
 * Teams decide which sites an editor can change, so every write here is an
 * admin action. Reads are not: an editor should be able to see why they can
 * or cannot reach a site.
 */
@Controller('teams')
@UseGuards(OrgGuard)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@Org() org: OrgContext) {
    return this.teams.list(org.organisationId);
  }

  @Get(':id')
  get(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.get(org.organisationId, id);
  }

  @Post()
  @Roles(Role.admin)
  create(@Org() org: OrgContext, @Session() s: CurrentSession, @Body() dto: CreateTeamDto) {
    return this.teams.create(org.organisationId, s.userId, dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  rename(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTeamDto,
  ) {
    return this.teams.rename(org.organisationId, s.userId, id, dto);
  }

  // PUT, not PATCH: the body is the whole set, and PUT says so.
  @Put(':id/members')
  @Roles(Role.admin)
  setMembers(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMembersDto,
  ) {
    return this.teams.setMembers(org.organisationId, s.userId, id, dto);
  }

  @Put(':id/sites')
  @Roles(Role.admin)
  setSites(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSitesDto,
  ) {
    return this.teams.setSites(org.organisationId, s.userId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.admin)
  remove(@Org() org: OrgContext, @Session() s: CurrentSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.remove(org.organisationId, s.userId, id);
  }
}
