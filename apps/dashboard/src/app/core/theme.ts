import { Injectable, effect, signal } from '@angular/core';

const STORAGE_KEY = 'inline-edit.theme';

/**
 * Light or dark, applied to <html>.
 *
 * The class is what the PrimeNG preset's `darkModeSelector` watches, so
 * without something writing it the toggle changes an icon and nothing else.
 *
 * The choice is remembered rather than read from the OS: this dashboard is
 * usually open beside the customer's own site, and flipping theme because
 * the machine went dark at sunset is not what anyone asked for.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  readonly dark = signal(this.restore());

  constructor() {
    effect(() => {
      const on = this.dark();
      document.documentElement.classList.toggle('dark', on);
      try {
        localStorage.setItem(STORAGE_KEY, on ? 'dark' : 'light');
      } catch {
        // Private browsing refuses writes. The theme still applies for this
        // session, which is better than failing to switch at all.
      }
    });
  }

  toggle() {
    this.dark.update((on) => !on);
  }

  private restore(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark';
    } catch {
      return false;
    }
  }
}
