import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { PageHeader, EmptyState } from '../../../design-system';
import { MOCK_CONNECTIONS, Connection } from '../../core/mock-data';
import { ConnectProviderDialog } from './connect-provider-dialog';

/**
 * Provider connections.
 *
 * Connected once by an admin, here, rather than by every editor inside the
 * browser extension — which is what made the first real install stall on an
 * app that had not been added to the organisation.
 */
@Component({
  selector: 'app-connections',
  imports: [DatePipe, Button, Tag, PageHeader, EmptyState, ConnectProviderDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Connections" subtitle="Where your repositories live">
      <p-button label="Connect a provider" icon="pi pi-plus" size="small" dsActions (onClick)="connecting.set(true)" />
    </ds-page-header>

    @if (connections().length) {
      <div class="grid">
        @for (c of connections(); track c.id) {
          <div class="ds-surface card">
            <div class="card-head">
              <span class="mark"><i [class]="icon(c.provider)"></i></span>
              <div class="titles">
                <strong>{{ c.accountLogin }}</strong>
                <small>{{ c.provider }} · {{ c.repositories }} repositories</small>
              </div>
              <p-tag
                [value]="c.status === 'active' ? 'Active' : 'Needs attention'"
                [severity]="c.status === 'active' ? 'success' : 'warn'"
                [rounded]="true" />
            </div>
            <div class="card-foot">
              <span class="ds-cell-muted">
                Connected by {{ c.connectedBy }} on {{ c.connectedAt | date: 'd MMM yyyy' }}
              </span>
              <p-button label="Manage" size="small" [text]="true" />
            </div>
          </div>
        }
      </div>
    } @else {
      <div class="ds-surface">
        <ds-empty-state
          icon="pi pi-link"
          title="No providers connected"
          description="Connect GitHub, GitLab or Bitbucket once, and every editor on your team can open pull requests without signing in to it themselves.">
          <p-button label="Connect a provider" icon="pi pi-plus" size="small" (onClick)="connecting.set(true)" />
        </ds-empty-state>
      </div>
    }

    <app-connect-provider-dialog [(visible)]="connecting" (registerSite)="goToSites()" />
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .grid { display: grid; gap: var(--ds-s-4); grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
    .card { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); }
    .card-head { display: flex; align-items: center; gap: var(--ds-s-3); }
    .mark { width: 40px; height: 40px; flex: none; border-radius: var(--ds-r-md); background: var(--ds-muted-bg); display: grid; place-items: center; font-size: 18px; color: var(--p-text-color); }
    .titles { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .titles strong { font-size: var(--ds-t-title); color: var(--p-text-color); }
    .titles small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); text-transform: capitalize; }
    .card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-s-3); padding-top: var(--ds-s-3); border-top: 1px solid var(--ds-hairline); }
    .ds-cell-muted { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
  `,
})
export class Connections {
  protected readonly connecting = signal(false);
  protected readonly connections = signal<Connection[]>(MOCK_CONNECTIONS);

  constructor(private readonly router: Router) {}

  protected goToSites() {
    this.router.navigate(['/sites']);
  }

  protected icon(provider: Connection['provider']) {
    return provider === 'github' ? 'pi pi-github' : provider === 'gitlab' ? 'pi pi-code' : 'pi pi-box';
  }
}
