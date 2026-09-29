import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Label + control + hint/error. Wrap any PrimeNG input:
 * <ds-field label="Unit name" for="unit" required hint="…"><input pInputText id="unit" /></ds-field>
 * Label is sentence case, 13px/600, never uppercase. Error replaces hint.
 */
@Component({
  selector: 'ds-field',
  templateUrl: './form-field.html',
  styleUrl: './form-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormField {
  readonly label = input<string>();
  readonly for = input<string>();
  readonly hint = input<string>();
  readonly error = input<string | null>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly optional = input(false, { transform: booleanAttribute });
}
