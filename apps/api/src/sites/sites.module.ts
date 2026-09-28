import { Module } from '@nestjs/common';
import { SitesService } from './sites.service';
import { ResolveController, SitesController } from './sites.controller';
import { OrgGuard } from '../organisations/org-context';

@Module({
  controllers: [SitesController, ResolveController],
  providers: [SitesService, OrgGuard],
  exports: [SitesService],
})
export class SitesModule {}
