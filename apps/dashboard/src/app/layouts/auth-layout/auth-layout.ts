import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout.scss',
  // The layout's own classes are global-ish here: the projected screens set
  // them too, so encapsulation would keep the card from ever being styled.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="auth-page">
      <div class="auth-shell">
        <div class="auth-brand">
          <span class="auth-brand__mark">IE</span>
          <span class="auth-brand__word">Inline Edit</span>
        </div>

        <div class="auth-card ds-surface">
          <router-outlet />
        </div>

        <footer class="auth-foot">
          <span>&copy; {{ year }} Inline Edit</span>
          <span class="auth-foot__dot">·</span>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </footer>
      </div>
    </div>
  `,
})
export class AuthLayout {
  protected readonly year = new Date().getFullYear();
}
