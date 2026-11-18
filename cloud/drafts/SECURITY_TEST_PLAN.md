# Cloud schema security review — draft

Status: DESIGN ONLY. Not deployed, not executed. The SQL draft is **not production-ready**.

## Expected access tests (use three separate authenticated identities A, B, C)

1. A creates list L. A reads and edits L and its items.
2. B and C cannot read L or its items without membership.
3. A adds B as a member only through a future invitation flow; B can read/add/toggle/delete items.
4. B cannot rename or delete L; B cannot add C or remove A.
5. C cannot guess an item UUID and read/change/delete it.
6. B can leave L; after removal B loses access to L and its items.
7. Unauthenticated requests cannot read or write any cloud data.
8. A cannot change L.owner_id through the public client; B cannot reassign an item to a different list.
9. Soft-deleted records are excluded from ordinary reads and sync handles tombstones correctly.
10. Concurrent offline edits, retries, duplicate Siri requests and revoked sessions do not create duplicates or overwrite newer data.

## Known blockers

- Direct INSERT into list_members must be removed from client permissions and replaced with verified invitation acceptance; owner may otherwise add arbitrary known user IDs without consent.
- UPDATE policies alone do not protect owner_id and list_id columns from reassignment; add column-level protection or immutable-column triggers.
- RLS has not been exercised against a real Supabase project. SECURITY DEFINER function ownership and grants must be audited.
- The local IndexedDB schema uses fixed list IDs and no sync queue. Migration must preserve existing items.
- No API, SMTP provider, credentials, or paid service has been configured.

## Acceptance

Only after database-level tests pass for all three identities, with privilege escalation and negative tests, can the schema be considered ready for integration.
