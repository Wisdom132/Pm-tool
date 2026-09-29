import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { Skeleton } from 'primeng/skeleton';
import { PageHeader, ErrorState } from '../../../../design-system';
import { AuditApi } from '../../../core/api/audit-api';
import { SitesApi } from '../../../core/api/sites-api';
import { TeamsApi } from '../../../core/api/teams-api';
import { createLoader } from '../../../core/load-state';
import { Session } from '../../../core/session';
import { environment } from '../../../../environments/environment';
import type { AuditEvent, SiteEnvironmentDetail, Team } from '../../../core/api-types';

/**
 * One site: what it points at, whether it is verified, who can edit it.
 *
 * Changing the branch is the consequential action here — it decides where
 * every future edit on this hostname lands — so it is called out rather than
 * sitting in a row of equal-looking fields.
 */
@Component({
  selector: 'app-site-detail',
  templateUrl: './site-detail.html',
  styleUrl: './site-detail.scss',
  imports: [DatePipe, FormsModule, RouterLink, Button, InputText, Message, Skeleton, ToggleSwitch, PageHeader, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteDetail {
  private readonly api = inject(SitesApi);
  private readonly teamsApi = inject(TeamsApi);
  private readonly auditApi = inject(AuditApi);
  private readonly session = inject(Session);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly loader = createLoader<SiteEnvironmentDetail | null>(null);
  protected readonly site = this.loader.data;
  protected readonly teams = signal<Team[]>([]);
  protected readonly activity = signal<AuditEvent[]>([]);
  protected readonly saving = signal(false);
  protected readonly message = signal<{ severity: 'success' | 'error'; text: string } | null>(null);
  protected readonly isAdmin = this.session.isAdmin;

  protected name = '';
  protected branch = '';
  protected feedbackWidget = false;

  /** Copied, not typed. Getting one character wrong here is a silent failure. */
  protected readonly copied = signal(false);

  constructor() {
    this.reload();
  }

  protected reload() {
    this.api.get(this.id).subscribe({
      next: (site) => {
        this.loader.set(site);
        this.name = site.site.name;
        this.branch = site.branch ?? '';
        this.feedbackWidget = site.site.feedbackWidget;
        this.loadRelated(site);
      },
      // Let the loader own the failure path, so the error state renders.
      error: () => this.loader.load(this.api.get(this.id)),
    });
  }

  /**
   * Teams are filtered client-side because the grant is on the *site* and
   * the teams endpoint already returns each team's sites — one request
   * instead of a per-site endpoint that would exist only for this screen.
   */
  private loadRelated(site: SiteEnvironmentDetail) {
    this.teamsApi.list().subscribe({
      next: (teams) =>
        this.teams.set(teams.filter((t) => t.sites.some((s) => s.site.id === site.siteId))),
    });

    if (this.session.isAdmin()) {
      this.auditApi.list({ limit: 100 }).subscribe({
        next: (page) =>
          this.activity.set(
            page.events.filter((e) => e.subject?.includes(site.hostname)).slice(0, 8),
          ),
      });
    }
  }

  protected changed(site: SiteEnvironmentDetail) {
    return this.name.trim() !== site.site.name || this.branch.trim() !== (site.branch ?? '');
  }

  protected save(site: SiteEnvironmentDetail) {
    this.saving.set(true);
    this.message.set(null);

    this.api
      .update(site.id, {
        name: this.name.trim(),
        // Empty means "read it from the page", which is null on the wire.
        branch: this.branch.trim() || null,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.message.set({ severity: 'success', text: 'Saved.' });
          this.reload();
        },
        error: (err: Error) => {
          this.saving.set(false);
          this.message.set({ severity: 'error', text: err.message });
        },
      });
  }

  /**
   * The widget's on/off switch, saved on its own.
   *
   * Separate from the Save button because it is the off switch: somebody
   * turning it off is usually doing so because something is wrong, and
   * making them press Save afterwards is the wrong moment to ask for a
   * second step.
   */
  protected toggleWidget(site: SiteEnvironmentDetail, enabled: boolean) {
    this.saving.set(true);
    this.message.set(null);

    this.api.update(site.id, { feedbackWidget: enabled }).subscribe({
      next: () => {
        this.saving.set(false);
        this.feedbackWidget = enabled;
        this.message.set({
          severity: 'success',
          text: enabled
            ? 'The feedback widget is on for this site.'
            : 'The feedback widget is off. It stops collecting immediately.',
        });
        this.reload();
      },
      error: (err: Error) => {
        this.saving.set(false);
        // Put the switch back: it must not show "on" for something that
        // failed to turn on.
        this.feedbackWidget = !enabled;
        this.message.set({ severity: 'error', text: err.message });
      },
    });
  }

  /** The tag a customer pastes into their page. */
  protected embedSnippet(): string {
    return `<script src="${window.location.origin}/widget.js" data-api="${environment.apiUrl}" defer></script>`;
  }

  protected copyEmbed() {
    void navigator.clipboard?.writeText(this.embedSnippet()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  /** A wildcard hostname is not a URL, so there is nothing to open. */
  protected siteUrl(site: SiteEnvironmentDetail) {
    return site.hostname.includes('*') ? '#' : `https://${site.hostname}`;
  }
}
