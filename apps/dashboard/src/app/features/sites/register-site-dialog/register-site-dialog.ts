import { ChangeDetectionStrategy, Component, computed, effect, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Message } from 'primeng/message';
import { SelectButton } from 'primeng/selectbutton';
import { RadioButton } from 'primeng/radiobutton';
import { ConnectionsApi } from '../../../core/api/connections-api';
import { SitesApi } from '../../../core/api/sites-api';
import type { Connection, EnvironmentLabel } from '../../../core/api-types';

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
  templateUrl: './register-site-dialog.html',
  styleUrl: './register-site-dialog.scss',
  imports: [FormsModule, Dialog, Button, InputText, Select, Message, SelectButton, RadioButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterSiteDialog {
  readonly visible = model(false);
  readonly registered = output<void>();

  constructor() {
    // On open, not on construction: a provider connected in another tab
    // should appear without a page reload.
    effect(() => {
      if (!this.visible()) return;
      this.connectionsApi.list().subscribe({
        next: (list) => this.liveConnections.set(list.filter((c) => !c.revokedAt)),
      });
    });
  }

  /**
   * Repositories come from the chosen connection, and branches from the
   * chosen repository — so neither can be typed freehand into a site that
   * then fails on the first edit.
   */
  protected onConnectionChange(id: string | null) {
    this.connectionId = id;
    this.repository = null;
    this.branch = null;
    this.repositories.set([]);
    this.branches.set([]);
    if (!id) return;

    this.loadingRepos.set(true);
    this.connectionsApi.repositories(id).subscribe({
      next: (repos) => {
        this.repositories.set(repos.map((r) => r.fullName));
        this.loadingRepos.set(false);
      },
      error: (err: Error) => {
        this.loadingRepos.set(false);
        this.error.set(err.message);
      },
    });
  }

  /**
   * Load the branches for the chosen repository.
   *
   * This used to do nothing but clear the field, on the reasoning that
   * branches need a site to read them from. They do not — they need a
   * *connection*, which exists by this step. The result was an empty
   * dropdown that could not be typed into either, so a fixed branch could
   * never be chosen and the dialog could not be completed.
   *
   * The field stays editable on top of the list, so a branch that does not
   * exist yet is still nameable.
   */
  protected onRepositoryChange(repository: string | null) {
    this.repository = repository;
    this.branch = null;
    this.branches.set([]);

    if (!repository || !this.connectionId) return;

    this.loadingBranches.set(true);
    this.connectionsApi.branches(this.connectionId, repository).subscribe({
      next: (names) => {
        this.loadingBranches.set(false);
        this.branches.set(names);
        // One branch is the common case, and making somebody open a list to
        // pick the only item in it is a step for its own sake.
        if (names.length === 1) this.branch = names[0];
      },
      error: () => {
        // Not fatal: the field is editable, so a name can still be typed.
        // Saying nothing is better than an error over a list that is only
        // a convenience.
        this.loadingBranches.set(false);
      },
    });
  }

  protected readonly step = signal(1);
  protected hostname = '';
  protected name = '';
  protected environment: 'production' | 'staging' | 'preview' = 'production';
  protected connectionId: string | null = null;
  protected repository: string | null = null;
  protected branch: string | null = null;
  protected readonly branchMode = signal<'fixed' | 'page'>('fixed');
  protected readonly framework = signal<Framework>('nuxt');

  private readonly sitesApi = inject(SitesApi);
  private readonly connectionsApi = inject(ConnectionsApi);

  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly loadingRepos = signal(false);
  protected readonly loadingBranches = signal(false);
  protected readonly repositories = signal<string[]>([]);
  protected readonly branches = signal<string[]>([]);
  private readonly liveConnections = signal<Connection[]>([]);

  protected readonly environments = [
    { label: 'Production', value: 'production' },
    { label: 'Staging', value: 'staging' },
    { label: 'Preview', value: 'preview' },
  ];

  protected readonly connections = computed(() =>
    this.liveConnections().map((c) => ({
      label: `${c.accountLogin} · ${c.provider}`,
      value: c.id,
    })),
  );

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
    return ['Hostname', 'Repository', 'Build plugin'][this.step() - 1];
  }

  protected canContinue() {
    if (this.step() === 1) return this.hostname.trim().length > 3;
    if (this.step() === 2) {
      return Boolean(this.connectionId && this.repository && (this.branchMode() === 'page' || this.branch));
    }
    return true;
  }

  /**
   * Create the site.
   *
   * There is no ownership step. It asked for a DNS record or meta tag
   * containing a token that does not exist until the site is registered,
   * and offered a Verify button that was not on the screen — because
   * nothing checks either one yet (P2.5). A step that cannot be completed,
   * in front of the step that actually matters, is worse than no step.
   *
   * The token is still generated on registration and shown on the site's
   * own page, so verification is reachable the moment P2.5 lands. Until
   * then it gates only the public feedback widget, never editing.
   */
  protected register() {
    this.saving.set(true);
    this.error.set('');

    this.sitesApi
      .create({
        name: this.name.trim() || this.hostname.trim(),
        hostname: this.hostname.trim(),
        label: this.environment,
        repository: this.repository!,
        branch: this.branchMode() === 'page' ? null : this.branch,
        connectionId: this.connectionId!,
      })
      .subscribe({
        next: (site) => {
          this.saving.set(false);
          this.registered.emit();
          // Straight to the last step: the plugin snippet is the thing they
          // still have to act on, and it does not depend on the response.
          this.step.set(3);
        },
        error: (err: Error) => {
          this.saving.set(false);
          this.error.set(err.message);
        },
      });
  }

  protected finish() {
    this.visible.set(false);
  }

  protected reset() {
    this.step.set(1);
    this.error.set('');
    this.repositories.set([]);
    this.branches.set([]);
    this.hostname = '';
    this.name = '';
    this.connectionId = null;
    this.repository = null;
    this.branch = null;
    this.branchMode.set('fixed');
  }
}
