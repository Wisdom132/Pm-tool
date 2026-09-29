#!/usr/bin/env bash
#
# The extension's whole path, as the extension now walks it.
#
#   npm run dev            # in apps/api
#   bash test/extension-flow.sh
#
# The property under test: the extension never names a repository. It gets a
# token from the dashboard, asks what a hostname is, and sends an
# environmentId. Naming a repository was the old service's design, and it let
# any editor write to any repository their organisation could reach.

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; FAILED=1; }
FAILED=0
code() { curl -s -o /tmp/ext.json -w '%{http_code}' "$@"; }
body() { cat /tmp/ext.json; }

STAMP=$(date +%s)
EMAIL="ext-$STAMP@example.test"
HOST="ext-$STAMP.example"

# ── the dashboard half: sign in, connect, register a site ─────────
curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" >/dev/null
LINK=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' -d "{\"token\":\"$LINK\"}" -c /tmp/ext-ck >/dev/null
DASH=$(grep ie_session /tmp/ext-ck | awk '{print $7}')
ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $DASH" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
CONN=$(psql "$DB" -At -c "insert into connection (id, organisation_id, provider, account_login, external_id) values (gen_random_uuid(), '$ORG', 'github', 'extco', 'e$STAMP') returning id" | head -1 | tr -d '[:space:]')
curl -s -X POST "$API/sites" -H "authorization: Bearer $DASH" -H "x-organisation-id: $ORG" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Ext\",\"hostname\":\"$HOST\",\"label\":\"production\",\"repository\":\"extco/site\",\"branch\":\"main\",\"connectionId\":\"$CONN\"}" >/dev/null

echo "── the dashboard mints a token for the extension ──"
c=$(code -X POST "$API/auth/extension-tokens" -H "authorization: Bearer $DASH" \
  -H 'content-type: application/json' -d '{"label":"Chrome on CI"}')
EXT=$(body | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
[ "$c" = "201" ] && [ -n "$EXT" ] && pass "token issued" || fail "token issued" "$c $(body)"
[ "$EXT" != "$DASH" ] && pass "it is a distinct session, not the dashboard's" || fail "distinct session" "same token"

echo "── it is listed, so it can be revoked ──"
code "$API/auth/extension-tokens" -H "authorization: Bearer $DASH" >/dev/null
TOK_ID=$(body | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')
case "$(body)" in *'Chrome on CI'*) pass "listed with its label" ;; *) fail "listed with label" "$(body)" ;; esac
case "$(body)" in *'"token"'*) fail "the list must not contain the token itself" "$(body)" ;; *) pass "the list carries no token value" ;; esac

echo "── step 1: the extension asks what this hostname is ──"
c=$(code "$API/resolve?hostname=$HOST" -H "authorization: Bearer $EXT")
ENV_ID=$(body | node -pe 'JSON.parse(require("fs").readFileSync(0)).environmentId')
[ "$c" = "200" ] && [ -n "$ENV_ID" ] && pass "resolved to environment $ENV_ID" || fail "resolve" "$c $(body)"
case "$(body)" in *'"repository":"extco/site"'*) pass "the server names the repository, not the page" ;; *) fail "repository reported" "$(body)" ;; esac

echo "── an unregistered hostname is answered, not errored ──"
c=$(code "$API/resolve?hostname=not-registered-$STAMP.example" -H "authorization: Bearer $EXT")
case "$c$(body)" in 200*'"known":false'*) pass "known:false with a reason ($c)" ;; *) fail "unregistered answered" "$c $(body)" ;; esac

echo "── step 2: every editing call takes the environment id ──"
for route in "editing/branches?environmentId=$ENV_ID" "editing/file?environmentId=$ENV_ID&path=README.md" "editing/preview-status?environmentId=$ENV_ID&commit=abc1234"; do
  c=$(code "$API/$route" -H "authorization: Bearer $EXT")
  # 4xx/5xx from GitHub is fine — the App is not installed on extco. What
  # matters is that it is past authorisation, not a 400 or 404.
  case "$c" in 401|400|404) fail "accepted $(echo "$route" | cut -d? -f1)" "$c $(body)" ;; *) pass "accepted $(echo "$route" | cut -d? -f1) ($c)" ;; esac
done

echo "── a repository named by the client is rejected outright ──"
c=$(code -X POST "$API/editing/change-requests" -H "authorization: Bearer $EXT" \
  -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$ENV_ID\",\"pageUrl\":\"https://$HOST/\",\"repo\":\"attacker/evil\",\"edits\":[{\"sourceFile\":\"a.ts\",\"originalText\":\"a\",\"newText\":\"b\"}]}")
case "$(body)" in *'should not exist'*) pass "an unexpected 'repo' field is refused ($c)" ;; *) fail "repo field refused" "$c $(body)" ;; esac

echo "── revoking the token stops it immediately ──"
curl -s -X DELETE "$API/auth/extension-tokens/$TOK_ID" -H "authorization: Bearer $DASH" >/dev/null
c=$(code "$API/resolve?hostname=$HOST" -H "authorization: Bearer $EXT")
[ "$c" = "401" ] && pass "revoked token is 401" || fail "revoked token refused" "$c $(body)"
c=$(code "$API/auth/me" -H "authorization: Bearer $DASH")
[ "$c" = "200" ] && pass "and the dashboard session is untouched" || fail "dashboard session untouched" "$c"

echo
[ "$FAILED" = "0" ] && echo "all checks passed" || echo "FAILURES ABOVE"
