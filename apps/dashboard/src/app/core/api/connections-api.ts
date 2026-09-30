import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  Connection,
  InstallUrl,
  Repository,
} from '../api-types';

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

  /**
   * Branches of one repository.
   *
   * On the connection, not the site: at registration time there is no site
   * yet, which is exactly when this list is needed.
   */
  branches(id: string, repository: string): Observable<string[]> {
    return this.api.get<string[]>(`/connections/${id}/branches`, { repository });
  }

  check(id: string, repository: string): Observable<{ ok: boolean; branches: number }> {
    return this.api.post(`/connections/${id}/check`, undefined, { repository });
  }

  revoke(id: string): Observable<{ id: string; revokedAt: string }> {
    return this.api.delete(`/connections/${id}`);
  }
}
