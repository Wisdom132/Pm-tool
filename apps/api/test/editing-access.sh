#!/usr/bin/env bash
#
# Access control and input validation on the editing endpoints, against a
# running API.
#
#   npm run dev            # in apps/api
#   bash test/editing-access.sh
#
# These are the endpoints a hostile page would attack: they are reachable
# with only an extension token, and they write to a customer's repository.
# The property under test is that the *client never names the repository* —
# it names a site environment, and the server derives everything else.

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     got: %s\n' "$1" "$2"; FAILED=1; }
FAILED=0

signin() {
  curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\"}" > /dev/null
  local t
  t=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
  curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' \
    -d "{\"token\":\"$t\"}" -c "/tmp/ck-$1.txt" > /dev/null
  grep ie_session "/tmp/ck-$1.txt" | awk '{print $7}'
}

code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
body() { cat /tmp/body.json; }

# ── two organisations, one site each ──────────────────────────────
psql "$DB" -q -c "delete from site_environment where hostname in ('alpha-edit.example','beta-edit.example')" >/dev/null 2>&1
psql "$DB" -q -c "delete from connection where external_id in ('9001','9002')" >/dev/null 2>&1
# The last two checks grant this editor team access, so a re-run has to undo
# it — otherwise the "no team grant" case silently tests the granted one.
psql "$DB" -q -c "delete from team_member where user_id in (select id from app_user where email='editor@example.test')" >/dev/null 2>&1

A_TOK=$(signin alpha-admin@example.test)
B_TOK=$(signin beta-admin@example.test)
A_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $A_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
B_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $B_TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')

mk_site() { # org token external_id hostname -> environment id
  local conn
  conn=$(psql "$DB" -At -c "insert into connection (id, organisation_id, provider, account_login, external_id) values (gen_random_uuid(), '$1', 'github', 'acct$3', '$3') returning id" | head -1 | tr -d '[:space:]')
  curl -s -X POST "$API/sites" -H "authorization: Bearer $2" -H "x-organisation-id: $1" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"$4\",\"hostname\":\"$4\",\"label\":\"production\",\"repository\":\"acct$3/site\",\"branch\":\"main\",\"connectionId\":\"$conn\"}" \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'
}

A_ENV=$(mk_site "$A_ORG" "$A_TOK" 9001 alpha-edit.example)
B_ENV=$(mk_site "$B_ORG" "$B_TOK" 9002 beta-edit.example)
echo "── two sites in two organisations ──"
[ -n "$A_ENV" ] && [ -n "$B_ENV" ] && [ "$A_ENV" != "$B_ENV" ] && pass "registered alpha and beta sites" || fail "registered sites" "$A_ENV / $B_ENV"

echo "── no session: every editing route refuses ──"
for route in "editing/file?environmentId=$A_ENV&path=a.ts" "editing/branches?environmentId=$A_ENV" "editing/preview-status?environmentId=$A_ENV&commit=abc1234"; do
  c=$(code "$API/$route")
  [ "$c" = "401" ] && pass "401 for $(echo "$route" | cut -d? -f1)" || fail "401 for $route" "$c"
done
c=$(code -X POST "$API/editing/change-requests" -H 'content-type: application/json' -d '{}')
[ "$c" = "401" ] && pass "401 for editing/change-requests" || fail "401 for change-requests" "$c"

echo "── beta cannot name alpha's environment ──"
c=$(code "$API/editing/branches?environmentId=$A_ENV" -H "authorization: Bearer $B_TOK")
[ "$c" = "404" ] && pass "cross-org environment is 404" || fail "cross-org 404" "$c $(body)"
case "$(body)" in *acct9001*|*alpha-edit*) fail "response must not leak the other org's repo" "$(body)" ;; *) pass "no repository name leaked in the refusal" ;; esac

echo "── a malformed environment id is a 400, not a 500 ──"
c=$(code "$API/editing/branches?environmentId=not-a-uuid" -H "authorization: Bearer $A_TOK")
[ "$c" = "400" ] && pass "malformed environmentId rejected" || fail "malformed environmentId 400" "$c $(body)"

echo "── the client cannot name a repository ──"
c=$(code -X POST "$API/editing/change-requests" -H "authorization: Bearer $A_TOK" \
  -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$A_ENV\",\"pageUrl\":\"https://alpha-edit.example/\",\"repo\":\"attacker/evil\",\"branch\":\"main\",\"edits\":[{\"sourceFile\":\"a.ts\",\"originalText\":\"a\",\"newText\":\"b\"}]}")
case "$(body)" in
  *"property repo should not exist"*) pass "an unexpected 'repo' field is rejected outright" ;;
  *) fail "repo field rejected" "$c $(body)" ;;
esac

echo "── path traversal is refused before any provider call ──"
for bad in "../../../etc/passwd" "%2e%2e%2fsecrets" ".git/config" "/etc/passwd"; do
  c=$(code -G "$API/editing/file" --data-urlencode "environmentId=$A_ENV" --data-urlencode "path=$bad" \
    -H "authorization: Bearer $A_TOK")
  case "$c$(body)" in
    400*not\ a\ valid\ source\ path*|400*) pass "refused path $bad" ;;
    *) fail "refused path $bad" "$c $(body)" ;;
  esac
done

echo "── an oversized upload is refused by validation ──"
# 9 MB of base64, past the 8 MB cap. Must be rejected before anything reads
# it into memory or talks to the provider.
node -e "
const big = 'A'.repeat(9_000_000);
process.stdout.write(JSON.stringify({
  environmentId: process.argv[1],
  pageUrl: 'https://alpha-edit.example/',
  edits: [{ sourceFile: 'a.ts', originalText: 'a', newText: 'b',
            upload: { path: 'public/x.png', dataUrl: 'data:image/png;base64,' + big } }],
}));
" "$A_ENV" > /tmp/big.json
c=$(code -X POST "$API/editing/change-requests" -H "authorization: Bearer $A_TOK" \
  -H 'content-type: application/json' --data-binary @/tmp/big.json)
case "$c$(body)" in
  400*dataUrl*|413*) pass "oversized upload rejected ($c)" ;;
  *) fail "oversized upload rejected" "$c $(body | head -c 200)" ;;
esac

echo "── an upload path cannot traverse ──"
c=$(code -X POST "$API/editing/change-requests" -H "authorization: Bearer $A_TOK" \
  -H 'content-type: application/json' \
  -d "{\"environmentId\":\"$A_ENV\",\"pageUrl\":\"https://alpha-edit.example/\",\"edits\":[{\"sourceFile\":\"a.ts\",\"originalText\":\"a\",\"newText\":\"b\",\"upload\":{\"path\":\"../../etc/x.png\",\"dataUrl\":\"data:image/png;base64,QQ==\"}}]}")
case "$c" in
  400) pass "traversing upload path refused before a branch is created" ;;
  *) fail "traversing upload path refused with 400" "$c $(body | head -c 200)" ;;
esac

echo "── rate limit headers are reported ──"
H=$(curl -s -D - -o /dev/null "$API/editing/branches?environmentId=$A_ENV" -H "authorization: Bearer $A_TOK" | grep -i "x-ratelimit")
case "$H" in *X-RateLimit-Limit*|*x-ratelimit-limit*) pass "X-RateLimit headers present" ;; *) fail "rate limit headers" "$H" ;; esac

echo "── an editor outside the site's team cannot reach it ──"
E_TOK=$(signin editor@example.test)
E_USER=$(psql "$DB" -At -c "select id from app_user where email='editor@example.test'" | head -1 | tr -d '[:space:]')
# Added to alpha's organisation as an editor, but to no team.
psql "$DB" -q -c "insert into membership (organisation_id, user_id, role) values ('$A_ORG','$E_USER','editor') on conflict do nothing" >/dev/null 2>&1
c=$(code "$API/editing/branches?environmentId=$A_ENV" -H "authorization: Bearer $E_TOK")
[ "$c" = "404" ] && pass "an editor with no team grant gets 404" || fail "editor without team 404" "$c $(body)"

echo "── the same editor reaches it once a team grants access ──"
psql "$DB" -q -c "insert into team_member (team_id, user_id) select t.id, '$E_USER' from team t where t.organisation_id='$A_ORG' and t.is_default on conflict do nothing" >/dev/null 2>&1
c=$(code "$API/editing/branches?environmentId=$A_ENV" -H "authorization: Bearer $E_TOK")
# 4xx/5xx from GitHub is expected (no real App); what matters is it is no longer 404.
[ "$c" != "404" ] && pass "team grant changes the answer (got $c, past authorisation)" || fail "team grant grants access" "$c $(body)"

echo
[ "$FAILED" = "0" ] && echo "all checks passed" || echo "FAILURES ABOVE"
