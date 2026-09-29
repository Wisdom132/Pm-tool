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

- [x] **The extension still speaks the old protocol.** Done. It now resolves
      the hostname once per page (`src/site-resolver.js`) and sends an
      `environmentId` to `/api/editing/*`.
      *The repo and branch pickers in the submit panel are gone, along with
      `loadRepos`, `loadBranches`, `saveSiteSettings` and manual mode — the
      choice they offered is no longer the client's to make, and offering
      one would produce a 404. An unregistered hostname now says so and
      points at the dashboard.*

      **Authentication changed shape.** There is no OAuth launch: the
      extension has no inbox for a magic link, so `POST
      /auth/extension-tokens` mints a long-lived session in the dashboard
      (Your account → Browser extension) and it is pasted into the popup.
      The background worker verifies it against `/auth/me` before storing,
      because a wrong token in `chrome.storage` fails later on a customer's
      page where the cause is invisible. Tokens are listed with a label and
      last-used time, and revocable one at a time.

      Two consequences worth naming:
      - **`chrome.identity` is no longer requested.** It existed only for
        the OAuth flow. One fewer permission on the install prompt.
      - **No provider credential can reach the browser at all** — not just
        by policy, but because nothing in the extension ever talks to
        GitHub.

      Verified by `apps/api/test/extension-flow.sh` — 13 checks walking the
      path the extension now walks, including that a client-supplied `repo`
      is refused outright and that revoking an extension token does not
      touch the dashboard session.
- [x] **The dashboard is 100% mock data.** Done: `core/mock-data.ts` is
      deleted, all seventeen feature files call the API, and every write
      persists. `core/api.client.ts` owns `withCredentials`, the
      `x-organisation-id` header and error-shape flattening;
      `core/api.ts` is one thin service per resource; `core/session.ts`
      holds the signed-in user and the current organisation; route guards
      keep an editor out of admin-only screens the API would 403 anyway.
      `createLoader` now takes an Observable, which is the only change its
      callers needed.
      *Verified by `apps/api/test/dashboard-contract.sh` — 18 checks that
      every endpoint returns the fields the dashboard's types promise,
      including three asserting that `lastEditedAt`, `verified` and a flat
      `provider` are **absent**. Those were mock inventions the dashboard
      referenced for weeks; nothing could catch it until the two were
      compared.*

      Three things the mock implied that the API does not do, corrected in
      place rather than faked:
      - **The reply thread on feedback detail is gone.** There is no
        comments model, so a composer would have accepted what someone
        typed and dropped it. Triage — status, and recording the issue it
        became — is what the API supports.
      - **The device-by-device session list is gone.** The API can revoke
        every other session or the current one, not name them, so the
        screen offers the blunt control it actually has.
      - **"The default team always covers every site" was false.** It is an
        ordinary team that each new site is granted to. The copy now says
        that.

      Also added `PATCH /auth/me`, so a display name can be set — which is
      what the pull-request attribution falls back from, and the difference
      between crediting "ada" and publishing "ada@acme.com".

### APIs the dashboard needs — done

`auth`, `sites`, `connections` and `editing` were already there. These
landed with it: **46 routes** in total, up from 20.

- [x] **Teams** — list, get, create, rename, delete, and `PUT` the whole
      member set or site set. The default team is protected from deletion:
      every new site is granted to it and every invitee joins it, so
      deleting it would silently make new sites admin-only.
- [x] **People** — one list merging accepted members and pending
      invitations, since "who is in this organisation" is one question.
      Change a role, remove someone.
- [x] **Invitations** — create (superseding any earlier one for the same
      address), revoke, and accept.
- [x] **Audit** — `GET /audit`, keyset-paginated on the autoincrement id.
      Admin only. `GET /audit/actions` for the filter. `pr.opened` and
      `issue.opened` are now recorded too — they were the gap.
- [x] **Organisation settings** — get, rename, and soft delete behind a
      typed confirmation. Delete is refused while provider connections are
      live, because uninstalling from GitHub is the part a soft delete
      cannot undo.
- [x] **Feedback inbox** — list with status counts, get, set status,
      promote, delete. New `Feedback` model and migration.
      *Not* the public collector: P3.1/P3.5 need rate limiting, size caps
      and spam handling first, and shipping ingest without them is how the
      first flood happens.

Verified by `apps/api/test/members-teams.sh` — 35 checks, including the one
that matters most: **an organisation cannot be left with no admin**, probed
from every route that could reach it.

**A real bug this surfaced.** An invited person signed in and got a `User`
row with *no membership at all* — `findOrCreateUser` checked
`hasPendingInvitation` and then did nothing with it, so they landed on a
dashboard that could show them nothing. `acceptPendingInvitations` now runs
on every sign-in, not just the first, so an existing user invited to a
second organisation joins it too.

**And two more.** Soft-deleting an organisation left it fully usable, because
`OrgGuard` never checked `deletedAt`; and `/auth/me` would have kept offering
it in the switcher. Both now filter on it in the query.

