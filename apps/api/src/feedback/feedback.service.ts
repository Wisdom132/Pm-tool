import { Injectable, NotFoundException } from '@nestjs/common';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackQueryDto, PromoteFeedbackDto, SetFeedbackStatusDto } from './dto';

const DEFAULT_LIMIT = 25;

/**
 * The feedback inbox.
 *
 * **Scope note.** This is the dashboard half of P3 only — reading, triaging
 * and resolving. The *collector* — a public endpoint accepting comments and
 * screenshots from unauthenticated visitors — is P3.1/P3.5 and is
 * deliberately not here: it needs rate limiting, size caps, spam handling
 * and a way to turn it off, and shipping the ingest without those is how the
 * first flood happens.
 *
 * So nothing creates a `Feedback` row yet except the extension, once it is
 * wired.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly feedback: FeedbackRepository) {}

  async list(organisationId: string, query: FeedbackQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;

    const [rows, counts] = await Promise.all([
      this.feedback.list({
        organisationId,
        status: query.status,
        siteId: query.siteId,
        before: query.cursor,
        limit,
      }),
      this.feedback.countsByStatus(organisationId),
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
}>(item: T) {
  const { authorName, authorEmail, authorUser, ...rest } = item;

  return {
    ...rest,
    author: {
      name: authorUser?.name ?? authorName ?? null,
      email: authorUser?.email ?? authorEmail ?? null,
      userId: authorUser?.id ?? null,
      /** False for a public submission, which is not to be trusted as identity. */
      verified: Boolean(authorUser),
    },
  };
}
