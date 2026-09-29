import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Avatar } from 'primeng/avatar';
import { Checkbox } from 'primeng/checkbox';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { MembersApi, SitesApi, TeamsApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Person, SiteEnvironment, Team } from '../../core/api.types';

/**
 * One team: which sites it can edit, and who is in it.
 *
 * Both are saved as a whole set (`PUT`), so a checkbox writes immediately
 * rather than accumulating into a Save button. That matches what the
 * endpoint does and avoids a screen that looks saved but is not.
 */
@Component({
  selector: 'app-team-detail',
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
  template: `
    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load this team"
          [detail]="loader.error() ?? 'It may have been deleted.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="ds-surface panel">
        <p-skeleton width="30%" height="1.4rem" />
        <p-skeleton width="60%" height="1rem" />
      </div>
    } @else if (team(); as t) {
      <ds-page-header [title]="t.name" [subtitle]="subtitle(t)">
        @if (!t.isDefault && isAdmin()) {
          <p-button
            [label]="deleting() ? 'Deleting…' : 'Delete team'"
            [text]="true"
            severity="danger"
            size="small"
            [disabled]="deleting()"
            dsActions
            (onClick)="remove(t)" />
        }
      </ds-page-header>

      <a routerLink="/teams" class="back"><i class="pi pi-arrow-left"></i> All teams</a>

      @if (error()) {
        <p-message severity="error" [closable]="true" (onClose)="error.set('')">{{ error() }}</p-message>
      }

      <section class="ds-surface panel">
        <header>
          <h2>Sites</h2>
          <span class="muted">
            @if (saving() === 'sites') { Saving… } @else { What this team is allowed to edit }
          </span>
        </header>

        @if (t.isDefault) {
          <p class="locked">
            <i class="pi pi-info-circle"></i>
            Every newly registered site is added to this team automatically, and
            everyone who accepts an invitation joins it — so it is what stops a
            new editor signing in to an empty dashboard. You can still narrow it
            here, but new sites will keep appearing.
          </p>
        }

        @if (!sites().length) {
          <ds-empty-state
            icon="pi pi-globe"
            title="No sites registered"
            description="Register a site first — until then there is nothing to grant."
            size="sm" />
        } @else {
          <div class="options">
            @for (s of sites(); track s.id) {
              <label class="option" [class.disabled]="!isAdmin()">
                <p-checkbox
                  [binary]="true"
                  [disabled]="!isAdmin() || saving() === 'sites'"
                  [ngModel]="siteIds().includes(s.siteId)"
                  (ngModelChange)="toggleSite(s.siteId)" />
                <span class="text">
                  <strong>{{ s.hostname }}</strong>
                  <small>{{ s.repository }} · {{ s.branch ?? 'branch from the page' }}</small>
                </span>
                <p-tag [value]="s.label" severity="secondary" [rounded]="true" />
              </label>
            }
          </div>
        }
      </section>

      <section class="ds-surface panel">
        <header>
          <h2>Members</h2>
          <span class="muted">
            @if (saving() === 'members') { Saving… } @else { {{ t.members.length }} in this team }
          </span>
        </header>

        @if (!candidates().length) {
          <ds-empty-state
            icon="pi pi-users"
            title="Nobody to add"
            description="Invite someone from the People page first."
            size="sm" />
        } @else {
          <ul class="people">
            @for (p of candidates(); track p.id) {
              <li>
                @if (isAdmin()) {
                  <p-checkbox
                    [binary]="true"
                    [disabled]="saving() === 'members'"
                    [ngModel]="memberIds().includes(p.id)"
                    (ngModelChange)="toggleMember(p.id)" />
                }
                <p-avatar [label]="(p.name || p.email).charAt(0).toUpperCase()" shape="circle" />
                <span class="text">
                  <strong>{{ p.name || p.email }}</strong>
                  <small>{{ p.email }}</small>
                </span>
                <p-tag
                  [value]="p.role === 'admin' ? 'Admin' : 'Editor'"
                  [severity]="p.role === 'admin' ? 'info' : 'secondary'"
                  [rounded]="true" />
              </li>
            }
          </ul>
          <small class="hint">
            Admins reach every site regardless of team, so adding one changes
            nothing about their access.
          </small>
        }
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-4); }
    .back { display: inline-flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-caption); color: var(--p-text-muted-color); justify-self: start; }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); }
    .panel header { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-s-3); }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .muted { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .locked { margin: 0; display: flex; align-items: flex-start; gap: var(--ds-s-2); padding: var(--ds-s-3); border-radius: var(--ds-r-sm); background: var(--ds-muted-bg); font-size: var(--ds-t-caption); line-height: 1.55; color: var(--p-text-muted-color); }
    .options { display: grid; gap: 1px; }
    .option { display: flex; align-items: center; gap: var(--ds-s-3); padding: var(--ds-s-3); border-radius: var(--ds-r-sm); cursor: pointer; }
    .option:hover:not(.disabled) { background: var(--ds-muted-bg); }
    .option.disabled { cursor: default; opacity: 0.75; }
    .option .text, .people .text { flex: 1; min-width: 0; display: grid; gap: 1px; }
    .option strong, .people strong { font-size: var(--ds-t-small); font-weight: 600; color: var(--p-text-color); }
    .option small, .people small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .people { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ds-s-2); }
    .people li { display: flex; align-items: center; gap: var(--ds-s-3); }
    .hint { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }
  `,
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
