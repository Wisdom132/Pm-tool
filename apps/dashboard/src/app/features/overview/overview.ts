import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Skeleton } from 'primeng/skeleton';
import type { Observable } from 'rxjs';
import { PageHeader, StatCard, EmptyState } from '../../../design-system';
import { AuditApi } from '../../core/api/audit-api';
import { FeedbackApi } from '../../core/api/feedback-api';
import { MembersApi } from '../../core/api/members-api';
import { SitesApi } from '../../core/api/sites-api';
import { Session } from '../../core/session';
import type { AuditEvent, Feedback, Person, SiteEnvironment } from '../../core/api-types';

@Component({
  selector: 'app-overview',
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
  imports: [DatePipe, RouterLink, Button, Tag, Skeleton, PageHeader, StatCard, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Overview {
  private readonly sitesApi = inject(SitesApi);
  private readonly feedbackApi = inject(FeedbackApi);
  private readonly auditApi = inject(AuditApi);
  private readonly membersApi = inject(MembersApi);
  private readonly session = inject(Session);

  protected readonly sites = signal<SiteEnvironment[]>([]);
  protected readonly feedback = signal<Feedback[]>([]);
  protected readonly audit = signal<AuditEvent[]>([]);
  protected readonly people = signal<Person[]>([]);
  protected readonly feedbackCounts = signal<Record<string, number>>({});
  protected readonly changeRequests = signal(0);
  protected readonly isAdmin = this.session.isAdmin;

  /** Four independent requests; the panels fill in as each lands. */
  private readonly pending = signal(0);
  protected readonly loading = computed(() => this.pending() > 0);

  protected readonly openFeedback = computed(
    () => (this.feedbackCounts()['new'] ?? 0) + (this.feedbackCounts()['triaged'] ?? 0),
  );
  protected readonly memberCount = computed(
    () => this.people().filter((p) => p.kind === 'member').length,
  );

  protected readonly siteCaption = computed(() => {
    const verified = this.sites().filter((s) => s.site.verifiedAt).length;
    const total = this.sites().length;
    if (!total) return 'none registered yet';
    return total === verified ? 'all verified' : `${verified} verified, ${total - verified} pending`;
  });

  protected readonly feedbackCaption = computed(() => {
    const resolved = this.feedbackCounts()['resolved'] ?? 0;
    return resolved ? `${resolved} resolved` : 'nothing resolved yet';
  });

  protected readonly peopleCaption = computed(() => {
    const invited = this.people().filter((p) => p.kind === 'invitation').length;
    if (!invited) return 'no invitations pending';
    return invited === 1 ? '1 invitation pending' : `${invited} invitations pending`;
  });

  constructor() {
    this.track(this.sitesApi.list(), (v) => this.sites.set(v));
    this.track(this.feedbackApi.list(), (page) => {
      this.feedback.set(page.items);
      this.feedbackCounts.set(page.counts);
    });
    this.track(this.membersApi.list(), (v) => this.people.set(v));

    // Admin-only, and it doubles as the source of the change-request count:
    // `pr.opened` is recorded for every one the editor opens.
    if (this.session.isAdmin()) {
      this.track(this.auditApi.list({ limit: 50 }), (page) => {
        this.audit.set(page.events);
        this.changeRequests.set(page.events.filter((e) => e.action === 'pr.opened').length);
      });
    }
  }

  /**
   * A failed panel is left empty rather than failing the page.
   *
   * The overview is four unrelated summaries; one of them being unavailable
   * is not a reason to show an error instead of the other three.
   */
  private track<T>(source: Observable<T>, apply: (value: T) => void) {
    this.pending.update((n) => n + 1);
    source.subscribe({
      next: (value) => {
        apply(value);
        this.pending.update((n) => n - 1);
      },
      error: () => this.pending.update((n) => n - 1),
    });
  }
}
