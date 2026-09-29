import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SelectButton } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { RouterLink } from '@angular/router';
import { Skeleton } from 'primeng/skeleton';
import { tap, map } from 'rxjs';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { FeedbackApi } from '../../core/api/feedback-api';
import { createLoader } from '../../core/load-state';
import type {
  Feedback as FeedbackItem,
  FeedbackCounts,
  FeedbackStatus,
} from '../../core/api-types';

/**
 * Feedback inbox.
 *
 * A list rather than a table: each item is a sentence someone wrote, and the
 * useful thing about it — the source file it maps to — is the part no general
 * feedback tool can show.
 */
@Component({
  selector: 'app-feedback',
  templateUrl: './feedback.html',
  styleUrl: './feedback.scss',
  imports: [DatePipe, FormsModule, RouterLink, SelectButton, Button, Tag, Skeleton, PageHeader, EmptyState, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Feedback {
  private readonly api = inject(FeedbackApi);

  protected readonly filters = [
    { label: 'All', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'Triaged', value: 'triaged' },
    { label: 'Resolved', value: 'resolved' },
  ];

  /**
   * Who it is for, alongside what state it is in.
   *
   * These are a separate axis from status rather than four more buttons in
   * the same row: "new" and "mine" are both true of the same comment, and
   * folding them into one control would make them exclusive.
   */
  protected readonly queues = computed(() => {
    const counts = this.counts();
    // The count is built into the label rather than projected through a
    // PrimeNG item template. A template that does not match the library's
    // contract renders nothing and still compiles — which is how a
    // `routerLink` went missing in this dashboard once already.
    const withCount = (label: string, n: number | undefined) =>
      n === undefined ? label : `${label} (${n})`;

    return [
      { label: 'Everyone', value: 'any' },
      { label: withCount('Mine', counts.mine), value: 'me' },
      { label: withCount('Unassigned', counts.unassigned), value: 'none' },
    ];
  });

  protected readonly filter = signal<'all' | FeedbackStatus>('all');
  protected readonly queue = signal<'any' | 'me' | 'none'>('any');
  protected readonly loader = createLoader<FeedbackItem[]>([]);
  protected readonly items = this.loader.data;
  protected readonly counts = signal<Partial<FeedbackCounts>>({});
  protected readonly busy = signal<string | null>(null);

  constructor() {
    this.reload();
  }

  /**
   * Filtering re-queries rather than narrowing what is already loaded.
   *
   * The list is paginated, so a client-side filter would only ever filter
   * the first page — which looks like "no resolved feedback" when there is
   * plenty, just not in the newest 25.
   */
  protected reload() {
    const filter = this.filter();
    const queue = this.queue();

    this.loader.load(
      this.api
        .list({
          status: filter === 'all' ? undefined : filter,
          // 'me' is sent as-is: the API resolves it from the session, so
          // the filter cannot be pointed at a colleague by guessing an id.
          assignedTo: queue === 'any' ? undefined : queue,
        })
        .pipe(
          tap((page) => this.counts.set(page.counts)),
          map((page) => page.items),
        ),
    );
  }

  protected onFilterChange(value: 'all' | FeedbackStatus) {
    this.filter.set(value);
    this.reload();
  }

  protected onQueueChange(value: 'any' | 'me' | 'none') {
    this.queue.set(value);
    this.reload();
  }


  protected setStatus(item: FeedbackItem, status: FeedbackStatus) {
    this.busy.set(item.id);
    this.api.setStatus(item.id, status).subscribe({
      next: () => {
        this.busy.set(null);
        this.reload();
      },
      error: () => this.busy.set(null),
    });
  }

  protected statusLabel(s: FeedbackStatus) {
    return s === 'new' ? 'New' : s === 'triaged' ? 'Triaged' : 'Resolved';
  }

  protected statusSeverity(s: FeedbackStatus) {
    return s === 'new' ? 'info' : s === 'triaged' ? 'warn' : 'success';
  }
}
