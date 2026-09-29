import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Empty / zero / no-results states. Rules:
 * - Title says what's missing, in plain words. Description says how to fix it (1 sentence).
 * - Max 2 actions. "No results" states offer "Clear search" (no + icon); "no data" states offer the create action.
 * - `sm` inside cards & charts, `md` inside tables & full sections.
 */
@Component({
  selector: 'ds-empty-state',
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
})
export class EmptyState {
  readonly icon = input('pi pi-inbox');
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly size = input<'sm' | 'md'>('md');
}
