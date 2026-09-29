import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from './session';

/**
 * Nobody reaches the shell without a session.
 *
 * `resolve()` is awaited rather than fire-and-forget, because the
 * organisation header has to be set before the first screen issues a
 * request — otherwise every page's opening call 400s on a missing header and
 * the dashboard looks broken for one render.
 */
export const requireSession: CanActivateFn = async (_route, state) => {
  const session = inject(Session);
  const router = inject(Router);

  if (await session.resolve()) return true;

  // Where they were going, so signing in lands them there rather than on
  // the overview.
  return router.createUrlTree(['/sign-in'], {
    queryParams: state.url && state.url !== '/' ? { next: state.url } : {},
  });
};

/** Keep a signed-in person out of the sign-in screen. */
export const requireNoSession: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  if (await session.resolve()) return router.createUrlTree(['/overview']);
  return true;
};

/**
 * Admin-only routes.
 *
 * The API enforces this too — this only avoids rendering a screen whose
 * every request would 403.
 */
export const requireAdmin: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  if (!(await session.resolve())) return router.createUrlTree(['/sign-in']);
  if (!session.isAdmin()) return router.createUrlTree(['/overview']);
  return true;
};
