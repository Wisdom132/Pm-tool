import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every database call for sites and their environments.
 *
 * Each method takes `organisationId` and filters on it. Not because the
 * guard above is untrusted, but because a query that *can* run without a
 * tenant is one refactor away from running without one — and the failure
 * mode is one customer reading another customer's source.
 */

/** Enough to render a site row without a second query. */
const SITE_SUMMARY = {
  select: { id: true, name: true, verifiedAt: true, feedbackWidget: true },
} as const;
const CONNECTION_SUMMARY = {
  select: { id: true, provider: true, accountLogin: true },
} as const;

export interface RegisterSite {
  organisationId: string;
  userId: string;
  name: string;
  hostname: string;
  label: string;
  repository: string;
  branch: string | null;
  connectionId: string;
  verificationToken: string;
}

@Injectable()
export class SitesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForOrganisation(organisationId: string) {
    return this.prisma.siteEnvironment.findMany({
      where: { organisationId },
      orderBy: [{ label: 'asc' }, { hostname: 'asc' }],
      include: { site: SITE_SUMMARY, connection: CONNECTION_SUMMARY },
    });
  }

  findEnvironment(organisationId: string, id: string) {
    return this.prisma.siteEnvironment.findFirst({
      where: { id, organisationId },
      include: { site: true, connection: CONNECTION_SUMMARY },
    });
  }

  /** With the whole connection, for opening a provider against it. */
  findEnvironmentWithConnection(organisationId: string, id: string) {
    return this.prisma.siteEnvironment.findFirst({
      where: { id, organisationId },
      include: { connection: true },
    });
  }

  /**
   * One environment, reachable only through the caller's own memberships.
   *
   * The membership join is in the query rather than a check afterwards. The
   * alternative — fetch by id, then compare organisations in application
   * code — is the shape that leaks a row on the one path where somebody
   * forgets the second step, and this is the lookup the extension hits on
   * every edit.
   */
  findEnvironmentForUser(userId: string, id: string) {
    return this.prisma.siteEnvironment.findFirst({
      where: { id, organisation: { memberships: { some: { userId } } } },
      include: {
        connection: true,
        site: { select: { id: true, name: true, verifiedAt: true, feedbackWidget: true } },
      },
    });
  }

  findByHostname(organisationId: string, hostname: string) {
    return this.prisma.siteEnvironment.findFirst({ where: { organisationId, hostname } });
  }

  /**
   * Every environment across a set of organisations.
   *
   * Reads wide on purpose. Hostname matching is a wildcard problem with a
   * precedence rule ("most specific wins"), and pushing it into SQL would
   * mean either a LIKE per candidate pattern or the same rule implemented
   * twice — once here and once in `hostname.ts`, where it is tested.
   */
  listForOrganisations(organisationIds: string[]) {
    return this.prisma.siteEnvironment.findMany({
      where: { organisationId: { in: organisationIds } },
      include: {
        site: SITE_SUMMARY,
        connection: { select: { provider: true, accountLogin: true, baseUrl: true } },
      },
    });
  }

  /**
   * Environments matching a hostname, with no user in the picture.
   *
   * For the public widget only, where there is no session to scope the
   * search to. It is deliberately narrow: an exact hostname hit, plus the
   * wildcard patterns, rather than every environment in the system — the
   * caller is anonymous and this must not become a way to enumerate which
   * hostnames are registered.
   *
   * Soft-deleted sites are excluded here rather than by the caller, so a
   * deleted site stops collecting the moment it is deleted.
   */
  async findPublicCandidates(hostname: string) {
    const select = {
      id: true,
      siteId: true,
      organisationId: true,
      hostname: true,
      label: true,
      site: { select: { id: true, name: true, feedbackWidget: true, verifiedAt: true } },
    } as const;

    const exact = await this.prisma.siteEnvironment.findMany({
      where: { hostname, site: { deletedAt: null } },
      select,
    });
    if (exact.length) return exact;

    // Wildcards cannot be matched in SQL against the registry's one-label
    // rule, so they are filtered in `bestMatch`. There are few of them.
    return this.prisma.siteEnvironment.findMany({
      where: { hostname: { startsWith: '*.' }, site: { deletedAt: null } },
      select,
    });
  }

  /** Whether any team this user belongs to grants access to a site. */
  async userReachesSiteViaTeam(userId: string, siteId: string): Promise<boolean> {
    const grant = await this.prisma.teamSite.findFirst({
      where: { siteId, team: { members: { some: { userId } } } },
      select: { teamId: true },
    });
    return grant !== null;
  }

  /**
   * Register a site and its first environment.
   *
   * One transaction across four tables, because a partial registration is
   * worse than none: a `site` with no environment is invisible in the
   * dashboard but still occupies its hostname, and an environment the
   * default team cannot reach is a site whose own editors are told it is
   * not registered.
   */
  registerSite(input: RegisterSite) {
    return this.prisma.$transaction(async (tx) => {
      const site = await tx.site.create({
        data: {
          organisationId: input.organisationId,
          name: input.name,
          verificationToken: input.verificationToken,
        },
      });

      const environment = await tx.siteEnvironment.create({
        data: {
          siteId: site.id,
          organisationId: input.organisationId,
          connectionId: input.connectionId,
          hostname: input.hostname,
          label: input.label,
          repository: input.repository,
          branch: input.branch,
        },
        include: { site: true, connection: CONNECTION_SUMMARY },
      });

      // "Everyone" is how an editor reaches a new site at all. Its absence
      // is not an error — an organisation may have deleted it — but a site
      // created without it is visible only to admins.
      const defaultTeam = await tx.team.findFirst({
        where: { organisationId: input.organisationId, isDefault: true },
        select: { id: true },
      });
      if (defaultTeam) {
        await tx.teamSite.create({ data: { teamId: defaultTeam.id, siteId: site.id } });
      }

      await tx.auditEvent.create({
        data: {
          organisationId: input.organisationId,
          actorUserId: input.userId,
          action: 'site.registered',
          subject: input.hostname,
          detail: { repository: input.repository, branch: input.branch },
        },
      });

      return environment;
    });
  }

  /**
   * Change a branch and/or a display name.
   *
   * `branchChange` is passed in rather than derived here: the caller has
   * already read the row to authorise the change, and re-reading it would
   * race with a concurrent update.
   */
  updateEnvironment(params: {
    organisationId: string;
    userId: string;
    id: string;
    hostname: string;
    branch?: string | null;
    name?: string;
    feedbackWidget?: boolean;
    branchChange: { from: string | null; to: string | null } | null;
    widgetChange: boolean | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.siteEnvironment.update({
        where: { id: params.id },
        data: {
          ...(params.branch !== undefined ? { branch: params.branch } : {}),
          ...(params.name || params.feedbackWidget !== undefined
            ? {
                site: {
                  update: {
                    ...(params.name ? { name: params.name } : {}),
                    ...(params.feedbackWidget !== undefined
                      ? { feedbackWidget: params.feedbackWidget }
                      : {}),
                  },
                },
              }
            : {}),
        },
        include: { site: true },
      });

      // Re-pointing a branch decides where every future edit on this
      // hostname lands, so it is recorded on its own rather than folded
      // into a generic "site updated".
      if (params.branchChange) {
        await tx.auditEvent.create({
          data: {
            organisationId: params.organisationId,
            actorUserId: params.userId,
            action: 'branch.changed',
            subject: params.hostname,
            detail: params.branchChange,
          },
        });
      }

      // Opening or closing a public ingest endpoint is worth its own entry.
      // "Who turned this on" is the first question asked after a flood.
      if (params.widgetChange !== null) {
        await tx.auditEvent.create({
          data: {
            organisationId: params.organisationId,
            actorUserId: params.userId,
            action: params.widgetChange ? 'widget.enabled' : 'widget.disabled',
            subject: params.hostname,
          },
        });
      }

      return updated;
    });
  }

  removeEnvironment(params: {
    organisationId: string;
    userId: string;
    id: string;
    hostname: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.siteEnvironment.delete({ where: { id: params.id } });

      await tx.auditEvent.create({
        data: {
          organisationId: params.organisationId,
          actorUserId: params.userId,
          action: 'site.removed',
          subject: params.hostname,
        },
      });
    });
  }
}
