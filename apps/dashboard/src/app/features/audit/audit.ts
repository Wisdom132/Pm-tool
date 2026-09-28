import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { Tag } from 'primeng/tag';
import { PageHeader, EmptyState } from '../../../design-system';
import { MOCK_AUDIT, AuditEntry } from '../../core/mock-data';

@Component({
  selector: 'app-audit',
  imports: [DatePipe, TableModule, Tag, PageHeader, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Audit log" subtitle="Every privileged action, with who did it and when" />

    <div class="ds-surface">
      <p-table [value]="entries()" styleClass="ds-table" [rowHover]="true" [tableStyle]="{ 'min-width': '720px' }">
        <ng-template #header>
          <tr>
            <th>Action</th>
            <th>Subject</th>
            <th>Who</th>
            <th>When</th>
          </tr>
        </ng-template>
        <ng-template #body let-e>
          <tr>
            <td><code class="action">{{ e.action }}</code></td>
            <td class="ds-cell-strong">{{ e.subject }}</td>
            <td class="ds-cell-muted">{{ e.actor }}</td>
            <td class="ds-cell-muted">{{ e.createdAt | date: 'd MMM yyyy, HH:mm' }}</td>
          </tr>
        </ng-template>

        <ng-template #emptymessage>
          <tr>
            <td colspan="4">
              <ds-empty-state
                icon="pi pi-history"
                title="Nothing recorded yet"
                description="Connecting a provider, registering a site or opening a pull request all land here."
                size="sm" />
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .action { font-size: var(--ds-t-caption); color: var(--p-primary-color); }
  `,
})
export class Audit {
  protected readonly entries = signal<AuditEntry[]>(MOCK_AUDIT);
}
