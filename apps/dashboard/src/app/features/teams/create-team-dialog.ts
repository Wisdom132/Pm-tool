import { ChangeDetectionStrategy, Component, effect, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Checkbox } from 'primeng/checkbox';
import { Message } from 'primeng/message';
import { MembersApi, SitesApi, TeamsApi } from '../../core/api';
import type { Person, SiteEnvironment } from '../../core/api.types';

/**
 * Creating a team.
 *
 * Sites and members are both chosen here rather than left for afterwards: a
 * team with no sites can edit nothing, and one with no members is a rule
 * nobody is subject to. Either on its own is a half-made thing that looks
 * finished in the list.
 */
@Component({
  selector: 'app-create-team-dialog',
  imports: [FormsModule, Dialog, Button, InputText, Checkbox, Message],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: '560px' }"
      (onHide)="reset()">
      <ng-template #header>
        <div class="head">
          <strong>New team</strong>
          <small>A group of people, and the sites they can edit</small>
        </div>
      </ng-template>

      <div class="form">
        @if (error()) {
          <p-message severity="error" [closable]="false">{{ error() }}</p-message>
        }

        <div class="field">
          <label for="name">Name</label>
          <input pInputText id="name" [(ngModel)]="name" placeholder="Marketing" />
        </div>

        <div class="field">
          <label>Sites this team can edit</label>
          <div class="options">
            @for (s of sites(); track s.id) {
              <label class="option">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="siteIds().includes(s.siteId)"
                  (ngModelChange)="toggleSite(s.siteId)" />
                <span class="text">
                  <strong>{{ s.hostname }}</strong>
                  <small>{{ s.repository }} · {{ s.branch ?? 'branch from the page' }}</small>
                </span>
              </label>
            }
          </div>
        </div>

        <div class="field">
          <label>Members</label>
          <div class="options">
            @for (m of members(); track m.id) {
              <label class="option">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="memberIds().includes(m.id)"
                  (ngModelChange)="toggleMember(m.id)" />
                <span class="text">
                  <strong>{{ m.name || m.email }}</strong>
                  <small>{{ m.role === 'admin' ? 'Admin — already has every site' : m.email }}</small>
                </span>
              </label>
            }
          </div>
          <small class="hint">
            Admins can edit every site regardless, so adding one here changes
            nothing. It is allowed because a team is also how people find each
            other.
          </small>
        </div>
      </div>

      <ng-template #footer>
        <p-button label="Cancel" [text]="true" severity="secondary" (onClick)="visible.set(false)" />
        <p-button
          [label]="saving() ? 'Creating…' : 'Create team'"
          [disabled]="!name.trim() || saving()"
          (onClick)="create()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .head { display: grid; gap: 2px; }
    .head strong { font-size: var(--ds-t-title); }
    .head small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); font-weight: 500; }
    .form { display: grid; gap: var(--ds-s-5); }
    .field { display: grid; gap: var(--ds-s-2); }
    .field > label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .options { display: grid; gap: 1px; max-height: 190px; overflow-y: auto; border: 1px solid var(--ds-border); border-radius: var(--ds-r-md); padding: var(--ds-s-2); }
    .option { display: flex; align-items: center; gap: var(--ds-s-3); padding: var(--ds-s-2) var(--ds-s-2); border-radius: var(--ds-r-sm); cursor: pointer; }
    .option:hover { background: var(--ds-muted-bg); }
    .option .text { display: grid; gap: 1px; min-width: 0; }
    .option strong { font-size: var(--ds-t-small); font-weight: 600; color: var(--p-text-color); }
    .option small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .hint { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }
  `,
})
export class CreateTeamDialog {
  private readonly teamsApi = inject(TeamsApi);
  private readonly sitesApi = inject(SitesApi);
  private readonly membersApi = inject(MembersApi);

  readonly visible = model(false);
  readonly created = output<void>();

  protected name = '';
  protected readonly siteIds = signal<string[]>([]);
  protected readonly memberIds = signal<string[]>([]);
  protected readonly sites = signal<SiteEnvironment[]>([]);
  protected readonly members = signal<Person[]>([]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string>('');

  constructor() {
    // Loaded when the dialog opens rather than on construction: the lists
    // change as sites are registered and people invited, and a dialog that
    // fetched once at page load would offer a stale set.
    effect(() => {
      if (!this.visible()) return;
      this.sitesApi.list().subscribe({ next: (s) => this.sites.set(s) });
      // Only accepted members: a pending invitation has no user id to add
      // to a team, and the API would reject it.
      this.membersApi.list().subscribe({
        next: (people) => this.members.set(people.filter((p) => p.kind === 'member')),
      });
    });
  }

  protected toggleSite(id: string) {
    this.siteIds.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  protected toggleMember(id: string) {
    this.memberIds.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  /**
   * Three calls: create, then set members, then set sites.
   *
   * Not one, because `POST /teams` takes only a name — the member and site
   * sets are `PUT`s against a team that has to exist first. A failure after
   * the create leaves a real team with partial access rather than nothing,
   * so the dialog stays open and says what happened instead of silently
   * dropping the selection.
   */
  protected create() {
    this.saving.set(true);
    this.error.set('');

    this.teamsApi.create(this.name.trim()).subscribe({
      next: (team) => {
        const memberIds = this.memberIds();
        const siteIds = this.siteIds();

        const after = () => {
          this.saving.set(false);
          this.created.emit();
          this.visible.set(false);
        };

        const setSites = () =>
          siteIds.length
            ? this.teamsApi.setSites(team.id, siteIds).subscribe({ next: after, error: this.fail })
            : after();

        if (memberIds.length) {
          this.teamsApi
            .setMembers(team.id, memberIds)
            .subscribe({ next: setSites, error: this.fail });
        } else {
          setSites();
        }
      },
      error: this.fail,
    });
  }

  private readonly fail = (err: Error) => {
    this.saving.set(false);
    this.error.set(err.message);
  };

  protected reset() {
    this.name = '';
    this.siteIds.set([]);
    this.memberIds.set([]);
    this.error.set('');
  }
}
