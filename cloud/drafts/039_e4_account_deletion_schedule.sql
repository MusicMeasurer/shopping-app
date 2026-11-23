-- Apply after the worker and both Vault entries exist. This is provisioning,
-- not part of the database migration or the disposable PostgreSQL tests.
do $$
begin
  if (select count(*) from vault.decrypted_secrets where name in
    ('shopping_account_deletion_url','shopping_account_deletion_worker_key')) <> 2 then
    raise exception 'Configure the account-deletion Vault entries first';
  end if;
end;
$$;

select cron.schedule('shopping-account-deletion','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='shopping_account_deletion_url'),
    headers := jsonb_build_object('content-type','application/json','authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='shopping_account_deletion_worker_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
$job$);
