-- ShoppingApp draft 013: make self-owned INSERT ... RETURNING compatible with RLS.
-- Apply after 012 in a disposable test database only.
-- No production deployment or runtime verification.
--
-- PostgreSQL may check the SELECT policy before the newly inserted row
-- exists when INSERT ... RETURNING requests a representation. A row-local
-- owner check allows the new owner's row without querying it by id.
-- Member reads still require the existing scoped membership helper.
drop policy if exists lists_read on public.shopping_lists;
create policy lists_read on public.shopping_lists
for select to authenticated
using (
  deleted_at is null
  and (
    owner_id = (select auth.uid())
    or public.can_access_list(id)
  )
);

-- This does not grant INSERT/SELECT table privileges; the existing role ACL
-- must be verified in a disposable Supabase/PostgREST test environment.
-- Regression tests: self-owned INSERT RETURNING; outsider SELECT denial;
-- member SELECT allowed; deleted list hidden; wrong-owner INSERT denied;
-- revoked member denied; no change to ownership-transfer RPC.
-- H-01/H-02/H-03 from CODEX_AUDIT_REPORT_011.md remain unresolved.
