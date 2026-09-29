import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackController } from './feedback.controller';
import { OrganisationsModule } from '../organisations/organisations.module';

@Module({
  imports: [OrganisationsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackRepository],
  exports: [FeedbackRepository],
})
export class FeedbackModule {}
