import { Routes } from '@angular/router';
import { DashboardLayout } from './layouts/dashboard-layout/dashboard-layout';
import { AuthLayout } from './layouts/auth-layout/auth-layout';
import { requireAdmin, requireNoSession, requireSession } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    component: AuthLayout,
    canActivate: [requireNoSession],
    children: [
      { path: 'sign-in', loadComponent: () => import('./features/auth/sign-in').then((m) => m.SignIn) },
      { path: 'sign-in/check-email', loadComponent: () => import('./features/auth/check-email').then((m) => m.CheckEmail) },
      { path: 'invite/:token', loadComponent: () => import('./features/auth/accept-invite').then((m) => m.AcceptInvite) },
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
      { path: 'sites/:id', loadComponent: () => import('./features/sites/site-detail').then((m) => m.SiteDetail) },

      { path: 'feedback', loadComponent: () => import('./features/feedback/feedback').then((m) => m.Feedback) },
      { path: 'feedback/:id', loadComponent: () => import('./features/feedback/feedback-detail').then((m) => m.FeedbackDetail) },

      { path: 'connections', loadComponent: () => import('./features/connections/connections').then((m) => m.Connections) },
      { path: 'integrations', loadComponent: () => import('./features/integrations/integrations').then((m) => m.Integrations) },

      { path: 'people', loadComponent: () => import('./features/people/people').then((m) => m.People) },
      { path: 'teams', loadComponent: () => import('./features/teams/teams').then((m) => m.Teams) },
      { path: 'teams/:id', loadComponent: () => import('./features/teams/team-detail').then((m) => m.TeamDetail) },

      { path: 'audit', canActivate: [requireAdmin], loadComponent: () => import('./features/audit/audit').then((m) => m.Audit) },

      { path: 'settings', canActivate: [requireAdmin], loadComponent: () => import('./features/settings/organisation-settings').then((m) => m.OrganisationSettings) },
      { path: 'account', loadComponent: () => import('./features/settings/account-settings').then((m) => m.AccountSettings) },

      // Inside the shell, so a wrong URL keeps its navigation rather than
      // dumping the person onto a bare page with no way back.
      { path: '**', loadComponent: () => import('./features/errors/not-found').then((m) => m.NotFound) },
    ],
  },
];
