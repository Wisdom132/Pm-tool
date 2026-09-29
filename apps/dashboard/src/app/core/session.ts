import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api.client';
import { AuthApi } from './api';
import type { CurrentUser, OrganisationSummary } from './api.types';

const STORED_ORG = 'ie.organisationId';

/**
 * Who is signed in, and which organisation they are looking at.
 *
 * Loaded once at startup rather than per route, because every screen needs
 * it and the organisation header has to be set before the first request goes
 * out. `resolve()` is awaited by the route guard for that reason.
 */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthApi);
  private readonly router = inject(Router);

  private readonly _user = signal<CurrentUser | null>(null);
  private readonly _organisations = signal<OrganisationSummary[]>([]);
  private readonly _ready = signal(false);

  readonly user = this._user.asReadonly();
  readonly organisations = this._organisations.asReadonly();
  readonly ready = this._ready.asReadonly();

  readonly organisationId = this.api.organisationId.asReadonly();

  readonly organisation = computed(() => {
    const id = this.api.organisationId();
    return this._organisations().find((o) => o.id === id) ?? null;
  });

  /** Drives whether admin-only controls are even rendered. */
  readonly isAdmin = computed(() => this.organisation()?.role === 'admin');

  readonly signedIn = computed(() => this._user() !== null);

  /**
   * Establish the session, once.
   *
   * Returns false when there is none, which the guard turns into a redirect.
   * A 401 here is the normal not-signed-in case, not an error worth
   * surfacing.
   */
  async resolve(): Promise<boolean> {
    if (this._ready()) return this.signedIn();

    try {
      const me = await firstValueFrom(this.auth.me());
      this._user.set(me.user);
      this._organisations.set(me.organisations);
      this.api.organisationId.set(this.pickOrganisation(me.organisations));
      return true;
    } catch {
      this._user.set(null);
      this._organisations.set([]);
      this.api.organisationId.set(null);
      return false;
    } finally {
      this._ready.set(true);
    }
  }

  /** After signing in, so the shell has a user without a page reload. */
  async refresh(): Promise<void> {
    this._ready.set(false);
    await this.resolve();
  }

  /**
   * Switch organisation.
   *
   * Remembered across reloads, and a full navigation to the overview rather
   * than an in-place swap: every open screen is showing another tenant's
   * data, and re-fetching each one would flash the wrong rows.
   */
  switchTo(organisationId: string) {
    if (!this._organisations().some((o) => o.id === organisationId)) return;

    this.api.organisationId.set(organisationId);
    localStorage.setItem(STORED_ORG, organisationId);
    void this.router.navigate(['/'], { onSameUrlNavigation: 'reload' });
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.auth.signOut());
    } finally {
      // Local state is cleared even if the request failed: the cookie may
      // already be gone, and leaving the shell looking signed in would be
      // worse than an orphaned server-side session that expires anyway.
      this._user.set(null);
      this._organisations.set([]);
      this.api.organisationId.set(null);
      this._ready.set(true);
      localStorage.removeItem(STORED_ORG);
      void this.router.navigate(['/sign-in']);
    }
  }

  /**
   * The last one they used, if they are still a member of it.
   *
   * The membership check matters: being removed from an organisation would
   * otherwise leave a stored id that produces a 403 on every request, with
   * no obvious way out but clearing site data.
   */
  private pickOrganisation(organisations: OrganisationSummary[]): string | null {
    if (!organisations.length) return null;

    const stored = localStorage.getItem(STORED_ORG);
    if (stored && organisations.some((o) => o.id === stored)) return stored;

    return organisations[0].id;
  }
}
