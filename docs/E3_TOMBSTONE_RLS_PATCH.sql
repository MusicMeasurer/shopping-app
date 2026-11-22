-- E3 hosted-lab RLS correction, observed successful 2026-11-07.
-- Apply ONLY after reviewing the target project and existing policy.
-- This is a reviewed patch, NOT an automatically deployed migration.
-- Existing items_read policy was:
-- USING (can_access_list(list_id) AND deleted_at IS NULL)
-- It prevented clients from reading tombstones required for explicit reconciliation.
--
-- Keep authorization restricted to authenticated users with access to the list.
-- The client fetchRemoteItems query still filters active rows by deleted_at IS NULL;
-- fetchRemoteTombstones separately requests deleted_at IS NOT NULL.
ALTER POLICY items_read ON public.shopping_items
  TO authenticated
  USING (public.can_access_list(list_id));

-- Verification query (does not itself prove cross-account RLS):
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'shopping_items'
  AND policyname = 'items_read';

-- Do not broaden INSERT/UPDATE policies or expose privileged RPCs.
-- Hosted disposable lab E3 workflow #5 passed after this correction.
