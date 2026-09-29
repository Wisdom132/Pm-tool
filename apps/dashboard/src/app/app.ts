import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Theme } from './core/theme';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [RouterOutlet],
})
export class App {
  // Constructed here, at the root, rather than by whichever layout happens to
  // render. Injecting it only in the dashboard shell meant a fresh load of a
  // sign-in or invitation URL never applied the saved theme.
  private readonly theme = inject(Theme);

  protected readonly title = signal('dashboard');
}
