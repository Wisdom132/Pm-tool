#!/usr/bin/env bash
#
# The invitation flow, from sending to joining.
#
#   npm run dev            # in apps/api
#   bash test/invitations.sh
#
# The gap this closes: acceptance used to happen only on sign-in, so a person
# who was already signed in when invited had a pending invitation, no
# membership, and a link that appeared to do nothing.

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; FAILED=1; }
FAILED=0
code() { curl -s -o /tmp/inv.json -w '%{http_code}' "$@"; }
body() { cat /tmp/inv.json; }
jq_() { node -pe "try{JSON.stringify(eval('(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")))$1'))}catch(e){'null'}" < /tmp/inv.json; }

signin() {
  curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' -d "{\"email\":\"$1\"}" >/dev/null
  local t; t=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
  curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' -d "{\"token\":\"$t\"}" -c "/tmp/ck-$1" >/dev/null
  grep ie_session "/tmp/ck-$1" | awk '{print $7}'
}

# Reads the invitation token out of the dev mailer's log line.
last_invite_token() {
  grep -o "invitations/[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d/ -f2
}

STAMP=$(date +%s)
OWNER="inv-owner-$STAMP@example.test"
NEWBIE="inv-new-$STAMP@example.test"
EXISTING="inv-existing-$STAMP@example.test"
STRANGER="inv-stranger-$STAMP@example.test"

A_TOK=$(signin "$OWNER")
ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $A_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
ORG_NAME=$(curl -s "$API/organisation" -H "authorization: Bearer $A_TOK" -H "x-organisation-id: $ORG" | node -pe 'JSON.parse(require("fs").readFileSync(0)).name')
H="authorization: Bearer $A_TOK"; O="x-organisation-id: $ORG"

echo "── the emailed link matches the dashboard route ──"
curl -s -X POST "$API/members/invitations" -H "$H" -H "$O" -H 'content-type: application/json' \
  -d "{\"email\":\"$NEWBIE\",\"role\":\"editor\"}" >/dev/null
LINK=$(grep -o "http[^ ]*invitations/[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1)
case "$LINK" in
  */invitations/*) pass "link is $LINK" ;;
  *) fail "link shape" "$LINK" ;;
esac
TOKEN=$(last_invite_token)

echo "── anyone holding the link can see what it offers ──"
c=$(code "$API/auth/invitations/$TOKEN")
[ "$c" = "200" ] && pass "public lookup works without a session" || fail "public lookup" "$c $(body)"
[ "$(jq_ '.status')" = '"pending"' ] && pass "status pending" || fail "status" "$(body)"
[ "$(jq_ '.email')" = "\"$NEWBIE\"" ] && pass "names the invited address" || fail "email" "$(body)"
[ "$(jq_ '.organisation.name')" = "\"$ORG_NAME\"" ] && pass "names the organisation: $ORG_NAME" || fail "organisation" "$(body)"

echo "── but not more than it should ──"
case "$(body)" in
  *members*|*sites*|*tokenHash*|*teamIds*) fail "the offer leaks more than needed" "$(body)" ;;
  *) pass "no member list, site list or token hash" ;;
esac

echo "── a guessed token is a 404, not a hint ──"
c=$(code "$API/auth/invitations/definitely-not-a-real-token")
[ "$c" = "404" ] && pass "unknown token 404s" || fail "unknown token" "$c $(body)"

echo "── signing in as the invitee joins them ──"
B_TOK=$(signin "$NEWBIE")
ROLE=$(psql "$DB" -At -c "select m.role from membership m join app_user u on u.id=m.user_id where u.email='$NEWBIE' and m.organisation_id='$ORG'" | tr -d '[:space:]')
[ "$ROLE" = "editor" ] && pass "membership created on sign-in (editor)" || fail "membership on sign-in" "$ROLE"
c=$(code "$API/auth/invitations/$TOKEN")
[ "$(jq_ '.status')" = '"accepted"' ] && pass "the link now reports accepted" || fail "status accepted" "$(body)"

echo "── the gap this closes: already signed in when invited ──"
C_TOK=$(signin "$EXISTING")
BEFORE=$(psql "$DB" -At -c "select count(*) from membership m join app_user u on u.id=m.user_id where u.email='$EXISTING' and m.organisation_id='$ORG'" | tr -d '[:space:]')
curl -s -X POST "$API/members/invitations" -H "$H" -H "$O" -H 'content-type: application/json' \
  -d "{\"email\":\"$EXISTING\",\"role\":\"admin\"}" >/dev/null
TOKEN2=$(last_invite_token)
[ "$BEFORE" = "0" ] && pass "not a member yet, and already signed in elsewhere" || fail "precondition" "$BEFORE"

c=$(code -X POST "$API/auth/invitations/$TOKEN2/accept" -H "authorization: Bearer $C_TOK")
[ "$c" = "201" ] && pass "accepted without signing out and back in ($c)" || fail "explicit accept" "$c $(body)"
AFTER=$(psql "$DB" -At -c "select m.role from membership m join app_user u on u.id=m.user_id where u.email='$EXISTING' and m.organisation_id='$ORG'" | tr -d '[:space:]')
[ "$AFTER" = "admin" ] && pass "membership created with the invited role (admin)" || fail "role after accept" "$AFTER"
T=$(psql "$DB" -At -c "select t.name from team_member tm join team t on t.id=tm.team_id join app_user u on u.id=tm.user_id where u.email='$EXISTING' and t.organisation_id='$ORG'" | tr -d '[:space:]')
[ -n "$T" ] && pass "and placed in a team: $T" || fail "team placement" "(none)"

echo "── accepting twice is not an error, and records once ──"
EVENTS_BEFORE=$(psql "$DB" -At -c "select count(*) from audit_event where organisation_id='$ORG' and action='invitation.accepted' and subject='$EXISTING'" | tr -d '[:space:]')
c=$(code -X POST "$API/auth/invitations/$TOKEN2/accept" -H "authorization: Bearer $C_TOK")
EVENTS_AFTER=$(psql "$DB" -At -c "select count(*) from audit_event where organisation_id='$ORG' and action='invitation.accepted' and subject='$EXISTING'" | tr -d '[:space:]')
[ "$c" = "201" ] && [ "$(jq_ '.alreadyAccepted')" = "true" ] && pass "second accept reports alreadyAccepted" || fail "idempotent accept" "$c $(body)"
[ "$EVENTS_BEFORE" = "$EVENTS_AFTER" ] && pass "no duplicate audit event ($EVENTS_AFTER)" || fail "audit written twice" "$EVENTS_BEFORE then $EVENTS_AFTER"

echo "── a forwarded link cannot be redeemed by someone else ──"
curl -s -X POST "$API/members/invitations" -H "$H" -H "$O" -H 'content-type: application/json' \
  -d "{\"email\":\"forwarded-$STAMP@example.test\",\"role\":\"admin\"}" >/dev/null
TOKEN3=$(last_invite_token)
D_TOK=$(signin "$STRANGER")
c=$(code -X POST "$API/auth/invitations/$TOKEN3/accept" -H "authorization: Bearer $D_TOK")
[ "$c" = "403" ] && pass "a different account is refused ($c)" || fail "stranger refused" "$c $(body)"
case "$(body)" in *"forwarded-$STAMP@example.test"*) pass "and told which address it was for" ;; *) fail "names the address" "$(body)" ;; esac
N=$(psql "$DB" -At -c "select count(*) from membership m join app_user u on u.id=m.user_id where u.email='$STRANGER'" | tr -d '[:space:]')
[ "$N" = "1" ] && pass "the stranger gained no membership in this org" || fail "stranger memberships" "$N"

echo "── an expired invitation reports expired, not an error ──"
psql "$DB" -q -c "update invitation set expires_at = now() - interval '1 day' where email = 'forwarded-$STAMP@example.test'" >/dev/null
c=$(code "$API/auth/invitations/$TOKEN3")
[ "$c" = "200" ] && [ "$(jq_ '.status')" = '"expired"' ] && pass "reported as expired ($c)" || fail "expired status" "$c $(body)"
c=$(code -X POST "$API/auth/invitations/$TOKEN3/accept" -H "$H")
[ "$c" = "403" ] || [ "$c" = "400" ] && pass "and cannot be accepted ($c)" || fail "expired accept refused" "$c $(body)"

echo
[ "$FAILED" = "0" ] && echo "all checks passed" || echo "FAILURES ABOVE"
