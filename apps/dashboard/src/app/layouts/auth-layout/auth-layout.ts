import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-auth-layout',
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.scss',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The layout's own classes are global-ish here: the projected screens set
  // them too, so encapsulation would keep the card from ever being styled.
  encapsulation: ViewEncapsulation.None,
})
export class AuthLayout {
  protected readonly year = new Date().getFullYear();
}
