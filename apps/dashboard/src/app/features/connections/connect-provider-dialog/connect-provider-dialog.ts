import { ChangeDetectionStrategy, Component, inject, model, output, signal } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { ConnectionsApi } from '../../../core/api/connections-api';
import type { Provider } from '../../../core/api-types';

interface ProviderOption {
  id: Provider;
  name: string;
  icon: string;
  blurb: string;
  /** What the change lands as, in the provider's own words. */
  changeNoun: string;
  available: boolean;
}

/**
 * Connecting a provider.
 *
 * Deliberately three steps rather than a single button. The middle step
 * exists because this is the moment an admin hands us write access to their
 * company's repositories — saying plainly what we will and will not do with
 * it belongs in front of that decision, not in a help page afterwards.
 */
@Component({
  selector: 'app-connect-provider-dialog',
  templateUrl: './connect-provider-dialog.html',
  styleUrl: './connect-provider-dialog.scss',
  imports: [Dialog, Button, Message, ProgressSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectProviderDialog {
  readonly visible = model(false);
  readonly connected = output<Provider>();
  readonly registerSite = output<void>();

  private readonly api = inject(ConnectionsApi);

  protected readonly step = signal<'choose' | 'review' | 'authorising' | 'failed'>('choose');
  protected readonly error = signal<string>('');
  protected readonly selected = signal<ProviderOption | null>(null);

  protected readonly providers: ProviderOption[] = [
    {
      id: 'github',
      name: 'GitHub',
      icon: 'pi pi-github',
      blurb: 'github.com or GitHub Enterprise',
      changeNoun: 'pull request',
      available: true,
    },
    {
      id: 'gitlab',
      name: 'GitLab',
      icon: 'pi pi-code',
      blurb: 'gitlab.com or self-hosted',
      changeNoun: 'merge request',
      // The provider interface is in place; the GitLab implementation is
      // not (P1.4). Showing it as available would walk an admin through a
      // consent screen and then fail.
      available: false,
    },
    {
      id: 'bitbucket',
      name: 'Bitbucket',
      icon: 'pi pi-box',
      blurb: 'Bitbucket Cloud',
      changeNoun: 'pull request',
      available: false,
    },
  ];

  protected heading() {
    return this.step() === 'failed' ? 'Connect a provider' : 'Connect a provider';
  }

  protected subheading() {
    switch (this.step()) {
      case 'choose':
        return 'Where your repositories live';
      case 'review':
        return `What ${this.selected()?.name} will be asked to allow`;
      case 'authorising':
        return 'Approve the installation to continue';
      default:
        return 'Something went wrong before you left this page';
    }
  }

  protected choose(p: ProviderOption) {
    this.selected.set(p);
    this.step.set('review');
  }

  /**
   * Leave for the provider.
   *
   * A full-page navigation rather than a popup: the install flow is several
   * screens on GitHub's side, it can require an organisation owner's
   * approval, and a popup that is blocked or closed leaves this dialog
   * waiting forever. The callback brings the admin back to
   * `/connections?connected=…`, which is where the outcome is reported.
   */
  protected authorise() {
    this.step.set('authorising');

    this.api.githubInstallUrl().subscribe({
      next: ({ url }) => {
        // Not router.navigate: this is a different origin.
        window.location.assign(url);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.step.set('failed');
      },
    });
  }

  protected reset() {
    this.step.set('choose');
    this.selected.set(null);
    this.error.set('');
  }
}
