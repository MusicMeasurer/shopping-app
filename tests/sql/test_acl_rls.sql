-- Executed by postgres superuser on an ephemeral GitHub Actions service.
-- Tests effective permissions, RLS and identity isolation with SET ROLE.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002');
-- Owner creates one list through the same INSERT permission as a client.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
INSERT INTO public.shopping_lists(id,owner_id,name)
VALUES ('10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001','owner list');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.shopping_lists) <> 1 THEN
  RAISE EXCEPTION 'owner cannot read own list';
 END IF;
 IF has_table_privilege('authenticated','public.shopping_items','INSERT') THEN
  RAISE EXCEPTION 'direct item INSERT permitted';
 END IF;
 IF has_table_privilege('authenticated','public.list_members','INSERT') THEN
  RAISE EXCEPTION 'direct membership INSERT permitted';
 END IF;
END $$;
-- User B cannot see or mutate A's list via direct SQL.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.shopping_lists) <> 0 THEN
  RAISE EXCEPTION 'cross-user list read leaked';
 END IF;
 IF public.can_access_list('10000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'cross-user access helper leaked';
 END IF;
END $$;
-- Anon cannot read private tables, even with an authenticated user claim.
SET LOCAL ROLE anon;
DO $$
BEGIN
 IF has_table_privilege('anon','public.shopping_lists','SELECT') THEN
  RAISE EXCEPTION 'anonymous list SELECT permitted';
 END IF;
 IF has_function_privilege('anon','public.apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint)','EXECUTE') THEN
  RAISE EXCEPTION 'anonymous mutation RPC permitted';
 END IF;
END $$;
ROLLBACK;
