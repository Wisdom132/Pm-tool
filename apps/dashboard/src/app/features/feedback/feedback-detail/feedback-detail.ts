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
import { PageHeader, ErrorState } from '../../../../design-system';
import { FeedbackApi } from '../../../core/api/feedback-api';
import { createLoader } from '../../../core/load-state';
import type { Feedback, FeedbackStatus } from '../../../core/api-types';

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
  templateUrl: './feedback-detail.html',
  styleUrl: './feedback-detail.scss',
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
