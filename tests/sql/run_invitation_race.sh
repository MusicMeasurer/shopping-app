#!/usr/bin/env bash
set -euo pipefail
# Disposable CI only. No secrets, no live Supabase connection.
psql -X -v ON_ERROR_STOP=1 -f tests/sql/invitation_race_setup.sql >/dev/null
token="$(psql -XAt -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true) IS NOT NULL;
SELECT public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1');
COMMIT;
SQL
)"
token="$(printf '%s\n' "$token" | grep -E '^[a-f0-9]{64}$' | head -1)"
test "${#token}" -eq 64
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Lock the list so both authenticated claimants must queue behind it.
psql -X -v ON_ERROR_STOP=1 <<'SQL' >"$tmp/lock" 2>&1 &
BEGIN;
SELECT 1 FROM public.shopping_lists
 WHERE id='10000000-0000-4000-8000-0000000000a1' FOR UPDATE;
SELECT pg_sleep(3);
COMMIT;
SQL
locker=$!
sleep 0.5
claim() {
 local actor="$1" output="$2"
 psql -X -v ON_ERROR_STOP=1 -v invite="$token" -v actor="$actor" <<'SQL' >"$output" 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor', true);
SELECT public.accept_list_invitation_link(:'invite');
COMMIT;
SQL
}
claim '00000000-0000-4000-8000-0000000000b1' "$tmp/b" & pid_b=$!
claim '00000000-0000-4000-8000-0000000000c1' "$tmp/c" & pid_c=$!
set +e
wait "$pid_b"; rc_b=$?
wait "$pid_c"; rc_c=$?
wait "$locker"; rc_lock=$?
set -e
if [[ "$rc_lock" -ne 0 ]] || [[ "$rc_b" -eq "$rc_c" ]]; then
 echo "FAIL: expected exactly one accepted claimant; b=$rc_b c=$rc_c locker=$rc_lock"
 sed -E 's/[a-f0-9]{64}/[REDACTED]/g' "$tmp/b" "$tmp/c" "$tmp/lock"
 exit 1
fi
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE members integer; claims integer; winner uuid;
BEGIN
 SELECT count(*) INTO members FROM public.list_members
 WHERE list_id='10000000-0000-4000-8000-0000000000a1';
 SELECT count(*) INTO claims FROM public.list_invitation_links
 WHERE list_id='10000000-0000-4000-8000-0000000000a1' AND accepted_at IS NOT NULL;
 SELECT accepted_by INTO winner FROM public.list_invitation_links
 WHERE list_id='10000000-0000-4000-8000-0000000000a1' AND accepted_at IS NOT NULL
 LIMIT 1;
 IF members <> 1 OR claims <> 1 OR NOT EXISTS (
 SELECT 1 FROM public.list_members
 WHERE list_id='10000000-0000-4000-8000-0000000000a1' AND user_id=winner
 ) THEN RAISE EXCEPTION 'race violated one-time membership'; END IF;
END $$;
SQL
echo 'PASS: exactly one of two simultaneous authenticated claimants accepted'
