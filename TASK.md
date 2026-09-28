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

- **A real database.** ~~`overlay/pr-service/lib/store.js` is a key/value
  store with TTL, backed by memory or Upstash.~~ *Done: Postgres via Prisma,
  13 models, every table organisation-scoped. The KV store is gone.*
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

- [x] **P0.1** Pick the datastore and write the schema: `organisation`, `user`,
      `membership`, `connection`, `site`, `audit_event`. Postgres unless there
      is a reason not to.
- [~] **P0.2** Sign-up, sign-in, organisations, ~~invitations~~, roles. At minimum
      **admin** (connects providers, registers sites) and **editor** (opens
      pull requests). The distinction matters: an editor should never be able
      to re-point a site at a different repository.
      *Done: magic-link sign-in, sessions, organisations, `admin`/`editor`
      enforced by `OrgGuard` and `@Roles`. **Missing: invitations.** The
      `Invitation` model exists and first sign-in honours a pending one, but
      nothing creates one — there is no endpoint, so a second person cannot
      be added to an organisation except by hand in SQL.*
- [—] **P0.3** ~~Move the datastore behind the same interface the API already
      uses, so `lib/store.js` stays the place sessions live.~~
      **Obsolete.** `lib/store.js` was deleted with the pr-service. Sessions
      are rows in Postgres like everything else, and all database access is
      behind `*.repository.ts` — there is no KV store left to bolt onto.
- [ ] **P0.4a** Expire old rows. `session` and `login_token` grow without
      bound — a session is revocable precisely because it is a row, and that
      is the cost of the choice. A periodic `deleteMany` on `expiresAt`, or
      the same on read. Cheap now, a slow table in a year.
- [~] **P0.4** Audit log for every privileged action — provider connected,
      site registered, branch changed, pull request opened. This is cheap to
      add now and very expensive to reconstruct later.
      *Written for `organisation.created`, `site.registered`,
      `branch.changed`, `site.removed`, `connection.created`,
      `connection.reconnected` and `connection.revoked` — each inside the
      transaction it records. **Missing: anything that reads them.** There is
      no `GET /audit`, so the dashboard's audit page is still mock data, and
      `pr.opened` is not recorded at all.*

## P1 — Provider connections, off the extension

Connecting GitHub inside the plugin was always a stopgap. It makes every
editor do an OAuth dance, and it requires the GitHub App to be installed on
the organisation before a non-technical user can do anything — which is
exactly where the first real install stalled.

- [x] **P1.1** Admin connects the provider **once, in the dashboard**. The
      extension stops holding a provider session entirely.
      *API side done: `POST /connections/github/install-url` and the
      `/connections/github/callback` redirect. The extension still holds its
      own GitHub session until the pr-service migration lands.*
- [~] **P1.2** The extension authenticates to *us*, not to GitHub, and
      receives a short-lived token scoped to one site. A leaked extension
      token should not be a leaked GitHub token.
      *API side done — `/api/editing/*` takes a platform session and never a
      provider token, and no provider credential reaches the browser at all.
      Still outstanding: the extension itself points at the old service, and
      its session is long-lived rather than scoped to one site.*
- [x] **P1.3** **Provider interface.** `RepositoryProvider` in
      `apps/api/src/providers/provider.types.ts` — twelve operations, every
      one with a caller today, and GitHub behind it in
      `github/github.provider.ts`. Scoped to one repository, so resolving
      `owner/repo` happens once. GitHub was previously woven through
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

### Landed with connections

- Credential encryption at rest: AES-256-GCM, key rotation without a
  migration, and a boot-time check so a missing key is a deployment that
  never goes live rather than a 500 in front of a customer.
  `apps/api/src/common/crypto.ts`, 15 tests.
- Signed, expiring install state. It is the only thing tying "an
  installation was created" to "this organisation asked for it" — without
  it, whoever completes an install picks which organisation it lands in.
  `apps/api/src/common/signed-state.ts`, 8 tests.
- Connections endpoints: list, install URL, repositories, check, revoke.
  Revoke is refused while sites still point at the connection, and it
  forgets any cached installation token so it stops working immediately
  rather than up to an hour later.
- `test/connections-isolation.sh` — 15 adversarial checks against the
  running API: state replay by another user, a forged state, a spoofed
  organisation header, a cross-organisation connection id, credentials in a
  response body, and revoke-with-dependants.

**A GitHub App connection stores no secret.** The App private key is ours,
held once in the environment; what is per-customer is the installation id,
which is not sensitive. That is why `Connection.credentials` is nullable —
encryption is there for GitLab and Bitbucket OAuth tokens and GitHub
Enterprise access tokens, which arrive with P1.4 and P1.5.

### The pr-service migration

`overlay/pr-service` is superseded. Its ten Next.js routes are six NestJS
endpoints under `/api/editing/*`, and the 1,442 lines of codemods moved to
`apps/api/src/editing/` unchanged — 171 tests followed them and still pass.

**What changed shape, and why it had to.** The old routes took `repo` and
`branch` from the request body. That body came from a page we do not control,
so any editor could write to any repository their organisation's connection
could reach — regardless of which sites their team had been granted. The
endpoints now take an `environmentId` and derive the repository, branch and
connection from the registered site. `SitesService.authoriseEnvironment` is
the check, and `test/editing-access.sh` is the proof.

| Old | New |
|---|---|
| `POST /api/create-pr` | `POST /api/editing/change-requests` |
| `POST /api/create-issue` | `POST /api/editing/issues` |
| `GET /api/file` | `GET /api/editing/file` |
| `POST /api/locate` | `POST /api/editing/locate` |
| `GET /api/branches` | `GET /api/editing/branches` |
| `GET /api/preview-status` | `GET /api/editing/preview-status` |
| `GET /api/repos` | `GET /api/connections/:id/repositories` |
| `lib/github.js`, `lib/github-app.js` | `providers/github/*` behind `RepositoryProvider` |
| `lib/withAuth.js`, `lib/sessions.js`, `lib/store.js` | platform sessions in Postgres |
| `lib/crypto.js` | **removed, not replaced** — no provider token ever reaches the browser now |
| `lib/oauth-state.js` | `common/signed-state.ts` |
| `lib/rate-limit.js` | `editing/rate-limit.ts` |
| `lib/locate-source.js` | `editing/locate.service.ts` + `locate-ranking.js` |
| `lib/resolve-i18n.js` | `editing/i18n.service.ts` |
| `lib/observability.js` | `common/observability.js`, called from `main.ts` |

**Still to do:**

- [ ] Point the extension at `/api/editing/*` and at `/api/resolve`. Until
      then it calls routes that no longer work, so the two halves are
      migrated but not yet joined.
- [x] Delete `overlay/pr-service`. Done: 2,741 lines across 28 tracked files,
      plus 252 MB of `node_modules`. Everything that pointed at it was
      updated in the same pass — the root `dev`/`dev:svc`/`install:all`
      scripts, the CI job, `check-env`, `check-github`, `install-app-key`,
      `docs/DEPLOYMENT.md` and the README. `git log --follow` still reaches
      the old code.
      *Its `.env.local` held a working GitHub App: `GITHUB_APP_ID` and the
      private key were migrated into `apps/api/.env`, and
      `npm run check:github` now signs a real App JWT that GitHub accepts.
      `GITHUB_CLIENT_ID`/`SECRET` and `TOKEN_SECRET` were for the extension's
      own OAuth dance, which the platform removed; they are archived at
      `~/inline-edit-pr-service.env.local.bak` rather than destroyed.*
- [ ] Rate-limit counters are per process, so N instances means N times the
      limit. Fine as a ceiling against a runaway client, not as a billing
      control. `editing/rate-limit.ts` documents it; moving `hit()` to
      Postgres is the fix.
- [~] `github.provider.ts` and `github-app.service.ts` have no *automated*
      tests — every method is an Octokit call, so covering them means either
      a mock (which tests the mock) or a live App.
      *Now verified manually against the real App migrated out of the old
      service: `listInstallations`, `describeInstallation`,
      `listRepositories` (178 repos, so pagination is exercised),
      `listBranches`, `resolveRef` including the 40-char short-circuit,
      `listPaths`, `readFile` at a branch **and at a commit**,
      `compareCommit` for both a known and an unknown commit, `searchText`,
      and the two refusals — a directory and a missing file both raising
      `ProviderError('not-found')`. Writes were deliberately not exercised:
      they would create branches and pull requests in a real repository.
      Still to do: a recorded-fixture suite so this runs in CI.*

## P2 — Site registry

`site → repository → branch`. The piece that makes the tool work on a site it
was not built to know about.

Today `resolvePageContext` reads `data-edit-repo` and `data-edit-branch` off
the page, stamped at build time from CI or git. When that metadata is missing
the tool cannot tell which repository it is editing — which is what produces
the `local/project` fallback and a source panel that gives up.

- [x] **P2.1** Register a site: hostname → connection → repository → branch.
      `heykara.com → iFrontida/website-revamp @ main`.
- [x] **P2.2** Several environments per site, because this is the normal case:
      `heykara.com → main`, `staging.heykara.com → develop`,
      `*.vercel.app → the branch in the URL`. Wildcards need a defined
      precedence — most specific hostname wins.
- [x] **P2.3** The extension asks the dashboard "what is this page?" and gets
      back repository, branch and permissions. The build annotation becomes a
      *refinement* — it still carries the exact commit — rather than the only
      source of truth.
      *`GET /api/resolve?hostname=` answers it, and every editing endpoint
      now takes an `environmentId` from that answer. `buildCommit` is the
      refinement: it decides what the branch is cut from, nothing more.*
- [~] **P2.4** Warn when the registered branch and the commit stamped on the
      page disagree. Editing a preview built from a commit that is no longer
      on the branch is how an edit silently lands in the wrong place.
      *The API answers it — `GET /api/editing/preview-status` returns
      `{status, aheadBy, usable}`, and `createChangeRequest` branches from
      the build commit when it is still reachable. **Missing: the warning
      itself**, which is extension UI.*
- [ ] **P2.5** Verify domain ownership before a site can be registered.
      Without it, anyone can claim `heykara.com` and collect feedback meant
      for someone else.

## P2.6 — Joining the halves

Both ends are built and neither is connected. This is now the critical path:
until it is done, nothing works end to end for a user.

- [ ] **The extension still speaks the old protocol.** It posts to
      `/api/create-pr` with `repo` and `branch` in the body, and
      authenticates via `/api/auth/extension` — all three are gone. It needs
      to call `GET /api/resolve?hostname=` once, then send `environmentId` to
      `/api/editing/*`. `inline-edit-tool/extension/src/background.js` is
      where the URLs live.
- [ ] **The dashboard is 100% mock data.** Seventeen feature files import
      `core/mock-data.ts` and **zero** use `HttpClient`. Sites and
      connections already have real endpoints to call; the rest do not (see
      below). Writes silently do nothing: registering a site adds no row,
      Save on site detail discards, feedback status never changes.

### APIs the dashboard needs and does not have

`auth`, `sites`, `connections` and `editing` exist — 20 endpoints. These do
not:

- [ ] **Teams** — create, rename, add/remove member, grant/revoke site
      access. The schema and the `Everyone` default team exist and
      `authoriseEnvironment` already enforces team access, so the model is
      proven; only the endpoints are missing.
- [ ] **People** — list members, change a role, remove someone.
- [ ] **Invitations** — create, list, revoke, accept. Blocks P0.2.
- [ ] **Audit** — `GET /audit`, paginated. Blocks P0.4.
- [ ] **Organisation settings** — rename, and the deletion obligation this
      file opens by naming.
- [ ] **Feedback** — the whole of P3 below.

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
