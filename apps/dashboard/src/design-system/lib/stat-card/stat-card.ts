import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Trend = 'up' | 'down' | 'warn' | 'neutral';

/**
 * One metric. `card` = standalone surface, `plain` = no surface (inside KpiStrip),
 * `hero` = navy brand block for the single most important number on a page.
 */
@Component({
  selector: 'ds-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-stat',
    '[class.ds-surface]': "variant() === 'card'",
    '[class.ds-stat--hero]': "variant() === 'hero'",
    '[class.ds-stat--plain]': "variant() === 'plain'"
  },
  template: `
    <div class="ds-stat__head">
      @if (icon()) { <span class="ds-stat__icon"><i [class]="icon()"></i></span> }
      <span class="ds-stat__label">{{ label() }}</span>
      <ng-content select="[dsStatAside]" />
    </div>
    <div class="ds-stat__row">
      <span class="ds-stat__value">{{ value() }}</span>
      @if (delta()) { <span class="ds-stat__delta" [attr.data-trend]="trend()">{{ delta() }}</span> }
    </div>
    @if (caption()) { <span class="ds-stat__caption" [attr.data-trend]="captionTrend()">{{ caption() }}</span> }
    <ng-content />
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--ds-s-2); padding: var(--ds-s-5) var(--ds-s-6); min-width: 0; }
    .ds-stat__head { display: flex; align-items: center; gap: var(--ds-s-2); min-height: 16px; }
    .ds-stat__icon { width: 28px; height: 28px; border-radius: var(--ds-r-sm); background: var(--ds-muted-bg); display: grid; place-items: center; font-size: 13px; color: var(--p-text-muted-color); }
    .ds-stat__label { flex: 1; font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-muted-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ds-stat__row { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--ds-s-3); }
    .ds-stat__value { font-size: var(--ds-t-display); font-weight: 700; line-height: 1.1; letter-spacing: -0.01em; color: var(--p-text-color); }
    .ds-stat__delta { padding: 4px 8px; border-radius: var(--ds-r-pill); font-size: var(--ds-t-caption); font-weight: 600; white-space: nowrap; background: var(--ds-muted-bg); color: var(--p-text-muted-color); }
    .ds-stat__delta[data-trend='up'] { background: var(--ds-success-soft); color: var(--ds-success-ink); }
    .ds-stat__delta[data-trend='down'] { background: var(--ds-danger-soft); color: var(--ds-danger-ink); }
    .ds-stat__delta[data-trend='warn'] { background: var(--ds-warn-soft); color: var(--ds-warn-ink); }
    .ds-stat__caption { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-muted-color); }
    .ds-stat__caption[data-trend='up'] { color: var(--ds-success-ink); }
    .ds-stat__caption[data-trend='warn'] { color: var(--ds-warn-ink); }
    .ds-stat__caption[data-trend='down'] { color: var(--ds-danger-ink); }

    :host(.ds-stat--hero) { padding: var(--ds-s-6); gap: var(--ds-s-3); border-radius: var(--ds-r-xl); background: var(--p-primary-color); box-shadow: var(--ds-shadow-hero); color: var(--p-primary-contrast-color); }
    :host(.ds-stat--hero) .ds-stat__label, :host(.ds-stat--hero) .ds-stat__caption { color: inherit; opacity: 0.72; }
    :host(.ds-stat--hero) .ds-stat__value { font-size: var(--ds-t-metric); color: inherit; letter-spacing: -0.02em; line-height: 1; }
    :host(.ds-stat--hero) .ds-stat__delta { background: color-mix(in srgb, currentColor 14%, transparent); color: inherit; }
  `
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
