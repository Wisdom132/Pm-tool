import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Avatar } from 'primeng/avatar';
import { Checkbox } from 'primeng/checkbox';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../../design-system';
import { MembersApi } from '../../../core/api/members-api';
import { SitesApi } from '../../../core/api/sites-api';
import { TeamsApi } from '../../../core/api/teams-api';
import { createLoader } from '../../../core/load-state';
import { Session } from '../../../core/session';
import type { Person, SiteEnvironment, Team } from '../../../core/api-types';

/**
 * One team: which sites it can edit, and who is in it.
 *
 * Both are saved as a whole set (`PUT`), so a checkbox writes immediately
 * rather than accumulating into a Save button. That matches what the
 * endpoint does and avoids a screen that looks saved but is not.
 */
@Component({
  selector: 'app-team-detail',
  templateUrl: './team-detail.html',
  styleUrl: './team-detail.scss',
  imports: [
    RouterLink,
    FormsModule,
    Button,
    Tag,
    Avatar,
    Checkbox,
    Message,
    Skeleton,
    PageHeader,
    EmptyState,
    ErrorState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamDetail {
  private readonly teamsApi = inject(TeamsApi);
  private readonly sitesApi = inject(SitesApi);
  private readonly membersApi = inject(MembersApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly loader = createLoader<Team | null>(null);
  protected readonly team = this.loader.data;
  protected readonly sites = signal<SiteEnvironment[]>([]);
  protected readonly candidates = signal<Person[]>([]);
  protected readonly saving = signal<'sites' | 'members' | null>(null);
  protected readonly deleting = signal(false);
  protected readonly error = signal('');
  protected readonly isAdmin = this.session.isAdmin;

  /** Derived from the loaded team, so a save that returns the team updates both. */
  protected readonly siteIds = computed(() => this.team()?.sites.map((s) => s.site.id) ?? []);
  protected readonly memberIds = computed(() => this.team()?.members.map((m) => m.user.id) ?? []);

  constructor() {
    this.reload();
    this.sitesApi.list().subscribe({ next: (s) => this.sites.set(s) });
    this.membersApi.list().subscribe({
      // Only accepted members: a pending invitation has no user id yet, so
      // it cannot be put in a team.
      next: (people) => this.candidates.set(people.filter((p) => p.kind === 'member')),
    });
  }

  protected reload() {
    this.loader.load(this.teamsApi.get(this.id));
  }

  protected subtitle(team: Team) {
    const people = team.members.length === 1 ? '1 person' : `${team.members.length} people`;
    const sites = team.sites.length === 1 ? '1 site' : `${team.sites.length} sites`;
    return `Team · ${people} · ${sites}`;
  }

  /**
   * Writes the whole set on every toggle.
   *
   * The endpoint is a `PUT`, and sending the current set is both what it
   * expects and what makes a concurrent change by another admin visible —
   * the response is the team as it now stands.
   */
  protected toggleSite(siteId: string) {
    const next = this.siteIds().includes(siteId)
      ? this.siteIds().filter((id) => id !== siteId)
      : [...this.siteIds(), siteId];

    this.save('sites', this.teamsApi.setSites(this.id, next));
  }

  protected toggleMember(userId: string) {
    const next = this.memberIds().includes(userId)
      ? this.memberIds().filter((id) => id !== userId)
      : [...this.memberIds(), userId];

    this.save('members', this.teamsApi.setMembers(this.id, next));
  }

  private save(what: 'sites' | 'members', request: ReturnType<TeamsApi['setSites']>) {
    this.saving.set(what);
    this.error.set('');

    request.subscribe({
      next: (team) => {
        this.saving.set(null);
        // The response is the new truth, so the checkboxes follow it rather
        // than the optimistic value — a rejected id then visibly snaps back.
        this.loader.set(team);
      },
      error: (err: Error) => {
        this.saving.set(null);
        this.error.set(err.message);
        // Re-read, so the UI shows what was actually saved.
        this.reload();
      },
    });
  }

  protected remove(team: Team) {
    this.deleting.set(true);
    this.error.set('');

    this.teamsApi.remove(team.id).subscribe({
      next: () => void this.router.navigate(['/teams']),
      error: (err: Error) => {
        this.deleting.set(false);
        this.error.set(err.message);
      },
    });
  }
}
