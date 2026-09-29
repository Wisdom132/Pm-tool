import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganisationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(id: string) {
    return this.prisma.organisation.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: {
          select: { sites: true, memberships: true, connections: true, teams: true },
        },
      },
    });
  }

  rename(params: { id: string; userId: string; from: string; to: string }) {
    return this.prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.update({
        where: { id: params.id },
        data: { name: params.to },
        select: { id: true, name: true, slug: true },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.id,
          actorUserId: params.userId,
          action: 'organisation.renamed',
          subject: params.to,
          detail: { from: params.from, to: params.to },
        },
      });

      return organisation;
    });
  }

  /**
   * Soft delete.
   *
   * `deletedAt` rather than a cascade, for two reasons. An accidental
   * deletion of a company's whole workspace should be recoverable for a
   * while; and the hard delete has to reach provider connections and any
   * future analytics store, which is a scheduled job, not a request.
   *
   * The audit row is written *before* the flag so it is still inside the
   * organisation's own log while that log is readable.
   */
  softDelete(params: { id: string; userId: string; name: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.auditEvent.create({
        data: {
          organisationId: params.id,
          actorUserId: params.userId,
          action: 'organisation.deleted',
          subject: params.name,
        },
      });

      // Every session for this organisation's members stays valid — a
      // person may belong to others — but OrgGuard stops resolving it,
      // because `find` filters on deletedAt.
      await tx.organisation.update({
        where: { id: params.id },
        data: { deletedAt: new Date() },
      });
    });
  }

  countLiveConnections(organisationId: string): Promise<number> {
    return this.prisma.connection.count({ where: { organisationId, revokedAt: null } });
  }
}
