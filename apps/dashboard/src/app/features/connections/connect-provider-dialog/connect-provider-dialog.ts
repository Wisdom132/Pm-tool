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

  protected readonly step = signal<'choose' | 'review' | 'authorising' | 'waiting' | 'failed'>(
    'choose'
  );
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
        return 'Opening a new tab';
      case 'waiting':
        return 'Finish in the other tab';
      default:
        return 'Something went wrong before you left this page';
    }
  }

  protected choose(p: ProviderOption) {
    this.selected.set(p);
    this.step.set('review');
  }

  /**
   * Leave for the provider, in a new tab.
   *
   * The install is several screens on GitHub's side and can stall on an
   * organisation owner's approval. Navigating the whole window there means
   * an admin who gives up, or whose approval is pending, has lost the
   * dashboard along with whatever else they were part-way through.
   *
   * The tab still reports its own outcome: the callback redirects to
   * `/connections?connected=…`, so the new tab lands on this same screen
   * with the result. This one refreshes when it regains focus, so both
   * agree without either being reloaded by hand.
   *
   * A blocked popup falls back to navigating this window. Returning null is
   * the browser saying no, and a dialog that spun forever after a blocked
   * popup would be the worse failure — it is the reason this was a
   * full-page navigation to begin with.
   */
  protected authorise() {
    this.step.set('authorising');

    this.api.githubInstallUrl().subscribe({
      next: ({ url }) => {
        // noopener: the opened tab must not get a handle on this window.
        const tab = window.open(url, '_blank', 'noopener,noreferrer');

        if (tab) {
          this.step.set('waiting');
          return;
        }

        // Blocked. Not router.navigate: this is a different origin.
        window.location.assign(url);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.step.set('failed');
      },
    });
  }

  /** Nothing left to do here — the other tab is carrying the flow. */
  protected done() {
    this.visible.set(false);
    this.reset();
  }

  protected reset() {
    this.step.set('choose');
    this.selected.set(null);
    this.error.set('');
  }
}
