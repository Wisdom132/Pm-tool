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
  imports: [Avatar, Button, IconField, InputIcon, InputText, Tooltip, Popover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.collapsed]': 'collapsed()', '[class.mobile-open]': 'mobileOpen()' },
  template: `
    <div class="backdrop" (click)="mobileOpen.set(false)"></div>

    <aside>
      <div class="brand">
        <span class="logo">IE</span>
        @if (!collapsed()) { <span class="name">Inline Edit</span> }
        <p-button class="collapse-btn" [icon]="collapsed() ? 'pi pi-angle-right' : 'pi pi-angle-left'" [text]="true" [rounded]="true" severity="secondary" size="small"
          (onClick)="collapsed.set(!collapsed())" [ariaLabel]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'" />
        <p-button class="drawer-close" icon="pi pi-times" [text]="true" [rounded]="true" severity="secondary" size="small"
          (onClick)="mobileOpen.set(false)" ariaLabel="Close menu" />
      </div>

      @if (showOrganisation()) {
      <button class="org" type="button" (click)="orgMenu.toggle($event)"
        [attr.aria-haspopup]="true" [attr.aria-expanded]="false">
        <span class="org-mark">{{ organisation().charAt(0) }}</span>
        @if (!collapsed()) {
          <span class="org-text"><strong>{{ organisation() }}</strong><small>{{ organisationMeta() }}</small></span>
          <i class="pi pi-chevron-down"></i>
        }
      </button>

      <p-popover #orgMenu styleClass="ds-org-menu">
        <div class="org-menu">
          <span class="org-menu-title">Organisations</span>
          @for (o of organisations(); track o.id) {
            <button type="button" class="org-option" [class.on]="o.id === organisationId()"
              (click)="switchOrganisation.emit(o.id); orgMenu.hide()">
              <span class="org-mark">{{ o.name.charAt(0) }}</span>
              <span class="org-text">
                <strong>{{ o.name }}</strong>
                <small>{{ o.meta }}</small>
              </span>
              @if (o.id === organisationId()) { <i class="pi pi-check"></i> }
            </button>
          }
          <div class="org-menu-sep"></div>
          <button type="button" class="org-option plain" (click)="createOrganisation.emit(); orgMenu.hide()">
            <span class="org-mark ghost"><i class="pi pi-plus"></i></span>
            <span class="org-text"><strong>New organisation</strong></span>
          </button>
        </div>
      </p-popover>
      }

      <nav>
        @for (g of nav(); track $index) {
          <div class="group">
            @if (g.title && !collapsed()) { <span class="group-title">{{ g.title }}</span> }
            @for (item of g.items; track item.id) {
              <button type="button" class="item" [class.active]="isActive(item)" (click)="onNavigate(item.children?.[0]?.id ?? item.id)"
                [pTooltip]="collapsed() ? item.label : ''" tooltipPosition="right">
                <i [class]="item.icon"></i>
                @if (!collapsed()) { <span>{{ item.label }}</span> }
                @if (item.children && !collapsed()) { <i class="pi pi-chevron-down caret" [class.open]="isActive(item)"></i> }
              </button>
              @if (item.children && isActive(item) && !collapsed()) {
                <div class="subs">
                  @for (c of item.children; track c.id) {
                    <button type="button" class="sub" [class.active]="active() === c.id" (click)="onNavigate(c.id)">{{ c.label }}</button>
                  }
                </div>
              }
            }
          </div>
        }
      </nav>

      <div class="foot">
        <button type="button" class="item" (click)="onNavigate('settings')"><i class="pi pi-cog"></i>@if (!collapsed()) {<span>Settings</span>}</button>
        <button type="button" class="item danger" (click)="logout.emit()"><i class="pi pi-sign-out"></i>@if (!collapsed()) {<span>Log out</span>}</button>
      </div>
    </aside>

    <div class="main">
      <header>
        <p-button class="hamburger" icon="pi pi-bars" [text]="true" [rounded]="true" severity="secondary" size="small"
          (onClick)="mobileOpen.set(true)" ariaLabel="Open menu" />
        <div class="crumbs"><ng-content select="[dsCrumbs]" /></div>
        <p-iconfield class="search">
          <p-inputicon class="pi pi-search" />
          <input pInputText type="search" placeholder="Search sites and feedback…" pSize="small"
            [value]="''" (keydown.enter)="search.emit($any($event.target).value)" />
        </p-iconfield>
        <p-button [icon]="dark() ? 'pi pi-sun' : 'pi pi-moon'" [rounded]="true" [outlined]="true" severity="secondary" size="small" (onClick)="dark.set(!dark())" ariaLabel="Toggle theme" />
        @if (notifications() > 0) {
          <p-button icon="pi pi-bell" [rounded]="true" [outlined]="true" severity="secondary" size="small"
            [badge]="notifications().toString()" badgeSeverity="danger" ariaLabel="Notifications" />
        } @else {
          <p-button icon="pi pi-bell" [rounded]="true" [outlined]="true" severity="secondary" size="small" ariaLabel="Notifications" />
        }
        <span class="divider"></span>
        <button type="button" class="user" (click)="onNavigate('account')" aria-label="Your account">
          <p-avatar [label]="user().charAt(0)" shape="circle" />
          <span class="user-text"><strong>{{ user() }}</strong><small>{{ role() }}</small></span>
        </button>
      </header>
      <main><div class="content"><ng-content /></div></main>
    </div>
  `,
  styles: `
    :host { display: flex; min-height: 100vh; background: var(--ds-app-bg); position: relative; }

    /* ── Sidebar (desktop) ────────────────────────────────────────────── */
    aside { width: var(--ds-sidebar-w); flex: none; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--p-content-background); border-right: 1px solid var(--ds-border); transition: width var(--ds-trans-smooth), transform var(--ds-trans-smooth); z-index: 30; }
    :host(.collapsed) aside { width: var(--ds-sidebar-w-collapsed); }
    .brand { height: var(--ds-topbar-h); display: flex; align-items: center; gap: var(--ds-s-2); padding: 0 var(--ds-s-3) 0 var(--ds-s-5); }
    :host(.collapsed) .brand { flex-direction: column; justify-content: center; height: auto; padding: var(--ds-s-4) 0 var(--ds-s-2); }
    .logo { width: 28px; height: 28px; flex: none; border-radius: var(--ds-r-sm); background: var(--p-primary-color); color: var(--p-primary-contrast-color); display: grid; place-items: center; font-weight: 800; }
    .name { flex: 1; font-size: var(--ds-t-title); font-weight: 700; color: var(--p-text-color); white-space: nowrap; }
    .drawer-close { display: none; }
    .org { margin: 0 var(--ds-s-3) var(--ds-s-3); display: flex; align-items: center; gap: var(--ds-s-3); padding: var(--ds-s-2); border: 1px solid var(--ds-border); border-radius: var(--ds-r-md); background: var(--ds-app-bg); color: var(--p-text-muted-color); font: inherit; cursor: pointer; text-align: left; }
    .org-mark { width: 32px; height: 32px; flex: none; border-radius: var(--ds-r-sm); background: var(--ds-tint); color: var(--p-primary-color); display: grid; place-items: center; font-weight: 700; }
    .org-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .org-text strong { font-size: var(--ds-t-body); font-weight: 600; color: var(--p-text-color); }
    .org-text small { font-size: var(--ds-t-caption); font-weight: 500; }
    .org .pi { font-size: 11px; }

    nav { flex: 1; overflow-y: auto; padding: var(--ds-s-2) var(--ds-s-3); display: flex; flex-direction: column; gap: var(--ds-s-5); }
    .group { display: flex; flex-direction: column; gap: 2px; }
    .group-title { padding: 0 var(--ds-s-3) var(--ds-s-2); font-size: 11px; font-weight: 600; color: var(--p-text-muted-color); letter-spacing: 0.04em; }
    .item { display: flex; align-items: center; gap: var(--ds-s-3); height: 36px; padding: 0 var(--ds-s-3); border: 0; border-radius: var(--ds-r-sm); background: transparent; color: var(--p-text-color); font: 500 var(--ds-t-body)/1 var(--ds-font); cursor: pointer; text-align: left; width: 100%; transition: background var(--ds-trans-tap); }
    :host(.collapsed) .item { justify-content: center; padding: 0; }
    .item:hover { background: var(--ds-muted-bg); }
    .item > .pi:first-child { width: 18px; text-align: center; font-size: 15px; color: var(--p-text-muted-color); }
    .item span { flex: 1; white-space: nowrap; }
    .item.active { background: var(--p-highlight-background); color: var(--p-primary-color); font-weight: 600; }
    .item.active > .pi:first-child { color: var(--p-primary-color); }
    .item.danger, .item.danger .pi { color: var(--ds-danger-ink) !important; }
    .item.danger:hover { background: var(--ds-danger-soft); }
    .caret { font-size: 10px; color: var(--p-text-muted-color); transform: rotate(-90deg); transition: transform var(--ds-trans-tap); }
    .caret.open { transform: none; }
    .subs { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 4px 21px; padding-left: var(--ds-s-3); border-left: 1px solid var(--ds-border); }
    .sub { height: 32px; padding: 0 var(--ds-s-3); border: 0; border-radius: var(--ds-r-sm); background: transparent; font: 500 var(--ds-t-small)/1 var(--ds-font); color: var(--p-text-muted-color); cursor: pointer; text-align: left; }
    .sub:hover { color: var(--p-text-color); }
    .sub.active { background: var(--ds-muted-bg); color: var(--p-text-color); font-weight: 600; }
    .foot { padding: var(--ds-s-3); border-top: 1px solid var(--ds-border); display: flex; flex-direction: column; gap: 2px; }

    /* ── Backdrop (mobile drawer overlay) ────────────────────────────── */
    .backdrop { display: none; }

    /* ── Main ─────────────────────────────────────────────────────────── */
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    header { height: var(--ds-topbar-h); position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: var(--ds-s-3); padding: 0 var(--ds-s-8); background: var(--p-content-background); border-bottom: 1px solid var(--ds-border); }
    .hamburger { display: none; }
    .crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-body); font-weight: 500; color: var(--p-text-muted-color); white-space: nowrap; overflow: hidden; }
    .search { width: 260px; }
    .search input { width: 100%; border-radius: var(--ds-r-pill); background: var(--ds-app-bg); }
    .divider { width: 1px; height: 24px; background: var(--ds-border); }
    .user { border: 0; background: transparent; font: inherit; cursor: pointer; display: flex; align-items: center; gap: var(--ds-s-2); }
    .user-text { display: grid; gap: 2px; }
    .user-text strong { font-size: var(--ds-t-small); font-weight: 600; color: var(--p-text-color); }
    .user-text small { font-size: 11px; font-weight: 500; color: var(--p-text-muted-color); }
    main { flex: 1; padding: var(--ds-s-8); display: flex; justify-content: center; }
    .content { width: 100%; max-width: var(--ds-content-max); display: flex; flex-direction: column; gap: var(--ds-s-6); }

    /* ── Tablet ──────────────────────────────────────────────────────── */
    @media (max-width: 1180px) { .user-text { display: none; } }
    @media (max-width: 1080px) { .search { display: none; } }

    /* ── Mobile: sidebar → off-canvas drawer ─────────────────────────── */
    @media (max-width: 960px) {
      header { padding: 0 var(--ds-s-4); gap: var(--ds-s-2); }
      main { padding: var(--ds-s-4); }
      .content { gap: var(--ds-s-4); }
      .hamburger { display: inline-flex; }
      .divider { display: none; }

      /* Sidebar becomes an overlay. Not collapsed on mobile — always full width. */
      aside { position: fixed; inset: 0 auto 0 0; width: min(300px, 88vw); transform: translateX(-100%); box-shadow: var(--ds-shadow-lifted); height: 100vh; }
      :host(.mobile-open) aside { transform: none; }
      :host(.collapsed) aside { width: min(300px, 88vw); }  /* ignore desktop-collapsed on mobile */
      :host(.collapsed) .brand { flex-direction: row; justify-content: flex-start; height: var(--ds-topbar-h); padding: 0 var(--ds-s-3) 0 var(--ds-s-5); }
      :host(.collapsed) .item { justify-content: flex-start; padding: 0 var(--ds-s-3); }
      .collapse-btn { display: none; }
      .drawer-close { display: inline-flex; }

      /* Show the name + item labels even if desktop had collapsed the sidebar */
      :host(.collapsed) .name { display: inline; }

      /* Backdrop */
      .backdrop { display: block; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); opacity: 0; pointer-events: none; transition: opacity var(--ds-trans-smooth); z-index: 20; }
      :host(.mobile-open) .backdrop { opacity: 1; pointer-events: auto; }

      /* Lock body scroll while drawer open */
      :host(.mobile-open) { overflow: hidden; }
    }

    @media (max-width: 640px) {
      header { padding: 0 var(--ds-s-3); }
      main { padding: var(--ds-s-3); }
      .user { gap: 0; }
    }
  `
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
