import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { Select } from 'primeng/select';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { tap, map } from 'rxjs';
import { AuditApi } from '../../core/api/audit-api';
import { createLoader } from '../../core/load-state';
import type { AuditEvent } from '../../core/api-types';

/**
 * The audit log.
 *
 * Paginated with a cursor rather than page numbers, because the underlying
 * table is append-only: an offset shifts under the reader, so page two would
 * re-show a row from page one every time a new event landed mid-read.
 */
@Component({
  selector: 'app-audit',
  templateUrl: './audit.html',
  styleUrl: './audit.scss',
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    Button,
    Select,
    Skeleton,
    PageHeader,
    EmptyState,
    ErrorState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Audit {
  private readonly api = inject(AuditApi);

  protected readonly loader = createLoader<AuditEvent[]>([]);
  protected readonly events = this.loader.data;
  protected readonly cursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly action = signal<string | null>(null);
  protected readonly actionOptions = signal<{ label: string; value: string }[]>([]);

  constructor() {
    this.reload();
    this.api.actions().subscribe({
      next: (actions) =>
        this.actionOptions.set(actions.map((a) => ({ label: a, value: a }))),
    });
  }

  /**
   * The loader holds the rows; the cursor lives here.
   *
   * `tap` captures the cursor from the page, `map` hands the loader just the
   * rows — so the loading and error states stay in one place instead of
   * being duplicated alongside a separate page signal.
   */
  protected reload() {
    this.cursor.set(null);
    this.loader.load(
      this.api.list({ action: this.action() ?? undefined }).pipe(
        tap((page) => this.cursor.set(page.nextCursor)),
        map((page) => page.events),
      ),
    );
  }

  protected filterBy(action: string | null) {
    this.action.set(action);
    this.reload();
  }

  protected loadMore() {
    const cursor = this.cursor();
    if (!cursor) return;

    this.loadingMore.set(true);
    this.api.list({ cursor, action: this.action() ?? undefined }).subscribe({
      next: (page) => {
        this.loader.set([...this.events(), ...page.events]);
        this.cursor.set(page.nextCursor);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  /** A one-line summary of the JSON detail, when there is something to say. */
  protected detailOf(event: AuditEvent): string | null {
    const detail = event.detail;
    if (!detail || typeof detail !== 'object') return null;

    if (typeof detail['from'] === 'string' && typeof detail['to'] === 'string') {
      return `${detail['from']} → ${detail['to']}`;
    }
    if (typeof detail['repository'] === 'string') {
      return String(detail['repository']);
    }
    if (typeof detail['url'] === 'string') {
      return String(detail['url']);
    }
    return null;
  }
}
