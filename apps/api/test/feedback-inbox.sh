#!/usr/bin/env bash
#
# The inbox: triage, ownership, and the queues a shared inbox is opened to
# look at.
#
#   npm run dev            # in apps/api
#   bash test/feedback-inbox.sh
#
# Before this, the inbox could read and resolve but not *assign* — so two
# people had no way to avoid picking up the same comment. The properties
# under test are the ones that only hold across the real pipeline: that an
# assignee must be a member, that `me` is resolved from the session rather
# than taken from the caller, and that the counts match the queues.
#
# Opening an issue on a provider is not tested here: it needs live
# credentials, and `test/github.sh` is where provider calls belong. What is
# tested is that a comment with no environment refuses rather than 500s.

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; FAILED=1; }
FAILED=0
code() { curl -s -o /tmp/fbi.json -w '%{http_code}' "$@"; }
body() { cat /tmp/fbi.json; }
jq_() { node -pe "try{JSON.stringify(eval('(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")))$1'))}catch(e){'null'}" < /tmp/fbi.json; }

signin() {
  curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' -d "{\"email\":\"$1\"}" >/dev/null
  local t; t=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
  curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' -d "{\"token\":\"$t\"}" -c "/tmp/cki-$1" >/dev/null
  grep ie_session "/tmp/cki-$1" | awk '{print $7}'
}

STAMP=$(date +%s)
A_TOK=$(signin "inbox-a-$STAMP@example.test")
S_TOK=$(signin "inbox-stranger-$STAMP@example.test")
A_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $A_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
A_UID=$(curl -s "$API/auth/me" -H "authorization: Bearer $A_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).user.id')
S_UID=$(curl -s "$API/auth/me" -H "authorization: Bearer $S_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).user.id')
AH="authorization: Bearer $A_TOK"; AO="x-organisation-id: $A_ORG"
HOST="inbox-$STAMP.example"

CONN=$(psql "$DB" -At -c "insert into connection (id, organisation_id, provider, account_login, external_id) values (gen_random_uuid(), '$A_ORG', 'github', 'inbox$STAMP', 'i$STAMP') returning id" | head -1 | tr -d '[:space:]')
ENV_ID=$(curl -s -X POST "$API/sites" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d "{\"name\":\"Inbox\",\"hostname\":\"$HOST\",\"label\":\"production\",\"repository\":\"inbox$STAMP/site\",\"branch\":\"main\",\"connectionId\":\"$CONN\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

# A second member, to assign to.
B_TOK=$(signin "inbox-b-$STAMP@example.test")
B_EMAIL="inbox-b-$STAMP@example.test"
B_UID=$(psql "$DB" -At -c "select id from app_user where email='$B_EMAIL'" | tr -d '[:space:]')
psql "$DB" -q -c "insert into membership (organisation_id, user_id, role) values ('$A_ORG','$B_UID','editor') on conflict do nothing"

file() { # message -> id
  curl -s -X POST "$API/feedback" -H "$AH" -H 'content-type: application/json' \
    -d "{\"environmentId\":\"$ENV_ID\",\"message\":\"$1\",\"pageUrl\":\"https://$HOST/pricing\",\"viewport\":\"1440x900\"}" \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'
}
ONE=$(file "The price is wrong.")
TWO=$(file "The footer link is dead.")

echo "── the browser string comes from the header, not the body ──"
# It was hardcoded null. A client that declares its own browser can declare
# any browser, so the body is not where this may come from.
UA=$(psql "$DB" -At -c "select coalesce(user_agent,'-') from feedback where id='$ONE'" | tr -d '\n')
case "$UA" in curl*) pass "recorded as sent by the client ($UA)" ;; *) fail "userAgent captured" "$UA" ;; esac

echo "── a body-supplied userAgent is refused outright ──"
c=$(code -X POST "$API/feedback" -H "$AH" -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$ENV_ID\",\"message\":\"x\",\"pageUrl\":\"https://$HOST/\",\"userAgent\":\"Not A Real Browser\"}")
case "$(body)" in *'should not exist'*) pass "the field is not accepted ($c)" ;; *) fail "userAgent refused" "$c $(body)" ;; esac

echo "── a new comment starts unassigned ──"
c=$(code "$API/feedback/$ONE" -H "$AH" -H "$AO")
[ "$(jq_ '.assignedTo')" = "null" ] && pass "nobody owns it yet" || fail "unassigned" "$(body)"
[ "$(jq_ '.hasScreenshot')" = "false" ] && pass "and has no screenshot" || fail "hasScreenshot" "$(body)"

echo "── assigning it ──"
c=$(code -X PATCH "$API/feedback/$ONE/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d "{\"assigneeId\":\"$B_UID\"}")
[ "$c" = "200" ] && pass "accepted ($c)" || fail "assign" "$c $(body)"
[ "$(jq_ '.assignedTo.id')" = "\"$B_UID\"" ] && pass "the owner is returned" || fail "assignedTo" "$(body)"
[ "$(jq_ '.assignedAt')" != "null" ] && pass "and when it was handed over" || fail "assignedAt" "$(body)"

echo "── somebody outside the organisation cannot be assigned ──"
# Otherwise a comment ends up owned by a person who cannot see it.
c=$(code -X PATCH "$API/feedback/$ONE/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d "{\"assigneeId\":\"$S_UID\"}")
[ "$c" = "400" ] && pass "refused ($c)" || fail "stranger refused" "$c $(body)"
c=$(code "$API/feedback/$ONE" -H "$AH" -H "$AO")
[ "$(jq_ '.assignedTo.id')" = "\"$B_UID\"" ] && pass "the previous owner is untouched" || fail "unchanged" "$(body)"

echo "── unassigning ──"
c=$(code -X PATCH "$API/feedback/$TWO/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d "{\"assigneeId\":\"$A_UID\"}")
[ "$c" = "200" ] && pass "assigned to self ($c)" || fail "self assign" "$c $(body)"
c=$(code -X PATCH "$API/feedback/$TWO/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d '{"assigneeId":null}')
[ "$c" = "200" ] && pass "put back down ($c)" || fail "unassign" "$c $(body)"
[ "$(jq_ '.assignedTo')" = "null" ] && pass "owner cleared" || fail "cleared" "$(body)"
[ "$(jq_ '.assignedAt')" = "null" ] && pass "and the timestamp with it" || fail "assignedAt cleared" "$(body)"

echo "── an absent assigneeId is not the same as null ──"
# @IsOptional would have skipped validation for an explicit null, making
# "unassign" and "field missing" indistinguishable.
c=$(code -X PATCH "$API/feedback/$TWO/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' -d '{}')
[ "$c" = "400" ] && pass "an empty body is refused ($c)" || fail "empty body" "$c $(body)"

echo "── a malformed assignee is refused, not passed to the database ──"
c=$(code -X PATCH "$API/feedback/$ONE/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d '{"assigneeId":"not-a-uuid"}')
[ "$c" = "400" ] && pass "refused ($c)" || fail "malformed uuid" "$c $(body)"

echo "── the queues ──"
c=$(code -X PATCH "$API/feedback/$TWO/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d "{\"assigneeId\":\"$A_UID\"}")

c=$(code "$API/feedback?assignedTo=me" -H "$AH" -H "$AO")
[ "$(jq_ '.items.length')" = "1" ] && pass "mine holds the one assigned to me" || fail "mine" "$(body)"
[ "$(jq_ '.items[0].id')" = "\"$TWO\"" ] && pass "and it is the right one" || fail "mine content" "$(body)"

c=$(code "$API/feedback?assignedTo=none" -H "$AH" -H "$AO")
case "$(jq_ '.items')" in
  *"$ONE"*) fail "unassigned queue" "includes a comment that has an owner" ;;
  *) pass "unassigned excludes what is owned" ;;
esac

echo "── the counts agree with the queues ──"
c=$(code "$API/feedback" -H "$AH" -H "$AO")
[ "$(jq_ '.counts.mine')" = "1" ] && pass "mine counts one" || fail "counts.mine" "$(body)"
UNASSIGNED=$(jq_ '.counts.unassigned')
[ "$UNASSIGNED" != "null" ] && pass "unassigned is counted ($UNASSIGNED)" || fail "counts.unassigned" "$(body)"

echo "── 'me' cannot be pointed at a colleague ──"
# It is resolved from the session, so naming a user id reaches only that
# user's queue and never a shortcut into somebody else's.
c=$(code "$API/feedback?assignedTo=$B_UID" -H "$AH" -H "$AO")
[ "$c" = "200" ] && pass "filtering by an explicit id works ($c)" || fail "explicit id" "$c $(body)"
c=$(code "$API/feedback?assignedTo=../admin" -H "$AH" -H "$AO")
[ "$c" = "400" ] && pass "a non-id is refused ($c)" || fail "bad assignedTo" "$c $(body)"

echo "── resolving clears ownership history correctly ──"
c=$(code -X PATCH "$API/feedback/$ONE/status" -H "$AH" -H "$AO" -H 'content-type: application/json' -d '{"status":"resolved"}')
[ "$(jq_ '.resolvedBy.id')" = "\"$A_UID\"" ] && pass "who resolved it is recorded" || fail "resolvedBy" "$(body)"
# Resolved work is not on anybody's plate, or the number only ever grows.
c=$(code "$API/feedback" -H "$AH" -H "$AO")
[ "$(jq_ '.counts.mine')" = "1" ] && pass "a resolved item leaves the 'mine' count" || fail "mine after resolve" "$(body)"

echo "── promoting a comment with no environment refuses rather than 500s ──"
ORPHAN=$(file "no environment")
psql "$DB" -q -c "update feedback set environment_id=null where id='$ORPHAN'"
c=$(code -X POST "$API/feedback/$ORPHAN/issue" -H "$AH" -H "$AO" -H 'content-type: application/json' -d '{}')
[ "$c" = "400" ] && pass "refused with a reason ($c)" || fail "orphan promote" "$c $(body)"
case "$(body)" in *"no repository"*) pass "and says why" ;; *) fail "reason given" "$(body)" ;; esac

echo "── a comment already promoted is not promoted twice ──"
c=$(code -X POST "$API/feedback/$TWO/promote" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d '{"url":"https://github.com/acme/site/issues/7"}')
[ "$c" = "201" ] && pass "recording an external issue works ($c)" || fail "promote" "$c $(body)"
c=$(code -X POST "$API/feedback/$TWO/issue" -H "$AH" -H "$AO" -H 'content-type: application/json' -d '{}')
[ "$c" = "400" ] && pass "opening a second one is refused ($c)" || fail "double promote" "$c $(body)"

echo "── a malformed id is a 400, not a 500 from the uuid column ──"
c=$(code -X PATCH "$API/feedback/not-a-uuid/assignee" -H "$AH" -H "$AO" -H 'content-type: application/json' -d '{"assigneeId":null}')
[ "$c" = "400" ] && pass "refused by the pipe ($c)" || fail "malformed id" "$c"

echo "── every one of these is scoped to the organisation ──"
S_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $S_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
for route in "$API/feedback/$ONE" "$API/feedback/$ONE/screenshot"; do
  c=$(code "$route" -H "authorization: Bearer $S_TOK" -H "x-organisation-id: $S_ORG")
  [ "$c" = "404" ] && pass "$(basename "$route") is 404 for another organisation" || fail "scope" "$route $c"
done
c=$(code -X PATCH "$API/feedback/$ONE/assignee" -H "authorization: Bearer $S_TOK" -H "x-organisation-id: $S_ORG" \
  -H 'content-type: application/json' -d '{"assigneeId":null}')
[ "$c" = "404" ] && pass "assignment is 404 for another organisation" || fail "assign scope" "$c $(body)"

echo
[ "$FAILED" = "0" ] && printf '\033[32mAll inbox checks passed.\033[0m\n' \
  || { printf '\033[31mSome checks failed.\033[0m\n'; exit 1; }
