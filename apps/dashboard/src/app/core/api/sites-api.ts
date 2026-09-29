import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  CreateSite,
  SiteEnvironment,
  SiteEnvironmentDetail,
  UpdateSite,
} from '../api-types';

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
