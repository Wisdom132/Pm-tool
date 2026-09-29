#!/usr/bin/env bash
#
# Feedback, from the extension to the inbox.
#
#   npm run dev            # in apps/api
#   bash test/feedback-intake.sh
#
# Until this existed the inbox had no producer, so it could only ever be
# empty. The property under test is the same one editing has: the client
# names an environment, never a site or an organisation.

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; FAILED=1; }
FAILED=0
code() { curl -s -o /tmp/fb.json -w '%{http_code}' "$@"; }
body() { cat /tmp/fb.json; }
jq_() { node -pe "try{JSON.stringify(eval('(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")))$1'))}catch(e){'null'}" < /tmp/fb.json; }

signin() {
  curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' -d "{\"email\":\"$1\"}" >/dev/null
  local t; t=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
  curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' -d "{\"token\":\"$t\"}" -c "/tmp/ck-$1" >/dev/null
  grep ie_session "/tmp/ck-$1" | awk '{print $7}'
}

STAMP=$(date +%s)
A_TOK=$(signin "fb-a-$STAMP@example.test")
B_TOK=$(signin "fb-b-$STAMP@example.test")
A_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $A_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
B_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $B_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')

mk() { # org token ext host -> environmentId
  local conn
  conn=$(psql "$DB" -At -c "insert into connection (id, organisation_id, provider, account_login, external_id) values (gen_random_uuid(), '$1', 'github', 'fb$3', '$3') returning id" | head -1 | tr -d '[:space:]')
  curl -s -X POST "$API/sites" -H "authorization: Bearer $2" -H "x-organisation-id: $1" -H 'content-type: application/json' \
    -d "{\"name\":\"FB\",\"hostname\":\"$4\",\"label\":\"production\",\"repository\":\"fb$3/site\",\"branch\":\"main\",\"connectionId\":\"$conn\"}" \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'
}
A_ENV=$(mk "$A_ORG" "$A_TOK" "f1$STAMP" "fb-a-$STAMP.example")
B_ENV=$(mk "$B_ORG" "$B_TOK" "f2$STAMP" "fb-b-$STAMP.example")
AH="authorization: Bearer $A_TOK"; AO="x-organisation-id: $A_ORG"

echo "── an annotated element: the comment carries its source line ──"
c=$(code -X POST "$API/feedback" -H "$AH" -H 'content-type: application/json' -d "{
  \"environmentId\":\"$A_ENV\",
  \"message\":\"This heading still says 'mater' — should be 'matter'.\",
  \"pageUrl\":\"https://fb-a-$STAMP.example/pricing?ref=nav\",
  \"element\":\"section > h1.hero-title\",
  \"sourceFile\":\"components/home-hero.vue\",
  \"sourceLine\":14,
  \"viewport\":\"1440x900\"
}")
[ "$c" = "201" ] && pass "accepted ($c)" || fail "accepted" "$c $(body)"
[ "$(jq_ '.sourceFile')" = '"components/home-hero.vue"' ] && pass "source file kept" || fail "source file" "$(body)"
[ "$(jq_ '.sourceLine')" = "14" ] && pass "source line kept — the differentiator" || fail "source line" "$(body)"
[ "$(jq_ '.pagePath')" = '"/pricing"' ] && pass "path derived from the URL, query dropped" || fail "pagePath" "$(body)"
[ "$(jq_ '.status')" = '"new"' ] && pass "lands as new" || fail "status" "$(body)"
[ "$(jq_ '.author.verified')" = "true" ] && pass "author is verified — they were signed in" || fail "author verified" "$(body)"
FB_ID=$(jq_ '.id' | tr -d '"')

echo "── the client cannot name the site or the organisation ──"
c=$(code -X POST "$API/feedback" -H "$AH" -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$A_ENV\",\"message\":\"x\",\"pageUrl\":\"https://x/\",\"organisationId\":\"$B_ORG\"}")
case "$(body)" in *'should not exist'*) pass "an unexpected organisationId is refused ($c)" ;; *) fail "organisationId refused" "$c $(body)" ;; esac

echo "── it is scoped to the environment's own organisation ──"
OWNER=$(psql "$DB" -At -c "select organisation_id from feedback where id='$FB_ID'" | tr -d '[:space:]')
[ "$OWNER" = "$A_ORG" ] && pass "stored against alpha's organisation" || fail "organisation scope" "$OWNER"

echo "── beta cannot file against alpha's site ──"
c=$(code -X POST "$API/feedback" -H "authorization: Bearer $B_TOK" -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$A_ENV\",\"message\":\"not mine\",\"pageUrl\":\"https://x/\"}")
[ "$c" = "404" ] && pass "cross-org intake is 404 ($c)" || fail "cross-org refused" "$c $(body)"

echo "── nor read it ──"
c=$(code "$API/feedback/$FB_ID" -H "authorization: Bearer $B_TOK" -H "x-organisation-id: $B_ORG")
[ "$c" = "404" ] && pass "cross-org read is 404" || fail "cross-org read" "$c"

echo "── a bad source path drops the link, keeps the comment ──"
c=$(code -X POST "$API/feedback" -H "$AH" -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$A_ENV\",\"message\":\"traversal attempt\",\"pageUrl\":\"https://x/\",\"sourceFile\":\"../../etc/passwd\",\"sourceLine\":3}")
[ "$c" = "201" ] && pass "comment still accepted ($c)" || fail "accepted despite bad path" "$c $(body)"
[ "$(jq_ '.sourceFile')" = "null" ] && pass "the traversing path was dropped" || fail "path dropped" "$(body)"
[ "$(jq_ '.sourceLine')" = "null" ] && pass "and the orphaned line with it" || fail "line dropped" "$(body)"

echo "── a whitespace-only comment is refused, not stored blank ──"
c=$(code -X POST "$API/feedback" -H "$AH" -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$A_ENV\",\"message\":\"   \",\"pageUrl\":\"https://x/\"}")
[ "$c" = "400" ] && pass "whitespace-only refused ($c)" || fail "empty refused" "$c $(body)"

echo "── the same class of bug on a site's repository ──"
# `"   "` used to pass @IsString/@MaxLength, trim to "" in the service, and
# register a site that failed on every edit rather than at registration.
c=$(code -X POST "$API/sites" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d "{\"name\":\"Blank\",\"hostname\":\"blank-$STAMP.example\",\"label\":\"production\",\"repository\":\"   \",\"connectionId\":\"$(psql "$DB" -At -c "select id from connection where organisation_id='$A_ORG' limit 1" | tr -d '[:space:]')\"}")
[ "$c" = "400" ] && pass "a whitespace-only repository is refused ($c)" || fail "blank repository refused" "$c $(body)"

echo "── no session, no comment ──"
c=$(code -X POST "$API/feedback" -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$A_ENV\",\"message\":\"anon\",\"pageUrl\":\"https://x/\"}")
[ "$c" = "401" ] && pass "unauthenticated is 401 ($c)" || fail "401 required" "$c"

echo "── it reaches the inbox the dashboard reads ──"
code "$API/feedback" -H "$AH" -H "$AO" >/dev/null
[ "$(jq_ '.counts.new')" = "2" ] && pass "counted as new: 2 (the whitespace-only one was refused)" || fail "inbox counts" "$(body)"
case "$(body)" in *"should be 'matter'"*) pass "the comment itself is listed" ;; *) fail "comment listed" "$(body | head -c 200)" ;; esac

echo "── and can be triaged ──"
c=$(code -X PATCH "$API/feedback/$FB_ID/status" -H "$AH" -H "$AO" -H 'content-type: application/json' -d '{"status":"resolved"}')
[ "$c" = "200" ] && [ "$(jq_ '.status')" = '"resolved"' ] && pass "resolved" || fail "resolve" "$c $(body)"
[ "$(jq_ '.resolvedBy.email')" != "null" ] && pass "and records who resolved it" || fail "resolvedBy" "$(body)"

echo "── the audit log records it ──"
N=$(psql "$DB" -At -c "select count(*) from audit_event where organisation_id='$A_ORG' and action='feedback.resolved'" | tr -d '[:space:]')
[ "$N" = "1" ] && pass "feedback.resolved recorded" || fail "audit" "$N"

echo
[ "$FAILED" = "0" ] && echo "all checks passed" || echo "FAILURES ABOVE"
