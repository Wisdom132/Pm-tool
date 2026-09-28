# Deploying the API

`apps/api` is a NestJS app backed by Postgres. It holds GitHub credentials
belonging to *other companies* and opens pull requests on an editor's behalf,
so treat it as production infrastructure.

**Node 22.12 or newer.** The codemods import `@babel/parser` 8, which is
ESM-only, while the build output is CommonJS — so this relies on Node's
`require(esm)` support. An older runtime builds successfully and then fails on
the first JSX edit.

---

## 1. Create a GitHub App

**Not** an OAuth App. A GitHub App gives per-repository installation,
short-lived tokens, organisation admin approval, and — the reason it is
required here — the ability to open a pull request for an editor who only has
read access.

<https://github.com/settings/apps> → **New GitHub App**

| Field | Value |
|-------|-------|
| Homepage URL | your dashboard URL |
| Callback URL | `https://your-api/api/connections/github/callback` |
| Setup URL | the same callback, so a direct install also lands there |
| Request user authorization (OAuth) during installation | **not required** |
| Webhook | **disabled** |
| Where can this be installed? | **Any account**, or customers cannot install it |

Repository permissions:

| Permission | Access | Why |
|------------|--------|-----|
| Contents | Read and write | Create branches, read and commit files |
| Pull requests | Read and write | Open the change request |
| Issues | Read and write | Observer mode files issues |
| Metadata | Read-only | Implied |

Then **Generate a private key** and download the `.pem`.

> The old service asked an *editor* to authorise GitHub. This one does not:
> an **admin installs the App once, in the dashboard**, and every editor in
> that organisation then works without a GitHub account of their own. That is
> where the first real install stalled, and why it changed.

---

## 2. Environment variables

Copy `apps/api/.env.example`. Every variable is documented there; this is the
deployment-specific commentary.

### Required

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Postgres. Run `prisma migrate deploy` before first boot |
| `CREDENTIALS_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Encrypts stored provider credentials at rest |
| `GITHUB_APP_ID` | From the App's settings page |
| `GITHUB_APP_SLUG` | The last path segment of `github.com/apps/<slug>`. Used to build the install URL |
| `GITHUB_APP_PRIVATE_KEY` | The `.pem`. Raw, with literal `\n`, or base64 — all three are accepted, because hosting UIs disagree about newlines |
| `DASHBOARD_URL` | Where the install callback redirects back to |

`npm run check:env` reports which of these are missing, and validates that the
credential key is really 32 bytes and the PEM really parses.

`npm run check:github` goes further: it signs a real App JWT and asks GitHub
who it belongs to. That is the only way to catch an App ID paired with someone
else's key — a mismatch which otherwise surfaces as a 401 halfway through
opening a pull request.

### Optional

| Variable | Notes |
|----------|-------|
| `CORS_ORIGINS` | Comma-separated. Defaults to `http://localhost:4300` |
| `PORT` | Defaults to 3333 |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` (default `info`) |
| `SENTRY_DSN` | Errors are forwarded when set; `@sentry/node` is an optional peer |

### Rotating the credential key

`CREDENTIALS_KEY` accepts a comma-separated list. The **first** key encrypts
new writes; the rest only decrypt. So rotation is:

1. Prepend a new key: `CREDENTIALS_KEY=new,old`
2. Deploy. New writes use `new`; existing rows still decrypt with `old`.
3. Once nothing references `old`, drop it.

No migration re-encrypts everything at once, and there is no window where a
credential cannot be read.

---

## 3. Deploy

```bash
npm ci
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run build:api
node apps/api/dist/main.js        # listens on 3333
```

The dashboard is a separate static build:

```bash
npm --prefix apps/dashboard run build
```

---

## 4. Verify

1. `GET /api/health` reports `{"status":"ok","database":"up"}` — it checks
   Postgres, not just that Node is running.
2. Sign in to the dashboard, then **Connections → Connect GitHub**. You are
   sent to GitHub and returned to the dashboard with the connection listed.
3. **Register a site**: `hostname → repository → branch`.
4. `GET /api/resolve?hostname=<that hostname>` answers with the repository and
   branch. This is what the extension asks.
5. Make an edit and submit. The pull request is opened by the App, with the
   editor credited by display name in the body.

### When something goes wrong

| Symptom | Cause |
|---------|-------|
| `CREDENTIALS_KEY is not set` at boot | Set it. The API deliberately refuses to start rather than store credentials in the clear |
| `CREDENTIALS_KEY entry 1 is 16 bytes; AES-256 needs 32` | Generate a 32-byte key; the message names which entry |
| `This link has expired or is not valid` on install | The signed `state` is older than ten minutes, or was signed by a different `CREDENTIALS_KEY`. Start the connection again |
| `This connection was started by a different person` | The browser completing the install is signed in as someone else |
| `GITHUB_APP_SLUG is not configured` | The install URL cannot be built without it |
| `The Inline Edit GitHub App is no longer installed on …` (409) | An admin uninstalled it on GitHub's side; reconnect in the dashboard |
| Repository missing from the picker | `/api/connections/:id/repositories` lists only repositories the installation can reach |
| `GITHUB_APP_PRIVATE_KEY is not a valid PEM` | The value got truncated or newline-mangled; base64 the whole file, or use `npm run install:key` |
| `No such site.` (404) from an editing endpoint | Either the environment does not exist or the caller's teams do not cover it. The two are deliberately indistinguishable |
| A 502 from an editing endpoint | The provider is unreachable. Not a 500, because the failure is upstream |

---

## Operating notes

- **Rate limits**: 20 change requests per hour per user *and* per site, 300
  reads, 60 searches. Configured in `apps/api/src/editing/rate-limit.ts`.

  Counters are **per process**, so N instances means N times the limit. That
  is a ceiling against a runaway client or a stolen session, not a billing
  control. Moving `hit()` to Postgres is a change to that one function.

- **Installation tokens** are cached in memory per process, expiring a minute
  early. Several instances each mint their own, which GitHub permits and
  which costs one extra call per instance per hour.

- **Revoking a connection** clears its stored credentials and forgets any
  cached token, so it stops working immediately rather than up to an hour
  later. It is refused while sites still point at it.

- **Logs** are one JSON object per line with a stable `event` field, so
  `create_pr.failed` and similar are greppable.

- **User content is never logged** — edit text is deliberately excluded.

- **Session and login-token rows grow without bound.** A session is revocable
  precisely because it is a row. Expiring them is `P0.4a` in `TASK.md` and is
  not yet implemented.
