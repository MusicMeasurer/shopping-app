-- Additive draft for the account change feed. Apply only in a disposable
-- database for review. A client needs a consistent initial snapshot before
-- consuming this feed. The storage and retention policy will be reviewed separately.
BEGIN;

CREATE SCHEMA IF NOT EXISTS shoppingapp_internal;
REVOKE ALL ON SCHEMA shoppingapp_internal FROM PUBLIC, anon, authenticated;

CREATE TABLE shoppingapp_internal.account_feed_positions (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  event_position bigint NOT NULL CHECK (event_position > 0)
);

CREATE TABLE shoppingapp_internal.account_feed_events (
  account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_position bigint NOT NULL CHECK (event_position > 0),
  entity text NOT NULL CHECK (entity IN ('list', 'item')),
  list_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  deleted boolean NOT NULL,
  snapshot jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_position),
  CHECK ((snapshot IS NULL) = deleted)
);

REVOKE ALL ON shoppingapp_internal.account_feed_positions, shoppingapp_internal.account_feed_events
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION shoppingapp_internal.append_account_feed_event(
  account uuid, kind text, list_key uuid, entity_key uuid, removed boolean, row_data jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  next_position bigint;
BEGIN
  IF account IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = account) THEN
    RETURN;
  END IF;
  -- This row lock orders successful commits per account. A sequence alone
  -- would let a later commit outrun an open transaction and lose its events.
  INSERT INTO shoppingapp_internal.account_feed_positions AS counter (account_id, event_position)
  VALUES (account, 1)
  ON CONFLICT (account_id) DO UPDATE SET event_position = counter.event_position + 1
  RETURNING event_position INTO next_position;

  INSERT INTO shoppingapp_internal.account_feed_events
    (account_id, event_position, entity, list_id, entity_id, deleted, snapshot)
  VALUES (account, next_position, kind, list_key, entity_key, removed,
    CASE WHEN removed THEN NULL ELSE row_data END);
END;
$$;

REVOKE ALL ON FUNCTION shoppingapp_internal.append_account_feed_event(uuid, text, uuid, uuid, boolean, jsonb)
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
  former_owner uuid;
  transferred_item public.shopping_items;
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
    IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      former_owner := OLD.owner_id;
    END IF;
  ELSE
    kind := 'item';
    list_key := (row_data->>'list_id')::uuid;
    SELECT owner_id INTO account FROM public.shopping_lists WHERE id = list_key;
  END IF;

  removed := TG_OP = 'DELETE' OR row_data->>'deleted_at' IS NOT NULL;
  -- Preserve the old owner's removal and send the new owner the existing
  -- purchases as well as the list. Ordinary updates still emit one row.
  IF former_owner IS NOT NULL THEN
    PERFORM shoppingapp_internal.append_account_feed_event(former_owner, 'list', list_key, list_key, true, NULL);
  END IF;
  PERFORM shoppingapp_internal.append_account_feed_event(account, kind, list_key, entity_key, removed, row_data);
  IF former_owner IS NOT NULL AND NOT removed THEN
    FOR transferred_item IN SELECT * FROM public.shopping_items WHERE list_id = list_key AND deleted_at IS NULL
    LOOP
      PERFORM shoppingapp_internal.append_account_feed_event(account, 'item', list_key, transferred_item.id,
        false, to_jsonb(transferred_item));
    END LOOP;
  END IF;
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

CREATE FUNCTION public.pull_e4_account_changes(p_account uuid, p_after bigint, p_limit integer DEFAULT 200)
RETURNS TABLE(event_position text, entity text, list_id uuid, entity_id uuid, deleted boolean, snapshot jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF p_account IS NULL OR actor IS DISTINCT FROM p_account THEN
    RAISE EXCEPTION 'Account session mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_after IS NULL OR p_after < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid cursor or page size' USING ERRCODE = '22023';
  END IF;

  IF p_after > COALESCE((SELECT c.event_position
      FROM shoppingapp_internal.account_feed_positions c WHERE c.account_id = actor), 0)
    OR (p_after < COALESCE((SELECT min(first.event_position)
      FROM shoppingapp_internal.account_feed_events first WHERE first.account_id = actor),
      (SELECT c.event_position + 1 FROM shoppingapp_internal.account_feed_positions c WHERE c.account_id = actor), 1) - 1) THEN
    RAISE EXCEPTION 'Account feed cursor expired' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY SELECT e.event_position::text, e.entity, e.list_id, e.entity_id,
    e.deleted OR active_list.id IS NULL,
    CASE WHEN active_list.id IS NOT NULL THEN e.snapshot END
  FROM shoppingapp_internal.account_feed_events e
  LEFT JOIN public.shopping_lists active_list
    ON active_list.id = e.list_id
    AND active_list.owner_id = actor AND active_list.deleted_at IS NULL
  WHERE e.account_id = actor AND e.event_position > p_after
  ORDER BY e.event_position
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.pull_e4_account_changes(uuid, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pull_e4_account_changes(uuid, bigint, integer) TO authenticated;

-- A single statement sees the snapshot and its watermark under the same MVCC view.
CREATE FUNCTION public.snapshot_e4_account_changes(p_account uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH lists AS MATERIALIZED (
    SELECT * FROM public.shopping_lists WHERE owner_id = auth.uid() AND deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'position', COALESCE((SELECT c.event_position::text
      FROM shoppingapp_internal.account_feed_positions c WHERE c.account_id = auth.uid()), '0'),
    'lists', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM lists l), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i))
      FROM public.shopping_items i JOIN lists l ON l.id = i.list_id WHERE i.deleted_at IS NULL), '[]'::jsonb)
  ) WHERE p_account = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.snapshot_e4_account_changes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snapshot_e4_account_changes(uuid) TO authenticated;

-- Use the existing mutation receipts and version checks. Each operation has
-- its own outcome so a rejected edit cannot roll back an unrelated edit.
CREATE FUNCTION public.push_e4_account_changes(p_account uuid, p_operations jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  operation jsonb;
  operation_key uuid;
  list_key uuid;
  item_key uuid;
  kind text;
  receipt jsonb;
  results jsonb := '[]'::jsonb;
BEGIN
  IF p_account IS NULL OR actor IS DISTINCT FROM p_account THEN
    RAISE EXCEPTION 'Account session mismatch' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_operations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Expected an array of operations' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_operations) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid batch size' USING ERRCODE = '22023';
  END IF;

  -- Take the same list locks as the item RPCs, in deterministic order.
  PERFORM 1 FROM public.shopping_lists AS lists
  WHERE lists.owner_id = actor AND lists.deleted_at IS NULL
    AND lists.id::text IN (
      SELECT lower(entry->>'list_id') FROM jsonb_array_elements(p_operations) AS elements(entry)
    )
  ORDER BY lists.id FOR UPDATE;

  FOR operation IN SELECT entry FROM jsonb_array_elements(p_operations) AS elements(entry)
  LOOP
    BEGIN
      operation_key := (operation->>'operation_id')::uuid;
      list_key := (operation->>'list_id')::uuid;
      item_key := (operation->>'item_id')::uuid;
      kind := operation->>'kind';
      IF NOT EXISTS (
        SELECT 1 FROM public.shopping_lists
        WHERE id = list_key AND owner_id = actor AND deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'List unavailable' USING ERRCODE = '42501';
      END IF;
      IF kind = 'add' AND operation->>'created_at' IS NOT NULL THEN
        receipt := public.add_e4_ordered_item(
          operation_key, list_key, item_key, operation->>'name',
          (operation->>'purchased')::boolean, (operation->>'quantity')::numeric,
          operation->>'unit', (operation->>'created_at')::timestamptz
        );
      ELSIF operation ? 'quantity' OR operation ? 'unit' THEN
        receipt := public.apply_e4_item_change(
          operation_key, list_key, kind, item_key, operation->>'name',
          (operation->>'purchased')::boolean, (operation->>'expected_version')::bigint,
          (operation->>'quantity')::numeric, operation->>'unit'
        );
      ELSE
        receipt := public.apply_item_change(
          operation_key, list_key, kind, item_key, operation->>'name',
          (operation->>'purchased')::boolean, (operation->>'expected_version')::bigint
        );
      END IF;
      results := results || jsonb_build_array(jsonb_build_object('receipt', receipt));
    EXCEPTION
      WHEN serialization_failure OR deadlock_detected THEN RAISE;
      WHEN data_exception OR integrity_constraint_violation OR insufficient_privilege OR raise_exception THEN
        results := results || jsonb_build_array(jsonb_build_object(
          'operation_id', operation->>'operation_id', 'code', SQLSTATE,
          'message', CASE WHEN SQLSTATE = 'P0001' THEN SQLERRM ELSE 'Operation rejected' END
        ));
    END;
  END LOOP;
  RETURN results;
END;
$$;

REVOKE ALL ON FUNCTION public.push_e4_account_changes(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_e4_account_changes(uuid, jsonb) TO authenticated;

COMMIT;
