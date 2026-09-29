import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackRepository } from './feedback.repository';
import {
  FeedbackController,
  FeedbackIntakeController,
  PublicFeedbackController,
} from './feedback.controller';
import { OrganisationsModule } from '../organisations/organisations.module';
import { SitesModule } from '../sites/sites.module';
import { ProvidersModule } from '../providers/providers.module';
import { RateLimitGuard } from '../common/rate-limit.guard';

@Module({
  imports: [OrganisationsModule, SitesModule, ProvidersModule],
  controllers: [FeedbackController, FeedbackIntakeController, PublicFeedbackController],
  providers: [FeedbackService, FeedbackRepository, RateLimitGuard],
  exports: [FeedbackRepository],
})
export class FeedbackModule {}
