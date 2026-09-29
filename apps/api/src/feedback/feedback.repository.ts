import { Injectable } from '@nestjs/common';
import { FeedbackSource, FeedbackStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const AUTHOR = { select: { id: true, name: true, email: true } } as const;

/**
 * Everything but the screenshot.
 *
 * The bytes are excluded deliberately and everywhere except
 * `readScreenshot`: a page of twenty-five comments each carrying a
 * half-megabyte image is a twelve-megabyte JSON response that nobody asked
 * for. `screenshotType` is selected instead, so a client can tell that an
 * image exists and go and fetch it.
 */
const LIST_FIELDS = {
  id: true,
  message: true,
  pageUrl: true,
  pagePath: true,
  element: true,
  sourceFile: true,
  sourceLine: true,
  authorName: true,
  authorEmail: true,
  status: true,
  promotedUrl: true,
  createdAt: true,
  resolvedAt: true,
  assignedAt: true,
  source: true,
  screenshotType: true,
  site: { select: { id: true, name: true } },
  environment: { select: { id: true, hostname: true, label: true } },
  authorUser: AUTHOR,
  resolvedBy: AUTHOR,
  assignedTo: AUTHOR,
} as const;

export interface FeedbackFilter {
  organisationId: string;
  status?: FeedbackStatus;
  siteId?: string;
  source?: FeedbackSource;
  /** A user id, or 'none' for the unassigned queue. */
  assignedToId?: string;
  before?: string;
  limit: number;
}

@Injectable()
export class FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keyset pagination on `createdAt` + `id`.
   *
   * The compound key matters: two submissions in the same millisecond are
   * ordinary for a widget on a busy page, and ordering on the timestamp
   * alone would make one of them skippable.
   */
  async list(filter: FeedbackFilter) {
    const cursor = filter.before
      ? await this.prisma.feedback.findUnique({
          where: { id: filter.before },
          select: { createdAt: true, id: true },
        })
      : null;

    const where: Prisma.FeedbackWhereInput = {
      organisationId: filter.organisationId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.siteId ? { siteId: filter.siteId } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      // 'none' is the unassigned queue — the thing a shared inbox is
      // actually opened to look at. It has to be a distinct value because
      // an absent filter means "any", and null means "nobody's".
      ...(filter.assignedToId
        ? { assignedToId: filter.assignedToId === 'none' ? null : filter.assignedToId }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    return this.prisma.feedback.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      select: LIST_FIELDS,
    });
  }

  /**
   * Record a comment.
   *
   * `organisationId` and `siteId` are taken from the resolved environment,
   * never from the caller — the same rule as editing. A comment that could
   * name its own site would let a page file feedback against somebody
   * else's.
   */
  create(input: {
    organisationId: string;
    siteId: string;
    environmentId: string | null;
    message: string;
    pageUrl: string;
    pagePath: string;
    element: string | null;
    sourceFile: string | null;
    sourceLine: number | null;
    /** Set on the extension path; null for a public submission. */
    authorUserId: string | null;
    /** Self-declared, and only on the public path. */
    authorName: string | null;
    authorEmail: string | null;
    source: FeedbackSource;
    authorIpHash: string | null;
    viewport: string | null;
    userAgent: string | null;
    screenshot: Uint8Array<ArrayBuffer> | null;
    screenshotType: string | null;
  }) {
    return this.prisma.feedback.create({
      data: input,
      select: LIST_FIELDS,
    });
  }

  find(organisationId: string, id: string) {
    return this.prisma.feedback.findFirst({
      where: { id, organisationId },
      select: { ...LIST_FIELDS, viewport: true, userAgent: true, environmentId: true },
    });
  }

  /**
   * The screenshot bytes, on their own.
   *
   * Separate from `find` so that the image is fetched only when it is going
   * to be shown. If this moves to object storage, this method becomes a
   * signed-URL lookup and no caller changes.
   */
  readScreenshot(organisationId: string, id: string) {
    return this.prisma.feedback.findFirst({
      where: { id, organisationId },
      select: { screenshot: true, screenshotType: true },
    });
  }

  /**
   * Counts for the inbox tabs.
   *
   * `mine` and `unassigned` are counted alongside the statuses because they
   * are the two questions somebody opening a shared inbox is actually
   * asking, and a tab with no number on it is a tab nobody clicks.
   */
  async countsByStatus(organisationId: string, userId: string) {
    const [rows, mine, unassigned] = await Promise.all([
      this.prisma.feedback.groupBy({
        by: ['status'],
        where: { organisationId },
        _count: { _all: true },
      }),
      // Resolved work is not on anybody's plate, so it does not count
      // towards "mine" — otherwise the number only ever grows.
      this.prisma.feedback.count({
        where: {
          organisationId,
          assignedToId: userId,
          status: { not: FeedbackStatus.resolved },
        },
      }),
      this.prisma.feedback.count({
        where: {
          organisationId,
          assignedToId: null,
          status: { not: FeedbackStatus.resolved },
        },
      }),
    ]);

    const counts: Record<string, number> = {
      new: 0,
      triaged: 0,
      resolved: 0,
      mine,
      unassigned,
    };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  }

  /**
   * Hand a comment to someone, or put it back down.
   *
   * The membership check is part of the same transaction as the write. Done
   * as a read in the service and a write here, a user removed from the
   * organisation in between would end up holding feedback they can no
   * longer see — so the check and the write have to be one unit of work.
   *
   * @param assigneeId a user id, or null to unassign
   */
  assign(params: {
    organisationId: string;
    userId: string;
    id: string;
    assigneeId: string | null;
    subject: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      if (params.assigneeId) {
        const member = await tx.memberships.findFirst({
          where: { organisationId: params.organisationId, userId: params.assigneeId },
          select: { userId: true },
        });
        if (!member) return null;
      }

      const updated = await tx.feedback.update({
        where: { id: params.id },
        data: {
          assignedToId: params.assigneeId,
          assignedAt: params.assigneeId ? new Date() : null,
        },
        select: LIST_FIELDS,
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: params.assigneeId ? 'feedback.assigned' : 'feedback.unassigned',
          subject: params.subject,
          ...(params.assigneeId ? { detail: { assigneeId: params.assigneeId } } : {}),
        },
      });

      return updated;
    });
  }

  setStatus(params: {
    organisationId: string;
    userId: string;
    id: string;
    status: FeedbackStatus;
    subject: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.feedback.update({
        where: { id: params.id },
        data: {
          status: params.status,
          // Stamped only on the way in to `resolved`, and cleared on the way
          // out, so "who resolved this" cannot outlive the resolution.
          resolvedAt: params.status === FeedbackStatus.resolved ? new Date() : null,
          resolvedById: params.status === FeedbackStatus.resolved ? params.userId : null,
        },
        select: LIST_FIELDS,
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: `feedback.${params.status}`,
          subject: params.subject,
        },
      });

      return updated;
    });
  }

  /** Record that a comment became an issue or a change request. */
  setPromoted(params: {
    organisationId: string;
    userId: string;
    id: string;
    url: string;
    subject: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.feedback.update({
        where: { id: params.id },
        data: { promotedUrl: params.url, status: FeedbackStatus.triaged },
        select: LIST_FIELDS,
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'feedback.promoted',
          subject: params.subject,
          detail: { url: params.url },
        },
      });

      return updated;
    });
  }

  remove(params: { organisationId: string; userId: string; id: string; subject: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.feedback.delete({ where: { id: params.id } });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'feedback.deleted',
          subject: params.subject,
        },
      });
    });
  }
}
