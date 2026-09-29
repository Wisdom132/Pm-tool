#!/usr/bin/env bash
#
# Teams, people, invitations, audit and organisation settings, against a
# running API.
#
#   npm run dev            # in apps/api
#   bash test/members-teams.sh
#
# The cases worth having: an organisation must not be able to lose its last
# admin, you must not be able to change your own role or remove yourself, and
# an invited person must actually end up with a membership.

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     got: %s\n' "$1" "$2"; FAILED=1; }
FAILED=0
code() { curl -s -o /tmp/mt.json -w '%{http_code}' "$@"; }
body() { cat /tmp/mt.json; }
jq_() { node -pe "try{JSON.stringify(eval('(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")))$1'))}catch(e){'null'}" < /tmp/mt.json; }

signin() {
  curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' -d "{\"email\":\"$1\"}" >/dev/null
  local t; t=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
  curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' -d "{\"token\":\"$t\"}" -c "/tmp/ck-$1" >/dev/null
  grep ie_session "/tmp/ck-$1" | awk '{print $7}'
}

# ── a fresh organisation, so admin counts are known ───────────────
STAMP=$(date +%s)
OWNER="owner-$STAMP@example.test"
MATE="mate-$STAMP@example.test"

A_TOK=$(signin "$OWNER")
ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $A_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
H="authorization: Bearer $A_TOK"; O="x-organisation-id: $ORG"
OWNER_ID=$(psql "$DB" -At -c "select id from app_user where email='$OWNER'" | head -1 | tr -d '[:space:]')

echo "── a new organisation starts with one admin and a default team ──"
code "$API/teams" -H "$H" -H "$O" >/dev/null
[ "$(jq_ '.length')" = "1" ] && [ "$(jq_ '[0].isDefault')" = "true" ] && pass "one default team: $(jq_ '[0].name')" || fail "default team" "$(body)"

echo "── the last admin cannot demote themselves ──"
c=$(code -X PATCH "$API/members/$OWNER_ID/role" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"role":"editor"}')
case "$c$(body)" in *"cannot change your own role"*) pass "self-demotion refused ($c)" ;; *) fail "self-demotion refused" "$c $(body)" ;; esac

echo "── the last admin cannot remove themselves ──"
c=$(code -X DELETE "$API/members/$OWNER_ID" -H "$H" -H "$O")
case "$c$(body)" in *"cannot remove yourself"*) pass "self-removal refused ($c)" ;; *) fail "self-removal refused" "$c $(body)" ;; esac

echo "── inviting someone ──"
c=$(code -X POST "$API/members/invitations" -H "$H" -H "$O" -H 'content-type: application/json' -d "{\"email\":\"$MATE\",\"role\":\"admin\"}")
[ "$c" = "201" ] && pass "invitation created" || fail "invitation created" "$c $(body)"
case "$(body)" in *token*) fail "the token must not be returned to the inviter" "$(body)" ;; *) pass "no token in the response" ;; esac

echo "── they appear as invited, not active ──"
code "$API/members" -H "$H" -H "$O" >/dev/null
INVITED=$(node -pe "JSON.parse(require('fs').readFileSync(0)).filter(m=>m.email==='$MATE').map(m=>m.status+'/'+m.kind).join()" < /tmp/mt.json)
[ "$INVITED" = "invited/invitation" ] && pass "listed as invited" || fail "listed as invited" "$INVITED"

echo "── inviting the same address twice supersedes, not duplicates ──"
code -X POST "$API/members/invitations" -H "$H" -H "$O" -H 'content-type: application/json' -d "{\"email\":\"$MATE\",\"role\":\"editor\"}" >/dev/null
N=$(psql "$DB" -At -c "select count(*) from invitation where email='$MATE' and accepted_at is null" | tr -d '[:space:]')
[ "$N" = "1" ] && pass "one live invitation, not two" || fail "one live invitation" "$N"

echo "── the invitee signs in and actually gets a membership ──"
B_TOK=$(signin "$MATE")
MATE_ID=$(psql "$DB" -At -c "select id from app_user where email='$MATE'" | head -1 | tr -d '[:space:]')
ROLE=$(psql "$DB" -At -c "select role from membership where organisation_id='$ORG' and user_id='$MATE_ID'" | tr -d '[:space:]')
[ -n "$ROLE" ] && pass "membership created on sign-in (role $ROLE)" || fail "membership created on sign-in" "(none — the bug this fixes)"

echo "── and lands in the default team ──"
T=$(psql "$DB" -At -c "select t.name from team_member tm join team t on t.id=tm.team_id where tm.user_id='$MATE_ID' and t.organisation_id='$ORG'" | tr -d '[:space:]')
[ -n "$T" ] && pass "in team: $T" || fail "in default team" "(none)"

echo "── they see the organisation in /auth/me, and no personal one ──"
code "$API/auth/me" -H "authorization: Bearer $B_TOK" >/dev/null
[ "$(jq_ '.organisations.length')" = "1" ] && pass "exactly one organisation, the one they were invited to" || fail "one organisation" "$(jq_ '.organisations')"

echo "── promoting to admin, then demoting: both recorded ──"
c=$(code -X PATCH "$API/members/$MATE_ID/role" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"role":"admin"}')
[ "$c" = "200" ] && [ "$(jq_ '.role')" = '"admin"' ] && pass "promoted to admin" || fail "promote to admin" "$c $(body)"
c=$(code -X PATCH "$API/members/$MATE_ID/role" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"role":"editor"}')
[ "$c" = "200" ] && [ "$(jq_ '.role')" = '"editor"' ] && pass "demoted back to editor" || fail "demote to editor" "$c $(body)"

echo "── a no-op role change writes no audit event ──"
BEFORE=$(psql "$DB" -At -c "select count(*) from audit_event where organisation_id='$ORG' and action='member.role_changed'" | tr -d '[:space:]')
code -X PATCH "$API/members/$MATE_ID/role" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"role":"editor"}' >/dev/null
AFTER=$(psql "$DB" -At -c "select count(*) from audit_event where organisation_id='$ORG' and action='member.role_changed'" | tr -d '[:space:]')
[ "$BEFORE" = "$AFTER" ] && pass "setting the role it already has records nothing ($AFTER events)" || fail "no-op writes nothing" "$BEFORE then $AFTER"

echo "── with one admin again, demoting the other is refused ──"
c=$(code -X PATCH "$API/members/$OWNER_ID/role" -H "authorization: Bearer $B_TOK" -H "$O" -H 'content-type: application/json' -d '{"role":"editor"}')
[ "$c" = "403" ] && pass "an editor cannot change roles at all ($c)" || fail "editor cannot change roles" "$c $(body)"

echo "── teams: create, rename, set sites ──"
c=$(code -X POST "$API/teams" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"name":"Marketing"}')
TEAM=$(jq_ '.id' | tr -d '"')
[ "$c" = "201" ] && pass "created Marketing" || fail "create team" "$c $(body)"
c=$(code -X POST "$API/teams" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"name":"Marketing"}')
[ "$c" = "409" ] && pass "duplicate name refused" || fail "duplicate name refused" "$c"
c=$(code -X PUT "$API/teams/$TEAM/members" -H "$H" -H "$O" -H 'content-type: application/json' -d "{\"memberIds\":[\"$MATE_ID\"]}")
[ "$c" = "200" ] && pass "set members" || fail "set members" "$c $(body)"
c=$(code -X PUT "$API/teams/$TEAM/members" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"memberIds":["00000000-0000-4000-8000-000000000000"]}')
case "$c$(body)" in *"not in this organisation"*) pass "a stranger's id is refused, not silently dropped" ;; *) fail "stranger id refused" "$c $(body)" ;; esac

echo "── the default team cannot be deleted ──"
DEF=$(curl -s "$API/teams" -H "$H" -H "$O" | node -pe 'JSON.parse(require("fs").readFileSync(0)).find(t=>t.isDefault).id')
c=$(code -X DELETE "$API/teams/$DEF" -H "$H" -H "$O")
case "$c$(body)" in *"default team cannot be deleted"*) pass "default team protected ($c)" ;; *) fail "default team protected" "$c $(body)" ;; esac

echo "── audit: admin only, and it records what happened ──"
c=$(code "$API/audit" -H "authorization: Bearer $B_TOK" -H "$O")
[ "$c" = "403" ] && pass "an editor cannot read the audit log" || fail "editor cannot read audit" "$c"
code "$API/audit" -H "$H" -H "$O" >/dev/null
ACTIONS=$(node -pe "JSON.parse(require('fs').readFileSync(0)).events.map(e=>e.action).join(' ')" < /tmp/mt.json)
echo "     events: $ACTIONS"
for want in team.created invitation.created invitation.accepted member.role_changed organisation.created; do
  case "$ACTIONS" in *"$want"*) pass "recorded $want" ;; *) fail "recorded $want" "$ACTIONS" ;; esac
done

echo "── audit pagination uses a keyset cursor ──"
code "$API/audit?limit=2" -H "$H" -H "$O" >/dev/null
CUR=$(jq_ '.nextCursor' | tr -d '"')
[ -n "$CUR" ] && [ "$CUR" != "null" ] && pass "nextCursor returned: $CUR" || fail "nextCursor" "$(body)"
FIRST=$(jq_ '.events[0].id' | tr -d '"')
code "$API/audit?limit=2&cursor=$CUR" -H "$H" -H "$O" >/dev/null
SECOND=$(jq_ '.events[0].id' | tr -d '"')
[ "$FIRST" != "$SECOND" ] && pass "page two differs from page one" || fail "page two differs" "$FIRST vs $SECOND"

echo "── organisation settings ──"
c=$(code -X PATCH "$API/organisation" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"name":"Renamed Co"}')
[ "$c" = "200" ] && pass "renamed" || fail "rename" "$c $(body)"
c=$(code -X DELETE "$API/organisation" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"confirm":"wrong"}')
case "$c$(body)" in *'to confirm'*) pass "delete needs the name typed back ($c)" ;; *) fail "delete confirmation" "$c $(body)" ;; esac

echo "── feedback inbox is empty but answers ──"
c=$(code "$API/feedback" -H "$H" -H "$O")
[ "$c" = "200" ] && [ "$(jq_ '.counts.new')" = "0" ] && pass "inbox returns counts" || fail "feedback inbox" "$c $(body)"


# ── the property: an organisation cannot reach zero admins ────────
echo
echo "── an organisation cannot be left with no admin ──"
curl -s -X PATCH "$API/members/$MATE_ID/role" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"role":"admin"}' >/dev/null
# Two admins, so one demoting the other is legitimate and leaves exactly one.
c=$(code -X PATCH "$API/members/$OWNER_ID/role" -H "authorization: Bearer $B_TOK" -H "$O" -H 'content-type: application/json' -d '{"role":"editor"}')
ADMINS=$(psql "$DB" -At -c "select count(*) from membership where organisation_id='$ORG' and role='admin'" | tr -d '[:space:]')
[ "$c" = "200" ] && [ "$ADMINS" = "1" ] && pass "one admin may demote another, leaving one" || fail "demote other admin" "$c, $ADMINS admins"

# The remaining admin has no route to remove the last admin privilege:
# demoting themselves and removing themselves are both refused, and nobody
# else has the rights to do it to them.
c=$(code -X PATCH "$API/members/$MATE_ID/role" -H "authorization: Bearer $B_TOK" -H "$O" -H 'content-type: application/json' -d '{"role":"editor"}')
[ "$c" = "400" ] && pass "the sole admin cannot demote themselves" || fail "sole admin self-demote" "$c $(body)"
c=$(code -X DELETE "$API/members/$MATE_ID" -H "authorization: Bearer $B_TOK" -H "$O")
[ "$c" = "400" ] && pass "the sole admin cannot remove themselves" || fail "sole admin self-remove" "$c $(body)"
c=$(code -X PATCH "$API/members/$MATE_ID/role" -H "$H" -H "$O" -H 'content-type: application/json' -d '{"role":"editor"}')
[ "$c" = "403" ] && pass "a demoted editor cannot demote the admin either" || fail "editor cannot demote admin" "$c $(body)"
ADMINS=$(psql "$DB" -At -c "select count(*) from membership where organisation_id='$ORG' and role='admin'" | tr -d '[:space:]')
[ "$ADMINS" = "1" ] && pass "still exactly one admin after every attempt" || fail "admin count held" "$ADMINS"

echo
[ "$FAILED" = "0" ] && echo "all checks passed" || echo "FAILURES ABOVE"
