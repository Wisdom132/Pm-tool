import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api-client';
import type {
  ExtensionToken,
  Me,
} from '../api-types';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);

  me(): Observable<Me> {
    return this.api.get<Me>('/auth/me');
  }

  requestLink(email: string): Observable<{ sent: boolean }> {
    return this.api.post('/auth/request-link', { email });
  }

  verify(token: string): Observable<{ user: Me['user'] }> {
    return this.api.post('/auth/verify', { token });
  }

  updateProfile(name: string): Observable<{ user: Me['user'] }> {
    return this.api.patch('/auth/me', { name });
  }

  /** Shown once — only its hash is stored, so it cannot be retrieved again. */
  createExtensionToken(label?: string): Observable<{ token: string; expiresInDays: number }> {
    return this.api.post('/auth/extension-tokens', { label });
  }

  extensionTokens(): Observable<ExtensionToken[]> {
    return this.api.get<ExtensionToken[]>('/auth/extension-tokens');
  }

  revokeExtensionToken(id: string): Observable<{ revoked: boolean }> {
    return this.api.delete(`/auth/extension-tokens/${id}`);
  }

  signOut(): Observable<{ signedOut: boolean }> {
    return this.api.post('/auth/sign-out');
  }

  signOutEverywhere(): Observable<{ signedOut: boolean }> {
    return this.api.post('/auth/sign-out-everywhere');
  }
}
