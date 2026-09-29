import { Injectable } from '@nestjs/common';
import { FeedbackStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const AUTHOR = { select: { id: true, name: true, email: true } } as const;

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
  site: { select: { id: true, name: true } },
  environment: { select: { id: true, hostname: true, label: true } },
  authorUser: AUTHOR,
  resolvedBy: AUTHOR,
} as const;

export interface FeedbackFilter {
  organisationId: string;
  status?: FeedbackStatus;
  siteId?: string;
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
    environmentId: string;
    message: string;
    pageUrl: string;
    pagePath: string;
    element: string | null;
    sourceFile: string | null;
    sourceLine: number | null;
    authorUserId: string;
    viewport: string | null;
    userAgent: string | null;
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

  /** Counts per status, for the inbox tabs. */
  async countsByStatus(organisationId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.feedback.groupBy({
      by: ['status'],
      where: { organisationId },
      _count: { _all: true },
    });

    const counts: Record<string, number> = { new: 0, triaged: 0, resolved: 0 };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
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
