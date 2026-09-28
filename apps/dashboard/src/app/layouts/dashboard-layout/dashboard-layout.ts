import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Theme } from '../../core/theme';
import { AppShell, DEFAULT_NAV } from '../../../design-system';
import { MOCK_ORGANISATIONS, MOCK_SESSION } from '../../core/mock-data';

/**
 * The signed-in frame. Everything behind auth renders inside this.
 *
 * Navigation is by route rather than by id so the sidebar and the URL cannot
 * disagree — the shell emits an id and this maps it to a path, which keeps
 * the design-system component free of any routing dependency.
 */
@Component({
  selector: 'app-dashboard-layout',
  imports: [AppShell, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-app-shell
      [nav]="nav"
      [active]="active()"
      [organisation]="organisation()"
      [organisationMeta]="organisationMeta()"
      [showOrganisation]="!!organisation()"
      [organisationId]="organisationId()"
      [organisations]="organisations"
      (switchOrganisation)="onSwitchOrganisation($event)"
      [user]="user()"
      [role]="role()"
      [(dark)]="dark"
      (navigate)="onNavigate($event)"
      (logout)="onLogout()">
      <ng-container dsCrumbs>
        <strong>{{ crumb() }}</strong>
      </ng-container>

      <router-outlet />
    </ds-app-shell>
  `,
  styles: `:host { display: block; }`,
})
export class DashboardLayout {
  protected readonly nav = DEFAULT_NAV;
  /** Owned by the service so the class on <html> and the toggle agree. */
  protected readonly dark = inject(Theme).dark;

  // Mock session until the API exists.
  protected readonly organisations = MOCK_ORGANISATIONS;
  protected readonly organisationId = signal(MOCK_SESSION.organisationId);
  protected readonly organisation = signal(MOCK_SESSION.organisation);
  protected readonly organisationMeta = signal(MOCK_SESSION.organisationMeta);
  protected readonly user = signal(MOCK_SESSION.user);
  protected readonly role = signal(MOCK_SESSION.role);

  protected readonly active = signal('overview');
  protected readonly crumb = computed(
    () => this.nav.flatMap((g) => g.items).find((i) => i.id === this.active())?.label ?? ''
  );

  constructor(private readonly router: Router) {
    // Deep links and reloads bypass onNavigate, so the highlighted item is
    // taken from the URL rather than only from the last click.
    this.syncFromUrl(this.router.url);
    this.router.events.subscribe(() => this.syncFromUrl(this.router.url));
  }

  private syncFromUrl(url: string) {
    const id = url.split('?')[0].split('/').filter(Boolean)[0];
    if (id) this.active.set(id);
  }

  protected onNavigate(id: string) {
    this.active.set(id);
    this.router.navigate(['/', id]);
  }

  protected onSwitchOrganisation(id: string) {
    const org = this.organisations.find((o) => o.id === id);
    if (!org) return;
    this.organisationId.set(org.id);
    this.organisation.set(org.name);
    this.organisationMeta.set(org.meta);
    // Everything on screen belongs to the old organisation, so go somewhere
    // that is true for the new one rather than leaving stale rows behind.
    this.router.navigate(['/overview']);
  }

  protected onLogout() {
    this.router.navigate(['/sign-in']);
  }
}
