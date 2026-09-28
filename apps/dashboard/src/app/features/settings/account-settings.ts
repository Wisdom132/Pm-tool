import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { PageHeader } from '../../../design-system';
import { MOCK_SESSION } from '../../core/mock-data';

@Component({
  selector: 'app-account-settings',
  imports: [FormsModule, Button, InputText, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Your account" subtitle="How you appear to your team, and where you are signed in" />

    <section class="ds-surface panel">
      <h2>Profile</h2>
      <div class="field">
        <label for="name">Name</label>
        <input pInputText id="name" [(ngModel)]="name" />
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input pInputText id="email" [(ngModel)]="email" [disabled]="true" />
        <small>
          Your email is your identity here, so changing it needs a confirmation
          to both addresses. <a href="#">Start that</a>.
        </small>
      </div>
      <div class="actions"><p-button label="Save changes" size="small" /></div>
    </section>

    <section class="ds-surface panel">
      <h2>Sessions</h2>
      <ul class="sessions">
        <li>
          <div>
            <strong>This browser</strong>
            <small>Chrome on macOS · Lagos · active now</small>
          </div>
          <span class="current">Current</span>
        </li>
        <li>
          <div>
            <strong>Chrome on macOS</strong>
            <small>Lagos · 3 days ago</small>
          </div>
          <p-button label="Revoke" [text]="true" size="small" severity="danger" />
        </li>
      </ul>
      <div class="actions">
        <p-button label="Sign out everywhere" [outlined]="true" severity="secondary" size="small" />
      </div>
    </section>
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); max-width: 640px; }
    .panel h2 { font-size: var(--ds-t-title); font-weight: 700; }
    .field { display: grid; gap: var(--ds-s-2); }
    .field label { font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-color); }
    .field small { font-size: var(--ds-t-caption); line-height: 1.5; color: var(--p-text-muted-color); }
    .sessions { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ds-s-3); }
    .sessions li { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-s-3); }
    .sessions strong { display: block; font-size: var(--ds-t-small); color: var(--p-text-color); }
    .sessions small { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .current { font-size: var(--ds-t-caption); font-weight: 600; color: var(--ds-success-ink); }
    .actions { display: flex; }
  `,
})
export class AccountSettings {
  protected name = MOCK_SESSION.user;
  protected email = 'wisdom@heykara.com';
}
