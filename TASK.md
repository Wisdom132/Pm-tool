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
- [x] **P0.2** Sign-up, sign-in, organisations, invitations, roles. At minimum
      **admin** (connects providers, registers sites) and **editor** (opens
      pull requests). The distinction matters: an editor should never be able
      to re-point a site at a different repository.
      *Done: magic-link sign-in, sessions, organisations, invitations, and
      `admin`/`editor` enforced by `OrgGuard` and `@Roles`. **One defect
      outstanding — see "Defects in work already reported done" below.***
- [—] **P0.3** ~~Move the datastore behind the same interface the API already
      uses, so `lib/store.js` stays the place sessions live.~~
      **Obsolete.** `lib/store.js` was deleted with the pr-service. Sessions
      are rows in Postgres like everything else, and all database access is
      behind `*.repository.ts` — there is no KV store left to bolt onto.
- [ ] **P0.4a** Expire old rows. `session` and `login_token` grow without
      bound — a session is revocable precisely because it is a row, and that
      is the cost of the choice. A periodic `deleteMany` on `expiresAt`, or
      the same on read. Cheap now, a slow table in a year.
- [x] **P0.4** Audit log for every privileged action — provider connected,
      site registered, branch changed, pull request opened. This is cheap to
      add now and very expensive to reconstruct later.
      *Written inside the transaction each one records, plus `pr.opened` and
      `issue.opened`. `GET /audit` is keyset-paginated and admin-only, with
      `GET /audit/actions` for the filter.*

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
- [x] **P1.2** The extension authenticates to *us*, not to GitHub, and
      receives a short-lived token scoped to one site. A leaked extension
      token should not be a leaked GitHub token.
      *Done. No provider credential reaches the browser at all — the
      extension never talks to GitHub. A token is minted in the dashboard,
      pasted into the popup, listed with a label and last-used time, and
      revocable on its own. One thing from the original wording is still
      unmet: the token is long-lived (30 days) rather than short-lived and
      scoped to a single site.*
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

- [x] Point the extension at `/api/editing/*` and at `/api/resolve`. Done —
      `src/site-resolver.js` resolves the hostname once per page and every
      editing call sends an `environmentId`.
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
- [x] **P2.4** Warn when the registered branch and the commit stamped on the
      page disagree. Editing a preview built from a commit that is no longer
      on the branch is how an edit silently lands in the wrong place.
      *`GET /api/editing/preview-status` answers it, `createChangeRequest`
      branches from the build commit while it is still reachable, and the
      submit panel's `checkPreviewFreshness` shows the warning before an
      edit is submitted.*
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

## Defects in work already reported done

Found by re-reading, not by a failing test — which is why they are listed
here rather than as unstarted work.

- [x] **Invitation links are broken.** Fixed: the route is
      `invitations/:token`, matching the email, with `invite/:token` kept as
      a redirect because invitations live 14 days and old-shape links may
      already be in an inbox.
- [x] **`accept-invite` is still hard-coded.** Fixed. It now fetches the
      invitation and renders four real states: signed out (offers a sign-in
      link to the invited address only), signed in as the invitee (the one
      case with an Accept button), signed in as somebody else (says so
      rather than accepting for the wrong account), and expired/already
      accepted.
- [x] **No endpoint reads an invitation by token.** Added
      `GET /auth/invitations/:token` — public, rate-limited, and deliberately
      thin: organisation name, address, role, expiry. No member or site list,
      so a guessed token is not worth having.
      Also added `POST /auth/invitations/:token/accept`, which closes a real
      gap: acceptance previously happened only on sign-in, so somebody
      *already signed in* when invited had a pending invitation, no
      membership, and a link that appeared to do nothing.
- [x] **Nothing writes a `Feedback` row.** Fixed: the extension now has a
      **Comment** tool. `POST /feedback` takes an `environmentId` and derives
      the organisation and site from it — the same rule editing follows — so
      a page cannot file feedback against somebody else's site.
- [x] **`TASK.md` lost its P3–P5 sections in commit `a90a735`** — restored
      from `2f5ffe1`. An edit script sliced out everything after the section
      it was replacing. Recorded because the same mistake would be invisible
      in any file nobody reads end to end.

## The annotation layer

Mapping a rendered element back to its source is what the product *is*.
Everything else — the API, the dashboard, the extension — is scaffolding
around it. It was audited properly after the plugins were found to have
drifted apart, and five defects came out of one reading.

**The four plugins had silently diverged.** Nothing compared them, so each
was only ever checked against itself.

| Defect | Where | Effect |
|---|---|---|
| Tag allowlist still in use | Svelte, Angular | Missed every `<div>` holding copy. On a utility-class codebase that is most of the page — the exact bug React and Vue had already abandoned the approach over |
| No `data-edit-col` | Angular | Two elements on one line produced the same `editKey`, so edits **collided in the session** and a structural edit matched whichever came first |
| Interpolated text offered as editable | Angular | `<p>{{ count }} deploys</p>` was editable, and the HTML codemod replaces the whole inner range — accepting that edit would **destroy the binding** |
| Capitalised tags matched | Svelte | Widening the scanner exposed it: the allowlist had excluded components by accident, since every entry was lowercase |
| Provenance only on component roots in Vue | React, Svelte, Angular | An image, an icon or a wrapper had no annotated ancestor, so Inspect and Comment could name no file |

A second review pass then found three more — two of them in the fixes
themselves, which is why the pass was worth doing:

| Defect | Where | Effect |
|---|---|---|
| Idempotency broken by the root-span change | Svelte, Angular *(mine)* | A root skipped as already-annotated left `rootEnd` behind, so on a second transform a nested child was mistaken for a root and annotated again — with a column measured into the already-annotated string. Build tools do transform a file twice |
| Close-tag scan not depth-aware | Angular | `<div><div>Copy</div></div>` matched the *inner* `</div>`, so the outer was judged to hold only text |
| Child elements' text counted as an element's own | Angular | `<p>Read our <a>guide</a></p>` was offered for editing. The HTML codemod replaces the whole inner range, so accepting it would have **deleted the link** |

The last two predate this work — `p` was on the old allowlist — but widening
the scanner made them reachable on every `<div>` and `<section>` on a page.

The structural fix is `annotation/lib/markup-scan.js`: Svelte and Angular
are both text scanners feeding the same HTML codemod, and keeping two
copies of the scan is precisely what let them diverge. They now share the
depth-aware close, the column base, the denylist and the tag pattern, and
agree element-for-element on what may be edited.

`tests/annotation-parity.test.js` is the net that was missing: it runs
equivalent markup through all four plugins and asserts on *behaviour*
rather than output, because the four legitimately differ in syntax and
column base. It found the Angular interpolation bug on its first run, and
now also covers the three data-loss cases and idempotency.

**One thing checked and found not to be a bug.** The plugins disagree on
column base — Vue is 1-based, React, Svelte and Angular 0-based. Each
matches *its own* codemod's parser, and nothing compares a column across
frameworks, so the difference is correct rather than a latent defect.

### Still open in the annotation layer

- [ ] **`data-edit-i18n-key` is emitted only by React.** Translated copy on
      Vue, Svelte and Angular is unreachable: the element holds `{{ t('x') }}`
      with no literal, so it is not annotated, and there is no key for
      `resolveI18nEdits` to redirect to a locale file. The whole i18n path
      exists and works — for one framework of four. Each needs its own idiom
      recognised (`$t()`, `| translate`, `t()`).

### Provenance is not the editing contract

`data-edit-file` and `data-editable` were emitted together by every
annotation plugin, on elements holding literal text. They mean different
things:

- **`data-editable`** — the codemod can rewrite this. Narrow on purpose:
  offering an edit that fails at pull-request time is worse than not
  offering it. This rule is right and unchanged.
- **`data-edit-file`** — this came from here. Emitting it only alongside
  the first meant an image, an icon, or a footer of links had no annotated
  ancestor anywhere up the tree — so Inspect and Comment could say nothing
  about the majority of a page. On a real Nuxt site, "almost all" elements.

The Vue plugin now also stamps the **template root** with provenance and
*not* `data-editable`, so everything inside a component can inherit a file
via `closest()`. `element-registry.js` keys the editing tools on
`data-editable`, so nothing new became editable.

- [x] **React, Svelte and Angular still conflate the two.** Done — all four
      plugins now stamp provenance on a component root without marking it
      editable.

### Validation must see what gets stored

`@IsNotEmpty()` accepted `"   "`, the service trimmed it on the way to the
database, and a blank comment was stored with a 201. The same shape had
already registered a site whose repository was the empty string — which then
failed on *every edit* rather than at registration, the worst place to find
out.

The fix is `common/trim.ts`: a `@Trim()` transform that runs **before**
validation, so the DTO is the single description of what is acceptable and a
new field cannot forget. Guarding in each service would have worked and would
have had to be remembered eight times.

### A trap worth naming

Twice now, moving a module has broken a test file's import and I have read
past it. Vitest reports a file that fails to *load* as `1 failed` with **zero
tests**, so the `Tests N passed` line stays green and only the count drops —
669 to 659 in this case, with no red test names.

**Read the file count, not just the test count.** `Test Files 35 passed (35)`
is the line that catches it.

## P3 — Feedback collector

Distinct from opening an issue or a pull request: a way for people who will
never touch the repository to leave a comment pinned to a part of the page.

- [~] **P3.1** A widget the site embeds, or the extension provides. Both,
      eventually — the embed is what lets a client comment without installing
      anything.
      *The extension half is done. The embed is not, and it is the half that
      carries P3.5's abuse surface: `POST /feedback` requires a session, so
      there is no unauthenticated ingest to flood yet.*
- [x] **P3.2** Feedback is pinned to an **element**, and where the page is
      annotated, to a **source file and line**. That link is the thing no
      general feedback tool has, and it is already built.
      *Done. The element is a selector from `element-selector.js`, which
      deliberately refuses generated classes — a hashed `header-1a2b3c` looks
      precise and stops matching at the next build, so it falls back to
      `nth-of-type`. 18 tests, including that every selector it emits
      re-finds its own element. An invalid `sourceFile` drops the link and
      keeps the comment rather than rejecting it.*
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
