-- E4 versioned list metadata RPC, REVIEW ONLY. Not executed.
-- Depends on 022_e4_list_metadata_REVIEW_ONLY.sql and existing shopping_lists.
-- Security and hosted A/B tests are mandatory before any deployment.
-- No delete/complete/archive semantics are implemented by this draft.

create table public.e4_list_operations (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, operation_id)
);

alter table public.e4_list_operations enable row level security;
-- No Data API policies: operations are accessible only through the checked RPC.
revoke all on public.e4_list_operations from public, anon, authenticated;

create or replace function public.apply_e4_list_metadata(
  p_operation uuid,
  p_list uuid,
  p_expected_revision bigint,
  p_name text default null,
  p_kind text default null,
  p_position bigint default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text;
  v_prior public.e4_list_operations%rowtype;
  v_list public.shopping_lists%rowtype;
  v_result jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if v_actor is null or p_operation is null or p_list is null or
     p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid actor, operation, list or revision';
  end if;
  if p_name is null and p_kind is null and p_position is null then
    raise exception 'Empty metadata mutation';
  end if;
  if p_name is not null and length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid list name';
  end if;
  if p_kind is not null and p_kind not in ('permanent', 'oneoff') then
    raise exception 'Invalid list kind';
  end if;
  if p_position is not null and p_position < 0 then
    raise exception 'Invalid list position';
  end if;

  -- Lock before checking owner, idempotency, or revision. Do not expose
  -- whether a foreign list exists via different error paths.
  select * into v_list from public.shopping_lists
    where id = p_list and owner_id = v_actor and deleted_at is null
    for update;
  if not found then raise exception 'List unavailable'; end if;

  v_hash := md5(pg_catalog.jsonb_build_array(
    p_list, p_expected_revision, p_name, p_kind, p_position)::text);
  select * into v_prior from public.e4_list_operations
    where actor_id = v_actor and operation_id = p_operation;
  if found then
    if v_prior.payload_hash <> v_hash or v_prior.list_id <> p_list then
      raise exception 'Operation ID payload mismatch';
    end if;
    return v_prior.result;
  end if;
  if v_list.revision <> p_expected_revision then
    raise exception 'List revision conflict';
  end if;

  update public.shopping_lists
    set name = coalesce(trim(p_name), name),
        kind = coalesce(p_kind, kind),
        position = coalesce(p_position, position),
        revision = revision + 1
    where id = p_list and owner_id = v_actor and deleted_at is null
    returning * into v_list;
  if not found then raise exception 'List unavailable'; end if;

  v_result := pg_catalog.jsonb_build_object(
    'operation_id', p_operation, 'list_id', p_list,
    'revision', v_list.revision, 'name', v_list.name,
    'kind', v_list.kind, 'position', v_list.position);
  insert into public.e4_list_operations(actor_id,operation_id,list_id,payload_hash,result)
    values(v_actor,p_operation,p_list,v_hash,v_result);
  return v_result;
end;
$$;

revoke all on function public.apply_e4_list_metadata(uuid,uuid,bigint,text,text,bigint)
  from public, anon;
grant execute on function public.apply_e4_list_metadata(uuid,uuid,bigint,text,text,bigint)
  to authenticated;

-- RELEASE BLOCKERS:
-- 1. Direct shopping_lists UPDATE grants/RLS can bypass this RPC's revision gate;
--    restrict direct metadata updates without breaking legacy E3 and ownership RPCs.
-- 2. Validate owner-only mutations, anonymous and foreign-account failures,
--    repeated operation ID same/different payload, stale revision, concurrent edits.
-- 3. No offline queue or account UI wiring yet; no archive or deletion handling.
-- 4. Operation table may need dedicated retention and account deletion tests.
