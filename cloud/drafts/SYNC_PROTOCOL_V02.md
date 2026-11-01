# Sync protocol v0.2

Status: DESIGN DRAFT; not deployed or tested.

## Data model
- Each item has stable UUID, version, server timestamps and optional deletion marker.
- Each list has monotonic revision.
- Operation log has actor UUID, operation UUID, canonical payload hash and durable result; uniqueness on actor and operation UUID.
- Change log records list UUID, revision, action and item snapshot. Deleted items generate tombstone events.

## Mutation transaction
1. Resolve actor from authenticated session, never request body.
2. Serialize writes to the target list and check current membership.
3. Check prior operation UUID: identical payload returns saved result; altered payload is rejected.
4. Validate action, item identity and expected version.
5. Apply add/update/soft-delete, increment item version and list revision.
6. Append change event and store operation result in the same transaction.
7. Return result; retry after lost response must not repeat mutation.

## Sync reads
- Fetch ordered events after the last confirmed revision, with bounded pagination.
- Include tombstones for deletions.
- Never use timestamps as cursor.
- Provide full snapshot when change-log retention makes a cursor too old.
- Preserve snapshot consistency with the revision boundary.

## Security and concurrency
- No direct client item INSERT, UPDATE or DELETE; use scoped server operations.
- Membership changes, owner transfers and mutations must coordinate locks.
- Recheck permissions on each operation; expired membership denies reads and writes.
- SQL function ownership, grants, schema access and RLS require test deployment.
- Siri needs a separate list-bound add-only revocable credential and endpoint.

## Local integration
- Migrate IndexedDB v1 without losing item UUIDs.
- Map fixed groceries/household IDs to cloud UUIDs.
- Persist local mutation and pending queue atomically.
- Isolate guest and each signed-in account, including cursors and pending queues.
- Confirm guest-to-cloud import with user before upload.

## Acceptance tests
- Owner, member, outsider and anonymous permission matrix.
- Identical retries create exactly one revision; mismatched retries fail.
- Stale versions fail without overwriting.
- Deleted items disappear on every authorized device after sync.
- Revoked members cannot pull or push.
- Concurrent updates and account switching never mix data.
- Snapshot plus change feed do not skip events.

Open: executable SQL migration, test database, retention policy, invitations, account deletion and Siri endpoint.
