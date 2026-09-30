import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Divider } from 'primeng/divider';
import { Message } from 'primeng/message';
import { AuthApi } from '../../../core/api/auth-api';

/**
 * Sign in with an email, not a GitHub account.
 *
 * The people this is for are writers and product managers editing copy; many
 * have no GitHub login at all. Connecting a repository is a separate,
 * admin-only step that happens once, after signing in.
 *
 * This screen used to be a `setTimeout` that navigated to the
 * check-your-email page without sending anything — written before the API
 * existed and never revisited. `AuthApi.requestLink` had been sitting there,
 * correct and uncalled, the whole time.
 */
@Component({
  selector: 'app-sign-in',
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.scss',
  imports: [FormsModule, Button, InputText, Divider, Message],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignIn {
  private readonly auth = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected email = '';
  protected readonly sending = signal(false);
  protected readonly error = signal('');

  protected submit() {
    const email = this.email.trim();
    if (!email) return;

    this.sending.set(true);
    this.error.set('');

    this.auth.requestLink(email).subscribe({
      next: () => {
        this.sending.set(false);
        this.router.navigate(['/sign-in/check-email'], {
          // `next` is carried through the email so that signing in lands
          // where they were going, not on the overview.
          queryParams: {
            email,
            next: this.route.snapshot.queryParamMap.get('next') || undefined,
          },
        });
      },
      error: (err: Error) => {
        this.sending.set(false);
        this.error.set(err.message || 'Could not send that link. Try again.');
      },
    });
  }
}
