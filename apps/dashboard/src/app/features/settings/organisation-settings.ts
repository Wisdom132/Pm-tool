import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Router } from '@angular/router';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, ErrorState } from '../../../design-system';
import { OrganisationApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Organisation } from '../../core/api.types';

@Component({
  selector: 'app-organisation-settings',
  imports: [FormsModule, Button, InputText, Message, Skeleton, PageHeader, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Organisation" subtitle="Name, address and what happens if you leave" />

    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load this organisation"
          [detail]="loader.error() ?? 'The request failed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="ds-surface panel">
        <p-skeleton width="30%" height="1.2rem" />
        <p-skeleton width="60%" height="2rem" />
      </div>
    } @else if (organisation(); as org) {
      @if (message(); as note) {
        <p-message [severity]="note.severity" [closable]="true" (onClose)="message.set(null)">
          {{ note.text }}
        </p-message>
      }

      <section class="ds-surface panel">
        <h2>General</h2>
        <div class="field">
          <label for="orgname">Name</label>
          <input pInputText id="orgname" [(ngModel)]="name" />
          <small>Shown in the sidebar and on invitations.</small>
        </div>
        <div class="field">
          <label for="slug">URL</label>
          <div class="slug">
            <span>app.inline-edit.com/</span>
            <!-- Read-only: the slug may already be in links somebody saved,
                 so changing it would break them. The API does not offer it. -->
            <input pInputText id="slug" [value]="org.slug" disabled />
          </div>
        </div>
        <div class="actions">
          <p-button
            [label]="saving() ? 'Saving…' : 'Save changes'"
            size="small"
            [disabled]="saving() || !name.trim() || name.trim() === org.name"
            (onClick)="save()" />
        </div>
      </section>

      <section class="ds-surface panel danger">
        <h2>Delete this organisation</h2>
        <p>
          Removes every site, team and piece of feedback.
          <strong>Your repositories and their pull requests are untouched</strong>
          — they live on GitHub, not here.
        </p>

        @if (org._count.connections > 0) {
          <!-- The API refuses this, because a soft delete cannot uninstall
               the app from somebody's repositories. -->
          <p-message severity="info" [closable]="false">
            Revoke the {{ org._count.connections }} provider
            {{ org._count.connections === 1 ? 'connection' : 'connections' }} first —
            deleting this does not uninstall the app from your repositories.
          </p-message>
        } @else {
          <p-message severity="warn" [closable]="false">
            This cannot be undone, and
            {{ org._count.memberships }} {{ org._count.memberships === 1 ? 'person' : 'people' }}
            lose access immediately.
          </p-message>

          <div class="field">
            <label for="confirm">Type <strong>{{ org.name }}</strong> to confirm</label>
            <input pInputText id="confirm" [(ngModel)]="confirm" [placeholder]="org.name" />
          </div>
        }

        <div class="actions">
          <p-button
            [label]="deleting() ? 'Deleting…' : 'Delete organisation'"
            severity="danger"
            [outlined]="true"
            size="small"
            [disabled]="deleting() || org._count.connections > 0 || confirm.trim() !== org.name"
            (onClick)="remove(org)" />
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); max-width: 640px; }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .panel p { margin: 0; font-size: var(--ds-t-small); line-height: 1.6; color: var(--p-text-muted-color); }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .slug { display: flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-small); color: var(--p-text-muted-color); }
    .slug input { flex: 1; }
    .actions { display: flex; justify-content: flex-start; }
    .danger { border-color: color-mix(in srgb, var(--ds-danger-ink) 24%, transparent); }
  `,
})
export class OrganisationSettings {
  private readonly api = inject(OrganisationApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  protected readonly loader = createLoader<Organisation | null>(null);
  protected readonly organisation = this.loader.data;
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly message = signal<{ severity: 'success' | 'error'; text: string } | null>(null);

  protected name = '';
  protected confirm = '';

  constructor() {
    this.reload();
  }

  protected reload() {
    this.api.get().subscribe({
      next: (org) => {
        this.loader.set(org);
        this.name = org.name;
      },
      error: () => this.loader.load(this.api.get()),
    });
  }

  protected save() {
    this.saving.set(true);
    this.message.set(null);

    this.api.rename(this.name.trim()).subscribe({
      next: (org) => {
        this.saving.set(false);
        this.loader.set(org as Organisation);
        this.message.set({ severity: 'success', text: 'Saved.' });
        // The sidebar shows this name, and it comes from /auth/me.
        void this.session.refresh();
      },
      error: (err: Error) => {
        this.saving.set(false);
        this.message.set({ severity: 'error', text: err.message });
      },
    });
  }

  protected remove(org: Organisation) {
    this.deleting.set(true);
    this.message.set(null);

    this.api.remove(this.confirm.trim()).subscribe({
      next: async () => {
        // The organisation they were in no longer exists, so the session has
        // to be re-read before anything else renders against it.
        await this.session.refresh();
        void this.router.navigate(['/']);
      },
      error: (err: Error) => {
        this.deleting.set(false);
        this.message.set({ severity: 'error', text: err.message });
      },
    });
  }
}
