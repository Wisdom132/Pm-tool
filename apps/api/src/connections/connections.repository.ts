import { Injectable } from '@nestjs/common';
import { Provider, type Connection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every database call for connections.
 *
 * The rule this file exists to hold: services decide, repositories persist.
 * `ConnectionsService` never touches Prisma, so what a connection *is* in
 * the database — which columns, which transaction, which fields are safe to
 * return — is decided in one place.
 *
 * Because `prisma.$transaction` is itself a database call, each method here
 * is a *complete* unit of work, including any audit row that has to land
 * atomically with the change. That is why `recordGithubInstall` writes the
 * audit event rather than leaving it to `AuditRepository`: a connection
 * nothing recorded granting is precisely the gap an audit log exists to
 * close.
 */

/** What the connections list needs, minus anything secret. */
const LIST_FIELDS = {
  id: true,
  provider: true,
  accountLogin: true,
  externalId: true,
  baseUrl: true,
  createdAt: true,
  revokedAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
  _count: { select: { environments: true } },
} as const;

export interface InstallRecord {
  organisationId: string;
  userId: string;
  installationId: string;
  accountLogin: string;
  repositoryCount: number | null;
  setupAction?: string;
}

@Injectable()
export class ConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForOrganisation(organisationId: string) {
    return this.prisma.connection.findMany({
      where: { organisationId },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      // The credentials column is excluded here rather than stripped later.
      // No endpoint needs it, so the query is the cheapest place to make
      // returning it impossible.
      select: LIST_FIELDS,
    });
  }

  /** Live connections only, scoped to the organisation. Null if neither holds. */
  findActive(organisationId: string, id: string): Promise<Connection | null> {
    return this.prisma.connection.findFirst({
      where: { id, organisationId, revokedAt: null },
    });
  }

  /** Includes revoked ones, and how many sites depend on it. */
  findWithDependantCount(organisationId: string, id: string) {
    return this.prisma.connection.findFirst({
      where: { id, organisationId },
      include: { _count: { select: { environments: true } } },
    });
  }

  /**
   * Record a finished GitHub App install.
   *
   * An upsert, not a create: reinstalling produces a new grant against an
   * installation id we may already hold, and a second live row for the same
   * account would leave sites pointing at whichever was found first.
   * Reinstalling also un-revokes, so a dead row that sites still reference
   * cannot accumulate.
   */
  recordGithubInstall(record: InstallRecord) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.connection.findUnique({
        where: {
          organisationId_provider_externalId: {
            organisationId: record.organisationId,
            provider: Provider.github,
            externalId: record.installationId,
          },
        },
      });

      const connection = existing
        ? await tx.connection.update({
            where: { id: existing.id },
            data: { accountLogin: record.accountLogin, revokedAt: null },
          })
        : await tx.connection.create({
            data: {
              organisationId: record.organisationId,
              provider: Provider.github,
              accountLogin: record.accountLogin,
              externalId: record.installationId,
              createdById: record.userId,
              // Null on purpose: a GitHub App install has no per-customer
              // secret to keep. Tokens are minted from our App key against
              // the installation id, which is not sensitive.
              credentials: null,
            },
          });

      await tx.auditEvent.create({
        data: {
          organisationId: record.organisationId,
          actorUserId: record.userId,
          action: existing ? 'connection.reconnected' : 'connection.created',
          subject: `github · ${record.accountLogin}`,
          detail: {
            installationId: record.installationId,
            repositories: record.repositoryCount,
            setupAction: record.setupAction ?? null,
          },
        },
      });

      return { connection, reconnected: Boolean(existing) };
    });
  }

  /**
   * Mark a connection revoked and drop its stored credentials.
   *
   * Cleared rather than kept for a possible undo: a revoked connection still
   * holding a live token is the thing a revoke is supposed to remove.
   */
  revoke(params: { organisationId: string; userId: string; id: string; subject: string }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.connection.update({
        where: { id: params.id },
        data: { revokedAt: new Date(), credentials: null },
      });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'connection.revoked',
          subject: params.subject,
        },
      });

      return updated;
    });
  }
}
