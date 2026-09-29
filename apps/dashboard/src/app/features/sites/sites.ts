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
import { SitesApi } from '../../core/api/sites-api';
import type { SiteEnvironment } from '../../core/api-types';
import { RegisterSiteDialog } from './register-site-dialog/register-site-dialog';

/**
 * Sites — hostname to repository and branch.
 *
 * This is the table the extension's whole "what am I editing?" question
 * resolves against, so the branch column is the important one: a null branch
 * means "read it from the page", which is what preview deploys need.
 */
@Component({
  selector: 'app-sites',
  templateUrl: './sites.html',
  styleUrl: './sites.scss',
  imports: [DatePipe, FormsModule, RouterLink, TableModule, Button, IconField, InputIcon, InputText, Tag, PageHeader, EmptyState, ErrorState, Skeleton, RegisterSiteDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
