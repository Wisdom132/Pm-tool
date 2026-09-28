import { Module } from '@nestjs/common';
import { EditingService } from './editing.service';
import { EditingController } from './editing.controller';
import { I18nService } from './i18n.service';
import { LocateService } from './locate.service';
import { RateLimitGuard } from './rate-limit.guard';
import { SitesModule } from '../sites/sites.module';

@Module({
  // SitesModule for authoriseEnvironment — the check that a page cannot
  // name a repository its editors were never granted.
  imports: [SitesModule],
  controllers: [EditingController],
  providers: [EditingService, I18nService, LocateService, RateLimitGuard],
})
export class EditingModule {}
