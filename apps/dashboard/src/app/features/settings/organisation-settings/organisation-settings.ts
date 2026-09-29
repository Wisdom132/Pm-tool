import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Router } from '@angular/router';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, ErrorState } from '../../../../design-system';
import { OrganisationApi } from '../../../core/api/organisation-api';
import { createLoader } from '../../../core/load-state';
import { Session } from '../../../core/session';
import type { Organisation } from '../../../core/api-types';

@Component({
  selector: 'app-organisation-settings',
  templateUrl: './organisation-settings.html',
  styleUrl: './organisation-settings.scss',
  imports: [FormsModule, Button, InputText, Message, Skeleton, PageHeader, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
