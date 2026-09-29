import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { AuthApi } from '../../../core/api/auth-api';
import { Session } from '../../../core/session';
import type { InvitationOffer } from '../../../core/api-types';

/**
 * Where an invitation link lands.
 *
 * It names the organisation and the role before anything is accepted: the
 * link arrives by email, and a person should know what they are joining and
 * with what powers before clicking again.
 *
 * Four states, because all four happen:
 *
 *   signed out            they need a sign-in link first, sent to the address
 *                         the invitation was addressed to and nowhere else.
 *   signed in, matching   the one case with an Accept button.
 *   signed in, different  the invitation belongs to somebody else. Say so
 *                         rather than silently accepting it for the wrong
 *                         account.
 *   expired / accepted    the API reports these as a status rather than an
 *                         error, so each can be explained.
 *
 * Accepting is its own call rather than something that happens on the next
 * sign-in. Sign-in does also accept pending invitations, but somebody who
 * was *already* signed in when invited would otherwise have no membership
 * until they next signed out and back in — a link that appeared to do
 * nothing.
 */
@Component({
  selector: 'app-accept-invite',
  templateUrl: './accept-invite.html',
  styleUrl: './accept-invite.scss',
  imports: [RouterLink, Button, Message, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptInvite {
  private readonly api = inject(AuthApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly loading = signal(true);
  protected readonly offer = signal<InvitationOffer | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly linkSent = signal(false);

  /** Null when signed out. */
  protected readonly signedInAs = computed(() => this.session.user()?.email ?? null);

  protected readonly matches = computed(() => {
    const offer = this.offer();
    const email = this.signedInAs();
    return Boolean(offer && email && offer.email === email);
  });

  constructor() {
    // The session may not be resolved yet: this route is reachable signed
    // out, so no guard has established it.
    void this.session.resolve();

    this.api.invitation(this.token).subscribe({
      next: (offer) => {
        this.offer.set(offer);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.loading.set(false);
      },
    });
  }

  protected accept() {
    this.busy.set(true);
    this.error.set('');

    this.api.acceptInvitation(this.token).subscribe({
      next: async () => {
        // The organisation list changed, and the shell renders from it.
        await this.session.refresh();
        void this.router.navigate(['/overview']);
      },
      error: (err: Error) => {
        this.busy.set(false);
        this.error.set(err.message);
      },
    });
  }

  /**
   * Send a sign-in link to the invited address.
   *
   * To that address specifically, not one they type: the invitation token is
   * long-lived and could have been forwarded, so it must not be the thing
   * that creates a session. A 15-minute single-use link to the address on
   * the invitation is what proves they are the person it was sent to.
   */
  protected requestLink() {
    const offer = this.offer();
    if (!offer) return;

    this.busy.set(true);
    this.error.set('');

    this.api.requestLink(offer.email).subscribe({
      next: () => {
        this.busy.set(false);
        this.linkSent.set(true);
      },
      error: (err: Error) => {
        this.busy.set(false);
        this.error.set(err.message);
      },
    });
  }

  protected signOut() {
    void this.session.signOut();
  }
}
