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
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-screen">
      @switch (state()) {
        @case ('valid') {
          <span class="auth-icon"><i class="pi pi-users"></i></span>
          <div class="auth-head">
            <h1>Join {{ organisation }}</h1>
            <p>
              <strong>{{ invitedBy }}</strong> invited
              <strong>{{ email }}</strong> as {{ role === 'admin' ? 'an admin' : 'an editor' }}.
            </p>
          </div>

          <ul class="can">
            <li><i class="pi pi-check"></i> Edit copy on the sites your teams cover</li>
            <li><i class="pi pi-check"></i> Open pull requests and leave feedback</li>
            @if (role === 'admin') {
              <li><i class="pi pi-check"></i> Connect providers, register sites, invite people</li>
            } @else {
              <li class="cannot"><i class="pi pi-times"></i> Cannot change where a site points</li>
            }
          </ul>

          <p-button label="Accept invitation" [fluid]="true" [loading]="accepting()" (onClick)="accept()" />
          <p class="auth-meta">Not you? Ignore this email and nothing happens.</p>
        }

        @case ('expired') {
          <span class="auth-icon warn"><i class="pi pi-clock"></i></span>
          <div class="auth-head">
            <h1>This invitation expired</h1>
            <p>
              Invitations last 7 days. Ask {{ invitedBy }} to send another — it
              takes them a moment.
            </p>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .auth-icon { width: 48px; height: 48px; border-radius: var(--ds-r-lg); background: var(--ds-tint); color: var(--p-primary-color); display: grid; place-items: center; font-size: 18px; }
    .auth-icon.warn { background: var(--ds-warn-soft); color: var(--ds-warn-ink); }
    .can { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ds-s-2); }
    .can li { display: flex; align-items: flex-start; gap: var(--ds-s-2); font-size: var(--ds-t-small); line-height: 1.5; color: var(--p-text-color); }
    .can i { margin-top: 3px; color: var(--ds-success-ink); font-size: 12px; }
    .can .cannot { color: var(--p-text-muted-color); }
    .can .cannot i { color: var(--p-text-muted-color); }
    .auth-meta { margin: 0; font-size: var(--ds-t-caption); color: var(--p-text-muted-color); text-align: center; }
  `,
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
