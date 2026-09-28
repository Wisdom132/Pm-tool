import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Empty / zero / no-results states. Rules:
 * - Title says what's missing, in plain words. Description says how to fix it (1 sentence).
 * - Max 2 actions. "No results" states offer "Clear search" (no + icon); "no data" states offer the create action.
 * - `sm` inside cards & charts, `md` inside tables & full sections.
 */
@Component({
  selector: 'ds-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  template: `
    <span class="icon"><i [class]="icon()"></i></span>
    <div class="copy">
      <span class="title">{{ title() }}</span>
      @if (description()) { <span class="desc">{{ description() }}</span> }
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--ds-s-3); text-align: center; padding: var(--ds-s-10) var(--ds-s-6); min-height: 280px; }
    :host([data-size='sm']) { min-height: 0; padding: var(--ds-s-6) var(--ds-s-4); gap: var(--ds-s-2); }
    .icon { width: 48px; height: 48px; border-radius: var(--ds-r-lg); background: var(--ds-muted-bg); display: grid; place-items: center; color: var(--p-text-muted-color); font-size: 18px; }
    :host([data-size='sm']) .icon { width: 40px; height: 40px; border-radius: var(--ds-r-md); font-size: 15px; }
    .copy { display: grid; gap: 6px; max-width: 340px; }
    .title { font-size: var(--ds-t-title); font-weight: 700; color: var(--p-text-color); }
    .desc { font-size: var(--ds-t-small); line-height: 1.5; color: var(--p-text-muted-color); text-wrap: pretty; }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--ds-s-2); margin-top: var(--ds-s-2); }
    .actions:empty { display: none; }
  `
})
export class EmptyState {
  readonly icon = input('pi pi-inbox');
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly size = input<'sm' | 'md'>('md');
}
