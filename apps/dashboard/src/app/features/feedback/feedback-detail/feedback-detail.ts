import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { SelectButton } from 'primeng/selectbutton';
import { PageHeader, ErrorState } from '../../../../design-system';
import { FeedbackApi } from '../../../core/api/feedback-api';
import { MembersApi } from '../../../core/api/members-api';
import { createLoader } from '../../../core/load-state';
import type { Feedback, FeedbackStatus } from '../../../core/api-types';

/**
 * One piece of feedback.
 *
 * **No reply thread.** The mock version had one, and there is no comments
 * model behind it — so a composer here would accept what someone typed and
 * silently drop it, which is worse than not offering it. Threaded discussion
 * is noted as a gap in `TASK.md` rather than faked here.
 *
 * What this page does support is the full triage loop: status, an owner, the
 * screenshot, and turning the comment into an issue on the repository behind
 * its site — carrying the page, the element and the source line across,
 * which is the retyping this exists to remove.
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
    Select,
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
  private readonly members = inject(MembersApi);
  private readonly router = inject(Router);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly loader = createLoader<Feedback | null>(null);
  protected readonly item = this.loader.data;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected promoteUrl = '';

  /** Who this can be handed to. Null is the "Unassigned" option. */
  protected readonly assignees = signal<{ label: string; value: string | null }[]>([
    { label: 'Unassigned', value: null },
  ]);

  /**
   * An object URL for the screenshot.
   *
   * The bytes arrive through the API client rather than an `<img src>`,
   * because that request could not carry the organisation header.
   */
  protected readonly screenshot = signal<string | null>(null);
  protected readonly screenshotOpen = signal(false);

  protected readonly statuses = [
    { label: 'New', value: 'new' as FeedbackStatus },
    { label: 'Triaged', value: 'triaged' as FeedbackStatus },
    { label: 'Resolved', value: 'resolved' as FeedbackStatus },
  ];

  constructor() {
    this.reload();
    this.loadAssignees();

    // An object URL holds the blob in memory until it is revoked. Navigating
    // between twenty comments without this leaks twenty screenshots.
    inject(DestroyRef).onDestroy(() => this.releaseScreenshot());
  }

  protected reload() {
    this.loader.load(this.api.get(this.id));
    this.loadScreenshot();
  }

  private loadAssignees() {
    this.members.list().subscribe({
      next: (people) =>
        this.assignees.set([
          { label: 'Unassigned', value: null },
          // Only accepted members: a pending invitation has no user id to
          // assign to, and its `id` is the invitation's.
          ...people
            .filter((p) => p.kind === 'member')
            .map((p) => ({ label: p.name || p.email, value: p.id })),
        ]),
      // A failure here costs the dropdown, not the page. The comment itself
      // is still perfectly readable.
      error: () => {},
    });
  }

  private loadScreenshot() {
    this.releaseScreenshot();

    this.api.screenshot(this.id).subscribe({
      next: (blob) => this.screenshot.set(URL.createObjectURL(blob)),
      // 404 is the ordinary case — most comments have no screenshot.
      error: () => this.screenshot.set(null),
    });
  }

  private releaseScreenshot() {
    const url = this.screenshot();
    if (url) URL.revokeObjectURL(url);
    this.screenshot.set(null);
  }

  protected context(feedback: Feedback) {
    return feedback.element ? `${feedback.pagePath} · ${feedback.element}` : feedback.pagePath;
  }

  protected setStatus(feedback: Feedback, status: FeedbackStatus) {
    if (status === feedback.status) return;
    this.run(this.api.setStatus(feedback.id, status));
  }

  protected assign(feedback: Feedback, assigneeId: string | null) {
    if ((feedback.assignedTo?.id ?? null) === assigneeId) return;
    this.run(this.api.assign(feedback.id, assigneeId));
  }

  /** Open the issue, rather than asking someone to go and write it. */
  protected createIssue(feedback: Feedback) {
    this.run(this.api.createIssue(feedback.id));
  }

  protected promote(feedback: Feedback) {
    this.run(this.api.promote(feedback.id, this.promoteUrl.trim()));
  }

  private run(request: Observable<Feedback>) {
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
        // Re-read, so the controls reflect what is actually stored.
        this.loader.load(this.api.get(this.id));
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
