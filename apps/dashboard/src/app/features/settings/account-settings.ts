import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { DatePipe } from '@angular/common';
import { Message } from 'primeng/message';
import { PageHeader } from '../../../design-system';
import { AuthApi } from '../../core/api';
import { Session } from '../../core/session';
import type { ExtensionToken } from '../../core/api.types';

@Component({
  selector: 'app-account-settings',
  imports: [DatePipe, FormsModule, Button, InputText, Message, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Your account" subtitle="How you appear to your team, and where you are signed in" />

    <section class="ds-surface panel">
      <h2>Profile</h2>
      <div class="field">
        <label for="name">Name</label>
        <input pInputText id="name" [(ngModel)]="name" />
      </div>
      <small class="hint">
        Used to credit you in a pull request. Without a name we use the part of
        your address before the @ — never the whole address, because a pull
        request can land in a public repository.
      </small>
      <div class="field">
        <label for="email">Email</label>
        <input pInputText id="email" [value]="email()" disabled />
        <small>
          Your address is your identity here — it is how the sign-in link
          reaches you, so it cannot be changed from this screen.
        </small>
      </div>
      @if (message(); as note) {
        <p-message [severity]="note.severity" [closable]="true" (onClose)="message.set(null)">
          {{ note.text }}
        </p-message>
      }
      <div class="actions">
        <p-button
          [label]="saving() ? 'Saving…' : 'Save changes'"
          size="small"
          [disabled]="saving()"
          (onClick)="save()" />
      </div>
    </section>

    <section class="ds-surface panel">
      <h2>Browser extension</h2>
      <p class="hint">
        The extension signs in to Inline Edit, not to GitHub — so no
        repository credential ever reaches your browser. Create a token here
        and paste it into the extension popup.
      </p>

      @if (issued(); as token) {
        <p-message severity="success" [closable]="false">
          <span class="issued">
            <strong>Copy this now — it is not shown again.</strong>
            <code>{{ token }}</code>
            <button type="button" class="copy" (click)="copy(token)">
              {{ copied() ? 'Copied' : 'Copy' }}
            </button>
          </span>
        </p-message>
      }

      <div class="field">
        <label for="label">Label</label>
        <input pInputText id="label" [(ngModel)]="label" placeholder="Chrome on my laptop" />
        <small>So you can tell one browser from another in the list below.</small>
      </div>

      <div class="actions">
        <p-button
          [label]="creating() ? 'Creating…' : 'Create a token'"
          size="small"
          [disabled]="creating()"
          (onClick)="createToken()" />
      </div>

      @if (tokens().length) {
        <ul class="sessions">
          @for (t of tokens(); track t.id) {
            <li>
              <div>
                <strong>{{ t.userAgent || 'Browser extension' }}</strong>
                <small>
                  created {{ t.createdAt | date: 'd MMM y' }} ·
                  @if (t.lastSeenAt) {
                    last used {{ t.lastSeenAt | date: 'd MMM, HH:mm' }}
                  } @else {
                    never used
                  }
                </small>
              </div>
              <p-button
                label="Revoke"
                [text]="true"
                size="small"
                severity="danger"
                [disabled]="revoking() === t.id"
                (onClick)="revoke(t)" />
            </li>
          }
        </ul>
      }
    </section>

    <section class="ds-surface panel">
      <h2>Sessions</h2>
      <p class="hint">
        Sessions last 30 days. There is no per-device list for dashboard
        sign-ins — the API can revoke them all or the current one, not name
        them — so the honest control is the blunt one. Extension tokens are
        listed individually above.
      </p>
      <div class="actions">
        <p-button
          [label]="signingOut() ? 'Signing out…' : 'Sign out everywhere else'"
          [outlined]="true"
          severity="secondary"
          size="small"
          [disabled]="signingOut()"
          (onClick)="signOutEverywhere()" />
      </div>
    </section>
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); max-width: 640px; }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }
    .sessions { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ds-s-3); }
    .sessions li { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-s-3); }
    .sessions strong { display: block; font-size: var(--ds-t-small); color: var(--p-text-color); }
    .sessions small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .current { font-size: var(--ds-t-caption); font-weight: 600; color: var(--ds-success-ink); }
    .actions { display: flex; }
    .hint { margin: 0; font-size: var(--ds-t-caption); line-height: 1.55; color: var(--p-text-muted-color); }
    .issued { display: grid; gap: var(--ds-s-2); text-align: left; }
    .issued code { padding: var(--ds-s-2); border-radius: var(--ds-r-sm); background: var(--ds-muted-bg); font-family: var(--ds-font-mono, ui-monospace, monospace); font-size: var(--ds-t-caption); overflow-wrap: anywhere; color: var(--p-text-color); }
    .copy { justify-self: start; padding: 4px 10px; border: 1px solid var(--ds-border); border-radius: var(--ds-r-sm); background: transparent; font: inherit; font-size: var(--ds-t-caption); cursor: pointer; }
  `,
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
