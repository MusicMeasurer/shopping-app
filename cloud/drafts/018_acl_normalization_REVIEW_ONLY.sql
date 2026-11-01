-- ShoppingApp · ACL normalization draft (post-001–016)
-- 2026-11-01. Disposable test databases only. NOT production approved.
-- Requires 001–016 installed; no data modifications.
-- NOTE: This patch reproduces explicit role ACL changes from the migration lab.
-- It does NOT prove absence of inherited/PUBLIC grants; test effective privileges separately.
BEGIN;

REVOKE REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Narrow, explicit client table access. RLS is an additional necessary gate.
GRANT SELECT ON TABLE
  public.shopping_lists,
  public.shopping_items,
  public.list_members,
  public.user_notifications
TO authenticated;
GRANT INSERT ON TABLE public.shopping_lists TO authenticated;

-- Explicitly deny direct item/member mutations; item changes use RPC.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.shopping_items,
  public.list_members,
  public.item_operations,
  public.list_changes,
  public.ownership_events,
  public.user_notifications
FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.shopping_lists FROM anon, authenticated;

COMMIT;

-- Review before deployment:
-- 1) pg_has_role/has_table_privilege checks including PUBLIC and inherited grants.
-- 2) Real authenticated A/B and anon PostgREST tests.
-- 3) Fresh install + upgrade with existing rows.
-- 4) Existing 001–016 may have other function defaults; inspect function ACL separately.
