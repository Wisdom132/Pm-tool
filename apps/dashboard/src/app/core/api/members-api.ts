import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  Invite,
  Person,
  Role,
} from '../api-types';

@Injectable({ providedIn: 'root' })
export class MembersApi {
  private readonly api = inject(ApiClient);

  /** Accepted members and pending invitations, in one list. */
  list(): Observable<Person[]> {
    return this.api.get<Person[]>('/members');
  }

  invite(invite: Invite): Observable<{ id: string; email: string; role: Role; expiresAt: string }> {
    return this.api.post('/members/invitations', invite);
  }

  revokeInvitation(id: string): Observable<{ revoked: boolean }> {
    return this.api.delete(`/members/invitations/${id}`);
  }

  changeRole(userId: string, role: Role): Observable<unknown> {
    return this.api.patch(`/members/${userId}/role`, { role });
  }

  remove(userId: string): Observable<{ removed: boolean }> {
    return this.api.delete(`/members/${userId}`);
  }
}
