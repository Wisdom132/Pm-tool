import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Message } from 'primeng/message';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { ConnectionsApi } from '../../core/api/connections-api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Connection } from '../../core/api-types';
import { ConnectProviderDialog } from './connect-provider-dialog/connect-provider-dialog';

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
  templateUrl: './connections.html',
  styleUrl: './connections.scss',
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
