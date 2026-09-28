import { Module } from '@nestjs/common';
import { SitesService } from './sites.service';
import { SitesRepository } from './sites.repository';
import { ResolveController, SitesController } from './sites.controller';
import { OrganisationsModule } from '../organisations/organisations.module';
import { ConnectionsModule } from '../connections/connections.module';

@Module({
  // OrganisationsModule for OrgGuard and membership lookups;
  // ConnectionsModule because registering a site has to check that the
  // connection it names is real and live.
  imports: [OrganisationsModule, ConnectionsModule],
  controllers: [SitesController, ResolveController],
  providers: [SitesService, SitesRepository],
  // The repository is exported so ProvidersModule can resolve a site
  // environment to a repository without reaching for Prisma.
  exports: [SitesService, SitesRepository],
})
export class SitesModule {}
