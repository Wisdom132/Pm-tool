import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { SitesService } from './sites.service';
import { CreateSiteDto, ResolveQueryDto, UpdateSiteDto } from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { Roles } from '../organisations/roles.decorator';
import { CurrentSession, Session } from '../auth/session.decorator';

@Controller('sites')
@UseGuards(OrgGuard)
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  list(@Org() org: OrgContext) {
    return this.sites.list(org.organisationId);
  }

  @Get(':id')
  get(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.get(org.organisationId, id);
  }

  // Registering a site decides which repository a hostname can write to, so
  // it is an admin action rather than something any editor can do.
  @Post()
  @Roles(Role.admin)
  create(@Org() org: OrgContext, @Session() session: CurrentSession, @Body() dto: CreateSiteDto) {
    return this.sites.create(org.organisationId, session.userId, dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  update(
    @Org() org: OrgContext,
    @Session() session: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.sites.update(org.organisationId, session.userId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.admin)
  remove(@Org() org: OrgContext, @Session() session: CurrentSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.sites.remove(org.organisationId, session.userId, id);
  }
}

/**
 * The extension's entry point, separate from the CRUD above.
 *
 * It deliberately takes no organisation header: the extension knows a
 * hostname and nothing else, and which organisation that belongs to is
 * exactly what it is asking.
 */
@Controller('resolve')
export class ResolveController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  async resolve(@Session() session: CurrentSession, @Query() query: ResolveQueryDto) {
    const site = await this.sites.resolve(session.userId, query.hostname);

    if (!site) {
      return {
        known: false,
        reason:
          'This hostname is not registered, or you do not have access to it. ' +
          'Register it in the dashboard to start editing.',
      };
    }

    return { known: true, ...site };
  }
}
