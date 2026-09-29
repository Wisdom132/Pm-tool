import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  Team,
} from '../api-types';

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
