import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Label + control + hint/error. Wrap any PrimeNG input:
 * <ds-field label="Unit name" for="unit" required hint="…"><input pInputText id="unit" /></ds-field>
 * Label is sentence case, 13px/600, never uppercase. Error replaces hint.
 */
@Component({
  selector: 'ds-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <label class="label" [attr.for]="for()">{{ label() }}@if (required()) {<span class="req" aria-hidden="true"> *</span>}
        @if (optional()) {<span class="opt">Optional</span>}
      </label>
    }
    <div class="control"><ng-content /></div>
    @if (error()) { <span class="msg err" role="alert"><i class="pi pi-exclamation-circle"></i>{{ error() }}</span> }
    @else if (hint()) { <span class="msg">{{ hint() }}</span> }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .label { display: flex; align-items: baseline; gap: 4px; font-size: var(--ds-t-small); font-weight: 600; color: var(--p-text-color); }
    .req { color: var(--ds-danger-dot); }
    .opt { margin-left: auto; font-size: var(--ds-t-caption); font-weight: 500; color: var(--p-text-muted-color); }
    .control { display: flex; flex-direction: column; }
    .control ::ng-deep > .p-inputtext, .control ::ng-deep > .p-select, .control ::ng-deep > .p-inputnumber, .control ::ng-deep > .p-textarea, .control ::ng-deep > .p-iconfield { width: 100%; }
    .msg { display: flex; align-items: center; gap: 6px; font-size: var(--ds-t-caption); line-height: 1.4; color: var(--p-text-muted-color); }
    .err { color: var(--ds-danger-ink); font-weight: 600; }
    .err i { font-size: 12px; }
  `
})
export class FormField {
  readonly label = input<string>();
  readonly for = input<string>();
  readonly hint = input<string>();
  readonly error = input<string | null>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly optional = input(false, { transform: booleanAttribute });
}
