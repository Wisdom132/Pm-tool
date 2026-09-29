import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SelectButton } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { RouterLink } from '@angular/router';
import { Skeleton } from 'primeng/skeleton';
import { tap, map } from 'rxjs';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { FeedbackApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import type { Feedback as FeedbackItem, FeedbackStatus } from '../../core/api.types';

/**
 * Feedback inbox.
 *
 * A list rather than a table: each item is a sentence someone wrote, and the
 * useful thing about it — the source file it maps to — is the part no general
 * feedback tool can show.
 */
@Component({
  selector: 'app-feedback',
  imports: [DatePipe, FormsModule, RouterLink, SelectButton, Button, Tag, Skeleton, PageHeader, EmptyState, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Feedback" subtitle="Comments left on your sites, pinned to the element they are about" />

    <p-selectbutton
      [options]="filters"
      [ngModel]="filter()"
      (ngModelChange)="onFilterChange($event)"
      optionLabel="label"
      optionValue="value"
      size="small"
      [allowEmpty]="false" />

    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load feedback"
          [detail]="loader.error() ?? 'The request for this list failed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="list">
        @for (n of [1, 2, 3]; track n) {
          <div class="ds-surface item">
            <p-skeleton width="30%" height="0.9rem" />
            <p-skeleton width="80%" height="1rem" />
          </div>
        }
      </div>
    } @else if (items().length) {
      <div class="list">
        @for (item of items(); track item.id) {
          <article class="ds-surface item">
            <header>
              <p-tag [value]="statusLabel(item.status)" [severity]="statusSeverity(item.status)" [rounded]="true" />
              <span class="ds-cell-muted">
                {{ item.author.name || item.author.email || 'Anonymous' }}
                @if (!item.author.verified && (item.author.name || item.author.email)) {
                  <!-- A public submission names itself; that is not identity. -->
                  <i class="pi pi-question-circle unverified" title="Self-reported — this person was not signed in"></i>
                }
              </span>
              <span class="dot">·</span>
              <span class="ds-cell-muted">{{ item.createdAt | date: 'd MMM, HH:mm' }}</span>
            </header>

            <p class="message">{{ item.message }}</p>

            <footer>
              <span class="where">
                <i class="pi pi-file"></i>
                @if (item.sourceFile) {
                  <code>{{ item.sourceFile }}</code>
                } @else {
                  <span class="ds-cell-muted">
                    {{ item.pagePath }}{{ item.element ? ' · ' + item.element : '' }} — source not resolved
                  </span>
                }
              </span>
              <span class="actions">
                <p-button label="Open" icon="pi pi-arrow-right" iconPos="right" size="small" [text]="true" [routerLink]="['/feedback', item.id]" />
                @if (item.status !== 'resolved') {
                  <p-button
                    label="Resolve"
                    icon="pi pi-check"
                    size="small"
                    [text]="true"
                    severity="secondary"
                    [disabled]="busy() === item.id"
                    (onClick)="setStatus(item, 'resolved')" />
                }
                @if (item.promotedUrl) {
                  <a class="promoted" [href]="item.promotedUrl" target="_blank" rel="noopener">
                    <i class="pi pi-external-link"></i> Filed
                  </a>
                }
              </span>
            </footer>
          </article>
        }
      </div>
    } @else {
      <div class="ds-surface">
        <ds-empty-state
          icon="pi pi-comments"
          title="Nothing here"
          [description]="filter() === 'all'
            ? 'Feedback left on your sites will arrive here, with the element and source file it refers to.'
            : 'No feedback with that status.'" />
      </div>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-4); justify-items: start; }
    :host > * { width: 100%; }
    .list { display: grid; gap: var(--ds-s-3); }
    .item { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-3); }
    header { display: flex; align-items: center; gap: var(--ds-s-2); }
    .message { margin: 0; font-size: var(--ds-t-body); line-height: 1.6; color: var(--p-text-color); }
    footer { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-s-3); flex-wrap: wrap; padding-top: var(--ds-s-3); border-top: 1px solid var(--ds-hairline); }
    .where { display: flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .where code { font-size: var(--ds-t-caption); color: var(--p-primary-color); }
    .ds-cell-muted { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .dot { color: var(--p-text-muted-color); }
    .unverified { font-size: 11px; opacity: 0.7; }
    .promoted { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ds-t-caption); color: var(--p-primary-color); }
  `,
})
export class Feedback {
  private readonly api = inject(FeedbackApi);

  protected readonly filters = [
    { label: 'All', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'Triaged', value: 'triaged' },
    { label: 'Resolved', value: 'resolved' },
  ];
  protected readonly filter = signal<'all' | FeedbackStatus>('all');
  protected readonly loader = createLoader<FeedbackItem[]>([]);
  protected readonly items = this.loader.data;
  protected readonly counts = signal<Record<string, number>>({});
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
    this.loader.load(
      this.api
        .list({ status: filter === 'all' ? undefined : filter })
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
