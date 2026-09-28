import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { PageHeader } from '../../../design-system';
import { MOCK_SESSION } from '../../core/mock-data';

@Component({
  selector: 'app-organisation-settings',
  imports: [FormsModule, Button, InputText, Message, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Organisation" subtitle="Name, address and what happens if you leave" />

    <section class="ds-surface panel">
      <h2>General</h2>
      <div class="field">
        <label for="orgname">Name</label>
        <input pInputText id="orgname" [(ngModel)]="name" />
        <small>Shown in the sidebar and on invitations.</small>
      </div>
      <div class="field">
        <label for="slug">URL</label>
        <div class="slug">
          <span>app.inline-edit.com/</span>
          <input pInputText id="slug" [(ngModel)]="slug" />
        </div>
      </div>
      <div class="actions"><p-button label="Save changes" size="small" /></div>
    </section>

    <section class="ds-surface panel danger">
      <h2>Delete this organisation</h2>
      <p>
        Removes every site, team and piece of feedback, and revokes the
        provider connections. <strong>Your repositories and their pull
        requests are untouched</strong> — they live on GitHub, not here.
      </p>
      <p-message severity="warn" [closable]="false">
        This cannot be undone, and {{ memberCount }} people lose access
        immediately.
      </p-message>
      <div class="actions">
        <p-button label="Delete organisation" severity="danger" [outlined]="true" size="small" />
      </div>
    </section>
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); max-width: 640px; }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .panel p { margin: 0; font-size: var(--ds-t-small); line-height: 1.6; color: var(--p-text-muted-color); }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .slug { display: flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-small); color: var(--p-text-muted-color); }
    .slug input { flex: 1; }
    .actions { display: flex; justify-content: flex-start; }
    .danger { border-color: color-mix(in srgb, var(--ds-danger-ink) 24%, transparent); }
  `,
})
export class OrganisationSettings {
  protected name = MOCK_SESSION.organisation;
  protected slug = 'heykara';
  protected readonly memberCount = 3;
}
