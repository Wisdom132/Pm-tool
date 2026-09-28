# Platform roadmap

Product work turning the browser editor into a multi-tenant service.

`TASKS.md` is the engineering log for what has already shipped — phases 0–9,
the extension, the annotation plugins, the codemods. This file is the plan for
what comes next and is deliberately separate: the work below changes what the
product *is*, not just what it does.

---

## The shape of the change

Today the whole system is two pieces a developer installs: a browser extension
and a stateless API. There is no account, no database, and no notion of a
company. Every editor authenticates to GitHub individually, and a GitHub App
has to be installed per organisation before anything works.

Everything below assumes a third piece — a dashboard with tenants — and that
assumption carries obligations the current codebase does not have:

- **A real database.** `overlay/pr-service/lib/store.js` is a key/value store
  with TTL, backed by memory or Upstash. That is right for sessions and nonces
  and wrong for tenants, sites and connections. This is the single largest
  lift, and everything else waits on it.
- **Tenant isolation.** Every query gains an organisation scope. Getting this
  wrong once leaks one customer's source into another customer's editor.
- **Secret custody.** We would hold long-lived provider credentials for other
  companies' repositories. That is a different risk class from a per-user
  token in a browser, and it needs encryption at rest, rotation and an audit
  trail.
- **Data retention and deletion.** Once there are accounts there is a
  deletion obligation, and it has to reach every store.

None of this is an argument against the plan. It is the cost of it, and it
should be priced in before the first schema is written.

---

## P0 — Dashboard and accounts

The foundation. Nothing else in this file can ship without it.

- [ ] **P0.1** Pick the datastore and write the schema: `organisation`, `user`,
      `membership`, `connection`, `site`, `audit_event`. Postgres unless there
      is a reason not to.
- [ ] **P0.2** Sign-up, sign-in, organisations, invitations, roles. At minimum
      **admin** (connects providers, registers sites) and **editor** (opens
      pull requests). The distinction matters: an editor should never be able
      to re-point a site at a different repository.
- [ ] **P0.3** Move the datastore behind the same interface the API already
      uses, so `lib/store.js` stays the place sessions live and the new tables
      are separate rather than bolted onto a KV store.
- [ ] **P0.4** Audit log for every privileged action — provider connected,
      site registered, branch changed, pull request opened. This is cheap to
      add now and very expensive to reconstruct later.

## P1 — Provider connections, off the extension

Connecting GitHub inside the plugin was always a stopgap. It makes every
editor do an OAuth dance, and it requires the GitHub App to be installed on
the organisation before a non-technical user can do anything — which is
exactly where the first real install stalled.

- [ ] **P1.1** Admin connects the provider **once, in the dashboard**. The
      extension stops holding a provider session entirely.
- [ ] **P1.2** The extension authenticates to *us*, not to GitHub, and
      receives a short-lived token scoped to one site. A leaked extension
      token should not be a leaked GitHub token.
- [ ] **P1.3** **Provider interface.** GitHub is currently woven through
      `lib/github.js`, `lib/github-app.js`, and the `create-pr`, `create-issue`,
      `file`, `locate`, `branches` and `repos` routes. Define the operations
      the product actually needs — read file, list branches, commit, open a
      change request, search text — and put GitHub behind it first.
- [ ] **P1.4** GitLab (merge requests) behind the same interface.
- [ ] **P1.5** Bitbucket (pull requests) behind the same interface.
- [ ] **P1.6** Self-hosted GitLab / GitHub Enterprise: a base URL on the
      connection. Worth designing for now, cheap now, painful to retrofit.

> The codemods are already provider-agnostic — they take file contents and
> return file contents. Only the transport is coupled.

## P2 — Site registry

`site → repository → branch`. The piece that makes the tool work on a site it
was not built to know about.

Today `resolvePageContext` reads `data-edit-repo` and `data-edit-branch` off
the page, stamped at build time from CI or git. When that metadata is missing
the tool cannot tell which repository it is editing — which is what produces
the `local/project` fallback and a source panel that gives up.

- [ ] **P2.1** Register a site: hostname → connection → repository → branch.
      `heykara.com → iFrontida/website-revamp @ main`.
- [ ] **P2.2** Several environments per site, because this is the normal case:
      `heykara.com → main`, `staging.heykara.com → develop`,
      `*.vercel.app → the branch in the URL`. Wildcards need a defined
      precedence — most specific hostname wins.
- [ ] **P2.3** The extension asks the dashboard "what is this page?" and gets
      back repository, branch and permissions. The build annotation becomes a
      *refinement* — it still carries the exact commit — rather than the only
      source of truth.
- [ ] **P2.4** Warn when the registered branch and the commit stamped on the
      page disagree. Editing a preview built from a commit that is no longer
      on the branch is how an edit silently lands in the wrong place.
- [ ] **P2.5** Verify domain ownership before a site can be registered.
      Without it, anyone can claim `heykara.com` and collect feedback meant
      for someone else.

## P3 — Feedback collector

Distinct from opening an issue or a pull request: a way for people who will
never touch the repository to leave a comment pinned to a part of the page.

- [ ] **P3.1** A widget the site embeds, or the extension provides. Both,
      eventually — the embed is what lets a client comment without installing
      anything.
- [ ] **P3.2** Feedback is pinned to an **element**, and where the page is
      annotated, to a **source file and line**. That link is the thing no
      general feedback tool has, and it is already built.
- [ ] **P3.3** Screenshot, viewport, browser and the page URL attached
      automatically. Most of a bug report is context nobody types.
- [ ] **P3.4** Inbox in the dashboard: triage, assign, resolve, and promote a
      comment into an issue or a pull request — which is where this rejoins
      the existing tool.
- [ ] **P3.5** **Abuse surface.** A public endpoint that accepts screenshots
      from unauthenticated visitors needs rate limiting, size caps, spam
      handling and a way to turn it off. Worth designing before shipping, not
      after the first flood.

## P4 — Reporting integrations

Incremental once P0 and P1 exist. Each one is ongoing maintenance, so add them
on demand rather than speculatively.

- [ ] **P4.1** Integration framework: connection, credential storage, field
      mapping, retry, and a visible failure state. The framework matters more
      than the first integration.
- [ ] **P4.2** Jira — create an issue from feedback or an edit.
- [ ] **P4.3** Linear, Slack, Airtable.
- [ ] **P4.4** Outbound webhooks, which cover everything not on this list and
      cost far less than a bespoke integration.

## P5 — Product analytics

**This is the one to scope down.** Recorded here honestly rather than as a
checklist item, because "implement what Hotjar does" is not a feature — it is
a company, with its own hard problems: ingestion at volume, storage cost, PII
in replays, consent management, and a performance budget on someone else's
production site.

It also changes the product's posture. Everything above runs on a preview
deploy or behind an extension. Analytics means our script on the customer's
**production** pages, in front of their real users, which is a different
compliance and reliability surface entirely.

There is a genuinely differentiated version, and it is narrower:

> Because we already map a rendered element to the source file and line that
> produced it, we can report engagement **per component** rather than per
> pixel. "This call-to-action is rendered in `Hero.vue:14` and nobody clicks
> it" is something a heatmap tool structurally cannot say, and it is the same
> click that opens the editor to fix it.

- [ ] **P5.1** Its own folder and its own service. No shared datastore with
      the editor — the access patterns and retention rules have nothing in
      common.
- [ ] **P5.2** Component-level click and visibility counts, keyed to source
      location. Start here; it is the differentiator and the cheapest to run.
- [ ] **P5.3** Consent, PII masking, and a documented retention window —
      **before** any recording feature, not alongside it.
- [ ] **P5.4** Heatmaps.
- [ ] **P5.5** Session replay. Last, and only if customers ask for it after
      P5.2. It is the most expensive thing on this page to build and to run.

---

## Sequencing

1. **P0 + P2 first.** They unblock everything and fix the failure already hit
   in practice: an organisation that could not use the tool because a GitHub
   App was not installed, and pages the extension could not identify.
2. **P3 next.** Small, self-contained, and the clearest new value for the
   non-technical users this is aimed at.
3. **P1.4–P1.6 on demand.** Build the interface early; add providers when a
   customer needs one.
4. **P4 as asked for.**
5. **P5.2 as an experiment.** Everything after it only if that lands.

## Open questions

- Who is the buyer — the engineering team that owns the repository, or the
  marketing team that owns the copy? The dashboard's shape depends on it.
- Does the extension survive, or does the dashboard become the way in? An
  embed with no install is a much shorter path for a non-technical editor.
- Self-serve or sales-led? It decides whether P0.2 needs invitations and
  billing on day one.
- What happens on a page with no build annotation at all? Locate already
  covers it, but it is slower and asks for a confirmation — and that will be
  the common case on sites that have not added the plugin yet.
