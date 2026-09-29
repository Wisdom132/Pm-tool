import { Module } from '@nestjs/common';
import { MembershipsRepository } from './memberships.repository';
import { OrganisationsRepository } from './organisations.repository';
import { OrganisationsService } from './organisations.service';
import { OrganisationsController } from './organisations.controller';
import { OrgGuard } from './org-context';

/**
 * The tenant boundary: membership lookups and the guard that enforces them.
 *
 * Exported rather than global, so a feature module that wants `OrgGuard`
 * has to say so. `@UseGuards(OrgGuard)` needs the guard's dependencies
 * resolvable from the module the controller lives in, and an explicit
 * import is what makes that failure a compile-time wiring error rather
 * than a runtime one.
 */
@Module({
  controllers: [OrganisationsController],
  providers: [MembershipsRepository, OrganisationsRepository, OrganisationsService, OrgGuard],
  exports: [MembershipsRepository, OrgGuard],
})
export class OrganisationsModule {}
