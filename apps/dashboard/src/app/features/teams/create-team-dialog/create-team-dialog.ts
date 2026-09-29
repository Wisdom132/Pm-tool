import { ChangeDetectionStrategy, Component, effect, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Checkbox } from 'primeng/checkbox';
import { Message } from 'primeng/message';
import { MembersApi } from '../../../core/api/members-api';
import { SitesApi } from '../../../core/api/sites-api';
import { TeamsApi } from '../../../core/api/teams-api';
import type { Person, SiteEnvironment } from '../../../core/api-types';

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
  templateUrl: './create-team-dialog.html',
  styleUrl: './create-team-dialog.scss',
  imports: [FormsModule, Dialog, Button, InputText, Checkbox, Message],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
