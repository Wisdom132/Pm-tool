import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Theme } from '../../core/theme';
import { AppShell, DEFAULT_NAV } from '../../../design-system';
import { Session } from '../../core/session';

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
      [organisations]="organisations()"
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

  private readonly session = inject(Session);

  protected readonly organisations = computed(() => this.session.organisations());
  protected readonly organisationId = computed(() => this.session.organisationId() ?? '');
  protected readonly organisation = computed(() => this.session.organisation()?.name ?? '');
  protected readonly organisationMeta = computed(() => this.session.organisation()?.meta ?? '');
  /**
   * Their name if they set one, otherwise the address they signed in with —
   * which is the only thing we know about a magic-link account.
   */
  protected readonly user = computed(() => {
    const user = this.session.user();
    return user?.name?.trim() || user?.email || '';
  });
  protected readonly role = computed(() => {
    const role = this.session.organisation()?.role;
    return role ? role[0].toUpperCase() + role.slice(1) : '';
  });

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
    // The session owns this: it sets the header every request uses, and
    // navigates, because everything on screen belongs to the old tenant.
    this.session.switchTo(id);
  }

  protected onLogout() {
    void this.session.signOut();
  }
}
