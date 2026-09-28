import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Trend, StatCard } from '../stat-card/stat-card';

export interface Kpi { label: string; value: string; caption?: string; trend?: Trend; delta?: string }

/** A row of metrics on one surface, hairline-divided. Reflows 4 → 2 → 1 via container queries. */
@Component({
  selector: 'ds-kpi-strip',
  imports: [StatCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ds-surface' },
  template: `
    <div class="grid" [style.--cols]="items().length">
      @for (k of items(); track k.label) {
        <ds-stat-card variant="plain" [label]="k.label" [value]="k.value" [caption]="k.caption" [captionTrend]="k.trend ?? 'neutral'" [delta]="k.delta" [trend]="k.trend ?? 'neutral'" />
      }
    </div>
  `,
  styles: `
    :host { display: block; container-type: inline-size; overflow: hidden; }
    .grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 1px; background: var(--ds-border); }
    .grid > * { background: var(--p-content-background); }
    @container (max-width: 720px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @container (max-width: 380px) { .grid { grid-template-columns: 1fr; } }
  `
})
export class KpiStrip {
  readonly items = input.required<Kpi[]>();
}
