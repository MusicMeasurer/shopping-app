-- Disposable lab only. Runs inside a transaction and rolls back all fixtures.
begin;
do $test$
declare
 v_list uuid; v_owner uuid; v_token text := repeat('c',64);
 v_operation uuid := gen_random_uuid(); v_first jsonb; v_again jsonb;
 v_credential uuid; v_rejected boolean; v_count integer;
begin
 select id, owner_id into v_list, v_owner
 from public.shopping_lists where deleted_at is null limit 1;
 if v_list is null then raise exception 'Missing disposable lab fixture list'; end if;

 insert into public.siri_shortcut_credentials(owner_id,list_id,token_hash,expires_at)
 values(v_owner,v_list,sha256(convert_to(v_token,'UTF8')),now()+interval '1 day')
 returning id into v_credential;

 v_first := public.siri_add_item(v_token,v_operation,v_list,'E3 lab milk');
 if v_first->>'operation_id' <> v_operation::text then raise exception 'Receipt mismatch'; end if;
 v_again := public.siri_add_item(v_token,v_operation,v_list,'E3 lab milk');
 if v_first <> v_again then raise exception 'Idempotency failure'; end if;
 if (select count(*) from public.shopping_items where id=v_operation) <> 1
 then raise exception 'Duplicate item'; end if;
 if (select count(*) from public.list_changes where item_id=v_operation) <> 1
 then raise exception 'Duplicate change'; end if;

 v_rejected := false;
 begin
  perform public.siri_add_item(v_token,v_operation,gen_random_uuid(),'E3 lab milk');
 exception when others then v_rejected := true; end;
 if not v_rejected then raise exception 'Cross-list access accepted'; end if;

 v_rejected := false;
 begin
  perform public.siri_add_item(v_token,v_operation,v_list,'Different name');
 exception when others then v_rejected := true; end;
 if not v_rejected then raise exception 'Operation mismatch accepted'; end if;

 update public.siri_shortcut_credentials set expires_at=now()-interval '1 second'
 where id=v_credential;
 v_rejected := false;
 begin
  perform public.siri_add_item(v_token,gen_random_uuid(),v_list,'E3 lab milk');
 exception when others then v_rejected := true; end;
 if not v_rejected then raise exception 'Expired token accepted'; end if;

 update public.siri_shortcut_credentials
 set expires_at=now()+interval '1 day',revoked_at=now() where id=v_credential;
 v_rejected := false;
 begin
  perform public.siri_add_item(v_token,gen_random_uuid(),v_list,'E3 lab milk');
 exception when others then v_rejected := true; end;
 if not v_rejected then raise exception 'Revoked token accepted'; end if;

 select count(*) into v_count from public.siri_shortcut_operations
 where credential_id=v_credential;
 if v_count <> 1 then raise exception 'Unexpected operation count'; end if;
end $test$;
rollback;