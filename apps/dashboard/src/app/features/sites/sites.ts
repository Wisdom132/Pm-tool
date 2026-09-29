import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { InputText } from 'primeng/inputtext';
import { Tag } from 'primeng/tag';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { createLoader } from '../../core/load-state';
import { SitesApi } from '../../core/api';
import type { SiteEnvironment } from '../../core/api.types';
import { RegisterSiteDialog } from './register-site-dialog';

/**
 * Sites — hostname to repository and branch.
 *
 * This is the table the extension's whole "what am I editing?" question
 * resolves against, so the branch column is the important one: a null branch
 * means "read it from the page", which is what preview deploys need.
 */
@Component({
  selector: 'app-sites',
  imports: [DatePipe, FormsModule, RouterLink, TableModule, Button, IconField, InputIcon, InputText, Tag, PageHeader, EmptyState, ErrorState, Skeleton, RegisterSiteDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Sites" subtitle="Which repository and branch each hostname edits">
      <p-button label="Register a site" icon="pi pi-plus" size="small" dsActions (onClick)="registering.set(true)" />
    </ds-page-header>

    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load your sites"
          [detail]="loader.error() ?? 'The request for this list failed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="ds-surface skeletons">
        @for (row of [1, 2, 3, 4]; track row) {
          <div class="skeleton-row">
            <p-skeleton width="38%" height="1rem" />
            <p-skeleton width="14%" height="1rem" />
            <p-skeleton width="24%" height="1rem" />
            <p-skeleton width="12%" height="1rem" />
          </div>
        }
      </div>
    } @else {
    <div class="ds-surface">
      <p-table
        [value]="filtered()"
        styleClass="ds-table"
        [rowHover]="true"
        [tableStyle]="{ 'min-width': '900px' }">
        <ng-template #caption>
          <div class="toolbar">
            <p-iconfield>
              <p-inputicon class="pi pi-search" />
              <input pInputText type="search" placeholder="Search hostname or repository" [ngModel]="query()" (ngModelChange)="query.set($event)" pSize="small" />
            </p-iconfield>
          </div>
        </ng-template>

        <ng-template #header>
          <tr>
            <th>Hostname</th>
            <th>Environment</th>
            <th>Repository</th>
            <th>Branch</th>
            <th>Registered</th>
            <th></th>
          </tr>
        </ng-template>

        <ng-template #body let-site>
          <tr>
            <td>
              <span class="ds-cell-strong">{{ site.hostname }}</span>
              @if (!site.site.verifiedAt) {
                <p-tag value="Unverified" severity="warn" [rounded]="true" styleClass="verify-tag" />
              }
            </td>
            <td><p-tag [value]="site.label" [severity]="envSeverity(site.label)" [rounded]="true" /></td>
            <td class="ds-cell-muted">{{ site.repository }}</td>
            <td>
              @if (site.branch) {
                <code>{{ site.branch }}</code>
              } @else {
                <span class="ds-cell-muted" title="Preview deploys carry the branch on the page itself">
                  from the page
                </span>
              }
            </td>
            <td class="ds-cell-muted">{{ site.createdAt | date: 'd MMM y' }}</td>
            <td class="row-actions">
              <p-button icon="pi pi-pencil" [text]="true" [rounded]="true" severity="secondary" size="small"
                ariaLabel="Edit site" [routerLink]="['/sites', site.id]" />
            </td>
          </tr>
        </ng-template>

        <ng-template #emptymessage>
          <tr>
            <td colspan="6">
              @if (query()) {
                <ds-empty-state
                  icon="pi pi-search"
                  title="No matches"
                  description="Nothing here matches that search."
                  size="sm">
                  <p-button label="Clear search" size="small" [text]="true" (onClick)="query.set('')" />
                </ds-empty-state>
              } @else {
                <ds-empty-state
                  icon="pi pi-globe"
                  title="No sites yet"
                  description="A site maps a hostname to a repository and branch, which is how the editor knows what it is editing.">
                  <p-button label="Register a site" icon="pi pi-plus" size="small" (onClick)="registering.set(true)" />
                </ds-empty-state>
              }
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
    }

    <app-register-site-dialog [(visible)]="registering" />
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .toolbar { display: flex; justify-content: flex-end; padding: var(--ds-s-2) 0; }
    .row-actions { text-align: right; }
    .skeletons { padding: var(--ds-s-4); display: grid; gap: var(--ds-s-4); }
    .skeleton-row { display: flex; gap: var(--ds-s-4); align-items: center; }
    code { font-family: var(--ds-font-mono, ui-monospace, monospace); font-size: var(--ds-t-caption); }
    :host ::ng-deep .verify-tag { margin-left: var(--ds-s-2); }
  `,
})
export class Sites {
  // A signal, not a plain field: `filtered` is a computed, and a computed
  // only recomputes when something it reads is a signal.
  protected readonly registering = signal(false);
  protected readonly loader = createLoader<SiteEnvironment[]>([]);
  protected readonly query = signal('');
  private readonly sites = this.loader.data;

  private readonly api = inject(SitesApi);

  constructor() {
    this.reload();
  }

  protected reload() {
    this.loader.load(this.api.list());
  }

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.sites();
    return this.sites().filter(
      (s) => s.hostname.toLowerCase().includes(q) || s.repository.toLowerCase().includes(q)
    );
  });

  protected envSeverity(label: SiteEnvironment['label']) {
    return label === 'production' ? 'success' : label === 'staging' ? 'info' : 'secondary';
  }
}
