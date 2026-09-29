import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeedbackSource } from '@prisma/client';
import { LIMITS, hit } from '../common/rate-limit';
import { FeedbackRepository } from './feedback.repository';
import { SitesService } from '../sites/sites.service';
import { ProvidersService } from '../providers/providers.service';
import { assertSourcePath } from '../editing/source-path';
import { ScreenshotRejected, decodeScreenshot, urlMatchesHostname } from './intake';
import { issueBody, issueTitle } from './issue-body';
import {
  AssignFeedbackDto,
  CreateFeedbackDto,
  FeedbackQueryDto,
  PromoteFeedbackDto,
  PublicFeedbackDto,
  SetFeedbackStatusDto,
} from './dto';

const DEFAULT_LIMIT = 25;

/** Context read off the request, never off the body. */
export interface RequestContext {
  userAgent: string | null;
  ipHash: string | null;
}

/**
 * The feedback inbox, and the two ways into it.
 *
 * **The extension path** is an authenticated editor whose session proves
 * both who they are and which sites they can reach. Everything about a
 * comment is derived from that session and the environment it names.
 *
 * **The public path** (`submitPublic`) has none of that. The author is
 * whoever loaded the page, the name on the comment is whatever they typed,
 * and the only thing standing between it and a flood is the set of gates in
 * `resolvePublic` and `intake.ts`. The two are kept as separate methods
 * rather than one with a flag, because every difference between them is a
 * trust decision and collapsing them is how one of those gets lost.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly feedback: FeedbackRepository,
    private readonly sites: SitesService,
    private readonly providers: ProvidersService,
  ) {}

  /**
   * Leave a comment from the extension.
   *
   * Goes through `authoriseEnvironment`, the same check editing uses, so a
   * comment can only be filed against a site the caller's teams cover — and
   * the organisation and site are derived from it rather than sent.
   */
  async create(userId: string, dto: CreateFeedbackDto, context: RequestContext) {
    const { environment } = await this.sites.authoriseEnvironment(userId, dto.environmentId);

    const created = await this.feedback.create({
      organisationId: environment.organisationId,
      siteId: environment.siteId,
      environmentId: environment.id,
      message: dto.message.trim(),
      pageUrl: dto.pageUrl,
      pagePath: pathOf(dto.pageUrl),
      element: dto.element ?? null,
      ...sourceOf(dto),
      authorUserId: userId,
      authorName: null,
      authorEmail: null,
      source: FeedbackSource.extension,
      authorIpHash: null,
      viewport: dto.viewport ?? null,
      // From the header, not the body. See `readUserAgent`.
      userAgent: context.userAgent,
      ...screenshotOf(dto.screenshot),
    });

    return describe(created);
  }

  /**
   * A comment from the public widget, with no account behind it.
   *
   * Everything the extension path takes from a session has to be
   * established here instead, and every one of these is load-bearing:
   *
   * - the site is found by hostname, and only if it verified its domain and
   *   switched the widget on (`resolvePublic`);
   * - the page URL must actually be on that hostname, or a comment could be
   *   filed against a real site while naming any URL at all;
   * - `sourceFile` is validated the same way, because it arrives from a page
   *   we do not control on both paths;
   * - the author is recorded as free text and marked unverified, never
   *   attached to a `User`.
   *
   * Rate limiting is the controller's job, by IP, before this is reached.
   */
  async submitPublic(dto: PublicFeedbackDto, context: RequestContext) {
    const hostname = hostOf(dto.pageUrl);
    if (!hostname) throw new BadRequestException('That page URL is not valid.');

    const site = await this.sites.resolvePublic(hostname);

    // One message for "not registered", "not verified" and "widget off". An
    // anonymous caller should not be able to tell them apart.
    if (!site) {
      throw new NotFoundException('This site is not accepting feedback.');
    }

    if (!urlMatchesHostname(dto.pageUrl, site.hostname)) {
      throw new BadRequestException('That page URL is not valid.');
    }

    // The per-address limit in the guard does nothing against a flood spread
    // across many addresses. This one can only be applied here, because the
    // site is not known until the hostname has been resolved.
    const perSite = hit('feedbackSite', site.siteId, LIMITS.feedbackSite);
    if (!perSite.allowed) {
      throw new HttpException(
        'This site is not accepting feedback right now. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const created = await this.feedback.create({
      organisationId: site.organisationId,
      siteId: site.siteId,
      environmentId: site.environmentId,
      message: dto.message.trim(),
      pageUrl: dto.pageUrl,
      pagePath: pathOf(dto.pageUrl),
      element: dto.element ?? null,
      ...sourceOf(dto),
      authorUserId: null,
      authorName: dto.authorName?.trim() || null,
      authorEmail: dto.authorEmail?.trim() || null,
      source: FeedbackSource.widget,
      authorIpHash: context.ipHash,
      viewport: dto.viewport ?? null,
      userAgent: context.userAgent,
      ...screenshotOf(dto.screenshot),
    });

    // Deliberately thin. The submitter is anonymous and has no business
    // reading back the organisation, the site, or the id of a record they
    // cannot fetch.
    return { received: true, id: created.id };
  }

  async list(organisationId: string, userId: string, query: FeedbackQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;

    const [rows, counts] = await Promise.all([
      this.feedback.list({
        organisationId,
        status: query.status,
        siteId: query.siteId,
        source: query.source,
        // 'me' is resolved here rather than in the client, so a caller
        // cannot ask for somebody else's queue by guessing a user id.
        assignedToId: query.assignedTo === 'me' ? userId : query.assignedTo,
        before: query.cursor,
        limit,
      }),
      this.feedback.countsByStatus(organisationId, userId),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map(describe),
      counts,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async get(organisationId: string, id: string) {
    const item = await this.feedback.find(organisationId, id);
    if (!item) throw new NotFoundException('No such feedback.');
    return describe(item);
  }

  async setStatus(
    organisationId: string,
    userId: string,
    id: string,
    dto: SetFeedbackStatusDto,
  ) {
    const existing = await this.get(organisationId, id);

    const updated = await this.feedback.setStatus({
      organisationId,
      userId,
      id,
      status: dto.status,
      subject: existing.pagePath,
    });

    return describe(updated);
  }

  /**
   * Hand a comment to someone, or put it back down.
   *
   * `assigneeId: null` unassigns. The membership check happens inside the
   * repository transaction, so someone removed from the organisation
   * mid-request cannot end up holding feedback they can no longer see.
   */
  async assign(organisationId: string, userId: string, id: string, dto: AssignFeedbackDto) {
    const existing = await this.get(organisationId, id);

    const updated = await this.feedback.assign({
      organisationId,
      userId,
      id,
      assigneeId: dto.assigneeId ?? null,
      subject: existing.pagePath,
    });

    if (!updated) {
      throw new BadRequestException('That person is not a member of this organisation.');
    }

    return describe(updated);
  }

  /**
   * The screenshot bytes, for the dashboard to render.
   *
   * @returns null when there is none, which the controller turns into a 404
   *          rather than an empty image.
   */
  async screenshot(organisationId: string, id: string) {
    const found = await this.feedback.readScreenshot(organisationId, id);
    if (!found?.screenshot || !found.screenshotType) return null;

    return { bytes: found.screenshot, type: found.screenshotType };
  }

  /**
   * Turn a comment into an issue on the repository behind its site.
   *
   * This is the step the inbox existed without: previously somebody read the
   * comment, went to GitHub, wrote the issue by hand, came back and pasted
   * the link. Everything they were retyping — the page, the element, the
   * source file and line — is already attached to the comment.
   *
   * The comment is marked promoted only *after* the issue exists. If the
   * provider call fails, nothing is recorded, so a retry is safe and does
   * not leave the inbox claiming an issue that was never opened.
   */
  async createIssue(organisationId: string, userId: string, id: string, webBaseUrl?: string) {
    const existing = await this.get(organisationId, id);

    if (existing.promotedUrl) {
      throw new BadRequestException(
        `This comment has already been promoted: ${existing.promotedUrl}`,
      );
    }

    // A comment from a page whose environment has since been deleted has
    // nothing to open an issue against.
    if (!existing.environmentId) {
      throw new BadRequestException(
        'This comment is not linked to a site environment, so there is no repository to open an issue on.',
      );
    }

    const { provider } = await this.providers.openForEnvironment(
      organisationId,
      existing.environmentId,
    );

    const forIssue = {
      message: existing.message,
      pageUrl: existing.pageUrl,
      pagePath: existing.pagePath,
      element: existing.element,
      sourceFile: existing.sourceFile,
      sourceLine: existing.sourceLine,
      viewport: existing.viewport ?? null,
      userAgent: existing.userAgent ?? null,
      createdAt: existing.createdAt,
      source: existing.source,
      author: existing.author,
    };

    const issue = await provider.openIssue({
      title: issueTitle(forIssue),
      body: issueBody(forIssue, webBaseUrl ? `${webBaseUrl}/feedback/${existing.id}` : undefined),
      labels: ['inline-edit'],
    });

    const updated = await this.feedback.setPromoted({
      organisationId,
      userId,
      id,
      url: issue.url,
      subject: existing.pagePath,
    });

    return describe(updated);
  }

  async promote(organisationId: string, userId: string, id: string, dto: PromoteFeedbackDto) {
    const existing = await this.get(organisationId, id);

    const updated = await this.feedback.setPromoted({
      organisationId,
      userId,
      id,
      url: dto.url,
      subject: existing.pagePath,
    });

    return describe(updated);
  }

  async remove(organisationId: string, userId: string, id: string) {
    const existing = await this.get(organisationId, id);
    await this.feedback.remove({ organisationId, userId, id, subject: existing.pagePath });
    return { removed: true };
  }
}

/**
 * One shape for the list and the detail view.
 *
 * `author` collapses the two ways a comment can be attributed — a signed-in
 * user, or free text from a public widget — so the client does not have to
 * know which it was.
 */
function describe<T extends {
  id: string;
  authorName: string | null;
  authorEmail: string | null;
  authorUser: { id: string; name: string | null; email: string } | null;
  screenshotType: string | null;
}>(item: T) {
  const { authorName, authorEmail, authorUser, screenshotType, ...rest } = item;

  return {
    ...rest,
    /**
     * The bytes are never inlined — a page of twenty-five comments each
     * carrying a half-megabyte image is a response nobody asked for. This
     * says only that there is one to fetch.
     */
    hasScreenshot: Boolean(screenshotType),
    author: {
      name: authorUser?.name ?? authorName ?? null,
      email: authorUser?.email ?? authorEmail ?? null,
      userId: authorUser?.id ?? null,
      /** False for a public submission, which is not to be trusted as identity. */
      verified: Boolean(authorUser),
    },
  };
}

/**
 * The path alone, for grouping comments by page.
 *
 * A malformed URL should not be what rejects somebody's comment, so it falls
 * back to the whole string.
 */
function pathOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname || '/';
  } catch {
    return pageUrl.slice(0, 200);
  }
}

/** The hostname, or null when the URL is not one. */
function hostOf(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The build annotation, validated.
 *
 * It arrives from a page we do not control on both paths. An invalid path is
 * dropped rather than rejected: the comment is still worth keeping, it just
 * loses the source link. The line goes with it — a line number without a
 * file points at nothing.
 */
function sourceOf(dto: { sourceFile?: string; sourceLine?: number }) {
  if (!dto.sourceFile) return { sourceFile: null, sourceLine: null };

  try {
    return {
      sourceFile: assertSourcePath(dto.sourceFile),
      sourceLine: dto.sourceLine ?? null,
    };
  } catch {
    return { sourceFile: null, sourceLine: null };
  }
}

/**
 * The screenshot, decoded and vetted.
 *
 * A bad image is rejected outright rather than dropped, because unlike the
 * source path it is something the sender chose to attach: silently storing
 * the comment without it would look like it worked.
 */
function screenshotOf(dataUrl: string | undefined) {
  if (!dataUrl) return { screenshot: null, screenshotType: null };

  try {
    const { bytes, type } = decodeScreenshot(dataUrl);
    return { screenshot: bytes, screenshotType: type };
  } catch (err) {
    if (err instanceof ScreenshotRejected) throw new BadRequestException(err.message);
    throw err;
  }
}
