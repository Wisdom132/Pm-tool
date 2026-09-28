import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';

/**
 * A wrong URL says so.
 *
 * It used to redirect to Overview, which quietly hid typos and dead links —
 * and made a link shared from a deleted site look like it worked.
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <span class="code">404</span>
      <h1>This page does not exist</h1>
      <p>
        The address may be mistyped, or whatever was here has since been
        deleted.
      </p>
      <div class="actions">
        <p-button label="Go back" icon="pi pi-arrow-left" [outlined]="true" severity="secondary" (onClick)="back()" />
        <p-button label="Overview" routerLink="/overview" />
      </div>
    </div>
  `,
  styles: `
    .wrap { display: grid; justify-items: center; gap: var(--ds-s-3); padding: var(--ds-s-10) var(--ds-s-4); text-align: center; }
    .code { font-size: var(--ds-t-metric); font-weight: 800; color: var(--p-primary-color); line-height: 1; }
    h1 { font-size: var(--ds-t-display); }
    p { margin: 0; max-width: 42ch; font-size: var(--ds-t-body); line-height: 1.6; color: var(--p-text-muted-color); }
    .actions { display: flex; gap: var(--ds-s-2); margin-top: var(--ds-s-3); }
  `,
})
export class NotFound {
  private readonly location = inject(Location);
  protected back() {
    this.location.back();
  }
}
