-- Captured from the accepted integration database and verified on the clean-version database.
-- Requires public.e4_completion_receipts and the versioned shopping tables.
CREATE OR REPLACE FUNCTION public.read_e4_completion_tombstones(p_operation uuid)
 RETURNS TABLE(id uuid, list_id uuid, version bigint, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := auth.uid(); v_receipt public.e4_completion_receipts%rowtype;
begin
 if v_actor is null or p_operation is null then raise exception 'Unauthorized completion lookup'; end if;
 select * into v_receipt from public.e4_completion_receipts
 where owner_id=v_actor and operation_id=p_operation;
 if not found then raise exception 'Completion receipt unavailable'; end if;
 return query select i.id,i.list_id,i.version::bigint,i.deleted_at
 from public.shopping_items i
 where i.list_id=v_receipt.list_id and i.deleted_at is not null
   and exists (select 1 from public.shopping_lists l where l.id=i.list_id and l.owner_id=v_actor);
end;
$function$;
revoke execute on function public.read_e4_completion_tombstones(uuid) from public, anon;
grant execute on function public.read_e4_completion_tombstones(uuid) to authenticated;
