#!/usr/bin/env bash
set -euo pipefail
# Disposable CI DB only. No production credentials.
psql -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-000000000071'),
 ('00000000-0000-4000-8000-000000000072');
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-000000000071',
  '00000000-0000-4000-8000-000000000071','lock expiry');
SQL
token="$(psql -XAt -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',true);
SELECT public.create_list_invitation_link('10000000-0000-4000-8000-000000000071');
COMMIT;
SQL
)"
# psql output includes set_config and transaction commands. Extract 64-char hex token.
token="$(printf '%s\n' "$token" | grep -E '^[0-9a-f]{64}$' | head -1)"
test "${#token}" -eq 64
psql -v ON_ERROR_STOP=1 -c "UPDATE public.list_invitation_links SET expires_at=clock_timestamp()+interval '2 seconds' WHERE list_id='10000000-0000-4000-8000-000000000071';"
# Lock the list for four seconds, forcing accept to wait past expiry.
psql -v ON_ERROR_STOP=1 <<'SQL' >/tmp/invite-lock-holder.log 2>&1 &
BEGIN;
SELECT id FROM public.shopping_lists WHERE id='10000000-0000-4000-8000-000000000071' FOR UPDATE;
SELECT pg_sleep(4);
COMMIT;
SQL
holder=$!
sleep 0.5
set +e
psql -v ON_ERROR_STOP=1 -v invite_token="$token" <<'SQL' >/tmp/invite-lock-claim.log 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000072',true);
SELECT public.accept_list_invitation_link(:'invite_token');
COMMIT;
SQL
rc=$?
set -e
wait "$holder"
if [ "$rc" -eq 0 ]; then
  echo 'FAIL: accepted invitation after expiry while waiting for lock'
  exit 1
fi
if ! grep -q 'Invalid invitation' /tmp/invite-lock-claim.log; then
  echo 'FAIL: claim failed for unexpected reason'
  sed -E 's/[0-9a-f]{64}/[REDACTED]/g' /tmp/invite-lock-claim.log
  exit 1
fi
count="$(psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.list_members WHERE list_id='10000000-0000-4000-8000-000000000071';")"
test "$count" = 0
echo 'PASS: lock wait crossed expiry; claim rejected and membership unchanged'
