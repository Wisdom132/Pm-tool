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
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'resolved().tone' },
  template: `<span class="dot"></span>{{ resolved().label }}`,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--ds-r-pill); font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; background: var(--ds-muted-bg); color: var(--p-text-color); }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--p-text-muted-color); }
    :host([data-tone='neutral']) .dot { background: var(--ds-success-dot); }
    :host([data-tone='success']) { background: var(--ds-success-soft); color: var(--ds-success-ink); }
    :host([data-tone='success']) .dot { background: var(--ds-success-dot); }
    :host([data-tone='warn']) { background: var(--ds-warn-soft); color: var(--ds-warn-ink); }
    :host([data-tone='warn']) .dot { background: var(--ds-warn-dot); }
    :host([data-tone='danger']) { background: var(--ds-danger-soft); color: var(--ds-danger-ink); }
    :host([data-tone='danger']) .dot { background: var(--ds-danger-dot); }
    :host([data-tone='info']) { background: var(--ds-info-soft); color: var(--p-primary-color); }
    :host([data-tone='info']) .dot { background: var(--p-primary-color); }
  `
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
