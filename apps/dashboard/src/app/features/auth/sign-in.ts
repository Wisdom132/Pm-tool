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
  imports: [FormsModule, Button, InputText, Divider],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-screen">
      <div class="auth-head">
        <h1>Sign in</h1>
        <p>We'll email you a link. No password to remember.</p>
      </div>

      <form class="auth-form" (ngSubmit)="submit()">
        <div class="auth-field">
          <label for="email">Work email</label>
          <input
            pInputText
            id="email"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="you@company.com"
            [(ngModel)]="email"
            required />
        </div>

        <p-button
          type="submit"
          label="Email me a link"
          [loading]="sending()"
          [fluid]="true" />
      </form>

      <p-divider align="center"><span class="auth-divider-text">or</span></p-divider>

      <p-button
        label="Continue with GitHub"
        icon="pi pi-github"
        severity="secondary"
        [outlined]="true"
        [fluid]="true" />

      <p class="auth-meta">
        Connecting a repository is a separate step, and only an admin needs to do it.
      </p>
    </div>
  `,
  styles: `
    .auth-form { display: grid; gap: var(--ds-s-4); }
    .auth-field { display: grid; gap: var(--ds-s-2); }
    .auth-field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .auth-divider-text { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .auth-meta { margin: 0; font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); text-align: center; }
  `,
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
