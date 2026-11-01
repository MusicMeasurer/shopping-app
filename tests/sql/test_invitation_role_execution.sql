-- Audit 017: simulate real SQL execution as anon and authenticated.
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM public.accept_list_invitation_link(repeat('a',64));
  RAISE EXCEPTION 'anon executed accept';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM count(*) FROM public.list_invitation_links;
  RAISE EXCEPTION 'anon read invitation table';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 BEGIN
  INSERT INTO public.list_members(list_id,user_id)
   VALUES ('10000000-0000-4000-8000-000000000099',
           '00000000-0000-4000-8000-000000000099');
  RAISE EXCEPTION 'authenticated wrote membership';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM count(*) FROM public.list_invitation_links;
  RAISE EXCEPTION 'authenticated read invitation table';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK;
