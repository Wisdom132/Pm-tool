import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  Feedback,
  FeedbackPage,
  FeedbackStatus,
} from '../api-types';

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
