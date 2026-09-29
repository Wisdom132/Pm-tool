import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { AvatarGroup } from 'primeng/avatargroup';
import { Avatar } from 'primeng/avatar';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { CreateTeamDialog } from './create-team-dialog';
import { TeamsApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Team } from '../../core/api.types';

/**
 * Teams — which sites a group of people may edit.
 *
 * The organisation role says what someone may *do*; a team says what they may
 * do it *to*. An agency's designers should not be able to edit the client
 * site they are not working on, and a role alone cannot express that.
 */
@Component({
  selector: 'app-teams',
  imports: [RouterLink, Button, Tag, Avatar, AvatarGroup, Skeleton, PageHeader, EmptyState, ErrorState, CreateTeamDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Teams" subtitle="Which sites each group of people can edit">
      @if (isAdmin()) {
        <p-button label="New team" icon="pi pi-plus" size="small" dsActions (onClick)="creating.set(true)" />
      }
    </ds-page-header>

    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load your teams"
          [detail]="loader.error() ?? 'The request for this list failed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="grid">
        @for (n of [1, 2, 3]; track n) {
          <div class="ds-surface card">
            <p-skeleton width="45%" height="1.2rem" />
            <p-skeleton width="70%" height="0.8rem" />
          </div>
        }
      </div>
    } @else if (!teams().length) {
      <div class="ds-surface">
        <ds-empty-state
          icon="pi pi-sitemap"
          title="No teams yet"
          description="A team decides which sites a group of people can edit. Until there is one, only admins can edit anything.">
          <p-button label="New team" icon="pi pi-plus" size="small" (onClick)="creating.set(true)" />
        </ds-empty-state>
      </div>
    } @else {
    <div class="grid">
      @for (t of teams(); track t.id) {
        <a class="ds-surface card" [routerLink]="['/teams', t.id]">
          <div class="card-head">
            <strong>{{ t.name }}</strong>
            @if (t.isDefault) {
              <p-tag value="Default" severity="secondary" [rounded]="true" />
            }
          </div>

          <div class="people">
            <p-avatargroup>
              @for (m of t.members.slice(0, 4); track m.user.id) {
                <p-avatar [label]="initial(m.user.name || m.user.email)" shape="circle" size="normal" />
              }
              @if (t.members.length > 4) {
                <p-avatar [label]="'+' + (t.members.length - 4)" shape="circle" size="normal" />
              }
            </p-avatargroup>
            <span class="muted">
              {{ t.members.length }} {{ t.members.length === 1 ? 'person' : 'people' }}
            </span>
          </div>

          <div class="sites">
            @for (h of hostnamesOf(t).slice(0, 3); track h) {
              <code>{{ h }}</code>
            }
            @if (hostnamesOf(t).length > 3) {
              <span class="muted">+{{ hostnamesOf(t).length - 3 }} more</span>
            }
            @if (!hostnamesOf(t).length) {
              <span class="muted warn">No sites — this team cannot edit anything yet</span>
            }
          </div>
        </a>
      }
    </div>
    }

    <p class="note">
      Everyone joins <strong>Everyone</strong> when they accept an invitation.
      Without a default, a new editor would sign in to an empty dashboard and
      read it as a broken invitation rather than as missing access.
    </p>

    <app-create-team-dialog [(visible)]="creating" (created)="onCreated()" />
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .grid { display: grid; gap: var(--ds-s-4); grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
    .card { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); text-decoration: none; color: inherit; transition: border-color var(--ds-trans-tap), box-shadow var(--ds-trans-tap); }
    .card:hover { border-color: var(--p-primary-color); box-shadow: var(--ds-shadow-lifted); text-decoration: none; }
    .card-head { display: flex; align-items: center; gap: var(--ds-s-2); }
    .card-head strong { font-size: var(--ds-t-title); color: var(--p-text-color); }
    .people { display: flex; align-items: center; gap: var(--ds-s-3); }
    .sites { display: flex; flex-wrap: wrap; gap: var(--ds-s-2); padding-top: var(--ds-s-3); border-top: 1px solid var(--ds-hairline); }
    .sites code { padding: 2px 7px; border-radius: var(--ds-r-sm); background: var(--ds-muted-bg); font-size: var(--ds-t-caption); color: var(--p-text-color); }
    .muted { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .warn { color: var(--ds-warn-ink); }
    .note { margin: 0; max-width: 70ch; font-size: var(--ds-t-caption); line-height: 1.6; color: var(--p-text-muted-color); }
  `,
})
export class Teams {
  private readonly api = inject(TeamsApi);
  private readonly session = inject(Session);

  protected readonly creating = signal(false);
  protected readonly loader = createLoader<Team[]>([]);
  protected readonly teams = this.loader.data;
  protected readonly isAdmin = this.session.isAdmin;

  constructor() {
    this.reload();
  }

  protected reload() {
    this.loader.load(this.api.list());
  }

  /**
   * A team grants access to a *site*, which may have several hostnames, so
   * the card shows hostnames rather than site names — that is what an editor
   * recognises.
   */
  protected hostnamesOf(team: Team) {
    return team.sites.flatMap((s) => s.site.environments.map((e) => e.hostname));
  }

  protected initial(s: string) {
    return s.charAt(0).toUpperCase();
  }

  /** Re-fetch rather than append: the server assigns the id and defaults. */
  protected onCreated() {
    this.reload();
  }
}
