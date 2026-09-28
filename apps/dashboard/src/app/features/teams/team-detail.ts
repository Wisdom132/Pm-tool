import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Avatar } from 'primeng/avatar';
import { Checkbox } from 'primeng/checkbox';
import { PageHeader, EmptyState } from '../../../design-system';
import { MOCK_TEAMS, MOCK_MEMBERS, MOCK_SITES } from '../../core/mock-data';

@Component({
  selector: 'app-team-detail',
  imports: [RouterLink, FormsModule, Button, Tag, Avatar, Checkbox, PageHeader, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (team; as t) {
      <ds-page-header [title]="t.name" [subtitle]="'Team · ' + t.memberIds.length + ' people · ' + siteIds().length + ' sites'">
        @if (!t.isDefault) {
          <p-button label="Delete team" [text]="true" severity="danger" size="small" dsActions />
        }
      </ds-page-header>

      <a routerLink="/teams" class="back"><i class="pi pi-arrow-left"></i> All teams</a>

      <section class="ds-surface panel">
        <header>
          <h2>Sites</h2>
          <span class="muted">What this team is allowed to edit</span>
        </header>

        @if (t.isDefault) {
          <p class="locked">
            <i class="pi pi-lock"></i>
            The default team always covers every site, so that a new member is
            never left with an empty dashboard. Make another team to narrow
            access.
          </p>
        }

        <div class="options">
          @for (s of sites; track s.id) {
            <label class="option" [class.disabled]="t.isDefault">
              <p-checkbox
                [binary]="true"
                [disabled]="t.isDefault"
                [ngModel]="siteIds().includes(s.id)"
                (ngModelChange)="toggleSite(s.id)" />
              <span class="text">
                <strong>{{ s.hostname }}</strong>
                <small>{{ s.repository }} · {{ s.branch ?? 'branch from the page' }}</small>
              </span>
              <p-tag [value]="s.label" severity="secondary" [rounded]="true" />
            </label>
          }
        </div>
      </section>

      <section class="ds-surface panel">
        <header>
          <h2>Members</h2>
          <p-button label="Add people" icon="pi pi-plus" size="small" [text]="true" />
        </header>

        @if (members.length) {
          <ul class="people">
            @for (m of members; track m.id) {
              <li>
                <p-avatar [label]="(m.name || m.email).charAt(0).toUpperCase()" shape="circle" />
                <span class="text">
                  <strong>{{ m.name || m.email }}</strong>
                  <small>{{ m.email }}</small>
                </span>
                <p-tag
                  [value]="m.role === 'admin' ? 'Admin' : 'Editor'"
                  [severity]="m.role === 'admin' ? 'info' : 'secondary'"
                  [rounded]="true" />
                <p-button icon="pi pi-times" [text]="true" [rounded]="true" severity="secondary" size="small" ariaLabel="Remove" />
              </li>
            }
          </ul>
        } @else {
          <ds-empty-state
            icon="pi pi-users"
            title="Nobody in this team"
            description="A team with no members is a rule nobody is subject to."
            size="sm" />
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
  `,
})
export class TeamDetail {
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');

  protected readonly team = MOCK_TEAMS.find((t) => t.id === this.id) ?? null;

  /** Local until there is an API to save to. */
  protected readonly siteIds = signal<string[]>(this.team?.siteIds ?? []);

  protected readonly sites = MOCK_SITES;

  protected readonly members = MOCK_MEMBERS.filter((m) => this.team?.memberIds.includes(m.id));

  protected toggleSite(id: string) {
    this.siteIds.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }
}
