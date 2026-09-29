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
import { FeedbackService } from './feedback.service';
import { FeedbackQueryDto, PromoteFeedbackDto, SetFeedbackStatusDto } from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { CurrentSession, Session } from '../auth/session.decorator';

/**
 * Not admin-only: triaging feedback is the job an editor is here to do.
 */
@Controller('feedback')
@UseGuards(OrgGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(@Org() org: OrgContext, @Query() query: FeedbackQueryDto) {
    return this.feedback.list(org.organisationId, query);
  }

  @Get(':id')
  get(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedback.get(org.organisationId, id);
  }

  @Patch(':id/status')
  setStatus(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetFeedbackStatusDto,
  ) {
    return this.feedback.setStatus(org.organisationId, s.userId, id, dto);
  }

  /** Record that this comment became an issue or a change request. */
  @Post(':id/promote')
  promote(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoteFeedbackDto,
  ) {
    return this.feedback.promote(org.organisationId, s.userId, id, dto);
  }

  @Delete(':id')
  remove(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.feedback.remove(org.organisationId, s.userId, id);
  }
}
