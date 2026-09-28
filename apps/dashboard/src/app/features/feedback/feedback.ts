import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { SelectButton } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { PageHeader, EmptyState } from '../../../design-system';
import { MOCK_FEEDBACK, FeedbackItem } from '../../core/mock-data';

/**
 * Feedback inbox.
 *
 * A list rather than a table: each item is a sentence someone wrote, and the
 * useful thing about it — the source file it maps to — is the part no general
 * feedback tool can show.
 */
@Component({
  selector: 'app-feedback',
  imports: [DatePipe, FormsModule, SelectButton, Button, Tag, PageHeader, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Feedback" subtitle="Comments left on your sites, pinned to the element they are about" />

    <p-selectbutton
      [options]="filters"
      [ngModel]="filter()"
      (ngModelChange)="filter.set($event)"
      optionLabel="label"
      optionValue="value"
      size="small"
      [allowEmpty]="false" />

    @if (visible().length) {
      <div class="list">
        @for (item of visible(); track item.id) {
          <article class="ds-surface item">
            <header>
              <p-tag [value]="statusLabel(item.status)" [severity]="statusSeverity(item.status)" [rounded]="true" />
              <span class="ds-cell-muted">{{ item.author }}</span>
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
                  <span class="ds-cell-muted">{{ item.page }} · {{ item.element }} — source not resolved</span>
                }
              </span>
              <span class="actions">
                <p-button label="Open editor" icon="pi pi-pencil" size="small" [text]="true" />
                <p-button label="Create issue" icon="pi pi-github" size="small" [text]="true" severity="secondary" />
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
  `,
})
export class Feedback {
  protected readonly filters = [
    { label: 'All', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'Triaged', value: 'triaged' },
    { label: 'Resolved', value: 'resolved' },
  ];
  protected readonly filter = signal<'all' | FeedbackItem['status']>('all');
  private readonly items = signal<FeedbackItem[]>(MOCK_FEEDBACK);

  protected readonly visible = computed(() => {
    const f = this.filter();
    return f === 'all' ? this.items() : this.items().filter((i) => i.status === f);
  });

  protected statusLabel(s: FeedbackItem['status']) {
    return s === 'new' ? 'New' : s === 'triaged' ? 'Triaged' : 'Resolved';
  }

  protected statusSeverity(s: FeedbackItem['status']) {
    return s === 'new' ? 'info' : s === 'triaged' ? 'warn' : 'success';
  }
}
