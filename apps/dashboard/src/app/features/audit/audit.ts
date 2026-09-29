import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { Select } from 'primeng/select';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { tap, map } from 'rxjs';
import { AuditApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import type { AuditEvent } from '../../core/api.types';

/**
 * The audit log.
 *
 * Paginated with a cursor rather than page numbers, because the underlying
 * table is append-only: an offset shifts under the reader, so page two would
 * re-show a row from page one every time a new event landed mid-read.
 */
@Component({
  selector: 'app-audit',
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
  template: `
    <ds-page-header title="Audit log" subtitle="Every privileged action, with who did it and when">
      <p-select
        dsActions
        [options]="actionOptions()"
        [ngModel]="action()"
        (ngModelChange)="filterBy($event)"
        optionLabel="label"
        optionValue="value"
        placeholder="All actions"
        [showClear]="true"
        size="small"
        styleClass="action-filter" />
    </ds-page-header>

    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load the audit log"
          [detail]="loader.error() ?? 'The request for this list failed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="ds-surface skeletons">
        @for (n of [1, 2, 3, 4, 5]; track n) {
          <div class="skeleton-row">
            <p-skeleton width="20%" height="1rem" />
            <p-skeleton width="34%" height="1rem" />
            <p-skeleton width="22%" height="1rem" />
            <p-skeleton width="18%" height="1rem" />
          </div>
        }
      </div>
    } @else {
      <div class="ds-surface">
        <p-table [value]="events()" styleClass="ds-table" [rowHover]="true" [tableStyle]="{ 'min-width': '760px' }">
          <ng-template #header>
            <tr>
              <th>Action</th>
              <th>Subject</th>
              <th>Who</th>
              <th>When</th>
            </tr>
          </ng-template>
          <ng-template #body let-e>
            <tr>
              <td><code class="action">{{ e.action }}</code></td>
              <td class="ds-cell-strong">
                {{ e.subject ?? '—' }}
                @if (detailOf(e); as d) { <small class="detail">{{ d }}</small> }
              </td>
              <td class="ds-cell-muted">
                <!-- An actor is null when the account has since been deleted.
                     The row deliberately outlives the user. -->
                {{ e.actor ? (e.actor.name || e.actor.email) : 'a deleted account' }}
              </td>
              <td class="ds-cell-muted">{{ e.createdAt | date: 'd MMM y, HH:mm' }}</td>
            </tr>
          </ng-template>

          <ng-template #emptymessage>
            <tr>
              <td colspan="4">
                @if (action()) {
                  <ds-empty-state
                    icon="pi pi-filter"
                    title="Nothing matches that action"
                    size="sm">
                    <p-button label="Clear filter" size="small" [text]="true" (onClick)="filterBy(null)" />
                  </ds-empty-state>
                } @else {
                  <ds-empty-state
                    icon="pi pi-history"
                    title="Nothing recorded yet"
                    description="Connecting a provider, registering a site or opening a pull request all land here."
                    size="sm" />
                }
              </td>
            </tr>
          </ng-template>
        </p-table>

        @if (cursor()) {
          <div class="more">
            <p-button
              [label]="loadingMore() ? 'Loading…' : 'Load older events'"
              size="small"
              [text]="true"
              [disabled]="loadingMore()"
              (onClick)="loadMore()" />
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .action { font-size: var(--ds-t-caption); color: var(--p-primary-color); }
    .detail { display: block; font-size: var(--ds-t-caption); font-weight: 500; color: var(--p-text-muted-color); }
    .more { display: flex; justify-content: center; padding: var(--ds-s-3); border-top: 1px solid var(--ds-hairline); }
    .skeletons { padding: var(--ds-s-4); display: grid; gap: var(--ds-s-4); }
    .skeleton-row { display: flex; gap: var(--ds-s-4); align-items: center; }
    :host ::ng-deep .action-filter { min-width: 200px; }
  `,
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
