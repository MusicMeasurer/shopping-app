-- Apply only in an approved environment after verifying its Realtime configuration.
BEGIN;

CREATE POLICY shopping_list_revisions_read ON realtime.messages
FOR SELECT TO authenticated
USING (
  extension = 'broadcast'
  AND topic = (SELECT realtime.topic())
  AND topic = 'shopping-lists:' || (SELECT auth.uid())::text
);

-- Keep this namespace isolated even if an environment has broader Realtime policies.
CREATE POLICY shopping_list_revisions_restrict_read ON realtime.messages AS RESTRICTIVE
FOR SELECT TO PUBLIC
USING (
  topic NOT LIKE 'shopping-lists:%'
  OR (extension = 'broadcast'
      AND topic = (SELECT realtime.topic())
      AND topic = 'shopping-lists:' || (SELECT auth.uid())::text)
);

CREATE POLICY shopping_list_revisions_server_only ON realtime.messages AS RESTRICTIVE
FOR INSERT TO PUBLIC
WITH CHECK (topic NOT LIKE 'shopping-lists:%');

CREATE SCHEMA IF NOT EXISTS shoppingapp_internal;
REVOKE ALL ON SCHEMA shoppingapp_internal FROM PUBLIC, anon, authenticated;

-- The trigger is server-owned, including when a client inserts an allowed list.
-- realtime.send runs with its caller's privileges and this topic is server-only.
CREATE FUNCTION shoppingapp_internal.broadcast_shopping_list_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed public.shopping_lists;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.revision = OLD.revision
      AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    changed := OLD;
  ELSE
    changed := NEW;
  END IF;

  PERFORM realtime.send(
    pg_catalog.jsonb_build_object('list_id', changed.id, 'revision', changed.revision),
    'list_revision',
    'shopping-lists:' || changed.owner_id::text,
    true
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION shoppingapp_internal.broadcast_shopping_list_revision() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER shopping_list_revision_broadcast
AFTER INSERT OR UPDATE OF revision, deleted_at OR DELETE ON public.shopping_lists
FOR EACH ROW EXECUTE FUNCTION shoppingapp_internal.broadcast_shopping_list_revision();

COMMIT;
