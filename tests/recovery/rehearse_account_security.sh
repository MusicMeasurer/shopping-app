#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${PGDATABASE:?}"
[[ $PGDATABASE == shoppingapp_recovery_ci && $PGHOST == localhost ]]
folder=$(mktemp -d)
export GNUPGHOME="$folder/gpg"
mkdir -m 700 "$GNUPGHOME"
restored=shoppingapp_account_restore_ci
trap 'dropdb --if-exists "$restored" >/dev/null; rm -rf "$folder"' EXIT
sql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
pg_tool() {
  local name=$1
  shift
  if [[ -n ${RECOVERY_PG_CONTAINER:-} ]]; then
    docker exec -i "$RECOVERY_PG_CONTAINER" "$name" -U "$PGUSER" "$@"
  else
    "$name" "$@"
  fi
}

# The fixture's snapshot contains old credentials, a list and live mail/code.
sql <<'SQL'
insert into auth.users (id, email) values
 ('62000000-0000-4000-8000-000000000001','old-recovery@example.test'),
 ('62000000-0000-4000-8000-000000000002','independent-recovery@example.test'),
 ('62000000-0000-4000-8000-000000000003','new-uuid-recovery@example.test'),
 ('62000000-0000-4000-8000-000000000004','reminder-recovery@example.test');
insert into auth.sessions values
 ('62000000-0000-4000-8000-000000000011','62000000-0000-4000-8000-000000000001');
insert into auth.refresh_tokens values
 ('62000000-0000-4000-8000-000000000012','62000000-0000-4000-8000-000000000011');
insert into public.shopping_lists (id, owner_id, name) values
 ('62000000-0000-4000-8000-000000000021','62000000-0000-4000-8000-000000000001','Deleted list'),
 ('62000000-0000-4000-8000-000000000022','62000000-0000-4000-8000-000000000002','Independent list');
insert into shoppingapp_deletion.tombstones (account_id, completed_at, review_at)
 values ('62000000-0000-4000-8000-000000000004',now()-interval '65 days',now()+interval '25 days');
insert into shoppingapp_deletion.reminders (account_id,email)
 values ('62000000-0000-4000-8000-000000000004','reminder-recovery@example.test');
insert into shoppingapp_deletion.mail (id,account_id,kind,email,code,expires_at)
 values (gen_random_uuid(),'62000000-0000-4000-8000-000000000002','code',
 'independent-recovery@example.test','123456',now()+interval '10 minutes');
insert into shoppingapp_registration.requests (email_key, requested_at, expires_at, code_key)
 values (shoppingapp_deletion.digest('email:registered-recovery@example.test'),now(),now()+interval '10 minutes',
 shoppingapp_deletion.digest('registration-code:' || encode(shoppingapp_deletion.digest('email:registered-recovery@example.test'),'hex') || ':123456'));
SQL
pg_tool pg_dump --format=custom "$PGDATABASE" >"$folder/older.dump"

# Only this later authoritative state has the installation and deletion.
sql <<'SQL'
insert into shoppingapp_deletion.devices (account_id,device_id,proof_hash)
 values ('62000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000031',
 shoppingapp_deletion.digest('device:62000000-0000-4000-8000-000000000041'));
insert into shoppingapp_deletion.tombstones (account_id,blocked_at,completed_at,review_at)
 values ('62000000-0000-4000-8000-000000000001',now()-interval '100 days',now()-interval '99 days',now()-interval '10 days');
delete from public.shopping_lists where owner_id='62000000-0000-4000-8000-000000000001';
delete from auth.users where id='62000000-0000-4000-8000-000000000001';
delete from shoppingapp_deletion.reminders;
insert into shoppingapp_registration.rate_windows values
 (shoppingapp_deletion.digest('registration-rate:hour:limited-recovery@example.test'),now(),3);
SQL

cutoff=$(sql -Atc 'select clock_timestamp()')
recipient=account-recovery-ci@example.test
gpg --batch --quiet --pinentry-mode loopback --passphrase '' --quick-generate-key "$recipient" default default 1d
sql -f cloud/recovery/export_account_security.sql |
  gpg --batch --quiet --encrypt --recipient "$recipient" --output "$folder/checkpoint.gpg"
gpg --batch --quiet --pinentry-mode loopback --passphrase '' --local-user "$recipient" \
  --detach-sign --output "$folder/checkpoint.sig" "$folder/checkpoint.gpg"
gpg --batch --quiet --verify "$folder/checkpoint.sig" "$folder/checkpoint.gpg"
createdb "$restored"
pg_tool pg_restore --exit-on-error --dbname="$restored" <"$folder/older.dump"

restore() {
  gpg --batch --quiet --decrypt "$folder/checkpoint.gpg" |
    sql -d "$restored" -v required_through="$1" -f cloud/recovery/restore_account_security.sql
}

# The import must refuse an insufficient checkpoint before making changes.
if restore 2100-01-01T00:00:00Z >"$folder/stale.log" 2>&1; then
  echo 'Stale checkpoint was accepted' >&2
  exit 1
fi
grep -q 'Invalid or stale account recovery checkpoint' "$folder/stale.log"
restore "$cutoff"
restore "$cutoff"
sql -d "$restored" -f tests/recovery/verify_account_security_restore.sql
