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
  templateUrl: './error-state.html',
  styleUrl: './error-state.scss',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
})
export class ErrorState {
  readonly title = input('Could not load this');
  readonly detail = input<string>();
  readonly size = input<'sm' | 'md'>('md');
  readonly retry = output<void>();
}
