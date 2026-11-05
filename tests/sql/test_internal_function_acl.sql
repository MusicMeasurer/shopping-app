-- Fail closed on unexpected effective privileges; no mutations.
DO $test$
DECLARE f regprocedure; n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['guard_item_identity()','guard_new_list_metadata()','reject_item_list_change()','set_updated_at()'] LOOP
   f := ('public.' || n)::regprocedure;
   IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE') THEN
      RAISE EXCEPTION 'Internal function callable by client role: %',f;
   END IF;
 END LOOP;
 IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL AND (has_function_privilege('anon',to_regprocedure('public.rls_auto_enable()'),'EXECUTE') OR has_function_privilege('authenticated',to_regprocedure('public.rls_auto_enable()'),'EXECUTE')) THEN
   RAISE EXCEPTION 'Event trigger helper callable by client role';
 END IF;
 FOREACH n IN ARRAY ARRAY['apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint)','pull_item_changes(uuid,bigint,integer)','can_access_list(uuid)'] LOOP
   f := ('public.' || n)::regprocedure;
   IF has_function_privilege('anon',f,'EXECUTE') OR NOT has_function_privilege('authenticated',f,'EXECUTE') THEN
      RAISE EXCEPTION 'Client RPC grants unexpected: %',f;
   END IF;
 END LOOP;
END $test$;
