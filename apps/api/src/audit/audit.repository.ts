import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditQuery {
  organisationId: string;
  /** Opaque cursor: the id of the last row from the previous page. */
  before?: bigint;
  limit: number;
  action?: string;
}

/**
 * Reading the audit log.
 *
 * Writes live in the repository that owns the change being recorded, so that
 * each lands in the same transaction. This is the only reader.
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keyset pagination on the autoincrement id, not `skip`/`take`.
   *
   * An offset into a table that is being appended to shifts under the
   * reader: page two re-shows a row from page one every time a new event
   * lands mid-read, which for an audit log is worse than useless.
   */
  list(query: AuditQuery) {
    return this.prisma.auditEvent.findMany({
      where: {
        organisationId: query.organisationId,
        ...(query.action ? { action: query.action } : {}),
        ...(query.before ? { id: { lt: query.before } } : {}),
      },
      orderBy: { id: 'desc' },
      // One extra, to learn whether another page exists without a count.
      take: query.limit + 1,
      select: {
        id: true,
        action: true,
        subject: true,
        detail: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /** The distinct actions present, for a filter dropdown. */
  async actions(organisationId: string): Promise<string[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { organisationId },
      distinct: ['action'],
      orderBy: { action: 'asc' },
      select: { action: true },
    });
    return rows.map((r) => r.action);
  }

  /** Standalone audit rows — those with nothing to be atomic with. */
  record(params: {
    organisationId: string;
    actorUserId: string | null;
    action: string;
    subject?: string;
    detail?: Record<string, unknown>;
  }) {
    return this.prisma.auditEvent.create({
      data: {
        organisationId: params.organisationId,
        actorUserId: params.actorUserId,
        action: params.action,
        subject: params.subject,
        detail: (params.detail ?? {}) as object,
      },
    });
  }
}
