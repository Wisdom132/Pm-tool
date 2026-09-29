import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';

/**
 * Where an invitation link lands.
 *
 * It names the organisation and the role before anything is accepted: the
 * link arrives by email, and a person should know what they are joining and
 * with what powers before clicking again.
 */
@Component({
  selector: 'app-accept-invite',
  templateUrl: './accept-invite.html',
  styleUrl: './accept-invite.scss',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptInvite {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** `?expired=1` shows the other branch without needing a real backend. */
  protected readonly state = signal<'valid' | 'expired'>(
    this.route.snapshot.queryParamMap.has('expired') ? 'expired' : 'valid'
  );
  protected readonly accepting = signal(false);

  protected readonly organisation = 'Heykara';
  protected readonly invitedBy = 'Wisdom Ekpot';
  protected readonly email = 'ada@acme.com';
  protected readonly role: 'admin' | 'editor' = 'editor';

  protected accept() {
    this.accepting.set(true);
    setTimeout(() => this.router.navigate(['/overview']), 700);
  }
}
