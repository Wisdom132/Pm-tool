import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Message } from 'primeng/message';
import { PageHeader } from '../../../design-system';
import { MOCK_SITES, MOCK_TEAMS } from '../../core/mock-data';

/**
 * One site: what it points at, whether it is verified, who can edit it.
 *
 * Changing the branch is the consequential action here — it decides where
 * every future edit on this hostname lands — so it is called out rather than
 * sitting in a row of equal-looking fields.
 */
@Component({
  selector: 'app-site-detail',
  imports: [DatePipe, FormsModule, RouterLink, Button, InputText, Select, Tag, Message, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (site; as s) {
      <ds-page-header [title]="s.hostname" [subtitle]="s.repository + ' · ' + (s.branch ?? 'branch from the page')">
        <p-button label="Open site" icon="pi pi-external-link" iconPos="right" [outlined]="true" severity="secondary" size="small" dsActions />
      </ds-page-header>

      <a routerLink="/sites" class="back"><i class="pi pi-arrow-left"></i> All sites</a>

      @if (!s.verified) {
        <p-message severity="warn" [closable]="false">
          This hostname is not verified, so feedback and edits from it are held.
          <a href="#">Finish verification</a>.
        </p-message>
      }

      <section class="ds-surface panel">
        <h2>Where it points</h2>

        <div class="field">
          <label for="hostname">Hostname</label>
          <input pInputText id="hostname" [(ngModel)]="hostname" />
        </div>

        <div class="field">
          <label for="branch">Branch</label>
          <p-select
            id="branch"
            [options]="branches"
            [(ngModel)]="branch"
            placeholder="Read from the page"
            [showClear]="true"
            [fluid]="true" />
          <small>
            Clearing this makes the branch come from the page, which is what
            preview deploys need. Changing it sends every future edit on this
            hostname somewhere else.
          </small>
        </div>

        <div class="actions"><p-button label="Save changes" size="small" /></div>
      </section>

      <section class="ds-surface panel">
        <h2>Who can edit it</h2>
        @if (teams().length) {
          <div class="teams">
            @for (t of teams(); track t.id) {
              <a class="team" [routerLink]="['/teams', t.id]">
                <strong>{{ t.name }}</strong>
                <small>{{ t.memberIds.length }} {{ t.memberIds.length === 1 ? 'person' : 'people' }}</small>
              </a>
            }
          </div>
        } @else {
          <p class="muted">No team covers this site, so only admins can edit it.</p>
        }
      </section>

      <section class="ds-surface panel">
        <h2>Recent edits</h2>
        @if (s.lastEditedAt) {
          <ul class="edits">
            <li>
              <code>pr.opened</code>
              <span>Ada Obi changed the hero heading</span>
              <small>{{ s.lastEditedAt | date: 'd MMM, HH:mm' }}</small>
            </li>
          </ul>
        } @else {
          <p class="muted">Nothing yet.</p>
        }
      </section>
    } @else {
      <p class="muted">That site does not exist.</p>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-4); }
    .back { display: inline-flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-caption); color: var(--p-text-muted-color); justify-self: start; }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); max-width: 640px; }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }
    .actions { display: flex; }
    .teams { display: flex; flex-wrap: wrap; gap: var(--ds-s-2); }
    .team { display: grid; gap: 1px; padding: var(--ds-s-2) var(--ds-s-3); border: 1px solid var(--ds-border); border-radius: var(--ds-r-md); text-decoration: none; }
    .team strong { font-size: var(--ds-t-small); color: var(--p-text-color); }
    .team small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .edits { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ds-s-2); }
    .edits li { display: flex; align-items: center; gap: var(--ds-s-3); font-size: var(--ds-t-small); }
    .edits code { font-size: var(--ds-t-caption); color: var(--p-primary-color); }
    .edits small { margin-left: auto; font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .muted { margin: 0; font-size: var(--ds-t-small); color: var(--p-text-muted-color); }
  `,
})
export class SiteDetail {
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  protected readonly site = MOCK_SITES.find((s) => s.id === this.id) ?? null;

  protected hostname = this.site?.hostname ?? '';
  protected branch = this.site?.branch ?? null;
  protected readonly branches = ['main', 'develop', 'staging'];

  protected readonly teams = signal(
    MOCK_TEAMS.filter((t) => this.site && t.siteIds.includes(this.site.id))
  );
}
