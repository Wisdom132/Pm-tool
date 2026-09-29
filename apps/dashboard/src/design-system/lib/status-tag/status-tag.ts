import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type Tone = 'success' | 'warn' | 'danger' | 'neutral' | 'info';

/** Dot + label pill for row status. Use one vocabulary per table (see STATUS_MAP). */
export const STATUS_MAP: Record<string, { label: string; tone: Tone }> = {
  in_stock: { label: 'In stock', tone: 'neutral' },
  low: { label: 'Low', tone: 'warn' },
  out: { label: 'Out', tone: 'danger' },
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  received: { label: 'Received', tone: 'success' },
  partial: { label: 'Partial', tone: 'warn' },
  paid: { label: 'Paid', tone: 'success' },
  unpaid: { label: 'Unpaid', tone: 'danger' }
};

@Component({
  selector: 'ds-status',
  templateUrl: './status-tag.html',
  styleUrl: './status-tag.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'resolved().tone' },
})
export class StatusTag {
  readonly status = input<string>();
  readonly label = input<string>();
  readonly tone = input<Tone>();
  protected readonly resolved = computed(() => {
    const m = STATUS_MAP[this.status() ?? ''];
    return { label: this.label() ?? m?.label ?? this.status() ?? '', tone: this.tone() ?? m?.tone ?? 'neutral' };
  });
}
