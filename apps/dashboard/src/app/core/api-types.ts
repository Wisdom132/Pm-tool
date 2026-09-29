/**
 * What the API actually returns.
 *
 * Hand-written rather than generated, and deliberately *not* a copy of the
 * Prisma models: these are the response shapes, so a field the API does not
 * send cannot be referenced in a template. That is the failure the mock data
 * hid — `lastEditedAt` and a flat `verified` boolean looked real for weeks
 * because nothing ever compared them against a response.
 */

export type Provider = 'github' | 'gitlab' | 'bitbucket';
export type Role = 'admin' | 'editor';
export type EnvironmentLabel = 'production' | 'staging' | 'preview';
export type FeedbackStatus = 'new' | 'triaged' | 'resolved';

/** How a comment arrived, which decides how far its author is trusted. */
export type FeedbackSource = 'extension' | 'widget';

// ── auth ─────────────────────────────────────────────────────────

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
}

export interface OrganisationSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  /** "4 sites · 3 members", composed server-side. */
  meta: string;
}

export interface Me {
  user: CurrentUser;
  organisations: OrganisationSummary[];
}

/** A long-lived session the browser extension holds. */
export interface ExtensionToken {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** The label given when it was created, so one browser is tellable from another. */
  userAgent: string | null;
  expiresAt: string;
}

/**
 * What an invitation link is offering.
 *
 * Deliberately thin — a guessed token should not be worth having, so this
 * carries no member list and no site list.
 */
export interface InvitationOffer {
  status: 'pending' | 'expired' | 'accepted';
  email: string;
  role: Role;
  expiresAt: string;
  organisation: { id: string; name: string };
}

// ── organisation ─────────────────────────────────────────────────

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  _count: { sites: number; memberships: number; connections: number; teams: number };
}

// ── sites ────────────────────────────────────────────────────────

export interface SiteEnvironment {
  id: string;
  siteId: string;
  organisationId: string;
  connectionId: string;
  hostname: string;
  label: EnvironmentLabel;
  repository: string;
  /** Null means "read the branch from the page" — what preview deploys need. */
  branch: string | null;
  createdAt: string;
  site: { id: string; name: string; verifiedAt: string | null; feedbackWidget: boolean };
  connection: { id: string; provider: Provider; accountLogin: string };
}

/** `GET /sites/:id` includes the whole site, not a summary. */
export interface SiteEnvironmentDetail extends Omit<SiteEnvironment, 'site'> {
  site: {
    id: string;
    name: string;
    verifiedAt: string | null;
    verificationToken: string;
    /** The public widget. Off until somebody turns it on. */
    feedbackWidget: boolean;
    createdAt: string;
  };
}

export interface CreateSite {
  name: string;
  hostname: string;
  label: EnvironmentLabel;
  repository: string;
  branch: string | null;
  connectionId: string;
}

export interface UpdateSite {
  name?: string;
  branch?: string | null;
  feedbackWidget?: boolean;
}

// ── connections ──────────────────────────────────────────────────

export interface Connection {
  id: string;
  provider: Provider;
  accountLogin: string;
  externalId: string;
  baseUrl: string | null;
  createdAt: string;
  revokedAt: string | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  _count: { environments: number };
}

export interface Repository {
  fullName: string;
  private: boolean;
}

export interface InstallUrl {
  url: string;
  expiresInSeconds: number;
}

// ── teams ────────────────────────────────────────────────────────

export interface TeamMemberRef {
  user: { id: string; name: string | null; email: string };
}

export interface TeamSiteRef {
  site: {
    id: string;
    name: string;
    environments: { id: string; hostname: string; label: EnvironmentLabel }[];
  };
}

export interface Team {
  id: string;
  organisationId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  members: TeamMemberRef[];
  sites: TeamSiteRef[];
  _count?: { members: number; sites: number };
}

// ── people ───────────────────────────────────────────────────────

/**
 * One row whether they have accepted or only been asked.
 *
 * `kind` matters for writes: removing a member and revoking an invitation
 * are different endpoints, and `id` is a user id for one and an invitation
 * id for the other.
 */
export interface Person {
  id: string;
  kind: 'member' | 'invitation';
  name: string | null;
  email: string;
  role: Role;
  status: 'active' | 'invited';
  lastSeenAt: string | null;
  joinedAt: string;
  expiresAt?: string;
  teams: { id: string; name: string }[];
}

export interface Invite {
  email: string;
  role: Role;
  teamIds?: string[];
}

// ── audit ────────────────────────────────────────────────────────

export interface AuditEvent {
  /** A stringified bigint: ids are sequential and exceed Number.MAX_SAFE_INTEGER. */
  id: string;
  action: string;
  subject: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  /** Null when the actor's account has since been deleted. */
  actor: { id: string; name: string | null; email: string } | null;
}

export interface AuditPage {
  events: AuditEvent[];
  nextCursor: string | null;
}

// ── feedback ─────────────────────────────────────────────────────

export interface Feedback {
  id: string;
  message: string;
  pageUrl: string;
  pagePath: string;
  element: string | null;
  /** The differentiator: where the page was annotated. */
  sourceFile: string | null;
  sourceLine: number | null;
  status: FeedbackStatus;
  source: FeedbackSource;
  promotedUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
  assignedAt: string | null;
  /** True when there is an image to fetch from `/feedback/:id/screenshot`. */
  hasScreenshot: boolean;
  site: { id: string; name: string } | null;
  environment: { id: string; hostname: string; label: EnvironmentLabel } | null;
  resolvedBy: { id: string; name: string | null; email: string } | null;
  assignedTo: { id: string; name: string | null; email: string } | null;
  author: {
    name: string | null;
    email: string | null;
    userId: string | null;
    /** False for a public submission, which is not to be trusted as identity. */
    verified: boolean;
  };
  viewport?: string | null;
  userAgent?: string | null;
}

/**
 * `mine` and `unassigned` sit alongside the statuses because they are the
 * two questions somebody opening a shared inbox is actually asking, and a
 * tab with no number on it is a tab nobody clicks.
 */
export type FeedbackCounts = Record<FeedbackStatus | 'mine' | 'unassigned', number>;

export interface FeedbackPage {
  items: Feedback[];
  counts: FeedbackCounts;
  nextCursor: string | null;
}

/** A user id, `me`, or `none` for the unassigned queue. */
export type AssigneeFilter = string;
