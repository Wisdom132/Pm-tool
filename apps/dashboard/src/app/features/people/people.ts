import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Avatar } from 'primeng/avatar';
import { Message } from 'primeng/message';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { Select } from 'primeng/select';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, EmptyState, ErrorState } from '../../../design-system';
import { InviteDialog } from './invite-dialog';
import { MembersApi } from '../../core/api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Person, Role } from '../../core/api.types';

/**
 * Team.
 *
 * Members and pending invitations are shown apart rather than as one list
 * with a status column: an invitation is a different thing from a person —
 * it expires, and it has not been accepted by anybody yet.
 *
 * The API returns them merged, with `kind` distinguishing them, because "who
 * is in this organisation" is one question. Splitting is presentation.
 */
@Component({
  selector: 'app-people',
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    Button,
    Tag,
    Avatar,
    Message,
    ConfirmDialog,
    Select,
    Skeleton,
    PageHeader,
    EmptyState,
    ErrorState,
    InviteDialog,
  ],
  providers: [ConfirmationService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ds-page-header title="People" subtitle="Everyone in this organisation, and what they can do">
      @if (isAdmin()) {
        <p-button label="Invite people" icon="pi pi-plus" size="small" dsActions (onClick)="inviting.set(true)" />
      }
    </ds-page-header>

    @if (error()) {
      <p-message severity="error" [closable]="true" (onClose)="error.set('')">{{ error() }}</p-message>
    }

    @if (loader.state() === 'error') {
      <div class="ds-surface">
        <ds-error-state
          title="Could not load the people in this organisation"
          [detail]="loader.error() ?? 'The request for this list failed.'"
          (retry)="reload()" />
      </div>
    } @else if (loader.state() === 'loading') {
      <div class="ds-surface skeletons">
        @for (n of [1, 2, 3]; track n) {
          <div class="skeleton-row">
            <p-skeleton shape="circle" size="2rem" />
            <p-skeleton width="40%" height="1rem" />
            <p-skeleton width="18%" height="1rem" />
          </div>
        }
      </div>
    } @else {
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
                    <span class="ds-cell-strong">{{ m.name || m.email }}</span>
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
                @if (isAdmin() && m.id !== currentUserId()) {
                  <p-select
                    [options]="roles"
                    [ngModel]="m.role"
                    (ngModelChange)="changeRole(m, $event)"
                    optionLabel="label"
                    optionValue="value"
                    size="small"
                    [disabled]="busy() === m.id"
                    styleClass="role-select" />
                  <p-button
                    icon="pi pi-times"
                    [text]="true"
                    [rounded]="true"
                    severity="danger"
                    size="small"
                    ariaLabel="Remove from organisation"
                    [disabled]="busy() === m.id"
                    (onClick)="confirmRemove(m)" />
                } @else if (m.id === currentUserId()) {
                  <span class="ds-cell-muted">you</span>
                }
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
                <td class="ds-cell-muted">{{ i.expiresAt | date: 'd MMM y' }}</td>
                <td class="row-actions">
                  @if (isAdmin()) {
                    <!-- No Resend: the API has no such endpoint, and inviting
                         the same address again supersedes the old invitation,
                         which is the same thing with one fewer concept. -->
                    <p-button
                      label="Revoke"
                      [text]="true"
                      size="small"
                      severity="danger"
                      [disabled]="busy() === i.id"
                      (onClick)="revokeInvitation(i)" />
                  }
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

    }

    <app-invite-dialog [(visible)]="inviting" (invited)="reload()" />
    <p-confirmdialog />
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
    .skeletons { padding: var(--ds-s-4); display: grid; gap: var(--ds-s-4); }
    .skeleton-row { display: flex; gap: var(--ds-s-3); align-items: center; }
    .row-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--ds-s-2); }
    :host ::ng-deep .role-select { min-width: 116px; }
  `,
})
export class People {
  private readonly api = inject(MembersApi);
  private readonly session = inject(Session);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly inviting = signal(false);
  protected readonly loader = createLoader<Person[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly isAdmin = this.session.isAdmin;
  protected readonly currentUserId = computed(() => this.session.user()?.id ?? null);

  protected readonly roles = [
    { label: 'Admin', value: 'admin' as Role },
    { label: 'Editor', value: 'editor' as Role },
  ];

  protected readonly members = computed(() =>
    this.loader.data().filter((p) => p.kind === 'member'),
  );
  protected readonly invitations = computed(() =>
    this.loader.data().filter((p) => p.kind === 'invitation'),
  );

  constructor() {
    this.reload();
  }

  protected reload() {
    this.loader.load(this.api.list());
  }

  protected initial(person: Person) {
    return (person.name || person.email).charAt(0).toUpperCase();
  }

  /**
   * The API refuses a change that would leave no admin, and refuses you
   * changing your own role at all. Both messages are written to be shown, so
   * they are surfaced verbatim rather than replaced with a generic failure.
   */
  protected changeRole(person: Person, role: Role) {
    if (role === person.role) return;

    this.busy.set(person.id);
    this.error.set('');

    this.api.changeRole(person.id, role).subscribe({
      next: () => {
        this.busy.set(null);
        this.reload();
      },
      error: (err: Error) => {
        this.busy.set(null);
        this.error.set(err.message);
        // Re-read so the select snaps back to the role that is actually set.
        this.reload();
      },
    });
  }

  protected confirmRemove(person: Person) {
    this.confirmation.confirm({
      header: 'Remove from organisation',
      message:
        `${person.name || person.email} will lose access to every site here. ` +
        'Their pull requests and audit entries stay.',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-text p-button-secondary p-button-sm',
      accept: () => this.remove(person),
    });
  }

  private remove(person: Person) {
    this.busy.set(person.id);
    this.error.set('');

    this.api.remove(person.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.reload();
      },
      error: (err: Error) => {
        this.busy.set(null);
        this.error.set(err.message);
      },
    });
  }

  protected revokeInvitation(invitation: Person) {
    this.busy.set(invitation.id);
    this.error.set('');

    this.api.revokeInvitation(invitation.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.reload();
      },
      error: (err: Error) => {
        this.busy.set(null);
        this.error.set(err.message);
      },
    });
  }
}
