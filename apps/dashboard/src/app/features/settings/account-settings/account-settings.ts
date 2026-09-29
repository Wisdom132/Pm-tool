import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { DatePipe } from '@angular/common';
import { Message } from 'primeng/message';
import { PageHeader } from '../../../../design-system';
import { AuthApi } from '../../../core/api/auth-api';
import { Session } from '../../../core/session';
import type { ExtensionToken } from '../../../core/api-types';

@Component({
  selector: 'app-account-settings',
  templateUrl: './account-settings.html',
  styleUrl: './account-settings.scss',
  imports: [DatePipe, FormsModule, Button, InputText, Message, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountSettings {
  private readonly api = inject(AuthApi);
  private readonly session = inject(Session);

  protected name = this.session.user()?.name ?? '';
  protected readonly email = () => this.session.user()?.email ?? '';
  protected readonly saving = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly message = signal<{ severity: 'success' | 'error'; text: string } | null>(null);
  protected readonly tokens = signal<ExtensionToken[]>([]);
  protected readonly issued = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly revoking = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected label = '';

  constructor() {
    this.loadTokens();
  }

  private loadTokens() {
    this.api.extensionTokens().subscribe({ next: (t) => this.tokens.set(t) });
  }

  protected createToken() {
    this.creating.set(true);
    this.message.set(null);
    this.copied.set(false);

    this.api.createExtensionToken(this.label.trim() || undefined).subscribe({
      next: ({ token }) => {
        this.creating.set(false);
        // Held in a signal only until the page is left. There is nowhere to
        // fetch it from again, which is what makes it safe to forget.
        this.issued.set(token);
        this.label = '';
        this.loadTokens();
      },
      error: (err: Error) => {
        this.creating.set(false);
        this.message.set({ severity: 'error', text: err.message });
      },
    });
  }

  protected async copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      this.copied.set(true);
    } catch {
      // Clipboard access can be denied; the token is on screen to select.
      this.copied.set(false);
    }
  }

  protected revoke(token: ExtensionToken) {
    this.revoking.set(token.id);

    this.api.revokeExtensionToken(token.id).subscribe({
      next: () => {
        this.revoking.set(null);
        this.loadTokens();
      },
      error: (err: Error) => {
        this.revoking.set(null);
        this.message.set({ severity: 'error', text: err.message });
      },
    });
  }

  protected save() {
    this.saving.set(true);
    this.message.set(null);

    this.api.updateProfile(this.name).subscribe({
      next: async () => {
        // The shell shows this name, and it comes from /auth/me.
        await this.session.refresh();
        this.saving.set(false);
        this.message.set({ severity: 'success', text: 'Saved.' });
      },
      error: (err: Error) => {
        this.saving.set(false);
        this.message.set({ severity: 'error', text: err.message });
      },
    });
  }

  protected signOutEverywhere() {
    this.signingOut.set(true);
    this.message.set(null);

    this.api.signOutEverywhere().subscribe({
      next: () => {
        this.signingOut.set(false);
        this.message.set({
          severity: 'success',
          text: 'Every other session has been signed out. This one is still active.',
        });
      },
      error: (err: Error) => {
        this.signingOut.set(false);
        this.message.set({ severity: 'error', text: err.message });
      },
    });
  }
}
