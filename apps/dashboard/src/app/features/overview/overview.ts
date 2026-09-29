import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Skeleton } from 'primeng/skeleton';
import type { Observable } from 'rxjs';
import { PageHeader, StatCard, EmptyState } from '../../../design-system';
import { AuditApi, FeedbackApi, MembersApi, SitesApi } from '../../core/api';
import { Session } from '../../core/session';
import type { AuditEvent, Feedback, Person, SiteEnvironment } from '../../core/api.types';

@Component({
  selector: 'app-overview',
  imports: [DatePipe, RouterLink, Button, Tag, Skeleton, PageHeader, StatCard, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Overview" subtitle="Sites, edits and feedback across your organisation" />

    <div class="stats">
      <ds-stat-card
        label="Sites"
        [value]="sites().length.toString()"
        icon="pi pi-globe"
        [caption]="siteCaption()" />
      <ds-stat-card
        label="Open feedback"
        [value]="openFeedback().toString()"
        icon="pi pi-comments"
        [caption]="feedbackCaption()" />
      <ds-stat-card
        label="Change requests"
        [value]="changeRequests().toString()"
        icon="pi pi-github"
        caption="opened from the editor" />
      <ds-stat-card
        label="People"
        [value]="memberCount().toString()"
        icon="pi pi-users"
        [caption]="peopleCaption()" />
    </div>

    <div class="two-up">
      <section class="ds-surface panel">
        <header>
          <h2>Recent feedback</h2>
          <p-button label="View all" size="small" [text]="true" routerLink="/feedback" />
        </header>
        @if (loading()) {
          <p-skeleton width="80%" height="1rem" />
        } @else if (feedback().length) {
          <ul>
            @for (f of feedback().slice(0, 3); track f.id) {
              <li>
                <p-tag [value]="f.status" [severity]="f.status === 'new' ? 'info' : f.status === 'triaged' ? 'warn' : 'success'" [rounded]="true" />
                <div class="line">
                  <span class="text">{{ f.message }}</span>
                  <small>
                    {{ f.author.name || f.author.email || 'Anonymous' }} · {{ f.createdAt | date: 'd MMM' }}
                  </small>
                </div>
              </li>
            }
          </ul>
        } @else {
          <ds-empty-state
            icon="pi pi-comments"
            title="No feedback yet"
            description="Comments left on your sites arrive here."
            size="sm" />
        }
      </section>

      @if (isAdmin()) {
      <section class="ds-surface panel">
        <header>
          <h2>Recent activity</h2>
          <p-button label="View all" size="small" [text]="true" routerLink="/audit" />
        </header>
        @if (loading()) {
          <p-skeleton width="80%" height="1rem" />
        } @else if (audit().length) {
          <ul>
            @for (a of audit().slice(0, 4); track a.id) {
              <li>
                <code class="action">{{ a.action }}</code>
                <div class="line">
                  <span class="text">{{ a.subject ?? '—' }}</span>
                  <small>
                    {{ a.actor ? (a.actor.name || a.actor.email) : 'a deleted account' }}
                    · {{ a.createdAt | date: 'd MMM, HH:mm' }}
                  </small>
                </div>
              </li>
            }
          </ul>
        } @else {
          <ds-empty-state
            icon="pi pi-history"
            title="Nothing recorded yet"
            description="Connecting a provider or registering a site lands here."
            size="sm" />
        }
      </section>
      }
    </div>
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .stats { display: grid; gap: var(--ds-s-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .two-up { display: grid; gap: var(--ds-s-4); grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); align-content: start; }
    .panel header { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-s-3); }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .panel ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ds-s-3); }
    .panel li { display: flex; align-items: flex-start; gap: var(--ds-s-3); }
    .line { display: grid; gap: 2px; min-width: 0; }
    .text { font-size: var(--ds-t-small); color: var(--p-text-color); }
    .line small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .action { flex: none; font-size: var(--ds-t-caption); color: var(--p-primary-color); }
  `,
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
