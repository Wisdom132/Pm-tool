import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { PageHeader } from '../../../design-system';

interface Integration {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  connected: boolean;
}

@Component({
  selector: 'app-integrations',
  imports: [Button, Tag, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="Integrations" subtitle="Send feedback and edits where your team already works" />

    <div class="grid">
      @for (i of available; track i.id) {
        <div class="ds-surface card">
          <span class="mark"><i [class]="i.icon"></i></span>
          <div class="body">
            <div class="title-row">
              <strong>{{ i.name }}</strong>
              @if (i.connected) { <p-tag value="Connected" severity="success" [rounded]="true" /> }
            </div>
            <p>{{ i.blurb }}</p>
          </div>
          <p-button
            [label]="i.connected ? 'Manage' : 'Connect'"
            size="small"
            [outlined]="!i.connected"
            [text]="i.connected"
            severity="secondary" />
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-5); }
    .grid { display: grid; gap: var(--ds-s-4); grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
    .card { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-4); grid-template-rows: auto 1fr auto; justify-items: start; }
    .mark { width: 40px; height: 40px; border-radius: var(--ds-r-md); background: var(--ds-muted-bg); display: grid; place-items: center; font-size: 18px; }
    .title-row { display: flex; align-items: center; gap: var(--ds-s-2); }
    .body strong { font-size: var(--ds-t-title); color: var(--p-text-color); }
    .body p { margin: var(--ds-s-2) 0 0; font-size: var(--ds-t-small); line-height: 1.5; color: var(--p-text-muted-color); }
  `,
})
export class Integrations {
  protected readonly available: Integration[] = [
    { id: 'jira', name: 'Jira', blurb: 'Turn a piece of feedback into a Jira issue, with the page and source file attached.', icon: 'pi pi-ticket', connected: false },
    { id: 'linear', name: 'Linear', blurb: 'Same, for teams on Linear.', icon: 'pi pi-bolt', connected: false },
    { id: 'slack', name: 'Slack', blurb: 'Post new feedback to a channel as it arrives.', icon: 'pi pi-comment', connected: true },
    { id: 'webhook', name: 'Webhook', blurb: 'Send every event to a URL you control — covers anything not on this list.', icon: 'pi pi-send', connected: false },
  ];
}
