import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Trend = 'up' | 'down' | 'warn' | 'neutral';

/**
 * One metric. `card` = standalone surface, `plain` = no surface (inside KpiStrip),
 * `hero` = navy brand block for the single most important number on a page.
 */
@Component({
  selector: 'ds-stat-card',
  templateUrl: './stat-card.html',
  styleUrl: './stat-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-stat',
    '[class.ds-surface]': "variant() === 'card'",
    '[class.ds-stat--hero]': "variant() === 'hero'",
    '[class.ds-stat--plain]': "variant() === 'plain'"
  },
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly delta = input<string>();
  readonly trend = input<Trend>('neutral');
  readonly caption = input<string>();
  readonly captionTrend = input<Trend>('neutral');
  readonly icon = input<string>();
  readonly variant = input<'card' | 'plain' | 'hero'>('card');
}
