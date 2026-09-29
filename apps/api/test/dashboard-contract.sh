#!/usr/bin/env bash
#
# Every endpoint the dashboard calls, with the shape its types promise.
#
#   npm run dev            # in apps/api
#   bash test/dashboard-contract.sh
#
# This is the check the mock data made impossible: for months the dashboard
# referenced fields like `lastEditedAt` and a flat `verified` boolean that no
# response has ever contained. Comparing the two is the whole point.

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; FAILED=1; }
FAILED=0

STAMP=$(date +%s)
EMAIL="dash-$STAMP@example.test"
curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" >/dev/null
TOKEN=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}" -c /tmp/dash-ck >/dev/null
TOK=$(grep ie_session /tmp/dash-ck | awk '{print $7}')
ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
H="authorization: Bearer $TOK"; O="x-organisation-id: $ORG"

# Plant a connection and a site so the list endpoints have something real.
CONN=$(psql "$DB" -At -c "insert into connection (id, organisation_id, provider, account_login, external_id) values (gen_random_uuid(), '$ORG', 'github', 'dashco', 'd$STAMP') returning id" | head -1 | tr -d '[:space:]')
SITE=$(curl -s -X POST "$API/sites" -H "$H" -H "$O" -H 'content-type: application/json' \
  -d "{\"name\":\"Dash\",\"hostname\":\"dash-$STAMP.example\",\"label\":\"production\",\"repository\":\"dashco/site\",\"branch\":\"main\",\"connectionId\":\"$CONN\"}")
SITE_ID=$(printf '%s' "$SITE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

# Assert a dotted path exists on the response, and is not undefined.
shape() { # name  url  path...
  local name=$1 url=$2; shift 2
  local body; body=$(curl -s "$url" -H "$H" -H "$O")
  local missing
  missing=$(node -e '
    const body = JSON.parse(process.argv[1]);
    const paths = process.argv.slice(2);
    const bad = [];
    for (const p of paths) {
      let cur = body;
      for (const key of p.split(".")) {
        if (cur == null) break;
        cur = /^\d+$/.test(key) ? cur[Number(key)] : cur[key];
      }
      if (cur === undefined) bad.push(p);
    }
    process.stdout.write(bad.join(", "));
  ' "$body" "$@" 2>/dev/null)
  if [ -z "$missing" ]; then pass "$name"; else fail "$name" "missing: $missing"; fi
}

echo "── every endpoint the dashboard's services call ──"
shape "GET /auth/me"        "$API/auth/me"        user.id user.email user.name organisations.0.id organisations.0.name organisations.0.slug organisations.0.role organisations.0.meta
shape "GET /organisation"   "$API/organisation"   id name slug createdAt _count.sites _count.memberships _count.connections _count.teams
shape "GET /sites"          "$API/sites"          0.id 0.siteId 0.organisationId 0.connectionId 0.hostname 0.label 0.repository 0.branch 0.createdAt 0.site.id 0.site.name 0.site.verifiedAt 0.connection.id 0.connection.provider 0.connection.accountLogin
shape "GET /sites/:id"      "$API/sites/$SITE_ID" id hostname repository branch site.id site.name site.verifiedAt site.verificationToken site.createdAt connection.provider
shape "GET /connections"    "$API/connections"    0.id 0.provider 0.accountLogin 0.externalId 0.baseUrl 0.createdAt 0.revokedAt 0._count.environments
shape "GET /teams"          "$API/teams"          0.id 0.organisationId 0.name 0.isDefault 0.createdAt 0.members 0.sites
shape "GET /members"        "$API/members"        0.id 0.kind 0.name 0.email 0.role 0.status 0.lastSeenAt 0.joinedAt 0.teams
shape "GET /audit"          "$API/audit"          events.0.id events.0.action events.0.subject events.0.detail events.0.createdAt events.0.actor.email nextCursor
shape "GET /audit/actions"  "$API/audit/actions"  0
shape "GET /feedback"       "$API/feedback"       items counts.new counts.triaged counts.resolved nextCursor

echo
echo "── fields the mock data invented and no response has ──"
BODY=$(curl -s "$API/sites" -H "$H" -H "$O")
for ghost in lastEditedAt verified provider; do
  if node -pe "JSON.parse(require('fs').readFileSync(0))[0]['$ghost'] === undefined" <<< "$BODY" | grep -q true; then
    pass "site.$ghost is absent (the dashboard no longer reads it)"
  else
    fail "site.$ghost absent" "it exists after all"
  fi
done

echo
echo "── a team detail carries what team-detail.ts renders ──"
TEAM=$(curl -s "$API/teams" -H "$H" -H "$O" | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')
curl -s -X PUT "$API/teams/$TEAM/sites" -H "$H" -H "$O" -H 'content-type: application/json' \
  -d "{\"siteIds\":[\"$(printf '%s' "$SITE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).siteId')\"]}" >/dev/null
shape "GET /teams/:id"      "$API/teams/$TEAM"    id name isDefault members sites.0.site.id sites.0.site.name sites.0.site.environments.0.hostname sites.0.site.environments.0.label

echo
echo "── PATCH /auth/me sets the name used to credit a pull request ──"
OUT=$(curl -s -X PATCH "$API/auth/me" -H "$H" -H 'content-type: application/json' -d '{"name":"Dash Tester"}')
case "$OUT" in *'"name":"Dash Tester"'*) pass "profile name saved" ;; *) fail "profile name saved" "$OUT" ;; esac
case "$(curl -s "$API/auth/me" -H "$H")" in *'"name":"Dash Tester"'*) pass "and returned by /auth/me" ;; *) fail "returned by /auth/me" "" ;; esac

echo
[ "$FAILED" = "0" ] && echo "all checks passed" || echo "FAILURES ABOVE"
