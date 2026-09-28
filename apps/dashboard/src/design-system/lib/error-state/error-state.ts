import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from 'primeng/button';

/**
 * When a request fails.
 *
 * Distinct from an empty state on purpose: empty means "there is nothing
 * here", failed means "we could not find out". Showing the empty state on a
 * failure tells someone their data is gone when it is not.
 */
@Component({
  selector: 'ds-error-state',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  template: `
    <span class="icon"><i class="pi pi-exclamation-triangle"></i></span>
    <div class="copy">
      <span class="title">{{ title() }}</span>
      <span class="desc">{{ detail() || 'Something went wrong on our side.' }}</span>
    </div>
    <div class="actions">
      <p-button label="Try again" icon="pi pi-refresh" size="small" [outlined]="true" (onClick)="retry.emit()" />
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--ds-s-3); text-align: center; padding: var(--ds-s-10) var(--ds-s-6); min-height: 280px; }
    :host([data-size='sm']) { min-height: 0; padding: var(--ds-s-6) var(--ds-s-4); }
    .icon { width: 48px; height: 48px; border-radius: var(--ds-r-lg); background: var(--ds-danger-soft); color: var(--ds-danger-ink); display: grid; place-items: center; font-size: 18px; }
    .copy { display: grid; gap: 6px; max-width: 360px; }
    .title { font-size: var(--ds-t-title); font-weight: 700; color: var(--p-text-color); }
    .desc { font-size: var(--ds-t-small); line-height: 1.5; color: var(--p-text-muted-color); text-wrap: pretty; }
  `,
})
export class ErrorState {
  readonly title = input('Could not load this');
  readonly detail = input<string>();
  readonly size = input<'sm' | 'md'>('md');
  readonly retry = output<void>();
}
