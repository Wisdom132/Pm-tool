import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from './api.client';
import type {
  AuditPage,
  ExtensionToken,
  Connection,
  CreateSite,
  Feedback,
  FeedbackPage,
  FeedbackStatus,
  InstallUrl,
  Invite,
  Me,
  Organisation,
  Person,
  Repository,
  Role,
  SiteEnvironment,
  SiteEnvironmentDetail,
  Team,
  UpdateSite,
} from './api.types';

/**
 * One service per resource, each a thin mapping of endpoint to method.
 *
 * Thin on purpose: no caching, no normalising, no shared store. A dashboard
 * page loads what it shows and reloads after it writes, which is correct by
 * construction and an order of magnitude less code than keeping a client
 * cache honest. If a screen ever needs more, it needs it for a reason that
 * will be obvious at the time.
 */

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);

  me(): Observable<Me> {
    return this.api.get<Me>('/auth/me');
  }

  requestLink(email: string): Observable<{ sent: boolean }> {
    return this.api.post('/auth/request-link', { email });
  }

  verify(token: string): Observable<{ user: Me['user'] }> {
    return this.api.post('/auth/verify', { token });
  }

  updateProfile(name: string): Observable<{ user: Me['user'] }> {
    return this.api.patch('/auth/me', { name });
  }

  /** Shown once — only its hash is stored, so it cannot be retrieved again. */
  createExtensionToken(label?: string): Observable<{ token: string; expiresInDays: number }> {
    return this.api.post('/auth/extension-tokens', { label });
  }

  extensionTokens(): Observable<ExtensionToken[]> {
    return this.api.get<ExtensionToken[]>('/auth/extension-tokens');
  }

  revokeExtensionToken(id: string): Observable<{ revoked: boolean }> {
    return this.api.delete(`/auth/extension-tokens/${id}`);
  }

  signOut(): Observable<{ signedOut: boolean }> {
    return this.api.post('/auth/sign-out');
  }

  signOutEverywhere(): Observable<{ signedOut: boolean }> {
    return this.api.post('/auth/sign-out-everywhere');
  }
}

@Injectable({ providedIn: 'root' })
export class OrganisationApi {
  private readonly api = inject(ApiClient);

  get(): Observable<Organisation> {
    return this.api.get<Organisation>('/organisation');
  }

  rename(name: string): Observable<Organisation> {
    return this.api.patch<Organisation>('/organisation', { name });
  }

  /** `confirm` must be the organisation's own name, typed back. */
  remove(confirm: string): Observable<{ deleted: boolean }> {
    return this.api.delete('/organisation', { confirm });
  }
}

@Injectable({ providedIn: 'root' })
export class SitesApi {
  private readonly api = inject(ApiClient);

  list(): Observable<SiteEnvironment[]> {
    return this.api.get<SiteEnvironment[]>('/sites');
  }

  get(id: string): Observable<SiteEnvironmentDetail> {
    return this.api.get<SiteEnvironmentDetail>(`/sites/${id}`);
  }

  create(site: CreateSite): Observable<SiteEnvironment> {
    return this.api.post<SiteEnvironment>('/sites', site);
  }

  update(id: string, changes: UpdateSite): Observable<SiteEnvironment> {
    return this.api.patch<SiteEnvironment>(`/sites/${id}`, changes);
  }

  remove(id: string): Observable<{ removed: boolean }> {
    return this.api.delete(`/sites/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class ConnectionsApi {
  private readonly api = inject(ApiClient);

  list(): Observable<Connection[]> {
    return this.api.get<Connection[]>('/connections');
  }

  /** Where to send an admin to install the GitHub App. */
  githubInstallUrl(): Observable<InstallUrl> {
    return this.api.post<InstallUrl>('/connections/github/install-url');
  }

  repositories(id: string): Observable<Repository[]> {
    return this.api.get<Repository[]>(`/connections/${id}/repositories`);
  }

  check(id: string, repository: string): Observable<{ ok: boolean; branches: number }> {
    return this.api.post(`/connections/${id}/check`, undefined, { repository });
  }

  revoke(id: string): Observable<{ id: string; revokedAt: string }> {
    return this.api.delete(`/connections/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class TeamsApi {
  private readonly api = inject(ApiClient);

  list(): Observable<Team[]> {
    return this.api.get<Team[]>('/teams');
  }

  get(id: string): Observable<Team> {
    return this.api.get<Team>(`/teams/${id}`);
  }

  create(name: string): Observable<Team> {
    return this.api.post<Team>('/teams', { name });
  }

  rename(id: string, name: string): Observable<Team> {
    return this.api.patch<Team>(`/teams/${id}`, { name });
  }

  /** The whole set, not a delta — hence PUT. */
  setMembers(id: string, memberIds: string[]): Observable<Team> {
    return this.api.put<Team>(`/teams/${id}/members`, { memberIds });
  }

  setSites(id: string, siteIds: string[]): Observable<Team> {
    return this.api.put<Team>(`/teams/${id}/sites`, { siteIds });
  }

  remove(id: string): Observable<{ removed: boolean }> {
    return this.api.delete(`/teams/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class MembersApi {
  private readonly api = inject(ApiClient);

  /** Accepted members and pending invitations, in one list. */
  list(): Observable<Person[]> {
    return this.api.get<Person[]>('/members');
  }

  invite(invite: Invite): Observable<{ id: string; email: string; role: Role; expiresAt: string }> {
    return this.api.post('/members/invitations', invite);
  }

  revokeInvitation(id: string): Observable<{ revoked: boolean }> {
    return this.api.delete(`/members/invitations/${id}`);
  }

  changeRole(userId: string, role: Role): Observable<unknown> {
    return this.api.patch(`/members/${userId}/role`, { role });
  }

  remove(userId: string): Observable<{ removed: boolean }> {
    return this.api.delete(`/members/${userId}`);
  }
}

@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly api = inject(ApiClient);

  list(options: { cursor?: string; action?: string; limit?: number } = {}): Observable<AuditPage> {
    return this.api.get<AuditPage>('/audit', options);
  }

  actions(): Observable<string[]> {
    return this.api.get<string[]>('/audit/actions');
  }
}

@Injectable({ providedIn: 'root' })
export class FeedbackApi {
  private readonly api = inject(ApiClient);

  list(
    options: { status?: FeedbackStatus; siteId?: string; cursor?: string } = {},
  ): Observable<FeedbackPage> {
    return this.api.get<FeedbackPage>('/feedback', options);
  }

  get(id: string): Observable<Feedback> {
    return this.api.get<Feedback>(`/feedback/${id}`);
  }

  setStatus(id: string, status: FeedbackStatus): Observable<Feedback> {
    return this.api.patch<Feedback>(`/feedback/${id}/status`, { status });
  }

  /** Record that this comment became an issue or a change request. */
  promote(id: string, url: string): Observable<Feedback> {
    return this.api.post<Feedback>(`/feedback/${id}/promote`, { url });
  }

  remove(id: string): Observable<{ removed: boolean }> {
    return this.api.delete(`/feedback/${id}`);
  }
}
