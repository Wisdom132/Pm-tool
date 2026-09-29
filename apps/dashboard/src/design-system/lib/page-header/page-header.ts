import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Page header. Eyebrow (section / date) → title (24px) → one-line subtitle.
 * Actions go in <div dsActions>: max one primary button, right-most.
 */
@Component({
  selector: 'ds-page-header',
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeader {
  readonly eyebrow = input<string>();
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly live = input(false);
}
