import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { PageHeader, StatCard } from '../../../design-system';
import { MOCK_SITES, MOCK_FEEDBACK, MOCK_AUDIT } from '../../core/mock-data';

@Component({
  selector: 'app-overview',
  imports: [DatePipe, RouterLink, Button, Tag, PageHeader, StatCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Overview" subtitle="Sites, edits and feedback across your organisation" />

    <div class="stats">
      <ds-stat-card label="Sites" [value]="sites().length.toString()" icon="pi pi-globe"
        caption="3 verified, 1 pending" />
      <ds-stat-card label="Open feedback" value="2" icon="pi pi-comments"
        caption="1 new since yesterday" captionTrend="up" />
      <ds-stat-card label="Pull requests this month" value="12" icon="pi pi-github"
        delta="+4" trend="up" />
      <ds-stat-card label="Editors" value="3" icon="pi pi-users" caption="1 invitation pending" />
    </div>

    <div class="two-up">
      <section class="ds-surface panel">
        <header>
          <h2>Recent feedback</h2>
          <p-button label="View all" size="small" [text]="true" routerLink="/feedback" />
        </header>
        <ul>
          @for (f of feedback().slice(0, 3); track f.id) {
            <li>
              <p-tag [value]="f.status" [severity]="f.status === 'new' ? 'info' : f.status === 'triaged' ? 'warn' : 'success'" [rounded]="true" />
              <div class="line">
                <span class="text">{{ f.message }}</span>
                <small>{{ f.author }} · {{ f.createdAt | date: 'd MMM' }}</small>
              </div>
            </li>
          }
        </ul>
      </section>

      <section class="ds-surface panel">
        <header>
          <h2>Recent activity</h2>
          <p-button label="View all" size="small" [text]="true" routerLink="/audit" />
        </header>
        <ul>
          @for (a of audit().slice(0, 4); track a.id) {
            <li>
              <code class="action">{{ a.action }}</code>
              <div class="line">
                <span class="text">{{ a.subject }}</span>
                <small>{{ a.actor }} · {{ a.createdAt | date: 'd MMM, HH:mm' }}</small>
              </div>
            </li>
          }
        </ul>
      </section>
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
  protected readonly sites = signal(MOCK_SITES);
  protected readonly feedback = signal(MOCK_FEEDBACK);
  protected readonly audit = signal(MOCK_AUDIT);
}
