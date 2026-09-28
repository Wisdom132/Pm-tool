#!/usr/bin/env bash
#
# Tenant isolation for provider connections, against a running API.
#
#   npm run dev            # in apps/api
#   bash test/connections-isolation.sh
#
# Not a unit test: the questions it asks — can another organisation see this
# connection, can a signed state be replayed by someone else, does a revoke
# actually stop a connection working — are only meaningful against the real
# guard stack, the real database and the real router. It reads sign-in tokens
# out of the dev log, so it needs the API's own log at /tmp/ie-api.log.
#
set -u
API=http://localhost:3333/api
# psql rejects Prisma's ?schema= parameter, so strip the query string.
DB=$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"' | cut -d? -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     got: %s\n' "$1" "$2"; FAILED=1; }
FAILED=0

# Sign in, returning a session token. Reads the login token straight from the
# database, which is what the emailed link would carry.
signin() {
  local email=$1
  curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\"}" > /dev/null
  local hash
  hash=$(psql "$DB" -At -c \
    "select token_hash from login_token where email='$email' and consumed_at is null order by created_at desc limit 1" \
    | tr -d '[:space:]')
  # The raw token only exists in the log line, so take it from there.
  local token
  token=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
  curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' \
    -d "{\"token\":\"$token\"}" -c "/tmp/ie-cookie-$email.txt" > /dev/null
  grep ie_session "/tmp/ie-cookie-$email.txt" | awk '{print $7}'
}

# Start from a known state: a leftover connection from a previous run hits
# the (organisation, provider, external_id) unique constraint and the insert
# below silently returns nothing.
psql "$DB" -q -c "delete from site_environment where hostname = 'alpha.example'" > /dev/null 2>&1
psql "$DB" -q -c "delete from connection where external_id = '4242'" > /dev/null 2>&1

echo "── sign in two unrelated organisations ──"
A_TOKEN=$(signin alpha-admin@example.test)
B_TOKEN=$(signin beta-admin@example.test)
A_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $A_TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
B_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $B_TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
echo "  alpha org $A_ORG"
echo "  beta  org $B_ORG"
[ -n "$A_ORG" ] && [ "$A_ORG" != "$B_ORG" ] && pass "two distinct organisations" || fail "distinct orgs" "$A_ORG / $B_ORG"

echo "── install URL carries a signed state ──"
URL=$(curl -s -X POST "$API/connections/github/install-url" \
  -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG" | node -pe 'JSON.parse(require("fs").readFileSync(0)).url || ""')
case "$URL" in
  *state=*) pass "install URL includes state" ;;
  *) fail "install URL includes state" "$URL" ;;
esac
STATE=$(printf '%s' "$URL" | sed 's/.*state=//')

echo "── the state names alpha, not whoever redeems it ──"
PAYLOAD=$(printf '%s' "$STATE" | cut -d. -f1 | base64 -d 2>/dev/null)
case "$PAYLOAD" in
  *"$A_ORG"*) pass "state is bound to the requesting organisation" ;;
  *) fail "state bound to org" "$PAYLOAD" ;;
esac

echo "── beta cannot redeem alpha's state ──"
OUT=$(curl -s -i "$API/connections/github/callback?installation_id=999&state=$STATE" \
  -H "authorization: Bearer $B_TOKEN" | grep -i '^location:')
case "$OUT" in
  *"started+by+a+different+person"*|*"started%20by%20a%20different%20person"*) pass "state replay by another user refused" ;;
  *) fail "state replay refused" "$OUT" ;;
esac

echo "── a forged state is refused ──"
OUT=$(curl -s -i "$API/connections/github/callback?installation_id=999&state=$(printf '%s' "{\"organisationId\":\"$A_ORG\",\"userId\":\"x\",\"exp\":99999999999999}" | base64 | tr -d '=' | tr '/+' '_-').deadbeef" \
  -H "authorization: Bearer $A_TOKEN" | grep -i '^location:')
case "$OUT" in
  *"expired+or+is+not+valid"*|*"expired%20or%20is%20not%20valid"*) pass "forged state refused" ;;
  *) fail "forged state refused" "$OUT" ;;
esac

echo "── connections are scoped per organisation ──"
# Plant a connection for alpha directly, since a real install needs GitHub.
CONN=$(psql "$DB" -At -c "insert into connection (id, organisation_id, provider, account_login, external_id) values (gen_random_uuid(), '$A_ORG', 'github', 'alphaco', '4242') returning id" | head -1 | tr -d '[:space:]')
[ -n "$CONN" ] && pass "planted a connection for alpha" || fail "planted connection" "(insert returned nothing)"
A_LIST=$(curl -s "$API/connections" -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG")
B_LIST=$(curl -s "$API/connections" -H "authorization: Bearer $B_TOKEN" -H "x-organisation-id: $B_ORG")
case "$A_LIST" in *alphaco*) pass "alpha sees its own connection" ;; *) fail "alpha sees own connection" "$A_LIST" ;; esac
case "$B_LIST" in *alphaco*) fail "beta must not see alpha's connection" "$B_LIST" ;; *) pass "beta cannot see alpha's connection" ;; esac

echo "── credentials never appear in a response ──"
case "$A_LIST" in *credential*) fail "credentials leaked in list" "$A_LIST" ;; *) pass "no credentials field in the response" ;; esac

echo "── beta cannot name alpha's connection id ──"
OUT=$(curl -s -o /dev/null -w '%{http_code}' "$API/connections/$CONN/repositories" \
  -H "authorization: Bearer $B_TOKEN" -H "x-organisation-id: $B_ORG")
[ "$OUT" = "404" ] && pass "cross-org connection id is 404, not 403" || fail "cross-org id 404" "$OUT"

echo "── a malformed id is a 400, not a database error ──"
OUT=$(curl -s -o /dev/null -w '%{http_code}' "$API/connections/not-a-uuid/repositories" \
  -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG")
[ "$OUT" = "400" ] && pass "malformed id rejected at the boundary" || fail "malformed id is 400" "$OUT"

echo "── beta cannot spoof alpha's organisation header ──"
OUT=$(curl -s -o /dev/null -w '%{http_code}' "$API/connections" \
  -H "authorization: Bearer $B_TOKEN" -H "x-organisation-id: $A_ORG")
[ "$OUT" = "403" ] && pass "spoofed organisation header refused" || fail "spoofed header refused" "$OUT"

echo "── revoke is refused while a site still uses it ──"
SITE=$(curl -s -X POST "$API/sites" -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Alpha\",\"hostname\":\"alpha.example\",\"label\":\"production\",\"repository\":\"alphaco/site\",\"branch\":\"main\",\"connectionId\":\"$CONN\"}")
case "$SITE" in *alpha.example*) pass "site registered against the connection" ;; *) fail "site registered" "$SITE" ;; esac
OUT=$(curl -s -X DELETE "$API/connections/$CONN" -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG")
case "$OUT" in *"still use this connection"*) pass "revoke blocked while sites depend on it" ;; *) fail "revoke blocked" "$OUT" ;; esac

echo "── revoke succeeds once the site is gone ──"
SITE_ID=$(printf '%s' "$SITE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s -X DELETE "$API/sites/$SITE_ID" -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG" > /dev/null
OUT=$(curl -s -X DELETE "$API/connections/$CONN" -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG")
case "$OUT" in *revokedAt*) pass "revoke succeeds with no dependants" ;; *) fail "revoke succeeds" "$OUT" ;; esac

echo "── a revoked connection cannot be used again ──"
OUT=$(curl -s -o /dev/null -w '%{http_code}' "$API/connections/$CONN/repositories" \
  -H "authorization: Bearer $A_TOKEN" -H "x-organisation-id: $A_ORG")
[ "$OUT" = "404" ] && pass "revoked connection is unusable" || fail "revoked unusable" "$OUT"

echo
[ "$FAILED" = "0" ] && echo "all checks passed" || echo "FAILURES ABOVE"
