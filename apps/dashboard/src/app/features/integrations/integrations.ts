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
  templateUrl: './integrations.html',
  styleUrl: './integrations.scss',
  imports: [Button, Tag, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Integrations {
  protected readonly available: Integration[] = [
    { id: 'jira', name: 'Jira', blurb: 'Turn a piece of feedback into a Jira issue, with the page and source file attached.', icon: 'pi pi-ticket', connected: false },
    { id: 'linear', name: 'Linear', blurb: 'Same, for teams on Linear.', icon: 'pi pi-bolt', connected: false },
    { id: 'slack', name: 'Slack', blurb: 'Post new feedback to a channel as it arrives.', icon: 'pi pi-comment', connected: true },
    { id: 'webhook', name: 'Webhook', blurb: 'Send every event to a URL you control — covers anything not on this list.', icon: 'pi pi-send', connected: false },
  ];
}
