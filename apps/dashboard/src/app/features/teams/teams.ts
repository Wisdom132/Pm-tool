import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { AvatarGroup } from 'primeng/avatargroup';
import { Avatar } from 'primeng/avatar';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { CreateTeamDialog } from './create-team-dialog/create-team-dialog';
import { TeamsApi } from '../../core/api/teams-api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Team } from '../../core/api-types';

/**
 * Teams — which sites a group of people may edit.
 *
 * The organisation role says what someone may *do*; a team says what they may
 * do it *to*. An agency's designers should not be able to edit the client
 * site they are not working on, and a role alone cannot express that.
 */
@Component({
  selector: 'app-teams',
  templateUrl: './teams.html',
  styleUrl: './teams.scss',
  imports: [RouterLink, Button, Tag, Avatar, AvatarGroup, Skeleton, PageHeader, EmptyState, ErrorState, CreateTeamDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
