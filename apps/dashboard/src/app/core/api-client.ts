import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * One place that knows how to talk to the API.
 *
 * Three things live here because getting them wrong is invisible until it
 * matters:
 *
 *   `withCredentials` — the session is an httpOnly cookie, so every request
 *   has to opt in. Without it the dashboard is silently signed out on
 *   anything but the simplest setup.
 *
 *   `x-organisation-id` — every tenant-scoped endpoint requires it, and
 *   `OrgGuard` returns 403 without it. Threading it through each call site
 *   would mean one forgotten header per new feature.
 *
 *   Error shape — the API answers with `{ message, error, statusCode }`, and
 *   `message` is sometimes an array from the validation pipe. Templates
 *   should receive a sentence, not a union.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  /**
   * Which organisation requests act in.
   *
   * A signal rather than a field so switching organisations re-runs whatever
   * depends on it, and so the shell can render the switcher from the same
   * source of truth the requests use.
   */
  readonly organisationId = signal<string | null>(null);

  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Observable<T> {
    return this.request<T>('GET', path, undefined, params);
  }

  post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Observable<T> {
    return this.request<T>('POST', path, body, params);
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.request<T>('PATCH', path, body);
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string, body?: unknown): Observable<T> {
    return this.request<T>('DELETE', path, body);
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>,
  ): Observable<T> {
    const organisationId = this.organisationId();

    return this.http
      .request<T>(method, `${environment.apiUrl}${path}`, {
        body,
        params: toParams(params),
        withCredentials: true,
        headers: organisationId ? { 'x-organisation-id': organisationId } : {},
      })
      .pipe(catchError((error: HttpErrorResponse) => throwError(() => toApiError(error))));
  }
}

/** A failure a template can show, with the status still available for logic. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Per-field messages from the validation pipe, when it produced them. */
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The caller is signed out. The shell redirects rather than showing this. */
  get unauthenticated() {
    return this.status === 401;
  }
}

/**
 * Undefined params are dropped rather than sent as the string "undefined",
 * which is what `HttpParams` does with them and which the API would then
 * reject as a malformed filter.
 */
function toParams(params?: Record<string, string | number | boolean | undefined>): HttpParams {
  let result = new HttpParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      result = result.set(key, String(value));
    }
  }
  return result;
}

function toApiError(error: HttpErrorResponse): ApiError {
  // status 0 means the request never arrived — a stopped API, or CORS.
  // Saying "unknown error" here sends people looking in the wrong place.
  if (error.status === 0) {
    return new ApiError(
      'Could not reach the API. Is it running?',
      0,
    );
  }

  const body = error.error as { message?: string | string[]; error?: string } | null;
  const raw = body?.message;

  if (Array.isArray(raw)) {
    return new ApiError(raw[0] ?? 'That request was not valid.', error.status, raw);
  }

  return new ApiError(
    raw || body?.error || error.message || 'Something went wrong.',
    error.status,
  );
}
