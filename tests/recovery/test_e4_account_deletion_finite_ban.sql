-- Isolated PostgreSQL only. No real mail or account mutation.
begin;
insert into auth.users(id,email,banned_until,email_confirmed_at) values
 ('65000000-0000-4000-8000-000000000001','finite-a1@example.test',null,now()),
 ('65000000-0000-4000-8000-000000000002','long-a1@example.test',now()+interval '150 years',now()),
 ('65000000-0000-4000-8000-000000000003','restore-a1@example.test','infinity',now()),
 ('65000000-0000-4000-8000-000000000004','independent-a1@example.test','infinity',now());
insert into auth.sessions(id,user_id) values
 ('65000000-0000-4000-8000-000000000011','65000000-0000-4000-8000-000000000001'),
 ('65000000-0000-4000-8000-000000000012','65000000-0000-4000-8000-000000000003'),
 ('65000000-0000-4000-8000-000000000013','65000000-0000-4000-8000-000000000004');
insert into auth.refresh_tokens values
 ('65000000-0000-4000-8000-000000000021','65000000-0000-4000-8000-000000000011');
do $$
declare
 a constant uuid := '65000000-0000-4000-8000-000000000001';
 b constant uuid := '65000000-0000-4000-8000-000000000002';
 c constant uuid := '65000000-0000-4000-8000-000000000003';
 d constant uuid := '65000000-0000-4000-8000-000000000004';
 sid constant uuid := '65000000-0000-4000-8000-000000000011';
 challenge uuid;
 code text;
 ban timestamptz;
begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',sid)::text,true);
 challenge := (public.request_account_deletion(false)->>'id')::uuid;
 select m.code into code from shoppingapp_deletion.mail m where m.id=challenge;
 if public.confirm_account_deletion(challenge,code) is distinct from 'deleted' then
   raise exception 'Deletion confirmation failed';
 end if;
 select banned_until into ban from auth.users where id=a;
 if ban is null or not isfinite(ban) or ban < now()+interval '876000 hours' then
   raise exception 'Auth ban must be finite and long before worker cleanup';
 end if;
 if exists(select from auth.sessions where user_id=a)
    or exists(select from auth.refresh_tokens where session_id=sid)
    or not exists(select from shoppingapp_deletion.tombstones where account_id=a and completed_at is null)
 then raise exception 'Immediate deletion fence failed'; end if;
 perform set_config('request.path','/rpc/apply_item_change',true);
 begin
   perform shoppingapp_deletion.api_guard();
   raise exception 'Old token allowed before cleanup';
 exception when insufficient_privilege then null;
 end;
 insert into shoppingapp_deletion.tombstones(account_id,completed_at) values(b,now()),(c,now());
 perform shoppingapp_deletion.rearm_restored_accounts();
 if (select banned_until from auth.users where id=b) is distinct from now()+interval '150 years'
    or not exists(select from auth.users where id=c and isfinite(banned_until)
       and banned_until>=now()+interval '876000 hours')
    or exists(select from auth.sessions where user_id=c)
    or not exists(select from auth.users where id=d and banned_until='infinity'::timestamptz)
    or not exists(select from auth.sessions where user_id=d)
 then raise exception 'Restore rearm or independent account isolation failed'; end if;
 perform public.process_account_deletions();
 if exists(select from auth.users where id in (a,b,c))
    or not exists(select from auth.users where id=d)
    or (select count(*) from shoppingapp_deletion.tombstones where account_id in (a,b,c) and completed_at is not null)<>3
 then raise exception 'Worker cleanup or tombstone failed'; end if;
 begin
   insert into auth.users(id,email) values(gen_random_uuid(),'finite-a1@example.test');
   raise exception '24 hour restriction bypassed';
 exception when check_violation then null;
 end;
end $$;
rollback;
