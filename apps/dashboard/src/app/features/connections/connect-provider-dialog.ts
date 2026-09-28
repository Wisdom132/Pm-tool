import { ChangeDetectionStrategy, Component, model, output, signal } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Provider } from '../../core/mock-data';

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
  imports: [Dialog, Button, Message, ProgressSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [dismissableMask]="step() !== 'authorising'"
      [closable]="step() !== 'authorising'"
      [style]="{ width: '540px' }"
      (onHide)="reset()">
      <ng-template #header>
        <div class="head">
          <strong>{{ heading() }}</strong>
          <small>{{ subheading() }}</small>
        </div>
      </ng-template>

      <!-- ── 1. Which provider ─────────────────────────────── -->
      @if (step() === 'choose') {
        <div class="providers">
          @for (p of providers; track p.id) {
            <button
              type="button"
              class="provider"
              [class.unavailable]="!p.available"
              [disabled]="!p.available"
              (click)="choose(p)">
              <span class="mark"><i [class]="p.icon"></i></span>
              <span class="text">
                <strong>{{ p.name }}</strong>
                <small>{{ p.blurb }}</small>
              </span>
              @if (p.available) {
                <i class="pi pi-chevron-right"></i>
              } @else {
                <span class="soon">Soon</span>
              }
            </button>
          }
        </div>
      }

      <!-- ── 2. What we are asking for ─────────────────────── -->
      @if (step() === 'review' && selected(); as p) {
        <div class="review">
          <p class="lede">
            You'll be sent to {{ p.name }} to approve access. Pick the
            repositories you want editable — you can change that later.
          </p>

          <ul class="scopes">
            <li>
              <i class="pi pi-check"></i>
              <div>
                <strong>Read repository contents</strong>
                <small>To show the file an element came from, and its styles.</small>
              </div>
            </li>
            <li>
              <i class="pi pi-check"></i>
              <div>
                <strong>Create branches and {{ p.changeNoun }}s</strong>
                <small>Every edit lands as a {{ p.changeNoun }} for review. Nothing is pushed to your default branch.</small>
              </div>
            </li>
            <li class="denied">
              <i class="pi pi-times"></i>
              <div>
                <strong>No direct writes, ever</strong>
                <small>We never commit to a branch outside a {{ p.changeNoun }}, and never force-push.</small>
              </div>
            </li>
          </ul>

          <p-message severity="secondary" [closable]="false">
            Only an admin does this, once. Everyone else on your team edits
            without signing in to {{ p.name }} at all.
          </p-message>
        </div>
      }

      <!-- ── 3. Off to the provider ────────────────────────── -->
      @if (step() === 'authorising') {
        <div class="waiting">
          <p-progressspinner styleClass="spin" strokeWidth="4" />
          <strong>Waiting for {{ selected()?.name }}…</strong>
          <small>Approve the request in the window that opened.</small>
        </div>
      }

      <!-- ── 4. Done ───────────────────────────────────────── -->
      @if (step() === 'done') {
        <div class="done">
          <span class="tick"><i class="pi pi-check"></i></span>
          <strong>{{ selected()?.name }} connected</strong>
          <small>
            <code>iFrontida</code> · 14 repositories available
          </small>
          <p class="next">
            Next: register a site, so the editor knows which repository a
            hostname belongs to.
          </p>
        </div>
      }

      <ng-template #footer>
        @switch (step()) {
          @case ('choose') {
            <p-button label="Cancel" [text]="true" severity="secondary" (onClick)="visible.set(false)" />
          }
          @case ('review') {
            <p-button label="Back" [text]="true" severity="secondary" (onClick)="step.set('choose')" />
            <p-button [label]="'Continue to ' + selected()?.name" icon="pi pi-external-link" iconPos="right" (onClick)="authorise()" />
          }
          @case ('authorising') {
            <p-button label="Cancel" [text]="true" severity="secondary" (onClick)="step.set('review')" />
          }
          @case ('done') {
            <p-button label="Register a site" (onClick)="finish()" />
          }
        }
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .head { display: grid; gap: 2px; }
    .head strong { font-size: var(--ds-t-title); }
    .head small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); font-weight: 500; }

    .providers { display: grid; gap: var(--ds-s-2); }
    .provider { display: flex; align-items: center; gap: var(--ds-s-3); padding: var(--ds-s-4); border: 1px solid var(--ds-border); border-radius: var(--ds-r-md); background: transparent; font: inherit; text-align: left; cursor: pointer; transition: background var(--ds-trans-tap), border-color var(--ds-trans-tap); }
    .provider:hover:not(:disabled) { background: var(--ds-muted-bg); border-color: var(--p-primary-color); }
    .provider.unavailable { opacity: 0.55; cursor: default; }
    .mark { width: 38px; height: 38px; flex: none; border-radius: var(--ds-r-sm); background: var(--ds-muted-bg); display: grid; place-items: center; font-size: 17px; color: var(--p-text-color); }
    .provider .text { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .provider .text strong { font-size: var(--ds-t-body); color: var(--p-text-color); }
    .provider .text small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .soon { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-muted-color); }

    .review { display: grid; gap: var(--ds-s-4); }
    .lede { margin: 0; font-size: var(--ds-t-body); line-height: 1.6; color: var(--p-text-color); }
    .scopes { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ds-s-3); }
    .scopes li { display: flex; gap: var(--ds-s-3); }
    .scopes i { margin-top: 3px; color: var(--ds-success-ink); }
    .scopes .denied i { color: var(--p-text-muted-color); }
    .scopes div { display: grid; gap: 2px; }
    .scopes strong { font-size: var(--ds-t-small); color: var(--p-text-color); }
    .scopes small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }

    .waiting, .done { display: grid; justify-items: center; gap: var(--ds-s-3); padding: var(--ds-s-8) var(--ds-s-4); text-align: center; }
    .waiting strong, .done strong { font-size: var(--ds-t-title); }
    .waiting small, .done small { font-size: var(--ds-t-small); color: var(--p-text-muted-color); }
    .tick { width: 48px; height: 48px; border-radius: 50%; background: var(--ds-success-soft); color: var(--ds-success-ink); display: grid; place-items: center; font-size: 20px; }
    .done code { font-family: var(--ds-font-mono, ui-monospace, monospace); color: var(--p-text-color); }
    .next { margin: var(--ds-s-2) 0 0; max-width: 34ch; font-size: var(--ds-t-caption); line-height: 1.55; color: var(--p-text-muted-color); }
    :host ::ng-deep .spin { width: 40px; height: 40px; }
  `,
})
export class ConnectProviderDialog {
  readonly visible = model(false);
  readonly connected = output<Provider>();
  readonly registerSite = output<void>();

  protected readonly step = signal<'choose' | 'review' | 'authorising' | 'done'>('choose');
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
      available: true,
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
    return this.step() === 'done' ? 'Connected' : 'Connect a provider';
  }

  protected subheading() {
    switch (this.step()) {
      case 'choose':
        return 'Where your repositories live';
      case 'review':
        return `What ${this.selected()?.name} will be asked to allow`;
      case 'authorising':
        return 'Approve the request to continue';
      default:
        return 'One connection, every editor on your team';
    }
  }

  protected choose(p: ProviderOption) {
    this.selected.set(p);
    this.step.set('review');
  }

  protected authorise() {
    this.step.set('authorising');
    // Mock: the real flow leaves for the provider and returns via callback.
    setTimeout(() => this.step.set('done'), 1400);
  }

  protected finish() {
    const id = this.selected()?.id;
    if (id) this.connected.emit(id);
    this.visible.set(false);
    this.registerSite.emit();
  }

  protected reset() {
    this.step.set('choose');
    this.selected.set(null);
  }
}
