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
import { InviteDialog } from './invite-dialog/invite-dialog';
import { MembersApi } from '../../core/api/members-api';
import { createLoader } from '../../core/load-state';
import { Session } from '../../core/session';
import type { Person, Role } from '../../core/api-types';

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
  templateUrl: './people.html',
  styleUrl: './people.scss',
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
