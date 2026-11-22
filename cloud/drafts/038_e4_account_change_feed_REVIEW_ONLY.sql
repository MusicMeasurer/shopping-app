-- Additive draft for the account change feed. Apply only in a disposable
-- database for review. A client needs a consistent initial snapshot before
-- consuming this feed. The storage and retention policy will be reviewed separately.
BEGIN;

CREATE SCHEMA IF NOT EXISTS shoppingapp_internal;
REVOKE ALL ON SCHEMA shoppingapp_internal FROM PUBLIC, anon, authenticated;

CREATE TABLE shoppingapp_internal.account_feed_positions (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  position bigint NOT NULL CHECK (position > 0)
);

CREATE TABLE shoppingapp_internal.account_feed_events (
  account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position bigint NOT NULL CHECK (position > 0),
  entity text NOT NULL CHECK (entity IN ('list', 'item')),
  list_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  deleted boolean NOT NULL,
  snapshot jsonb,
  PRIMARY KEY (account_id, position),
  CHECK ((snapshot IS NULL) = deleted)
);

REVOKE ALL ON shoppingapp_internal.account_feed_positions, shoppingapp_internal.account_feed_events
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION shoppingapp_internal.record_account_feed_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  row_data jsonb;
  account uuid;
  list_key uuid;
  entity_key uuid;
  kind text;
  removed boolean;
  next_position bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
    IF TG_OP = 'UPDATE' AND row_data = to_jsonb(OLD) THEN
      RETURN NULL;
    END IF;
  END IF;

  entity_key := (row_data->>'id')::uuid;
  IF TG_TABLE_NAME = 'shopping_lists' THEN
    kind := 'list';
    list_key := entity_key;
    account := (row_data->>'owner_id')::uuid;
  ELSE
    kind := 'item';
    list_key := (row_data->>'list_id')::uuid;
    SELECT owner_id INTO account FROM public.shopping_lists WHERE id = list_key;
  END IF;

  -- Account cascades are removed with the account. A hard-deleted list has
  -- its own tombstone, including when its items are deleted by cascade.
  IF account IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = account) THEN
    RETURN NULL;
  END IF;

  removed := TG_OP = 'DELETE' OR row_data->>'deleted_at' IS NOT NULL;
  -- This row lock orders successful commits per account. A sequence alone
  -- would let a later commit outrun an open transaction and lose its events.
  INSERT INTO shoppingapp_internal.account_feed_positions AS counter (account_id, position)
  VALUES (account, 1)
  ON CONFLICT (account_id) DO UPDATE SET position = counter.position + 1
  RETURNING position INTO next_position;

  INSERT INTO shoppingapp_internal.account_feed_events
    (account_id, position, entity, list_id, entity_id, deleted, snapshot)
  VALUES (account, next_position, kind, list_key, entity_key, removed,
    CASE WHEN removed THEN NULL ELSE row_data END);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION shoppingapp_internal.record_account_feed_event() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER shopping_list_account_feed
AFTER INSERT OR UPDATE OR DELETE ON public.shopping_lists
FOR EACH ROW EXECUTE FUNCTION shoppingapp_internal.record_account_feed_event();

CREATE TRIGGER shopping_item_account_feed
AFTER INSERT OR UPDATE OR DELETE ON public.shopping_items
FOR EACH ROW EXECUTE FUNCTION shoppingapp_internal.record_account_feed_event();

CREATE FUNCTION public.pull_e4_account_changes(p_after bigint, p_limit integer DEFAULT 200)
RETURNS TABLE(position text, entity text, list_id uuid, entity_id uuid, deleted boolean, snapshot jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Account session required' USING ERRCODE = '42501';
  END IF;
  IF p_after IS NULL OR p_after < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid cursor or page size' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT e.position::text, e.entity, e.list_id, e.entity_id,
    e.deleted OR active_list.id IS NULL,
    CASE WHEN active_list.id IS NOT NULL THEN e.snapshot END
  FROM shoppingapp_internal.account_feed_events e
  LEFT JOIN public.shopping_lists active_list
    ON active_list.id = e.list_id
    AND active_list.owner_id = actor AND active_list.deleted_at IS NULL
  WHERE e.account_id = actor AND e.position > p_after
  ORDER BY e.position
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.pull_e4_account_changes(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pull_e4_account_changes(bigint, integer) TO authenticated;

COMMIT;
