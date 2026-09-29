import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Tag } from 'primeng/tag';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { SelectButton } from 'primeng/selectbutton';
import { PageHeader, ErrorState } from '../../../design-system';
import { FeedbackApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import type { Feedback, FeedbackStatus } from '../../core/api.types';

/**
 * One piece of feedback.
 *
 * **No reply thread.** The mock version had one, and there is no comments
 * model behind it — so a composer here would accept what someone typed and
 * silently drop it, which is worse than not offering it. What the API does
 * support is triage: change the status, and record the issue or change
 * request this became. Threaded discussion is noted as a gap in `TASK.md`
 * rather than faked here.
 */
@Component({
  selector: 'app-feedback-detail',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    Button,
    InputText,
    Tag,
    Message,
    Skeleton,
    SelectButton,
    PageHeader,
    ErrorState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load this feedback"
          [detail]="loader.error() ?? 'It may have been deleted.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="ds-surface panel">
        <p-skeleton width="25%" height="1rem" />
        <p-skeleton width="90%" height="1.2rem" />
      </div>
    } @else if (item(); as f) {
      <ds-page-header title="Feedback" [subtitle]="context(f)">
        <p-button
          label="Delete"
          icon="pi pi-trash"
          size="small"
          [text]="true"
          severity="danger"
          dsActions
          [disabled]="busy()"
          (onClick)="remove(f)" />
      </ds-page-header>

      <a routerLink="/feedback" class="back"><i class="pi pi-arrow-left"></i> All feedback</a>

      @if (error()) {
        <p-message severity="error" [closable]="true" (onClose)="error.set('')">{{ error() }}</p-message>
      }

      <section class="ds-surface panel">
        <header>
          <p-tag
            [value]="f.status"
            [severity]="f.status === 'new' ? 'info' : f.status === 'triaged' ? 'warn' : 'success'"
            [rounded]="true" />
          <span class="muted">
            {{ f.author.name || f.author.email || 'Anonymous' }}
            @if (!f.author.verified && (f.author.name || f.author.email)) {
              <i class="pi pi-question-circle" title="Self-reported — this person was not signed in"></i>
            }
            · {{ f.createdAt | date: 'd MMM y, HH:mm' }}
          </span>
        </header>

        <p class="message">{{ f.message }}</p>

        <div class="where">
          <i class="pi pi-file"></i>
          @if (f.sourceFile) {
            <code>{{ f.sourceFile }}@if (f.sourceLine) {:{{ f.sourceLine }}}</code>
          } @else {
            <span class="muted">Source not resolved — the editor will search for this text</span>
          }
        </div>

        <dl class="context">
          <div><dt>Page</dt><dd><a [href]="f.pageUrl" target="_blank" rel="noopener">{{ f.pageUrl }}</a></dd></div>
          @if (f.element) { <div><dt>Element</dt><dd><code>{{ f.element }}</code></dd></div> }
          @if (f.environment) { <div><dt>Site</dt><dd>{{ f.environment.hostname }} · {{ f.environment.label }}</dd></div> }
          @if (f.viewport) { <div><dt>Viewport</dt><dd>{{ f.viewport }}</dd></div> }
          @if (f.userAgent) { <div><dt>Browser</dt><dd class="ua">{{ f.userAgent }}</dd></div> }
          @if (f.resolvedBy && f.resolvedAt) {
            <div>
              <dt>Resolved</dt>
              <dd>
                by {{ f.resolvedBy.name || f.resolvedBy.email }}, {{ f.resolvedAt | date: 'd MMM y, HH:mm' }}
              </dd>
            </div>
          }
        </dl>
      </section>

      <section class="ds-surface panel">
        <h2>Triage</h2>

        <div class="field">
          <label>Status</label>
          <p-selectbutton
            [options]="statuses"
            [ngModel]="f.status"
            (ngModelChange)="setStatus(f, $event)"
            optionLabel="label"
            optionValue="value"
            size="small"
            [allowEmpty]="false"
            [disabled]="busy()" />
        </div>

        <div class="field">
          <label for="promoted">Issue or pull request</label>
          @if (f.promotedUrl) {
            <p class="promoted">
              <i class="pi pi-external-link"></i>
              <a [href]="f.promotedUrl" target="_blank" rel="noopener">{{ f.promotedUrl }}</a>
            </p>
          } @else {
            <div class="promote">
              <input
                pInputText
                id="promoted"
                [(ngModel)]="promoteUrl"
                placeholder="https://github.com/acme/site/issues/12" />
              <p-button
                label="Link"
                size="small"
                [disabled]="!promoteUrl.trim() || busy()"
                (onClick)="promote(f)" />
            </div>
            <small>
              Recording it here is how the person who left this comment can see
              it was acted on. Creating it is still done from the editor.
            </small>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-4); }
    .back { display: inline-flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-caption); color: var(--p-text-muted-color); justify-self: start; }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .panel header { display: flex; align-items: center; gap: var(--ds-s-2); flex-wrap: wrap; }
    .muted { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .message { margin: 0; font-size: var(--ds-t-body); line-height: 1.65; color: var(--p-text-color); }
    .where { display: flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .where code { font-size: var(--ds-t-caption); color: var(--p-primary-color); }
    .context { margin: 0; display: grid; gap: var(--ds-s-2); padding-top: var(--ds-s-3); border-top: 1px solid var(--ds-hairline); }
    .context > div { display: grid; grid-template-columns: 110px 1fr; gap: var(--ds-s-3); align-items: baseline; }
    .context dt { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-muted-color); }
    .context dd { margin: 0; font-size: var(--ds-t-caption); color: var(--p-text-color); min-width: 0; overflow-wrap: anywhere; }
    .context .ua { color: var(--p-text-muted-color); }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }
    .promote { display: flex; gap: var(--ds-s-2); }
    .promote input { flex: 1; }
    .promoted { margin: 0; display: flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-caption); }
  `,
})
export class FeedbackDetail {
  private readonly api = inject(FeedbackApi);
  private readonly router = inject(Router);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly loader = createLoader<Feedback | null>(null);
  protected readonly item = this.loader.data;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected promoteUrl = '';

  protected readonly statuses = [
    { label: 'New', value: 'new' as FeedbackStatus },
    { label: 'Triaged', value: 'triaged' as FeedbackStatus },
    { label: 'Resolved', value: 'resolved' as FeedbackStatus },
  ];

  constructor() {
    this.reload();
  }

  protected reload() {
    this.loader.load(this.api.get(this.id));
  }

  protected context(feedback: Feedback) {
    return feedback.element ? `${feedback.pagePath} · ${feedback.element}` : feedback.pagePath;
  }

  protected setStatus(feedback: Feedback, status: FeedbackStatus) {
    if (status === feedback.status) return;
    this.run(this.api.setStatus(feedback.id, status));
  }

  protected promote(feedback: Feedback) {
    this.run(this.api.promote(feedback.id, this.promoteUrl.trim()));
  }

  private run(request: ReturnType<FeedbackApi['setStatus']>) {
    this.busy.set(true);
    this.error.set('');

    request.subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.promoteUrl = '';
        this.loader.set(updated);
      },
      error: (err: Error) => {
        this.busy.set(false);
        this.error.set(err.message);
        // Re-read, so the status buttons reflect what is actually stored.
        this.reload();
      },
    });
  }

  protected remove(feedback: Feedback) {
    this.busy.set(true);

    this.api.remove(feedback.id).subscribe({
      next: () => void this.router.navigate(['/feedback']),
      error: (err: Error) => {
        this.busy.set(false);
        this.error.set(err.message);
      },
    });
  }
}
