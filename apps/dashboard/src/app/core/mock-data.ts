/**
 * Mock data — everything here is fake.
 *
 * It exists so the screens can be designed and reviewed before the API does,
 * and so empty states, loading states and full tables can all be looked at on
 * demand rather than only when the data happens to be in that shape.
 *
 * Kept in one file, and imported only by feature components, so replacing it
 * with real HTTP calls is a matter of deleting it and following the compiler.
 */

export type Provider = 'github' | 'gitlab' | 'bitbucket';
export type Role = 'admin' | 'editor';

export interface SiteEnvironment {
  id: string;
  hostname: string;
  label: 'production' | 'staging' | 'preview';
  repository: string;
  /** Null means the branch is read from the page — what preview deploys need. */
  branch: string | null;
  provider: Provider;
  verified: boolean;
  lastEditedAt: string | null;
}

export interface Connection {
  id: string;
  provider: Provider;
  accountLogin: string;
  repositories: number;
  connectedBy: string;
  connectedAt: string;
  status: 'active' | 'needs-attention';
}

export interface FeedbackItem {
  id: string;
  message: string;
  page: string;
  element: string;
  sourceFile: string | null;
  author: string;
  createdAt: string;
  status: 'new' | 'triaged' | 'resolved';
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'invited';
  lastSeenAt: string | null;
}

export interface Team {
  id: string;
  name: string;
  isDefault: boolean;
  memberIds: string[];
  /** Site ids this team may edit. */
  siteIds: string[];
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  subject: string;
  createdAt: string;
}

export const MOCK_SITES: SiteEnvironment[] = [
  {
    id: '1',
    hostname: 'heykara.com',
    label: 'production',
    repository: 'iFrontida/website-revamp',
    branch: 'main',
    provider: 'github',
    verified: true,
    lastEditedAt: '2026-09-27T14:12:00Z',
  },
  {
    id: '2',
    hostname: 'staging.heykara.com',
    label: 'staging',
    repository: 'iFrontida/website-revamp',
    branch: 'develop',
    provider: 'github',
    verified: true,
    lastEditedAt: '2026-09-28T09:40:00Z',
  },
  {
    id: '3',
    hostname: '*.website-revamp.pages.dev',
    label: 'preview',
    repository: 'iFrontida/website-revamp',
    branch: null,
    provider: 'github',
    verified: true,
    lastEditedAt: null,
  },
  {
    id: '4',
    hostname: 'docs.heykara.com',
    label: 'production',
    repository: 'iFrontida/docs',
    branch: 'main',
    provider: 'github',
    verified: false,
    lastEditedAt: null,
  },
];

export const MOCK_CONNECTIONS: Connection[] = [
  {
    id: '1',
    provider: 'github',
    accountLogin: 'iFrontida',
    repositories: 14,
    connectedBy: 'Wisdom Ekpot',
    connectedAt: '2026-09-12T11:02:00Z',
    status: 'active',
  },
  {
    id: '2',
    provider: 'gitlab',
    accountLogin: 'heykara-internal',
    repositories: 3,
    connectedBy: 'Wisdom Ekpot',
    connectedAt: '2026-09-20T16:30:00Z',
    status: 'needs-attention',
  },
];

export const MOCK_FEEDBACK: FeedbackItem[] = [
  {
    id: '1',
    message: 'This headline still says "mater" — should be "matter".',
    page: '/',
    element: 'h1.home-hero',
    sourceFile: 'components/reusables/home-hero.vue:6',
    author: 'Ada (Marketing)',
    createdAt: '2026-09-28T08:15:00Z',
    status: 'new',
  },
  {
    id: '2',
    message: 'Can the laundry card mention the 48-hour turnaround first?',
    page: '/laundry',
    element: 'p.card-body',
    sourceFile: 'components/contents/laundry.vue:86',
    author: 'Ada (Marketing)',
    createdAt: '2026-09-27T17:44:00Z',
    status: 'triaged',
  },
  {
    id: '3',
    message: 'Pricing page footer links to the old terms document.',
    page: '/pricing',
    element: 'a.footer-link',
    sourceFile: null,
    author: 'Chidi (Support)',
    createdAt: '2026-09-26T10:05:00Z',
    status: 'resolved',
  },
];

export const MOCK_MEMBERS: Member[] = [
  {
    id: '1',
    name: 'Wisdom Ekpot',
    email: 'wisdom@heykara.com',
    role: 'admin',
    status: 'active',
    lastSeenAt: '2026-09-28T09:55:00Z',
  },
  {
    id: '2',
    name: 'Ada Obi',
    email: 'ada@heykara.com',
    role: 'editor',
    status: 'active',
    lastSeenAt: '2026-09-28T08:20:00Z',
  },
  {
    id: '3',
    name: '',
    email: 'chidi@heykara.com',
    role: 'editor',
    status: 'invited',
    lastSeenAt: null,
  },
];

export const MOCK_TEAMS: Team[] = [
  {
    id: 'everyone',
    name: 'Everyone',
    isDefault: true,
    memberIds: ['1', '2', '3'],
    siteIds: ['1', '2', '3', '4'],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    isDefault: false,
    memberIds: ['2'],
    siteIds: ['1', '2'],
  },
  {
    id: 'docs',
    name: 'Docs',
    isDefault: false,
    memberIds: ['3'],
    siteIds: ['4'],
  },
];

export const MOCK_AUDIT: AuditEntry[] = [
  {
    id: '1',
    action: 'pr.opened',
    actor: 'Ada Obi',
    subject: 'iFrontida/website-revamp #248',
    createdAt: '2026-09-28T09:41:00Z',
  },
  {
    id: '2',
    action: 'site.registered',
    actor: 'Wisdom Ekpot',
    subject: 'staging.heykara.com',
    createdAt: '2026-09-27T15:02:00Z',
  },
  {
    id: '3',
    action: 'branch.changed',
    actor: 'Wisdom Ekpot',
    subject: 'staging.heykara.com → develop',
    createdAt: '2026-09-27T15:03:00Z',
  },
  {
    id: '4',
    action: 'connection.created',
    actor: 'Wisdom Ekpot',
    subject: 'github · iFrontida',
    createdAt: '2026-09-12T11:02:00Z',
  },
];

export const MOCK_ORGANISATIONS = [
  { id: 'heykara', name: 'Heykara', meta: '4 sites · 3 members' },
  { id: 'frontida', name: 'iFrontida', meta: '2 sites · 8 members' },
];

export const MOCK_SESSION = {
  user: 'Wisdom Ekpot',
  role: 'Admin',
  organisationId: 'heykara',
  organisation: 'Heykara',
  organisationMeta: '4 sites · 3 members',
};
