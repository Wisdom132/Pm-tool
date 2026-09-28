import { ChangeDetectionStrategy, Component, computed, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Message } from 'primeng/message';
import { SelectButton } from 'primeng/selectbutton';
import { RadioButton } from 'primeng/radiobutton';
import { MOCK_CONNECTIONS } from '../../core/mock-data';

type Framework = 'nuxt' | 'vue' | 'react' | 'next' | 'svelte' | 'angular';

/**
 * Registering a site.
 *
 * Four steps because four separate things have to be true before an edit can
 * become a pull request: we know the hostname, we know the repository and
 * branch, we know the person registering it controls the domain, and the
 * build stamps source locations onto the page.
 *
 * The last step is the one people skip and then wonder why nothing is
 * editable, so it is part of the flow rather than a documentation link.
 */
@Component({
  selector: 'app-register-site-dialog',
  imports: [FormsModule, Dialog, Button, InputText, Select, Message, SelectButton, RadioButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: '620px' }"
      (onHide)="reset()">
      <ng-template #header>
        <div class="head">
          <strong>Register a site</strong>
          <small>Step {{ step() }} of 4 · {{ stepName() }}</small>
        </div>
      </ng-template>

      <div class="rail">
        @for (n of [1, 2, 3, 4]; track n) {
          <span class="tick" [class.on]="step() >= n" [class.current]="step() === n"></span>
        }
      </div>

      <!-- ── 1. Which hostname ─────────────────────────────── -->
      @if (step() === 1) {
        <div class="form">
          <div class="field">
            <label for="hostname">Hostname</label>
            <input pInputText id="hostname" [(ngModel)]="hostname" placeholder="staging.acme.com" />
            <small>
              One wildcard label is allowed at the front, which is how preview
              deploys are covered: <code>*.acme.vercel.app</code>.
            </small>
          </div>

          <div class="field">
            <label>Environment</label>
            <p-selectbutton
              [options]="environments"
              [(ngModel)]="environment"
              optionLabel="label"
              optionValue="value"
              size="small"
              [allowEmpty]="false" />
          </div>

          <div class="field">
            <label for="name">Display name <span class="opt">optional</span></label>
            <input pInputText id="name" [(ngModel)]="name" placeholder="Acme — staging" />
          </div>
        </div>
      }

      <!-- ── 2. Which repository and branch ────────────────── -->
      @if (step() === 2) {
        <div class="form">
          <div class="field">
            <label for="connection">Connection</label>
            <p-select
              id="connection"
              [options]="connections"
              [(ngModel)]="connectionId"
              optionLabel="label"
              optionValue="value"
              placeholder="Choose a provider account"
              [fluid]="true" />
          </div>

          <div class="field">
            <label for="repo">Repository</label>
            <p-select
              id="repo"
              [options]="repositories"
              [(ngModel)]="repository"
              placeholder="Choose a repository"
              [filter]="true"
              [fluid]="true" />
          </div>

          <div class="field">
            <label>Branch</label>
            <div class="choices">
              <label class="choice" [class.on]="branchMode() === 'fixed'">
                <p-radiobutton name="branchMode" value="fixed" [ngModel]="branchMode()" (ngModelChange)="branchMode.set($event)" inputId="fixed" />
                <span>
                  <strong>A fixed branch</strong>
                  <small>Every edit on this hostname targets the same branch.</small>
                </span>
              </label>

              @if (branchMode() === 'fixed') {
                <p-select
                  [options]="branches"
                  [(ngModel)]="branch"
                  placeholder="Choose a branch"
                  [fluid]="true"
                  styleClass="nested" />
              }

              <label class="choice" [class.on]="branchMode() === 'page'">
                <p-radiobutton name="branchMode" value="page" [ngModel]="branchMode()" (ngModelChange)="branchMode.set($event)" inputId="page" />
                <span>
                  <strong>Read it from the page</strong>
                  <small>
                    What preview deploys need: each deployment is a different
                    branch, and the build stamps which one onto the page.
                  </small>
                </span>
              </label>
            </div>
          </div>
        </div>
      }

      <!-- ── 3. Prove you own it ───────────────────────────── -->
      @if (step() === 3) {
        <div class="form">
          <p class="lede">
            Add one of these to <code>{{ hostname || 'your domain' }}</code>, then
            press Verify. Without it anyone could claim this hostname and
            collect the feedback left on it.
          </p>

          <div class="field">
            <label>DNS record</label>
            <div class="snippet">
              <code>TXT  _inline-edit.{{ hostname || 'acme.com' }}  {{ token }}</code>
              <p-button icon="pi pi-copy" [text]="true" severity="secondary" size="small" ariaLabel="Copy" />
            </div>
          </div>

          <div class="or"><span>or</span></div>

          <div class="field">
            <label>Meta tag in your &lt;head&gt;</label>
            <div class="snippet">
              <code>&lt;meta name="inline-edit-verification" content="{{ token }}" /&gt;</code>
              <p-button icon="pi pi-copy" [text]="true" severity="secondary" size="small" ariaLabel="Copy" />
            </div>
          </div>

          @if (verifyFailed()) {
            <p-message severity="warn" [closable]="false">
              Not found yet. DNS can take a few minutes to propagate — you can
              carry on and verify later.
            </p-message>
          }
        </div>
      }

      <!-- ── 4. Stamp the source locations ─────────────────── -->
      @if (step() === 4) {
        <div class="form">
          <p class="lede">
            Last thing. The editor traces a heading on the page back to the line
            that produced it, and only a build plugin can record that. Without
            this step the site loads but almost nothing is editable.
          </p>

          <div class="field">
            <label>Framework</label>
            <p-select
              [options]="frameworks"
              [ngModel]="framework()"
              (ngModelChange)="framework.set($event)"
              optionLabel="label"
              optionValue="value"
              [fluid]="true" />
          </div>

          <div class="field">
            <label>Install</label>
            <div class="snippet block">
              <code>npm i -D &#64;quartalyst/inline-edit-annotation</code>
              <p-button icon="pi pi-copy" [text]="true" severity="secondary" size="small" ariaLabel="Copy" />
            </div>
          </div>

          <div class="field">
            <label>{{ snippet().file }}</label>
            <pre class="code">{{ snippet().code }}</pre>
          </div>

          <p-message severity="secondary" [closable]="false">
            Nothing is annotated unless <code>INLINE_EDIT=1</code> is set, so your
            normal builds are untouched. Set it on the deploy that editors use.
          </p-message>
        </div>
      }

      <ng-template #footer>
        @if (step() > 1) {
          <p-button label="Back" [text]="true" severity="secondary" (onClick)="step.set(step() - 1)" />
        }
        @if (step() === 3) {
          <p-button label="Skip for now" [text]="true" severity="secondary" (onClick)="step.set(4)" />
          <p-button label="Verify" icon="pi pi-check" (onClick)="verify()" />
        } @else if (step() === 4) {
          <p-button label="Finish" icon="pi pi-check" (onClick)="finish()" />
        } @else {
          <p-button label="Continue" icon="pi pi-arrow-right" iconPos="right" [disabled]="!canContinue()" (onClick)="step.set(step() + 1)" />
        }
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .head { display: grid; gap: 2px; }
    .head strong { font-size: var(--ds-t-title); }
    .head small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); font-weight: 500; }

    .rail { display: flex; gap: 6px; margin-bottom: var(--ds-s-5); }
    .tick { flex: 1; height: 3px; border-radius: var(--ds-r-pill); background: var(--ds-border); transition: background var(--ds-trans-tap); }
    .tick.on { background: var(--p-primary-color); }

    .form { display: grid; gap: var(--ds-s-5); }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field > small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }
    .opt { font-weight: 500; color: var(--p-text-muted-color); }
    .lede { margin: 0; font-size: var(--ds-t-body); line-height: 1.6; color: var(--p-text-color); }

    .choices { display: grid; gap: var(--ds-s-2); }
    .choice { display: flex; align-items: flex-start; gap: var(--ds-s-3); padding: var(--ds-s-3); border: 1px solid var(--ds-border); border-radius: var(--ds-r-md); cursor: pointer; }
    .choice.on { border-color: var(--p-primary-color); background: var(--ds-tint); }
    .choice span { display: grid; gap: 2px; }
    .choice strong { font-size: var(--ds-t-small); color: var(--p-text-color); }
    .choice small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }

    .snippet { display: flex; align-items: center; gap: var(--ds-s-2); padding: var(--ds-s-3); border: 1px solid var(--ds-border); border-radius: var(--ds-r-sm); background: var(--ds-muted-bg); }
    .snippet code { flex: 1; min-width: 0; overflow-x: auto; font-family: var(--ds-font-mono, ui-monospace, monospace); font-size: var(--ds-t-caption); color: var(--p-text-color); white-space: nowrap; }
    .or { display: flex; align-items: center; gap: var(--ds-s-3); color: var(--p-text-muted-color); font-size: var(--ds-t-caption); }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--ds-border); }

    .code { margin: 0; padding: var(--ds-s-4); border-radius: var(--ds-r-sm); background: #141416; color: #e4e4e7; font-family: var(--ds-font-mono, ui-monospace, monospace); font-size: var(--ds-t-caption); line-height: 1.6; overflow-x: auto; }
    :host ::ng-deep .nested { margin-left: var(--ds-s-6); }
  `,
})
export class RegisterSiteDialog {
  readonly visible = model(false);
  readonly registered = output<void>();

  protected readonly step = signal(1);
  protected hostname = '';
  protected name = '';
  protected environment: 'production' | 'staging' | 'preview' = 'production';
  protected connectionId: string | null = null;
  protected repository: string | null = null;
  protected branch: string | null = null;
  protected readonly branchMode = signal<'fixed' | 'page'>('fixed');
  protected readonly verifyFailed = signal(false);
  protected readonly framework = signal<Framework>('nuxt');

  protected readonly token = 'ie-verify-7f3a9c21d4e8';

  protected readonly environments = [
    { label: 'Production', value: 'production' },
    { label: 'Staging', value: 'staging' },
    { label: 'Preview', value: 'preview' },
  ];

  protected readonly connections = MOCK_CONNECTIONS.map((c) => ({
    label: `${c.accountLogin} · ${c.provider}`,
    value: c.id,
  }));

  protected readonly repositories = ['iFrontida/website-revamp', 'iFrontida/docs', 'iFrontida/app'];
  protected readonly branches = ['main', 'develop', 'staging'];

  protected readonly frameworks = [
    { label: 'Nuxt', value: 'nuxt' },
    { label: 'Vue + Vite', value: 'vue' },
    { label: 'React + Vite', value: 'react' },
    { label: 'Next.js', value: 'next' },
    { label: 'SvelteKit', value: 'svelte' },
    { label: 'Angular', value: 'angular' },
  ];

  /** The exact wiring for the chosen framework — no guessing at the docs. */
  protected readonly snippet = computed<{ file: string; code: string }>(() => {
    switch (this.framework()) {
      case 'nuxt':
        return {
          file: 'nuxt.config.ts',
          code: `export default defineNuxtConfig({\n  modules: ['@quartalyst/inline-edit-annotation/nuxt'],\n});`,
        };
      case 'vue':
        return {
          file: 'vite.config.js',
          code: `import inlineEdit from '@quartalyst/inline-edit-annotation/vue';\n\nexport default defineConfig({\n  // before vue(): it needs the raw .vue file\n  plugins: [inlineEdit(), vue()],\n});`,
        };
      case 'react':
        return {
          file: 'vite.config.js',
          code: `import react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [\n    react({\n      babel: { plugins: ['@quartalyst/inline-edit-annotation/react'] },\n    }),\n  ],\n});`,
        };
      case 'next':
        return {
          file: '.babelrc',
          code: `{\n  "presets": ["next/babel"],\n  "plugins": ["@quartalyst/inline-edit-annotation/react"]\n}`,
        };
      case 'svelte':
        return {
          file: 'vite.config.js',
          code: `import inlineEdit from '@quartalyst/inline-edit-annotation/svelte';\n\nexport default defineConfig({\n  // before sveltekit(): the compiler turns components into JS\n  plugins: [inlineEdit(), sveltekit()],\n});`,
        };
      case 'angular':
        return {
          file: 'angular.json',
          code: `"customWebpackConfig": {\n  "path": "./node_modules/@quartalyst/inline-edit-annotation/angular/webpack.config.js",\n  "mergeStrategies": { "module.rules": "prepend" }\n}`,
        };
    }
  });

  protected stepName() {
    return ['Hostname', 'Repository', 'Ownership', 'Build plugin'][this.step() - 1];
  }

  protected canContinue() {
    if (this.step() === 1) return this.hostname.trim().length > 3;
    if (this.step() === 2) {
      return Boolean(this.connectionId && this.repository && (this.branchMode() === 'page' || this.branch));
    }
    return true;
  }

  protected verify() {
    // Mock: a real check queries DNS and fetches the page.
    this.verifyFailed.set(true);
  }

  protected finish() {
    this.registered.emit();
    this.visible.set(false);
  }

  protected reset() {
    this.step.set(1);
    this.hostname = '';
    this.name = '';
    this.connectionId = null;
    this.repository = null;
    this.branch = null;
    this.branchMode.set('fixed');
    this.verifyFailed.set(false);
  }
}
