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
import {
  CreateFeedbackDto,
  FeedbackQueryDto,
  PromoteFeedbackDto,
  SetFeedbackStatusDto,
} from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
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

/**
 * Where the extension files a comment.
 *
 * Its own controller, outside `OrgGuard`, for the same reason the editing
 * endpoints are: the extension runs on a customer's own pages and knows one
 * thing — the site environment it is on. Which organisation that belongs to
 * is derived from the environment, not asserted by the caller.
 */
@Controller('feedback')
@UseGuards(RateLimitGuard)
export class FeedbackIntakeController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @RateLimit('write')
  create(@Session() session: CurrentSession, @Body() dto: CreateFeedbackDto) {
    return this.feedback.create(session.userId, dto);
  }
}
