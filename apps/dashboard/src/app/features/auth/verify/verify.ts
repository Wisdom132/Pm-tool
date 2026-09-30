import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Button } from 'primeng/button';
import { AuthApi } from '../../../core/api/auth-api';
import { Session } from '../../../core/session';

/**
 * Where a sign-in link lands.
 *
 * This route did not exist. The API has been emailing
 * `/sign-in/verify?token=…` since sign-in was built, and the dashboard had
 * nothing mounted there — so every link in every email fell through to the
 * catch-all inside the dashboard shell, which requires a session, and
 * bounced the person straight back to the sign-in screen they had just come
 * from. The one path a new user has into the product was a loop.
 *
 * The token is consumed on arrival, once. `consumeLoginToken` on the API is
 * single-use, so a double-render here would report failure for a token that
 * had in fact just worked.
 */
@Component({
  selector: 'app-verify',
  templateUrl: './verify.html',
  styleUrl: './verify.scss',
  imports: [Button, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Verify {
  private readonly auth = inject(AuthApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly error = signal('');

  constructor() {
    void this.run();
  }

  private async run() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.error.set('That link is missing its token. Ask for a new one.');
      return;
    }

    try {
      await firstValueFrom(this.auth.verify(token));

      // The shell reads the user from here, so it has to be repopulated
      // before navigating — otherwise the overview renders for a session
      // the client does not yet know it has.
      await this.session.refresh();

      // Back to whatever they were trying to reach when they were sent to
      // sign in. `requireSession` puts it in `next`.
      const next = this.route.snapshot.queryParamMap.get('next');
      await this.router.navigateByUrl(next && next.startsWith('/') ? next : '/overview');
    } catch (err) {
      // A used, expired or forged token all arrive here, and the API
      // deliberately does not distinguish them. Saying "ask for another"
      // is both true and the only useful instruction.
      this.error.set(
        (err as Error)?.message || 'That link has expired or has already been used.'
      );
    }
  }
}
