import { ChangeDetectionStrategy, Component, computed, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Chip } from 'primeng/chip';
import { Message } from 'primeng/message';
import { Role } from '../../core/mock-data';

/**
 * Inviting people.
 *
 * Several addresses at once, because a team is onboarded in one sitting far
 * more often than one person at a time. The role is a deliberate choice
 * rather than a default: it decides whether someone can re-point a site at a
 * different repository, which is the one action here that can quietly send
 * edits to the wrong place.
 */
@Component({
  selector: 'app-invite-dialog',
  imports: [FormsModule, Dialog, Button, InputText, Chip, Message],
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
          <strong>{{ sent() ? 'Invitations sent' : 'Invite people' }}</strong>
          <small>
            {{ sent() ? 'They can accept from their inbox' : 'They sign in with the email you enter — no GitHub account needed' }}
          </small>
        </div>
      </ng-template>

      @if (!sent()) {
        <div class="form">
          <div class="field">
            <label for="emails">Email addresses</label>
            <div class="entry">
              @if (emails().length) {
                <div class="chips">
                  @for (e of emails(); track e) {
                    <p-chip [label]="e" [removable]="true" (onRemove)="remove(e)" />
                  }
                </div>
              }
              <input
                pInputText
                id="emails"
                type="email"
                [ngModel]="draft()"
                (ngModelChange)="draft.set($event)"
                (keydown.enter)="add($event)"
                (keydown.comma)="add($event)"
                (blur)="add($event)"
                [placeholder]="emails().length ? 'Add another…' : 'ada@acme.com'" />
            </div>
            <small>Enter or a comma adds an address. Paste a list and they all land.</small>
          </div>

          <div class="field">
            <label>Role</label>
            <div class="roles">
              @for (r of roles; track r.value) {
                <button
                  type="button"
                  class="role"
                  [class.on]="role() === r.value"
                  (click)="role.set(r.value)">
                  <span class="radio" [class.on]="role() === r.value"></span>
                  <span class="text">
                    <strong>{{ r.label }}</strong>
                    <small>{{ r.blurb }}</small>
                  </span>
                </button>
              }
            </div>
          </div>

          @if (invalid().length) {
            <p-message severity="warn" [closable]="false">
              Not an email address: {{ invalid().join(', ') }}
            </p-message>
          }
        </div>
      } @else {
        <div class="done">
          <span class="tick"><i class="pi pi-send"></i></span>
          <strong>{{ emails().length }} invitation{{ emails().length === 1 ? '' : 's' }} on the way</strong>
          <small>
            They expire in 7 days. You can resend or revoke any of them from the
            team list.
          </small>
        </div>
      }

      <ng-template #footer>
        @if (!sent()) {
          <p-button label="Cancel" [text]="true" severity="secondary" (onClick)="visible.set(false)" />
          <p-button
            [label]="emails().length > 1 ? 'Send ' + emails().length + ' invitations' : 'Send invitation'"
            icon="pi pi-send"
            [disabled]="!canSend()"
            (onClick)="send()" />
        } @else {
          <p-button label="Done" (onClick)="visible.set(false)" />
        }
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .head { display: grid; gap: 2px; }
    .head strong { font-size: var(--ds-t-title); }
    .head small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); font-weight: 500; }

    .form { display: grid; gap: var(--ds-s-5); }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field > small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }

    .entry { display: grid; gap: var(--ds-s-2); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--ds-s-2); }

    .roles { display: grid; gap: var(--ds-s-2); }
    .role { display: flex; align-items: flex-start; gap: var(--ds-s-3); padding: var(--ds-s-3); border: 1px solid var(--ds-border); border-radius: var(--ds-r-md); background: transparent; font: inherit; text-align: left; cursor: pointer; }
    .role.on { border-color: var(--p-primary-color); background: var(--ds-tint); }
    .radio { width: 16px; height: 16px; margin-top: 2px; flex: none; border: 2px solid var(--ds-border-strong, #94a3b8); border-radius: 50%; }
    .radio.on { border-color: var(--p-primary-color); border-width: 5px; }
    .role .text { display: grid; gap: 2px; }
    .role strong { font-size: var(--ds-t-small); color: var(--p-text-color); }
    .role small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }

    .done { display: grid; justify-items: center; gap: var(--ds-s-3); padding: var(--ds-s-8) var(--ds-s-4); text-align: center; }
    .done strong { font-size: var(--ds-t-title); }
    .done small { max-width: 36ch; font-size: var(--ds-t-small); line-height: 1.55; color: var(--p-text-muted-color); }
    .tick { width: 48px; height: 48px; border-radius: 50%; background: var(--ds-tint); color: var(--p-primary-color); display: grid; place-items: center; font-size: 18px; }
  `,
})
export class InviteDialog {
  readonly visible = model(false);
  readonly invited = output<{ emails: string[]; role: Role }>();

  protected readonly emails = signal<string[]>([]);
  protected readonly invalid = signal<string[]>([]);
  protected readonly draft = signal('');
  protected readonly role = signal<Role>('editor');
  protected readonly sent = signal(false);

  protected readonly roles: { value: Role; label: string; blurb: string }[] = [
    {
      value: 'editor',
      label: 'Editor',
      blurb: 'Edits copy, opens pull requests, leaves feedback. Cannot change where a site points.',
    },
    {
      value: 'admin',
      label: 'Admin',
      blurb: 'Everything an editor can do, plus connecting providers, registering sites and inviting people.',
    },
  ];

  protected readonly canSend = computed(() => this.emails().length > 0);

  /** Split on anything that separates a pasted list. */
  protected add(event: Event) {
    event.preventDefault?.();
    const parts = this.draft()
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;

    const good: string[] = [];
    const bad: string[] = [];
    for (const p of parts) (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p) ? good : bad).push(p);

    this.emails.update((list) => [...new Set([...list, ...good])]);
    this.invalid.set(bad);
    this.draft.set(bad.join(' '));
  }

  protected remove(email: string) {
    this.emails.update((list) => list.filter((e) => e !== email));
  }

  protected send() {
    this.invited.emit({ emails: this.emails(), role: this.role() });
    this.sent.set(true);
  }

  protected reset() {
    this.emails.set([]);
    this.invalid.set([]);
    this.draft.set('');
    this.role.set('editor');
    this.sent.set(false);
  }
}
