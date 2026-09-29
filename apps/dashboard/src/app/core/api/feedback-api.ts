import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  Feedback,
  FeedbackPage,
  FeedbackSource,
  FeedbackStatus,
} from '../api-types';

@Injectable({ providedIn: 'root' })
export class FeedbackApi {
  private readonly api = inject(ApiClient);

  list(
    options: {
      status?: FeedbackStatus;
      source?: FeedbackSource;
      /** A user id, `me`, or `none` for the unassigned queue. */
      assignedTo?: string;
      siteId?: string;
      cursor?: string;
    } = {},
  ): Observable<FeedbackPage> {
    return this.api.get<FeedbackPage>('/feedback', options);
  }

  get(id: string): Observable<Feedback> {
    return this.api.get<Feedback>(`/feedback/${id}`);
  }

  setStatus(id: string, status: FeedbackStatus): Observable<Feedback> {
    return this.api.patch<Feedback>(`/feedback/${id}/status`, { status });
  }

  /** Hand it to someone, or pass null to put it back down. */
  assign(id: string, assigneeId: string | null): Observable<Feedback> {
    return this.api.patch<Feedback>(`/feedback/${id}/assignee`, { assigneeId });
  }

  /**
   * Open an issue on the repository behind this comment's site.
   *
   * Distinct from `promote`, which only records a link to one somebody
   * created by hand elsewhere.
   */
  createIssue(id: string): Observable<Feedback> {
    return this.api.post<Feedback>(`/feedback/${id}/issue`, {});
  }

  /** Record that this comment became an issue or a change request elsewhere. */
  promote(id: string, url: string): Observable<Feedback> {
    return this.api.post<Feedback>(`/feedback/${id}/promote`, { url });
  }

  /**
   * The screenshot, as bytes.
   *
   * Not a URL for an `<img src>`: that request could not carry the
   * `x-organisation-id` header every tenant-scoped endpoint requires, so
   * the browser would be answered 403. The caller turns this into an object
   * URL and is responsible for revoking it.
   */
  screenshot(id: string): Observable<Blob> {
    return this.api.blob(`/feedback/${id}/screenshot`);
  }

  remove(id: string): Observable<{ removed: boolean }> {
    return this.api.delete(`/feedback/${id}`);
  }
}
