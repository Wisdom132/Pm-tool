#!/usr/bin/env bash
#
# The public widget's endpoint, and the gates in front of it.
#
#   npm run dev            # in apps/api
#   bash test/feedback-public.sh
#
# This is the only route in the system an unauthenticated stranger can
# reach, and it accepts an image. Everything here is a check that cannot be
# unit tested, because the point of each one is that it holds across the
# real request pipeline — the guard, the validation pipe, the resolver and
# the database, in that order.
#
# The gates, in the order a request meets them:
#
#   1. the widget must be switched on for the site   (off by default)
#   2. the site must have verified its domain        (unset by default)
#   3. the page URL must be on the site's hostname
#   4. the message and screenshot must fit the caps
#   5. the screenshot must actually be an image
#   6. per-address and per-site rate limits

set -u
API=http://localhost:3333/api
DB=$(grep '^DATABASE_URL' .env | cut -d'=' -f2- | tr -d '"' | cut -d'?' -f1)

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; FAILED=1; }
FAILED=0
code() { curl -s -o /tmp/fbp.json -w '%{http_code}' "$@"; }
body() { cat /tmp/fbp.json; }
jq_() { node -pe "try{JSON.stringify(eval('(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")))$1'))}catch(e){'null'}" < /tmp/fbp.json; }

signin() {
  curl -s -X POST "$API/auth/request-link" -H 'content-type: application/json' -d "{\"email\":\"$1\"}" >/dev/null
  local t; t=$(grep -o "verify?token=[A-Za-z0-9_-]*" /tmp/ie-api.log | tail -1 | cut -d= -f2)
  curl -s -X POST "$API/auth/verify" -H 'content-type: application/json' -d "{\"token\":\"$t\"}" -c "/tmp/ckp-$1" >/dev/null
  grep ie_session "/tmp/ckp-$1" | awk '{print $7}'
}

STAMP=$(date +%s)
TOK=$(signin "pub-$STAMP@example.test")
ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $TOK" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
AH="authorization: Bearer $TOK"; AO="x-organisation-id: $ORG"
HOST="pub-$STAMP.example"

CONN=$(psql "$DB" -At -c "insert into connection (id, organisation_id, provider, account_login, external_id) values (gen_random_uuid(), '$ORG', 'github', 'pub$STAMP', 'p$STAMP') returning id" | head -1 | tr -d '[:space:]')
ENV_ID=$(curl -s -X POST "$API/sites" -H "$AH" -H "$AO" -H 'content-type: application/json' \
  -d "{\"name\":\"Pub\",\"hostname\":\"$HOST\",\"label\":\"production\",\"repository\":\"pub$STAMP/site\",\"branch\":\"main\",\"connectionId\":\"$CONN\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
SITE_ID=$(psql "$DB" -At -c "select site_id from site_environment where id='$ENV_ID'" | tr -d '[:space:]')

post() { # body -> status
  code -X POST "$API/public/feedback" -H 'content-type: application/json' -d "$1"
}

# A body too large to pass as an argument. `-d` puts it in argv, and the
# kernel refuses a couple of megabytes there long before curl runs.
post_file() { # file -> status
  code -X POST "$API/public/feedback" -H 'content-type: application/json' --data-binary "@$1"
}
SAY="{\"message\":\"The price is wrong.\",\"pageUrl\":\"https://$HOST/pricing\"}"

echo "── a freshly registered site collects nothing ──"
# Registering a site must not quietly open an ingest endpoint. Both the
# widget flag and domain verification are off until somebody sets them.
c=$(post "$SAY")
[ "$c" = "404" ] && pass "widget off by default ($c)" || fail "widget off by default" "$c $(body)"

echo "── verified but not switched on: still nothing ──"
psql "$DB" -q -c "update site set verified_at=now() where id='$SITE_ID'"
c=$(post "$SAY")
[ "$c" = "404" ] && pass "verification alone is not enough ($c)" || fail "verified only" "$c $(body)"

echo "── switched on but not verified: still nothing ──"
# This is the check `verification_token` was always for. Without it anyone
# can register acme.com and collect feedback meant for its owner.
psql "$DB" -q -c "update site set verified_at=null, feedback_widget=true where id='$SITE_ID'"
c=$(post "$SAY")
[ "$c" = "404" ] && pass "an unverified domain collects nothing ($c)" || fail "unverified" "$c $(body)"

echo "── all three failures look identical to a stranger ──"
R_OFF=$(body)
c=$(post "{\"message\":\"x\",\"pageUrl\":\"https://never-registered-$STAMP.example/\"}")
# An anonymous caller must not be able to tell "unregistered" from
# "unverified" from "switched off" — that is free reconnaissance.
[ "$(body)" = "$R_OFF" ] && pass "unregistered is indistinguishable from unverified" \
  || fail "responses differ" "off=$R_OFF unreg=$(body)"

echo "── verified and switched on: it works ──"
psql "$DB" -q -c "update site set verified_at=now(), feedback_widget=true where id='$SITE_ID'"
c=$(post "$SAY")
[ "$c" = "201" ] && pass "accepted ($c)" || fail "accepted" "$c $(body)"
[ "$(jq_ '.received')" = "true" ] && pass "acknowledged" || fail "received" "$(body)"

echo "── the off switch works immediately ──"
psql "$DB" -q -c "update site set feedback_widget=false where id='$SITE_ID'"
c=$(post "$SAY")
[ "$c" = "404" ] && pass "turning it off stops ingest at once ($c)" || fail "off switch" "$c $(body)"

echo "── a deleted site stops collecting ──"
psql "$DB" -q -c "update site set feedback_widget=true, deleted_at=now() where id='$SITE_ID'"
c=$(post "$SAY")
[ "$c" = "404" ] && pass "a soft-deleted site collects nothing ($c)" || fail "deleted site" "$c $(body)"

# Back on, for the screenshot checks below.
psql "$DB" -q -c "update site set deleted_at=null where id='$SITE_ID'"

echo "── screenshots ──"
PNG=$(node -e 'const h=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);process.stdout.write(Buffer.concat([h,Buffer.alloc(200)]).toString("base64"))')
c=$(post "{\"message\":\"with a picture\",\"pageUrl\":\"https://$HOST/\",\"screenshot\":\"data:image/png;base64,$PNG\"}")
[ "$c" = "201" ] && pass "a real PNG is accepted ($c)" || fail "png accepted" "$c $(body)"

SHOT_ID=$(psql "$DB" -At -c "select id from feedback where site_id='$SITE_ID' and screenshot is not null limit 1" | tr -d '[:space:]')
[ -n "$SHOT_ID" ] && pass "the bytes reached the database" || fail "bytes stored" "none"

echo "── the declared type is not believed ──"
# Believing it is how an upload endpoint becomes a way to host arbitrary
# content on our own origin.
LIE=$(node -e 'process.stdout.write(Buffer.from("<svg onload=alert(1)>").toString("base64"))')
c=$(post "{\"message\":\"x\",\"pageUrl\":\"https://$HOST/\",\"screenshot\":\"data:image/png;base64,$LIE\"}")
[ "$c" = "400" ] && pass "bytes that are not a PNG are refused ($c)" || fail "magic bytes checked" "$c $(body)"

c=$(post "{\"message\":\"x\",\"pageUrl\":\"https://$HOST/\",\"screenshot\":\"data:image/svg+xml;base64,$LIE\"}")
[ "$c" = "400" ] && pass "SVG is refused outright ($c)" || fail "svg refused" "$c $(body)"

echo "── a screenshot at a realistic size gets through ──"
# The regression this guards: Express caps a JSON body at 100KB by default,
# which is below the 512KB the column accepts — so every real screenshot was
# refused with a 413 and the cap in the DTO was unreachable code. A small
# test PNG passes either way, which is why this needs a realistic size.
REAL=$(node -e 'const h=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);process.stdout.write(Buffer.concat([h,Buffer.alloc(300*1024)]).toString("base64"))')
c=$(post "{\"message\":\"a 300KB screenshot\",\"pageUrl\":\"https://$HOST/\",\"screenshot\":\"data:image/png;base64,$REAL\"}")
[ "$c" = "201" ] && pass "300KB is accepted ($c)" || fail "realistic screenshot" "$c $(body)"

echo "── but an oversized one is refused ──"
node -e 'const fs=require("fs");fs.writeFileSync("/tmp/fbp-big.json",JSON.stringify({message:"x",pageUrl:"https://'"$HOST"'/",screenshot:"data:image/png;base64,"+"A".repeat(2*1024*1024)}))'
c=$(post_file /tmp/fbp-big.json)
# 413 from the body limit or 400 from validation — both refuse it, and the
# body limit is deliberately the earlier of the two.
case "$c" in 400|413) pass "over the cap is refused ($c)" ;; *) fail "size cap" "$c $(body)" ;; esac

echo "── the response tells an anonymous caller nothing ──"
# No organisation, no site, no environment: the submitter cannot read the
# record back, so naming it would only leak structure.
case "$(body)" in
  *organisationId*|*siteId*|*environmentId*) fail "response leaks structure" "$(body)" ;;
  *) pass "no organisation, site or environment in the response" ;;
esac

echo "── it is stored as a widget submission, unverified and unattributed ──"
ROW=$(psql "$DB" -At -c "select source || '|' || coalesce(author_user_id::text,'-') || '|' || coalesce(author_ip_hash,'-') from feedback where site_id='$SITE_ID' order by created_at desc limit 1" | tr -d '[:space:]')
case "$ROW" in
  widget\|-\|?*) pass "source=widget, no user attached, address hashed" ;;
  *) fail "stored shape" "$ROW" ;;
esac

echo "── the address is hashed, never stored ──"
RAW=$(psql "$DB" -At -c "select count(*) from feedback where author_ip_hash like '%127.0.0.1%' or author_ip_hash like '%::1%'" | tr -d '[:space:]')
[ "$RAW" = "0" ] && pass "no address appears in the column" || fail "address stored raw" "$RAW rows"

echo "── a self-declared name is kept but marked unverified ──"
c=$(post "{\"message\":\"I am the CFO.\",\"pageUrl\":\"https://$HOST/\",\"authorName\":\"The CFO\",\"authorEmail\":\"cfo@example.test\"}")
[ "$c" = "201" ] && pass "accepted with a name ($c)" || fail "named submission" "$c $(body)"
ID=$(psql "$DB" -At -c "select id from feedback where site_id='$SITE_ID' and author_name='The CFO' limit 1" | tr -d '[:space:]')
c=$(code "$API/feedback/$ID" -H "$AH" -H "$AO")
[ "$(jq_ '.author.verified')" = "false" ] && pass "the inbox shows it as unverified" || fail "verified flag" "$(body)"
[ "$(jq_ '.author.name')" = '"The CFO"' ] && pass "the name is still shown" || fail "name kept" "$(body)"

echo "── the page URL must be on the site's own hostname ──"
# Otherwise a comment filed against a real site can name any URL at all,
# and the inbox shows a link with nothing to do with that site.
c=$(post "{\"message\":\"x\",\"pageUrl\":\"https://evil-$STAMP.example/phish\"}")
[ "$c" = "404" ] && pass "a foreign URL resolves to no site ($c)" || fail "foreign URL" "$c $(body)"

echo "── a scheme we would render as a link is refused ──"
for u in "javascript:alert(1)" "data:text/html,<script>"; do
  c=$(post "{\"message\":\"x\",\"pageUrl\":\"$u\"}")
  case "$c" in 400|404) pass "$u refused ($c)" ;; *) fail "$u refused" "$c $(body)" ;; esac
done

echo "── a blank comment is refused, not stored empty ──"
c=$(post "{\"message\":\"   \",\"pageUrl\":\"https://$HOST/\"}")
[ "$c" = "400" ] && pass "whitespace-only refused ($c)" || fail "blank refused" "$c $(body)"

echo "── it cannot name its own site, organisation or author ──"
for field in '"environmentId":"'"$ENV_ID"'"' '"source":"extension"'; do
  c=$(post "{\"message\":\"x\",\"pageUrl\":\"https://$HOST/\",$field}")
  case "$(body)" in
    *'should not exist'*) pass "$field is refused" ;;
    *) fail "$field refused" "$c $(body)" ;;
  esac
done

echo "── the inbox serves the image back safely ──"
HDRS=$(curl -s -D - -o /dev/null "$API/feedback/$SHOT_ID/screenshot" -H "$AH" -H "$AO")
case "$HDRS" in *"200"*) pass "the screenshot is served" ;; *) fail "screenshot served" "$HDRS" ;; esac
case "$HDRS" in *nosniff*) pass "X-Content-Type-Options: nosniff" ;; *) fail "nosniff" "$HDRS" ;; esac
case "$HDRS" in *"private"*) pass "Cache-Control is private, not shared" ;; *) fail "private cache" "$HDRS" ;; esac
case "$HDRS" in *"image/png"*) pass "served as the type it actually is" ;; *) fail "content type" "$HDRS" ;; esac

echo "── a screenshot is scoped to its organisation ──"
OTHER=$(signin "pub-other-$STAMP@example.test")
OTHER_ORG=$(curl -s "$API/auth/me" -H "authorization: Bearer $OTHER" | node -pe 'JSON.parse(require("fs").readFileSync(0)).organisations[0].id')
c=$(code "$API/feedback/$SHOT_ID/screenshot" -H "authorization: Bearer $OTHER" -H "x-organisation-id: $OTHER_ORG")
[ "$c" = "404" ] && pass "another organisation cannot fetch it ($c)" || fail "cross-org screenshot" "$c"

echo "── CORS: the widget runs on domains we have never heard of ──"
# The dashboard's allowlist cannot serve this — the whole point is that we
# do not know the origin in advance. Safe only because no credentials are
# involved.
PRE=$(curl -s -D - -o /dev/null -X OPTIONS "$API/public/feedback" \
  -H 'Origin: https://some-customer.example' \
  -H 'Access-Control-Request-Method: POST')
case "$PRE" in *"Access-Control-Allow-Origin: *"*) pass "preflight allows any origin" ;; *) fail "preflight" "$PRE" ;; esac

ACT=$(curl -s -D - -o /dev/null -X POST "$API/public/feedback" \
  -H 'Origin: https://some-customer.example' -H 'content-type: application/json' -d "$SAY")
case "$ACT" in *"Access-Control-Allow-Origin: *"*) pass "the POST carries the header too" ;; *) fail "post header" "$ACT" ;; esac
case "$ACT" in *"Access-Control-Allow-Credentials: true"*) fail "credentials allowed with *" "$ACT" ;; *) pass "credentials are not allowed" ;; esac

echo "── the authenticated routes keep their allowlist ──"
AUTH_CORS=$(curl -s -D - -o /dev/null "$API/feedback" -H 'Origin: https://evil.example' -H "$AH" -H "$AO")
case "$AUTH_CORS" in
  *"Access-Control-Allow-Origin: *"*) fail "the wildcard leaked onto a credentialed route" "$AUTH_CORS" ;;
  *) pass "no wildcard on /api/feedback" ;;
esac

echo "── the per-address rate limit ──"
# Last, because it spends the budget. Twenty an hour is generous for a
# person and useless for a script; the limit is the whole defence on the one
# endpoint a stranger can reach.
psql "$DB" -q -c "update site set feedback_widget=true where id='$SITE_ID'"
LIMITED=0
for i in $(seq 1 25); do
  c=$(post "{\"message\":\"flood $i\",\"pageUrl\":\"https://$HOST/\"}")
  [ "$c" = "429" ] && { LIMITED=1; break; }
done
[ "$LIMITED" = "1" ] && pass "a flood from one address is cut off" || fail "rate limited" "never refused in 25 tries"

case "$(body)" in *"Retry-After"*|*"Try again"*) pass "it says when to try again" ;; *) pass "refused (no retry hint)" ;; esac

echo
[ "$FAILED" = "0" ] && printf '\033[32mAll public-intake checks passed.\033[0m\n' \
  || { printf '\033[31mSome checks failed.\033[0m\n'; exit 1; }
