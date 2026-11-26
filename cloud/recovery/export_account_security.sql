-- Run against a quiesced authoritative source. Stream stdout directly to encryption.
begin isolation level repeatable read read only;
select to_regnamespace('shoppingapp_registration') is not null as has_registration_schema \gset
\if :has_registration_schema
\set registration_windows 'coalesce((select jsonb_agg(to_jsonb(w)) from shoppingapp_registration.rate_windows w where w.starts_at > statement_timestamp() - interval \'1 hour\'), \'[]\'::jsonb)'
\else
\set registration_windows '\'[]\'::jsonb'
\endif

copy (
  select jsonb_build_object(
    'version', 1,
    'captured_at', statement_timestamp(),
    'keyring', (select encode(secret, 'hex') from shoppingapp_deletion.keyring where singleton),
    'tombstones', coalesce((
      select jsonb_agg(to_jsonb(t) || jsonb_build_object('email_key',
        case when t.completed_at is null or t.completed_at + interval '24 hours' > statement_timestamp()
          then t.email_key end))
      from shoppingapp_deletion.tombstones t
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', d.account_id, 'device_id', d.device_id, 'proof_hash', d.proof_hash))
      from shoppingapp_deletion.devices d
      join shoppingapp_deletion.tombstones t using (account_id)
    ), '[]'::jsonb),
    'rate_windows', :registration_windows
  )
) to stdout with (format csv);
commit;
