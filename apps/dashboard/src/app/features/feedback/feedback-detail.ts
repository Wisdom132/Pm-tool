import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Textarea } from 'primeng/textarea';
import { Tag } from 'primeng/tag';
import { Avatar } from 'primeng/avatar';
import { PageHeader } from '../../../design-system';
import { MOCK_FEEDBACK } from '../../core/mock-data';

interface Reply {
  author: string;
  body: string;
  at: string;
}

@Component({
  selector: 'app-feedback-detail',
  imports: [DatePipe, FormsModule, RouterLink, Button, Textarea, Tag, Avatar, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (item; as f) {
      <ds-page-header title="Feedback" [subtitle]="f.page + ' · ' + f.element">
        <p-button label="Open in editor" icon="pi pi-pencil" size="small" dsActions />
      </ds-page-header>

      <a routerLink="/feedback" class="back"><i class="pi pi-arrow-left"></i> All feedback</a>

      <section class="ds-surface panel">
        <header>
          <p-tag [value]="f.status" [severity]="f.status === 'new' ? 'info' : f.status === 'triaged' ? 'warn' : 'success'" [rounded]="true" />
          <span class="muted">{{ f.author }} · {{ f.createdAt | date: 'd MMM yyyy, HH:mm' }}</span>
        </header>

        <p class="message">{{ f.message }}</p>

        <div class="where">
          <i class="pi pi-file"></i>
          @if (f.sourceFile) {
            <code>{{ f.sourceFile }}</code>
          } @else {
            <span class="muted">Source not resolved — the editor will search for this text</span>
          }
        </div>
      </section>

      <section class="thread">
        @for (r of replies(); track $index) {
          <article class="ds-surface reply">
            <p-avatar [label]="r.author.charAt(0)" shape="circle" size="normal" />
            <div class="body">
              <header><strong>{{ r.author }}</strong><small>{{ r.at }}</small></header>
              <p>{{ r.body }}</p>
            </div>
          </article>
        }

        <div class="ds-surface composer">
          <textarea
            pTextarea
            rows="3"
            placeholder="Reply, or say what you did about it…"
            [(ngModel)]="draft"></textarea>
          <div class="composer-actions">
            <p-button label="Mark resolved" [text]="true" severity="secondary" size="small" />
            <p-button label="Reply" size="small" [disabled]="!draft.trim()" (onClick)="reply()" />
          </div>
        </div>
      </section>
    } @else {
      <p class="muted">That feedback does not exist.</p>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-4); max-width: 760px; }
    .back { display: inline-flex; align-items: center; gap: var(--ds-s-2); font-size: var(--ds-t-caption); color: var(--p-text-muted-color); justify-self: start; }
    .panel { padding: var(--ds-s-5); display: grid; gap: var(--ds-s-3); }
    .panel header { display: flex; align-items: center; gap: var(--ds-s-2); }
    .message { margin: 0; font-size: var(--ds-t-body); line-height: 1.6; color: var(--p-text-color); }
    .where { display: flex; align-items: center; gap: var(--ds-s-2); padding-top: var(--ds-s-3); border-top: 1px solid var(--ds-hairline); font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .where code { color: var(--p-primary-color); }
    .thread { display: grid; gap: var(--ds-s-3); }
    .reply { padding: var(--ds-s-4); display: flex; gap: var(--ds-s-3); }
    .reply .body { flex: 1; display: grid; gap: var(--ds-s-2); }
    .reply header { display: flex; align-items: baseline; gap: var(--ds-s-2); }
    .reply strong { font-size: var(--ds-t-small); }
    .reply small, .muted { font-size: var(--ds-t-caption); color: var(--p-text-muted-color); }
    .reply p { margin: 0; font-size: var(--ds-t-small); line-height: 1.6; }
    .composer { padding: var(--ds-s-4); display: grid; gap: var(--ds-s-3); }
    .composer textarea { width: 100%; resize: vertical; }
    .composer-actions { display: flex; justify-content: flex-end; gap: var(--ds-s-2); }
  `,
})
export class FeedbackDetail {
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  protected readonly item = MOCK_FEEDBACK.find((f) => f.id === this.id) ?? null;

  protected draft = '';
  protected readonly replies = signal<Reply[]>([
    { author: 'Wisdom Ekpot', body: 'Good catch — fixing this in the next pass.', at: '28 Sep, 09:02' },
  ]);

  protected reply() {
    this.replies.update((r) => [
      ...r,
      { author: 'Wisdom Ekpot', body: this.draft.trim(), at: 'just now' },
    ]);
    this.draft = '';
  }
}
