import { ChangeDetectionStrategy, Component, HostListener, input, model, output } from '@angular/core';
import { Avatar } from 'primeng/avatar';
import { Button } from 'primeng/button';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { InputText } from 'primeng/inputtext';
import { Tooltip } from 'primeng/tooltip';
import { Popover } from 'primeng/popover';

export interface NavItem { id: string; label: string; icon: string; children?: { id: string; label: string }[] }
export interface NavGroup { title?: string; items: NavItem[] }

export const DEFAULT_NAV: NavGroup[] = [
  { items: [{ id: 'overview', label: 'Overview', icon: 'pi pi-th-large' }] },
  {
    title: 'Workspace',
    items: [
      { id: 'sites', label: 'Sites', icon: 'pi pi-globe' },
      { id: 'feedback', label: 'Feedback', icon: 'pi pi-comments' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { id: 'connections', label: 'Connections', icon: 'pi pi-link' },
      { id: 'integrations', label: 'Integrations', icon: 'pi pi-bolt' },
      { id: 'people', label: 'People', icon: 'pi pi-users' },
      { id: 'teams', label: 'Teams', icon: 'pi pi-sitemap' },
      { id: 'audit', label: 'Audit log', icon: 'pi pi-history' },
    ],
  },
];

/**
 * App frame. Desktop: 248px sidebar (72px collapsed) + 64px topbar + centred
 * 1240px content. Below 960px the sidebar goes off-canvas, opened by the
 * hamburger and closed by navigating, tapping the backdrop or Escape.
 *
 * The organisation switcher is the tenant switcher: an agency editing several
 * clients' sites belongs to more than one, and the sidebar is where they say
 * which one they are working in.
 */
@Component({
  selector: 'ds-app-shell',
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
  imports: [Avatar, Button, IconField, InputIcon, InputText, Tooltip, Popover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.collapsed]': 'collapsed()', '[class.mobile-open]': 'mobileOpen()' },
})
export class AppShell {
  readonly nav = input<NavGroup[]>(DEFAULT_NAV);
  readonly active = input('overview');
  readonly organisation = input('');
  /** Hidden until a session says which organisation this is; an empty
   *  switcher reads as a broken control rather than as a loading one. */
  readonly showOrganisation = input(true);
  readonly organisationId = input('');
  /** Every organisation this person belongs to — agencies have several. */
  readonly organisations = input<{ id: string; name: string; meta: string }[]>([]);
  readonly switchOrganisation = output<string>();
  readonly createOrganisation = output<void>();
  readonly organisationMeta = input('');
  readonly user = input('');
  readonly role = input('');
  readonly notifications = input(0);
  readonly collapsed = model(false);
  readonly dark = model(false);
  readonly mobileOpen = model(false);
  readonly navigate = output<string>();
  readonly search = output<string>();
  readonly logout = output<void>();

  protected isActive(item: NavItem) {
    return item.id === this.active() || !!item.children?.some((c) => c.id === this.active());
  }

  protected onNavigate(id: string) {
    this.navigate.emit(id);
    if (this.mobileOpen()) this.mobileOpen.set(false);
  }

  @HostListener('window:keydown.escape')
  protected onEsc() {
    if (this.mobileOpen()) this.mobileOpen.set(false);
  }
}
