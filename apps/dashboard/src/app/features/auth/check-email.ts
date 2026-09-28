import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';

@Component({
  selector: 'app-check-email',
  imports: [Button, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-screen">
      <span class="auth-icon"><i class="pi pi-envelope"></i></span>

      <div class="auth-head">
        <h1>Check your email</h1>
        <p>
          We sent a sign-in link to
          <strong>{{ email() || 'your inbox' }}</strong>. It expires in 15 minutes.
        </p>
      </div>

      <!-- Mock only: a real build would not offer a way past the email. -->
      <p-button label="Continue (mock)" [fluid]="true" routerLink="/overview" />

      <p class="auth-meta">
        Wrong address? <a routerLink="/sign-in">Use a different one</a>
      </p>
    </div>
  `,
  styles: `
    .auth-icon { width: 48px; height: 48px; border-radius: var(--ds-r-lg); background: var(--ds-tint); color: var(--p-primary-color); display: grid; place-items: center; font-size: 18px; }
    .auth-meta { margin: 0; font-size: var(--ds-t-caption); color: var(--p-text-muted-color); text-align: center; }
  `,
})
export class CheckEmail {
  private readonly route = inject(ActivatedRoute);
  protected readonly email = () => this.route.snapshot.queryParamMap.get('email');
}
