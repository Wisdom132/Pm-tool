import { Routes } from '@angular/router';
import { DashboardLayout } from './layouts/dashboard-layout/dashboard-layout';
import { AuthLayout } from './layouts/auth-layout/auth-layout';
import { requireAdmin, requireNoSession, requireSession } from './core/auth-guard';

export const routes: Routes = [
  {
    path: '',
    component: AuthLayout,
    canActivate: [requireNoSession],
    children: [
      // Without this, `/` matched this layout and found no child to put in
      // its outlet — the shell rendered around an empty card, which is what
      // a first-time visitor saw at the root of the dashboard.
      { path: '', redirectTo: 'sign-in', pathMatch: 'full' },
      { path: 'sign-in', loadComponent: () => import('./features/auth/sign-in/sign-in').then((m) => m.SignIn) },
      { path: 'sign-in/check-email', loadComponent: () => import('./features/auth/check-email/check-email').then((m) => m.CheckEmail) },
    ],
  },
  {
    // The invitation page, on the auth layout but *without*
    // `requireNoSession`. Both states are legitimate here: somebody with no
    // account needs to be told what they are joining, and somebody already
    // signed in is exactly who can accept it. Guarding it as
    // "signed out only" bounced the second case to the overview, which is
    // the one person the link was useful to.
    path: '',
    component: AuthLayout,
    children: [
      // Where the emailed sign-in link lands. On the *unguarded* layout for
      // the same reason as invitations: bouncing a signed-in person off it
      // would consume nothing and explain nothing, and somebody signing in
      // on a second device is exactly who is holding this link.
      { path: 'sign-in/verify', loadComponent: () => import('./features/auth/verify/verify').then((m) => m.Verify) },

      // `invitations/`, matching the path the API puts in the email. The
      // old `invite/` is kept as a redirect because invitations live 14
      // days, so links in the old shape may already be in an inbox.
      { path: 'invitations/:token', loadComponent: () => import('./features/auth/accept-invite/accept-invite').then((m) => m.AcceptInvite) },
      { path: 'invite/:token', redirectTo: 'invitations/:token' },
    ],
  },
  {
    path: '',
    component: DashboardLayout,
    canActivate: [requireSession],
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', loadComponent: () => import('./features/overview/overview').then((m) => m.Overview) },

      { path: 'sites', loadComponent: () => import('./features/sites/sites').then((m) => m.Sites) },
      { path: 'sites/:id', loadComponent: () => import('./features/sites/site-detail/site-detail').then((m) => m.SiteDetail) },

      { path: 'feedback', loadComponent: () => import('./features/feedback/feedback').then((m) => m.Feedback) },
      { path: 'feedback/:id', loadComponent: () => import('./features/feedback/feedback-detail/feedback-detail').then((m) => m.FeedbackDetail) },

      { path: 'connections', loadComponent: () => import('./features/connections/connections').then((m) => m.Connections) },
      { path: 'integrations', loadComponent: () => import('./features/integrations/integrations').then((m) => m.Integrations) },

      { path: 'people', loadComponent: () => import('./features/people/people').then((m) => m.People) },
      { path: 'teams', loadComponent: () => import('./features/teams/teams').then((m) => m.Teams) },
      { path: 'teams/:id', loadComponent: () => import('./features/teams/team-detail/team-detail').then((m) => m.TeamDetail) },

      { path: 'audit', canActivate: [requireAdmin], loadComponent: () => import('./features/audit/audit').then((m) => m.Audit) },

      { path: 'settings', canActivate: [requireAdmin], loadComponent: () => import('./features/settings/organisation-settings/organisation-settings').then((m) => m.OrganisationSettings) },
      { path: 'account', loadComponent: () => import('./features/settings/account-settings/account-settings').then((m) => m.AccountSettings) },

      // Inside the shell, so a wrong URL keeps its navigation rather than
      // dumping the person onto a bare page with no way back.
      { path: '**', loadComponent: () => import('./features/errors/not-found/not-found').then((m) => m.NotFound) },
    ],
  },
];
