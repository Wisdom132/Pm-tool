import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  Organisation,
} from '../api-types';

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
