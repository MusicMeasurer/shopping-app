-- E3 REVIEW ONLY. DO NOT APPLY TO PRODUCTION WITHOUT APPROVAL.
-- Requires existing schema 001-016, 003/004 sync protocol, pgcrypto.
-- Server-side Edge Function holds service-role credential; Shortcut holds only
-- an independently revocable random token. Never expose service role to iOS.
create table if not exists public.siri_shortcut_credentials (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 list_id uuid not null references public.shopping_lists(id) on delete cascade,
 token_hash bytea not null unique,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists siri_shortcut_credentials_owner_idx
 on public.siri_shortcut_credentials(owner_id);
alter table public.siri_shortcut_credentials enable row level security;
revoke all on public.siri_shortcut_credentials from public, anon, authenticated;

-- Enrollment requires authenticated user; a server-generated 32-byte token is
-- returned once. DB stores digest only. No broad credential table SELECT grant.
create or replace function public.enroll_siri_shortcut(p_list uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_actor uuid := auth.uid();
 v_token text;
 v_id uuid;
begin
 if v_actor is null or p_list is null then raise exception 'Unauthorized'; end if;
 perform 1 from public.shopping_lists
  where id = p_list and owner_id = v_actor and deleted_at is null for update;
 if not found then raise exception 'List unavailable'; end if;
 -- 32 bytes / 256 bits. hex is suitable for Shortcuts Authorization header.
 v_token := encode(extensions.gen_random_bytes(32), 'hex');
 insert into public.siri_shortcut_credentials(owner_id,list_id,token_hash,expires_at)
 values(v_actor,p_list,extensions.digest(v_token,'sha256'),now()+interval '90 days')
 returning id into v_id;
 return jsonb_build_object('credential_id',v_id,'token',v_token,'expires_in_days',90);
end;
$$;
revoke all on function public.enroll_siri_shortcut(uuid) from public,anon;
grant execute on function public.enroll_siri_shortcut(uuid) to authenticated;

create or replace function public.revoke_siri_shortcut(p_credential uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
 if auth.uid() is null then raise exception 'Unauthorized'; end if;
 update public.siri_shortcut_credentials
 set revoked_at = now()
 where id = p_credential and owner_id = auth.uid() and revoked_at is null;
 return found;
end;
$$;
revoke all on function public.revoke_siri_shortcut(uuid) from public,anon;
grant execute on function public.revoke_siri_shortcut(uuid) to authenticated;

-- Called ONLY by trusted backend with service-role privileges.
-- The operation UUID doubles as stable item UUID for idempotent retries.
-- Lock the credential row to serialize rate-limit and revoke races.
create or replace function public.siri_add_item(
 p_token text, p_operation uuid, p_list uuid, p_name text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_credential public.siri_shortcut_credentials%rowtype;
 v_previous public.item_operations%rowtype;
 v_item public.shopping_items%rowtype;
 v_revision bigint;
 v_hash text;
 v_result jsonb;
begin
 if p_token is null or length(p_token) <> 64 or
    p_token !~ '^[0-9a-f]{64}$' or
    p_operation is null or p_list is null or
    p_name is null or length(trim(p_name)) not between 1 and 120 or
    p_name ~ '[[:cntrl:]]' then
   raise exception 'Invalid request';
 end if;
 select * into v_credential from public.siri_shortcut_credentials
 where token_hash = extensions.digest(p_token,'sha256') for update;
 if not found or v_credential.revoked_at is not null or
    v_credential.expires_at <= now() or v_credential.list_id <> p_list then
   raise exception 'Unauthorized';
 end if;
 perform 1 from public.shopping_lists
 where id = p_list and owner_id = v_credential.owner_id and deleted_at is null
 for update;
 if not found then raise exception 'List unavailable'; end if;
 v_hash := md5(jsonb_build_array(p_list,'add',p_operation,trim(p_name),false,null)::text);
 select * into v_previous from public.item_operations
 where actor_id = v_credential.owner_id and operation_id = p_operation;
 if found then
   if v_previous.payload_hash <> v_hash then raise exception 'Operation mismatch'; end if;
   return v_previous.result;
 end if;
 -- Bound abuse even when a Shortcut credential leaks; per-token sliding hour.
 if (select count(*) from public.siri_shortcut_operations
     where credential_id = v_credential.id and created_at > now()-interval '1 hour') >= 60 then
   raise exception 'Rate limit exceeded';
 end if;
 insert into public.shopping_items(id,list_id,name,purchased)
 values(p_operation,p_list,trim(p_name),false) returning * into v_item;
 update public.shopping_lists set revision=revision+1
 where id=p_list returning revision into v_revision;
 insert into public.list_changes(list_id,revision,item_id,kind,snapshot)
 values(p_list,v_revision,p_operation,'add',
 jsonb_build_object('id',v_item.id,'name',v_item.name,
 'purchased',false,'version',v_item.version,'deleted',false));
 v_result := jsonb_build_object('operation_id',p_operation,
 'list_revision',v_revision,'item_version',v_item.version);
 insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)
 values(v_credential.owner_id,p_operation,p_list,v_hash,v_result);
 insert into public.siri_shortcut_operations(credential_id,operation_id)
 values(v_credential.id,p_operation);
 return v_result;
end;
$$;

create table if not exists public.siri_shortcut_operations (
 credential_id uuid not null references public.siri_shortcut_credentials(id) on delete cascade,
 operation_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(credential_id,operation_id)
);
create index if not exists siri_shortcut_operations_rate_idx
 on public.siri_shortcut_operations(credential_id,created_at);
alter table public.siri_shortcut_operations enable row level security;
revoke all on public.siri_shortcut_operations from public,anon,authenticated;
revoke all on function public.siri_add_item(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.siri_add_item(text,uuid,uuid,text) to service_role;

-- Security review required: privilege grants and schema ownership, search_path,
-- credential lifecycle, auth.uid() during enrollment, rate limiting and RPC
-- behavior must be exercised against a disposable Supabase project.
