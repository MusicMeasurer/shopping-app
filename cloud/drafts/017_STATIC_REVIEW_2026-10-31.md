# Migration 017 — static review checkpoint (2026-10-31)

Status: REVIEW ONLY. No PostgreSQL compilation or installation of migration 017 has been performed.

## Verified against user-provided live SQL outputs
- Existing functions is_list_owner, remove_list_member, transfer_list_ownership: SECURITY DEFINER, postgres owner, empty search_path, authenticated/service_role grants (no anon/PUBLIC in ACL output).
- list_members primary key (list_id,user_id); FKs to shopping_lists and auth.users, ON DELETE CASCADE.
- list_members privileges: anon SELECT/INSERT false; authenticated SELECT true; authenticated INSERT/UPDATE/DELETE false; RLS enabled.
- Sole reported list_members RLS policy: members_read SELECT authenticated USING can_access_list(list_id).
- can_access_list(uuid): checks shopping_lists.deleted_at IS NULL and (owner_id = auth.uid() OR membership exists). SECURITY DEFINER, empty search_path.

These outputs verify the existing schema and definitions, not invitation RPC behavior.

## Static review of 017_recipient_bound_invitations_REVIEW_ONLY.sql
- Invitation token is UUID and recipient-bound through auth.uid() in accept/finalize/decline.
- Direct table privileges revoked; RPC execute granted to authenticated.
- Mutating RPCs generally acquire shopping_lists row lock before invitation lock, reducing deadlock risk.
- Accept records finalize_after, does not insert membership. Finalize inserts membership after deadline.
- Revoke can mark pending/processing invitation revoked before finalization.
- Finalize replay returns list only if accepted membership still exists; does not re-add after owner removal.
- Current code has no independent compile/run proof. Review of concurrency semantics is not equivalent to testing.

## Open gates / issues
1. **Priority boundary**: after finalize_after, revoke and finalize race for list lock; first lock acquisition wins. Cannot promise priority to network-delayed revocation.
2. **Grace timing**: deadline is recorded in an uncommitted accept transaction; observable post-commit grace may be shorter than 3 seconds under transaction/commit delays. Must define guarantee and test.
3. **Ownership transfer**: pending invitations remain usable after transfer unless new owner revokes; decide intended behavior and test.
4. **Revocation response**: revoke_list_invitation silently does nothing when already accepted/declined; client must not infer success from HTTP 200 alone. Consider explicit result/status.
5. **Recipient discovery**: no UX or safe identifier lookup flow yet.
6. **SQL compilation and concurrency**: disposable PostgreSQL/Supabase execution, role isolation, clock-boundary, parallel requests, and recovery tests pending.
7. **Function ACL / RLS**: audit actual installed 017 objects after installation; current live outputs only cover 001..016.

## Next step
Resolve items 2–4 in SQL/design, then compile/test in disposable DB. Obtain explicit approval before applying migration 017 to the existing Supabase TEST project. Do not merge into production branch before passing validation plan.
