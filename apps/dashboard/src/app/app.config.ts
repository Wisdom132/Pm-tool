import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { DashboardPreset } from '../design-system/theme/preset';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: DashboardPreset,
        options: {
          // Dark mode is opt-in via a class rather than the OS setting: a
          // dashboard shown alongside the customer's own site should not
          // flip theme on its own.
          darkModeSelector: '.dark',
          // Our own rules must win over Prime's defaults, so the library's
          // styles are layered below them.
          cssLayer: { name: 'primeng', order: 'theme, base, primeng' },
        },
      },
    }),
  ],
};
