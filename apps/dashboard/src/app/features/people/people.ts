import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Avatar } from 'primeng/avatar';
import { Menu } from 'primeng/menu';
import { PageHeader, EmptyState } from '../../../design-system';
import { InviteDialog } from './invite-dialog';
import { MOCK_MEMBERS, Member, Role } from '../../core/mock-data';

/**
 * Team.
 *
 * Members and pending invitations are shown apart rather than as one list
 * with a status column: an invitation is a different thing from a person —
 * it expires, it can be resent, and it has not been accepted by anybody yet.
 */
@Component({
  selector: 'app-people',
  imports: [DatePipe, TableModule, Button, Tag, Avatar, Menu, PageHeader, EmptyState, InviteDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="People" subtitle="Everyone in this organisation, and what they can do">
      <p-button label="Invite people" icon="pi pi-plus" size="small" dsActions (onClick)="inviting.set(true)" />
    </ds-page-header>

    <section class="block">
      <h2 class="block-title">
        Members <span class="count">{{ members().length }}</span>
      </h2>

      <div class="ds-surface">
        <p-table [value]="members()" styleClass="ds-table" [rowHover]="true" [tableStyle]="{ 'min-width': '720px' }">
          <ng-template #header>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Last seen</th>
              <th></th>
            </tr>
          </ng-template>

          <ng-template #body let-m>
            <tr>
              <td>
                <div class="person">
                  <p-avatar [label]="initial(m)" shape="circle" />
                  <div class="person-text">
                    <span class="ds-cell-strong">{{ m.name }}</span>
                    <span class="ds-cell-muted">{{ m.email }}</span>
                  </div>
                </div>
              </td>
              <td>
                <p-tag
                  [value]="m.role === 'admin' ? 'Admin' : 'Editor'"
                  [severity]="m.role === 'admin' ? 'info' : 'secondary'"
                  [rounded]="true" />
              </td>
              <td class="ds-cell-muted">{{ m.lastSeenAt ? (m.lastSeenAt | date: 'd MMM, HH:mm') : '—' }}</td>
              <td class="row-actions">
                <p-button
                  icon="pi pi-ellipsis-h"
                  [text]="true"
                  [rounded]="true"
                  severity="secondary"
                  size="small"
                  ariaLabel="Actions"
                  (onClick)="memberMenu.toggle($event)" />
              </td>
            </tr>
          </ng-template>

          <ng-template #emptymessage>
            <tr>
              <td colspan="4">
                <ds-empty-state
                  icon="pi pi-users"
                  title="Nobody here yet"
                  description="Invite the people who write your copy. They sign in with their email — no GitHub account needed."
                  size="sm">
                  <p-button label="Invite people" icon="pi pi-plus" size="small" (onClick)="inviting.set(true)" />
                </ds-empty-state>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
      <p-menu #memberMenu [model]="memberActions" [popup]="true" />
    </section>

    @if (invitations().length) {
      <section class="block">
        <h2 class="block-title">
          Pending invitations <span class="count">{{ invitations().length }}</span>
        </h2>

        <div class="ds-surface">
          <p-table [value]="invitations()" styleClass="ds-table" [rowHover]="true" [tableStyle]="{ 'min-width': '720px' }">
            <ng-template #header>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </ng-template>

            <ng-template #body let-i>
              <tr>
                <td class="ds-cell-strong">{{ i.email }}</td>
                <td>
                  <p-tag
                    [value]="i.role === 'admin' ? 'Admin' : 'Editor'"
                    [severity]="i.role === 'admin' ? 'info' : 'secondary'"
                    [rounded]="true" />
                </td>
                <td class="ds-cell-muted">in 7 days</td>
                <td class="row-actions">
                  <p-button label="Resend" [text]="true" size="small" />
                  <p-button label="Revoke" [text]="true" size="small" severity="danger" />
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>
    }

    <p class="note">
      An <strong>editor</strong> opens pull requests and leaves feedback. Only an
      <strong>admin</strong> can connect a provider or re-point a site at a
      different repository — which is the one change here that could quietly
      send edits somewhere else.
    </p>

    <app-invite-dialog [(visible)]="inviting" (invited)="onInvited($event)" />
  `,
  styles: `
    :host { display: grid; gap: var(--ds-s-6); }
    .block { display: grid; gap: var(--ds-s-3); }
    .block-title { font-size: var(--ds-t-title); font-weight: 700; display: flex; align-items: center; gap: var(--ds-s-2); }
    .count { padding: 1px 8px; border-radius: var(--ds-r-pill); background: var(--ds-muted-bg); font-size: var(--ds-t-caption); font-weight: 600; color: var(--p-text-muted-color); }
    .person { display: flex; align-items: center; gap: var(--ds-s-3); }
    .person-text { display: grid; gap: 1px; }
    .row-actions { text-align: right; white-space: nowrap; }
    .note { margin: 0; max-width: 72ch; font-size: var(--ds-t-caption); line-height: 1.6; color: var(--p-text-muted-color); }
  `,
})
export class People {
  protected readonly inviting = signal(false);
  private readonly all = signal<Member[]>(MOCK_MEMBERS);

  protected readonly members = computed(() => this.all().filter((m) => m.status === 'active'));
  protected readonly invitations = computed(() => this.all().filter((m) => m.status === 'invited'));

  protected readonly memberActions = [
    { label: 'Change role', icon: 'pi pi-user-edit' },
    { label: 'Resend sign-in link', icon: 'pi pi-envelope' },
    { separator: true },
    { label: 'Remove from organisation', icon: 'pi pi-times', styleClass: 'danger-item' },
  ];

  protected initial(m: Member) {
    return (m.name || m.email).charAt(0).toUpperCase();
  }

  protected onInvited({ emails, role }: { emails: string[]; role: Role }) {
    this.all.update((list) => [
      ...list,
      ...emails.map((email, i) => ({
        id: `new-${Date.now()}-${i}`,
        name: '',
        email,
        role,
        status: 'invited' as const,
        lastSeenAt: null,
      })),
    ]);
  }
}
