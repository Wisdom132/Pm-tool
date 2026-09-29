import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, ErrorState } from '../../../design-system';
import { AuditApi, SitesApi, TeamsApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { AuditEvent, SiteEnvironmentDetail, Team } from '../../core/api.types';

/**
 * One site: what it points at, whether it is verified, who can edit it.
 *
 * Changing the branch is the consequential action here — it decides where
 * every future edit on this hostname lands — so it is called out rather than
 * sitting in a row of equal-looking fields.
 */
@Component({
  selector: 'app-site-detail',
  imports: [DatePipe, FormsModule, RouterLink, Button, InputText, Message, Skeleton, PageHeader, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load this site"
          [detail]="loader.error() ?? 'It may have been removed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="ds-surface panel">
        <p-skeleton width="40%" height="1.4rem" />
        <p-skeleton width="70%" height="1rem" />
      </div>
    } @else if (site(); as s) {
      <ds-page-header [title]="s.hostname" [subtitle]="s.repository + ' · ' + (s.branch ?? 'branch from the page')">
        <a
          class="p-button p-button-outlined p-button-secondary p-button-sm"
          [href]="siteUrl(s)"
          target="_blank"
          rel="noopener"
          dsActions>
          Open site <i class="pi pi-external-link"></i>
        </a>
      </ds-page-header>

      <a routerLink="/sites" class="back"><i class="pi pi-arrow-left"></i> All sites</a>

      @if (message(); as note) {
        <p-message [severity]="note.severity" [closable]="true" (onClose)="message.set(null)">
          {{ note.text }}
        </p-message>
      }

      @if (!s.site.verifiedAt) {
        <p-message severity="info" [closable]="false">
          This hostname is not verified. Add the TXT record
          <code>_inline-edit.{{ s.hostname }}</code> with the value
          <code>{{ s.site.verificationToken }}</code>, or a meta tag with the
          same value. Nothing checks it yet, so editing works either way.
        </p-message>
      }

      <section class="ds-surface panel">
        <h2>Where it points</h2>

        <div class="field">
          <label for="name">Name</label>
          <input pInputText id="name" [(ngModel)]="name" />
          <small>Shown in lists. The hostname is what the editor matches on.</small>
        </div>

        <div class="field">
          <label>Hostname</label>
          <!-- Read-only: the hostname is the key the extension resolves
               against, and the API has no way to change it. Register a new
               environment instead. -->
          <input pInputText [value]="s.hostname" disabled />
        </div>

        <div class="field">
          <label>Repository</label>
          <input pInputText [value]="s.repository" disabled />
          <small>
            Re-pointing a site at a different repository is not offered here —
            it would silently redirect every future edit. Register a new site.
          </small>
        </div>

        <div class="field">
          <label for="branch">Branch</label>
          <input
            pInputText
            id="branch"
            [(ngModel)]="branch"
            placeholder="Read from the page" />
          <small>
            Leaving this empty makes the branch come from the page, which is what
            preview deploys need. Changing it sends every future edit on this
            hostname somewhere else.
          </small>
        </div>

        <div class="actions">
          <p-button
            [label]="saving() ? 'Saving…' : 'Save changes'"
            size="small"
            [disabled]="saving() || !changed(s)"
            (onClick)="save(s)" />
        </div>
      </section>

      <section class="ds-surface panel">
        <h2>Who can edit it</h2>
        @if (teams().length) {
          <div class="teams">
            @for (t of teams(); track t.id) {
              <a class="team" [routerLink]="['/teams', t.id]">
                <strong>{{ t.name }}</strong>
                <small>{{ t.members.length }} {{ t.members.length === 1 ? 'person' : 'people' }}</small>
              </a>
            }
          </div>
        } @else {
          <p class="muted">No team covers this site, so only admins can edit it.</p>
        }
      </section>

      @if (isAdmin()) {
      <section class="ds-surface panel">
        <h2>Recent activity</h2>
        @if (activity().length) {
          <ul class="edits">
            @for (e of activity(); track e.id) {
              <li>
                <code>{{ e.action }}</code>
                <span>{{ e.actor ? (e.actor.name || e.actor.email) : 'a deleted account' }}</span>
                <small>{{ e.createdAt | date: 'd MMM, HH:mm' }}</small>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Nothing recorded for this hostname yet.</p>
        }
      </section>
      }
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
  private readonly api = inject(SitesApi);
  private readonly teamsApi = inject(TeamsApi);
  private readonly auditApi = inject(AuditApi);
  private readonly session = inject(Session);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly loader = createLoader<SiteEnvironmentDetail | null>(null);
  protected readonly site = this.loader.data;
  protected readonly teams = signal<Team[]>([]);
  protected readonly activity = signal<AuditEvent[]>([]);
  protected readonly saving = signal(false);
  protected readonly message = signal<{ severity: 'success' | 'error'; text: string } | null>(null);
  protected readonly isAdmin = this.session.isAdmin;

  protected name = '';
  protected branch = '';

  constructor() {
    this.reload();
  }

  protected reload() {
    this.api.get(this.id).subscribe({
      next: (site) => {
        this.loader.set(site);
        this.name = site.site.name;
        this.branch = site.branch ?? '';
        this.loadRelated(site);
      },
      // Let the loader own the failure path, so the error state renders.
      error: () => this.loader.load(this.api.get(this.id)),
    });
  }

  /**
   * Teams are filtered client-side because the grant is on the *site* and
   * the teams endpoint already returns each team's sites — one request
   * instead of a per-site endpoint that would exist only for this screen.
   */
  private loadRelated(site: SiteEnvironmentDetail) {
    this.teamsApi.list().subscribe({
      next: (teams) =>
        this.teams.set(teams.filter((t) => t.sites.some((s) => s.site.id === site.siteId))),
    });

    if (this.session.isAdmin()) {
      this.auditApi.list({ limit: 100 }).subscribe({
        next: (page) =>
          this.activity.set(
            page.events.filter((e) => e.subject?.includes(site.hostname)).slice(0, 8),
          ),
      });
    }
  }

  protected changed(site: SiteEnvironmentDetail) {
    return this.name.trim() !== site.site.name || this.branch.trim() !== (site.branch ?? '');
  }

  protected save(site: SiteEnvironmentDetail) {
    this.saving.set(true);
    this.message.set(null);

    this.api
      .update(site.id, {
        name: this.name.trim(),
        // Empty means "read it from the page", which is null on the wire.
        branch: this.branch.trim() || null,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.message.set({ severity: 'success', text: 'Saved.' });
          this.reload();
        },
        error: (err: Error) => {
          this.saving.set(false);
          this.message.set({ severity: 'error', text: err.message });
        },
      });
  }

  /** A wildcard hostname is not a URL, so there is nothing to open. */
  protected siteUrl(site: SiteEnvironmentDetail) {
    return site.hostname.includes('*') ? '#' : `https://${site.hostname}`;
  }
}
