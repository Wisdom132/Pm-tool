import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { ConnectionsApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Connection } from '../../core/api.types';
import { ConnectProviderDialog } from './connect-provider-dialog';

/**
 * Provider connections.
 *
 * Connected once by an admin, here, rather than by every editor inside the
 * browser extension — which is what made the first real install stall on an
 * app that had not been added to the organisation.
 *
 * The install flow leaves the page entirely: GitHub sends the admin back to
 * `/connections?connected=<id>` or `?error=<message>`, so this screen has to
 * read its own query string on arrival.
 */
@Component({
  selector: 'app-connections',
  imports: [
    DatePipe,
    Button,
    Tag,
    Message,
    Skeleton,
    PageHeader,
    EmptyState,
    ErrorState,
    ConnectProviderDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Connections" subtitle="Where your repositories live">
      @if (isAdmin()) {
        <p-button label="Connect a provider" icon="pi pi-plus" size="small" dsActions (onClick)="connecting.set(true)" />
      }
    </ds-page-header>

    @if (banner(); as note) {
      <p-message [severity]="note.severity" [closable]="true" (onClose)="banner.set(null)">
        {{ note.text }}
      </p-message>
    }

    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load your connections"
          [detail]="loader.error() ?? 'The request for this list failed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="grid">
        @for (n of [1, 2]; track n) {
          <div class="ds-surface card">
            <p-skeleton width="60%" height="1.2rem" />
            <p-skeleton width="40%" height="0.8rem" />
          </div>
        }
      </div>
    } @else if (loader.data().length) {
      <div class="grid">
        @for (c of loader.data(); track c.id) {
          <div class="ds-surface card" [class.revoked]="c.revokedAt">
            <div class="card-head">
              <span class="mark"><i [class]="icon(c.provider)"></i></span>
              <div class="titles">
                <strong>{{ c.accountLogin }}</strong>
                <small>{{ c.provider }} · {{ siteCount(c) }}</small>
              </div>
              <p-tag
                [value]="c.revokedAt ? 'Revoked' : 'Active'"
                [severity]="c.revokedAt ? 'secondary' : 'success'"
                [rounded]="true" />
            </div>
            <div class="card-foot">
              <span class="ds-cell-muted">
                @if (c.createdBy) {
                  Connected by {{ c.createdBy.name || c.createdBy.email }} on {{ c.createdAt | date: 'd MMM y' }}
                } @else {
                  Connected on {{ c.createdAt | date: 'd MMM y' }}
                }
              </span>
              @if (!c.revokedAt && isAdmin()) {
                <p-button
                  [label]="revoking() === c.id ? 'Revoking…' : 'Revoke'"
                  size="small"
                  [text]="true"
                  severity="danger"
                  [disabled]="revoking() !== null"
                  (onClick)="revoke(c)" />
              }
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
          @if (isAdmin()) {
            <p-button label="Connect a provider" icon="pi pi-plus" size="small" (onClick)="connecting.set(true)" />
          }
        </ds-empty-state>
      </div>
    }

    <app-connect-provider-dialog
      [(visible)]="connecting"
      (connected)="reload()"
      (registerSite)="goToSites()" />
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .grid { display: grid; gap: var(--ds-s-4); grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
    .card { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); }
    .card.revoked { opacity: 0.6; }
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
  private readonly api = inject(ConnectionsApi);
  private readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly connecting = signal(false);
  protected readonly revoking = signal<string | null>(null);
  protected readonly banner = signal<{ severity: 'success' | 'error'; text: string } | null>(null);
  protected readonly loader = createLoader<Connection[]>([]);
  protected readonly isAdmin = this.session.isAdmin;

  constructor() {
    this.readCallback();
    this.reload();
  }

  protected reload() {
    this.loader.load(this.api.list());
  }

  /**
   * What GitHub's redirect left in the URL.
   *
   * Cleared afterwards so a refresh does not re-show a stale result, and so
   * the message cannot be forged into a bookmarkable link.
   */
  private readCallback() {
    const params = this.route.snapshot.queryParamMap;
    const error = params.get('error');
    const connected = params.get('connected');

    if (error) {
      this.banner.set({ severity: 'error', text: error });
    } else if (connected) {
      this.banner.set({ severity: 'success', text: 'Provider connected. Register a site next.' });
    }

    if (error || connected) {
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  protected goToSites() {
    void this.router.navigate(['/sites']);
  }

  /**
   * The API refuses this while sites still point at the connection, which is
   * the message worth showing verbatim — it names how many and what to do.
   */
  protected revoke(connection: Connection) {
    this.revoking.set(connection.id);

    this.api.revoke(connection.id).subscribe({
      next: () => {
        this.revoking.set(null);
        this.banner.set({
          severity: 'success',
          text: `${connection.accountLogin} disconnected.`,
        });
        this.reload();
      },
      error: (err: Error) => {
        this.revoking.set(null);
        this.banner.set({ severity: 'error', text: err.message });
      },
    });
  }

  protected siteCount(connection: Connection) {
    const n = connection._count.environments;
    return n === 1 ? '1 site' : `${n} sites`;
  }

  protected icon(provider: Connection['provider']) {
    return provider === 'github' ? 'pi pi-github' : provider === 'gitlab' ? 'pi pi-code' : 'pi pi-box';
  }
}
