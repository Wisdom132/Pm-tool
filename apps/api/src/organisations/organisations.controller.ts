import { Body, Controller, Delete, Get, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrganisationsService } from './organisations.service';
import { DeleteOrganisationDto, RenameOrganisationDto } from './dto';
import { Org, OrgContext, OrgGuard } from './org-context';
import { Roles } from './roles.decorator';
import { CurrentSession, Session } from '../auth/session.decorator';

/**
 * The current organisation. No id in the path: which one is already
 * established by the `x-organisation-id` header and verified by OrgGuard, so
 * taking it twice would just be a second thing to disagree.
 */
@Controller('organisation')
@UseGuards(OrgGuard)
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @Get()
  get(@Org() org: OrgContext) {
    return this.organisations.get(org.organisationId);
  }

  @Patch()
  @Roles(Role.admin)
  rename(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Body() dto: RenameOrganisationDto,
  ) {
    return this.organisations.rename(org.organisationId, s.userId, dto);
  }

  @Delete()
  @Roles(Role.admin)
  remove(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Body() dto: DeleteOrganisationDto,
  ) {
    return this.organisations.remove(org.organisationId, s.userId, dto);
  }
}
