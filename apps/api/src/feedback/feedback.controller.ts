import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FeedbackService, type RequestContext } from './feedback.service';
import {
  AssignFeedbackDto,
  CreateFeedbackDto,
  FeedbackQueryDto,
  PromoteFeedbackDto,
  PublicFeedbackDto,
  SetFeedbackStatusDto,
} from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { CurrentSession, Session } from '../auth/session.decorator';
import { Public } from '../auth/public.decorator';
import { clientIp, hashIp, readUserAgent } from './intake';

/**
 * Context taken from the request itself, never from the body.
 *
 * `userAgent` because a client that declares its own browser can declare
 * any browser; the address because it is the only handle on an anonymous
 * submitter, and it is hashed immediately so what is stored is a handle
 * rather than personal data about a visitor who never signed up for
 * anything.
 */
function contextOf(request: Request): RequestContext {
  const secret = process.env.SESSION_SECRET ?? 'inline-edit-dev';
  const trustProxy = process.env.TRUST_PROXY === '1';
  const ip = clientIp(request.headers, request.socket?.remoteAddress, trustProxy);

  return {
    userAgent: readUserAgent(request.headers),
    ipHash: hashIp(ip, secret),
  };
}

/**
 * Not admin-only: triaging feedback is the job an editor is here to do.
 */
@Controller('feedback')
@UseGuards(OrgGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Query() query: FeedbackQueryDto,
  ) {
    return this.feedback.list(org.organisationId, s.userId, query);
  }

  @Get(':id')
  get(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedback.get(org.organisationId, id);
  }

  /**
   * The screenshot, as an image.
   *
   * Its own route rather than a field on the comment, so the bytes are
   * fetched only when they are going to be shown, and so the browser can
   * cache them.
   */
  @Get(':id/screenshot')
  // Private: the image is scoped to one organisation, and a shared cache
  // storing it would serve it to whoever asked next.
  @Header('Cache-Control', 'private, max-age=3600')
  // The screenshot is a picture of a customer's page, and it is served from
  // our origin. These stop it being framed, sniffed into something
  // executable, or rendered as a document.
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  async screenshot(
    @Org() org: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const image = await this.feedback.screenshot(org.organisationId, id);
    if (!image) throw new NotFoundException('No screenshot for this feedback.');

    res.setHeader('Content-Type', image.type);
    res.setHeader('Content-Length', String(image.bytes.byteLength));
    res.end(Buffer.from(image.bytes));
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

  /** Hand it to someone, or put it back down with `{ "assigneeId": null }`. */
  @Patch(':id/assignee')
  assign(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignFeedbackDto,
  ) {
    return this.feedback.assign(org.organisationId, s.userId, id, dto);
  }

  /**
   * Open an issue on the repository behind this comment's site.
   *
   * Distinct from `promote`, which records a link to an issue somebody
   * created elsewhere. This one writes it, carrying the page, the element
   * and the source line across — the context that was being retyped by
   * hand.
   */
  @Post(':id/issue')
  @UseGuards(RateLimitGuard)
  @RateLimit('write')
  createIssue(
    @Org() org: OrgContext,
    @Session() s: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.feedback.createIssue(org.organisationId, s.userId, id, process.env.WEB_URL);
  }

  /** Record that this comment became an issue or a change request elsewhere. */
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
  create(
    @Session() session: CurrentSession,
    @Body() dto: CreateFeedbackDto,
    @Req() request: Request,
  ) {
    return this.feedback.create(session.userId, dto, contextOf(request));
  }
}

/**
 * The public widget's endpoint.
 *
 * The only route in this system an unauthenticated stranger can reach, and
 * it accepts an image. What stands between it and abuse, in order:
 *
 * 1. **`@Public()`** — no session, by design. Everything below replaces one.
 * 2. **A per-address rate limit**, applied by the guard before the body is
 *    looked at.
 * 3. **Validation caps** — 5,000 characters of message, and a screenshot
 *    limit enforced on the decoded length, not the base64 string.
 * 4. **The site must have verified its domain and switched the widget on.**
 *    Both off by default. This is the off switch: one flag, effective
 *    immediately, no deploy on the customer's side.
 * 5. **A per-site rate limit**, in the service, because a flood spread over
 *    many addresses defeats the per-address one.
 * 6. **Magic-byte checking** on the image, so the endpoint cannot be used to
 *    host arbitrary content on our origin.
 *
 * Its own path rather than a mode on `POST /feedback`, so that no change to
 * the authenticated route can accidentally widen this one.
 */
@Controller('public/feedback')
@UseGuards(RateLimitGuard)
export class PublicFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @Public()
  @RateLimit('feedbackIp')
  submit(@Body() dto: PublicFeedbackDto, @Req() request: Request) {
    return this.feedback.submitPublic(dto, contextOf(request));
  }
}
