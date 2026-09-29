import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Trend, StatCard } from '../stat-card/stat-card';

export interface Kpi { label: string; value: string; caption?: string; trend?: Trend; delta?: string }

/** A row of metrics on one surface, hairline-divided. Reflows 4 → 2 → 1 via container queries. */
@Component({
  selector: 'ds-kpi-strip',
  templateUrl: './kpi-strip.html',
  styleUrl: './kpi-strip.scss',
  imports: [StatCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ds-surface' },
})
export class KpiStrip {
  readonly items = input.required<Kpi[]>();
}
