import { Injectable } from '@nestjs/common';
import { AuditRepository } from './audit.repository';
import { AuditQueryDto } from './dto';

const DEFAULT_LIMIT = 50;

@Injectable()
export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  async list(organisationId: string, query: AuditQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;

    const rows = await this.audit.list({
      organisationId,
      before: query.cursor ? BigInt(query.cursor) : undefined,
      limit,
      action: query.action,
    });

    // The repository fetched one extra to tell us whether more exist.
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      // BigInt is not JSON-serialisable, so ids cross the wire as strings.
      events: page.map((e) => ({
        id: String(e.id),
        action: e.action,
        subject: e.subject,
        detail: e.detail,
        createdAt: e.createdAt,
        // An actor can be null: the row outlives the user, deliberately —
        // deleting someone must not erase what they did.
        actor: e.actor
          ? { id: e.actor.id, name: e.actor.name, email: e.actor.email }
          : null,
      })),
      nextCursor: hasMore ? String(page[page.length - 1].id) : null,
    };
  }

  actions(organisationId: string) {
    return this.audit.actions(organisationId);
  }
}
