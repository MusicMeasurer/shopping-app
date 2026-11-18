-- CI-only draft. Do not deploy to hosted environments without security review.
-- Owner-derived, idempotent E4 list creation; no direct client table writes.
create table public.e4_list_create_operations (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,operation_id)
);
alter table public.e4_list_create_operations enable row level security;
revoke all on public.e4_list_create_operations from public, anon, authenticated;

create or replace function public.create_e4_list(
  p_operation uuid, p_name text, p_kind text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text;
  v_prior public.e4_list_create_operations%rowtype;
  v_list public.shopping_lists%rowtype;
  v_result jsonb;
  v_position bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
  end if;
  if v_actor is null or p_operation is null or
     p_name is null or length(trim(p_name)) not between 1 and 120 or
     p_kind is null or p_kind not in ('permanent','oneoff') then
    raise exception 'Invalid list creation';
  end if;
  -- Serialize same-owner creates, including duplicate operation IDs.
  perform 1 from auth.users where id=v_actor for update;
  if not found then raise exception 'Account unavailable'; end if;
  v_hash := md5(pg_catalog.jsonb_build_array(trim(p_name),p_kind)::text);
  select * into v_prior from public.e4_list_create_operations
    where actor_id=v_actor and operation_id=p_operation;
  if found then
    if v_prior.payload_hash <> v_hash then
      raise exception 'Operation ID payload mismatch';
    end if;
    return v_prior.result;
  end if;
  select coalesce(max(position),-1)+1 into v_position
    from public.shopping_lists where owner_id=v_actor and deleted_at is null;
  insert into public.shopping_lists(owner_id,name,kind,position)
    values(v_actor,trim(p_name),p_kind,v_position) returning * into v_list;
  v_result := pg_catalog.jsonb_build_object(
    'operation_id',p_operation,'list_id',v_list.id,'owner_id',v_list.owner_id,
    'name',v_list.name,'kind',v_list.kind,'position',v_list.position,
    'revision',v_list.revision);
  insert into public.e4_list_create_operations(actor_id,operation_id,list_id,payload_hash,result)
    values(v_actor,p_operation,v_list.id,v_hash,v_result);
  return v_result;
end;
$$;
revoke all on function public.create_e4_list(uuid,text,text) from public,anon;
grant execute on function public.create_e4_list(uuid,text,text) to authenticated;
