import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  AuditPage,
} from '../api-types';

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
