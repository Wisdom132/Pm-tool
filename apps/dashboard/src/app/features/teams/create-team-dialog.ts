import { ChangeDetectionStrategy, Component, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Checkbox } from 'primeng/checkbox';
import { MOCK_MEMBERS, MOCK_SITES, Team } from '../../core/mock-data';

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
  imports: [FormsModule, Dialog, Button, InputText, Checkbox],
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
        <div class="field">
          <label for="name">Name</label>
          <input pInputText id="name" [(ngModel)]="name" placeholder="Marketing" />
        </div>

        <div class="field">
          <label>Sites this team can edit</label>
          <div class="options">
            @for (s of sites; track s.id) {
              <label class="option">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="siteIds().includes(s.id)"
                  (ngModelChange)="toggleSite(s.id)" />
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
            @for (m of members; track m.id) {
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
        <p-button label="Create team" [disabled]="!name.trim()" (onClick)="create()" />
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
  readonly visible = model(false);
  readonly created = output<Team>();

  protected name = '';
  protected readonly siteIds = signal<string[]>([]);
  protected readonly memberIds = signal<string[]>([]);
  protected readonly sites = MOCK_SITES;
  protected readonly members = MOCK_MEMBERS;

  protected toggleSite(id: string) {
    this.siteIds.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  protected toggleMember(id: string) {
    this.memberIds.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  protected create() {
    this.created.emit({
      id: `team-${Date.now()}`,
      name: this.name.trim(),
      isDefault: false,
      memberIds: this.memberIds(),
      siteIds: this.siteIds(),
    });
    this.visible.set(false);
  }

  protected reset() {
    this.name = '';
    this.siteIds.set([]);
    this.memberIds.set([]);
  }
}
