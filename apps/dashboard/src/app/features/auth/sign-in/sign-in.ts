import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Divider } from 'primeng/divider';

/**
 * Sign in with an email, not a GitHub account.
 *
 * The people this is for are writers and product managers editing copy; many
 * have no GitHub login at all. Connecting a repository is a separate,
 * admin-only step that happens once, after signing in.
 */
@Component({
  selector: 'app-sign-in',
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.scss',
  imports: [FormsModule, Button, InputText, Divider],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignIn {
  protected email = '';
  protected readonly sending = signal(false);

  constructor(private readonly router: Router) {}

  protected submit() {
    this.sending.set(true);
    // Mock: the API does not exist yet.
    setTimeout(() => {
      this.sending.set(false);
      this.router.navigate(['/sign-in/check-email'], { queryParams: { email: this.email } });
    }, 600);
  }
}
