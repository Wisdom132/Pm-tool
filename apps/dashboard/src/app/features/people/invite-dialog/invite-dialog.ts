import { ChangeDetectionStrategy, Component, computed, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Chip } from 'primeng/chip';
import { Message } from 'primeng/message';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { MembersApi } from '../../../core/api/members-api';
import type { Role } from '../../../core/api-types';

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
  templateUrl: './invite-dialog.html',
  styleUrl: './invite-dialog.scss',
  imports: [FormsModule, Dialog, Button, InputText, Chip, Message],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteDialog {
  private readonly api = inject(MembersApi);

  readonly visible = model(false);
  /** Fired once, after sending, so the list refreshes with what landed. */
  readonly invited = output<void>();

  protected readonly emails = signal<string[]>([]);
  protected readonly invalid = signal<string[]>([]);
  protected readonly draft = signal('');
  protected readonly role = signal<Role>('editor');
  protected readonly sent = signal(false);
  protected readonly sending = signal(false);
  protected readonly succeeded = signal<string[]>([]);
  protected readonly failed = signal<{ email: string; reason: string }[]>([]);

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

  /**
   * One request per address.
   *
   * The API invites one person at a time, and that is the right granularity:
   * inviting five people where one is already a member should send four
   * invitations and say so, not fail the batch. `forkJoin` with a
   * per-request `catchError` is what keeps a rejection from cancelling the
   * others.
   */
  protected send() {
    const role = this.role();
    this.sending.set(true);

    forkJoin(
      this.emails().map((email) =>
        this.api.invite({ email, role }).pipe(
          map(() => ({ email, ok: true as const })),
          catchError((err: Error) => of({ email, ok: false as const, reason: err.message })),
        ),
      ),
    ).subscribe((results) => {
      this.succeeded.set(results.filter((r) => r.ok).map((r) => r.email));
      this.failed.set(
        results
          .filter((r): r is { email: string; ok: false; reason: string } => !r.ok)
          .map((r) => ({ email: r.email, reason: r.reason })),
      );
      this.sending.set(false);
      this.sent.set(true);
      this.invited.emit();
    });
  }

  protected reset() {
    this.emails.set([]);
    this.invalid.set([]);
    this.draft.set('');
    this.role.set('editor');
    this.sent.set(false);
    this.sending.set(false);
    this.succeeded.set([]);
    this.failed.set([]);
  }
}
