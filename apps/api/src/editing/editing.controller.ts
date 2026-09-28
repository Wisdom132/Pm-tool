import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { EditingService } from './editing.service';
import {
  BranchesQueryDto,
  CreateChangeRequestDto,
  CreateIssueDto,
  LocateDto,
  PreviewStatusQueryDto,
  ReadFileQueryDto,
} from './dto';
import { RateLimit, RateLimitGuard } from './rate-limit.guard';
import { CurrentSession, Session } from '../auth/session.decorator';

/**
 * What the extension talks to.
 *
 * No `OrgGuard` here, and no `x-organisation-id` header. The extension runs
 * on a customer's own pages and knows one thing: which site environment it
 * is on, from `/resolve`. Which organisation that belongs to is derived from
 * the environment, not asserted by the caller — see
 * `SitesService.authoriseEnvironment`.
 */
@Controller('editing')
@UseGuards(RateLimitGuard)
export class EditingController {
  constructor(private readonly editing: EditingService) {}

  /** Read a source file for the in-browser editor. */
  @Get('file')
  @RateLimit('read')
  file(@Session() session: CurrentSession, @Query() query: ReadFileQueryDto) {
    return this.editing.readFile(session.userId, query.environmentId, query.path, query.ref);
  }

  @Get('branches')
  @RateLimit('read')
  branches(@Session() session: CurrentSession, @Query() query: BranchesQueryDto) {
    return this.editing.listBranches(session.userId, query.environmentId);
  }

  /**
   * How stale is this preview?
   *
   * Always answers, even when the commit cannot be resolved — a commit the
   * provider has never heard of *is* the answer, and a 500 here would make
   * the extension look broken on a perfectly editable page.
   */
  @Get('preview-status')
  @RateLimit('read')
  previewStatus(@Session() session: CurrentSession, @Query() query: PreviewStatusQueryDto) {
    return this.editing.previewStatus(
      session.userId,
      query.environmentId,
      query.commit,
      query.branch,
    );
  }

  /**
   * Suggest where a piece of unannotated text might live.
   *
   * A separate step from opening a change request on purpose: the caller
   * shows these to the editor and sends back the one they confirmed.
   * Nothing is written on the strength of a guess.
   */
  @Post('locate')
  @RateLimit('search')
  locate(@Session() session: CurrentSession, @Body() dto: LocateDto) {
    return this.editing.locate(session.userId, dto.environmentId, dto.text, dto.ref);
  }

  /** The main event: edits in, change request out. */
  @Post('change-requests')
  @RateLimit('write')
  createChangeRequest(
    @Session() session: CurrentSession,
    @Body() dto: CreateChangeRequestDto,
  ) {
    return this.editing.createChangeRequest(session.userId, session.displayName, dto);
  }

  @Post('issues')
  @RateLimit('write')
  createIssue(@Session() session: CurrentSession, @Body() dto: CreateIssueDto) {
    return this.editing.createIssue(session.userId, session.displayName, dto);
  }
}
