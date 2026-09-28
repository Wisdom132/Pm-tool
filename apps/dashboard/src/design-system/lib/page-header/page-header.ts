import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Page header. Eyebrow (section / date) → title (24px) → one-line subtitle.
 * Actions go in <div dsActions>: max one primary button, right-most.
 */
@Component({
  selector: 'ds-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text">
      @if (eyebrow()) { <span class="eyebrow">{{ eyebrow() }}</span> }
      <h1 class="title">{{ title() }}</h1>
      @if (subtitle() || live()) {
        <div class="sub">
          @if (live()) { <span class="live" aria-hidden="true"></span> }
          <span>{{ subtitle() }}</span>
        </div>
      }
    </div>
    <div class="actions"><ng-content select="[dsActions]" /></div>
  `,
  styles: `
    :host { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: var(--ds-s-4); }
    .text { display: grid; gap: var(--ds-s-2); min-width: 0; }
    .eyebrow { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-muted-color); }
    .title { margin: 0; font-size: var(--ds-t-display); font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; color: var(--p-text-color); text-wrap: balance; }
    .sub { display: flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-body); font-weight: 500; color: var(--p-text-muted-color); }
    .live { width: 7px; height: 7px; border-radius: 50%; background: var(--ds-success-dot); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ds-success-dot) 20%, transparent); flex: none; }
    .actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--ds-s-2); }
  `
})
export class PageHeader {
  readonly eyebrow = input<string>();
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly live = input(false);
}
