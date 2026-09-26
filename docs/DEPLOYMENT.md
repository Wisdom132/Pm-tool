# Deploying the pr-service

The service is a Next.js app. It holds GitHub credentials and opens pull
requests on the editor's behalf, so treat it as production infrastructure
even though it is small.

---

## 1. Create a GitHub App

**Not** an OAuth App. A GitHub App gives per-repository installation,
short-lived tokens, organisation admin approval, and — the reason it is
required here — the ability to open a pull request for an editor who only
has read access.

<https://github.com/settings/apps> → **New GitHub App**

| Field | Value |
|-------|-------|
| Homepage URL | your service URL |
| Callback URL | `https://your-service/api/auth/extension-callback` |
| Request user authorization (OAuth) during installation | **enabled** |
| Webhook | **disabled** |

Repository permissions:

| Permission | Access | Why |
|------------|--------|-----|
| Contents | Read and write | Create branches, read and commit files |
| Pull requests | Read and write | Open the PR |
| Issues | Read and write | Observer mode files issues |
| Metadata | Read-only | Implied |

Then **Generate a private key** and download the `.pem`.

Install the App on the repositories you want editable. Only installed
repositories appear in the extension.

---

## 2. Environment variables

Copy `overlay/pr-service/.env.example`. Every variable is documented there;
this is the deployment-specific commentary.

### Required

| Variable | Notes |
|----------|-------|
| `GITHUB_APP_ID` | From the App's settings page |
| `GITHUB_CLIENT_ID` | From the same page |
| `GITHUB_CLIENT_SECRET` | Generate one; rotate if it ever leaks |
| `GITHUB_APP_PRIVATE_KEY` | The `.pem`. Raw, with literal `\n`, or base64 — all three are accepted, because hosting UIs disagree about newlines |
| `APP_URL` | Must exactly match the App's callback URL origin |
| `TOKEN_SECRET` | `openssl rand -base64 32`. Encrypts stored GitHub tokens — rotating it signs everyone out |
| `ALLOWED_EXTENSION_IDS` | Comma-separated Chrome extension IDs. **Required in production**; without it the service refuses to authenticate anyone |

### Strongly recommended

| Variable | Notes |
|----------|-------|
| `UPSTASH_REDIS_REST_URL` | Session store |
| `UPSTASH_REDIS_REST_TOKEN` | |

Without these, sessions live in process memory. On a serverless host that
means **every request may hit a different instance and see no session**, so
sign-in appears to fail at random. The service logs a warning at startup when
running this way in production.

Any Redis exposed over Upstash's HTTP API works; the client is plain `fetch`,
with no extra dependency.

### Optional

| Variable | Notes |
|----------|-------|
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` (default `info`) |
| `SENTRY_DSN` | Errors are forwarded when set |

---

## 3. Finding your extension ID

`ALLOWED_EXTENSION_IDS` gates both the OAuth redirect target and CORS, so it
has to be right.

- **Unpacked**: `chrome://extensions` with Developer mode on — the ID is under
  the extension name. It is derived from the directory path, so it changes if
  you move the folder. Pin it by adding a `key` to `manifest.json`.
- **Published**: the ID in the Web Store URL.

Outside production, an unset allowlist accepts any well-formed extension ID so
first-run setup is possible. That fallback is disabled when
`NODE_ENV=production`.

---

## 4. Deploy

### Vercel

```bash
cd overlay/pr-service
vercel
```

Set the environment variables in the project settings. `APP_URL` must be the
production domain, not a preview URL, or the OAuth callback will not match.

### Anywhere else

```bash
npm ci --prefix overlay/pr-service
npm run build --prefix overlay/pr-service
npm start --prefix overlay/pr-service      # listens on 3001
```

Node 18+.

---

## 5. Verify

1. `GET /` shows the service page and its URL.
2. Set that URL in the extension popup. Non-localhost must be `https://`.
3. Open an annotated preview, make an edit, submit.
4. The PR is opened by the App, with the editor credited in the body.

### When something goes wrong

| Symptom | Cause |
|---------|-------|
| `ALLOWED_EXTENSION_IDS is not configured` | Set it, or you are unintentionally running with `NODE_ENV=production` |
| `Invalid, expired or already-used state parameter` | Clock skew, or a stale callback being replayed. State nonces are single-use by design |
| `The Inline Edit GitHub App is not installed on …` | Install the App on that repository |
| Signed out at random | Memory session store on a multi-instance host — configure Upstash |
| Repository missing from the picker | `/api/repos` lists only repositories the App is installed on |
| `GITHUB_APP_PRIVATE_KEY is not a valid PEM` | The value got truncated or newline-mangled; base64 the whole file instead |

---

## Operating notes

- **Rate limits**: 20 pull requests per hour per user and per repository, 300
  reads per hour. Adjust in `lib/rate-limit.js`.
- **Logs** are one JSON object per line with a stable `event` field, so
  `create_pr.failed` and `session.decrypt_failed` are greppable.
- **User content is never logged** — edit text is deliberately excluded.
- **Rotating `TOKEN_SECRET`** invalidates every session. Existing sessions
  fail to decrypt, are treated as absent, and editors simply reconnect.
