# ShoppingApp sync and Siri integration — design draft 0.1

Status: DESIGN, not implemented. No credentials, hosting or provider configured.

## Local-first contract
- IndexedDB remains authoritative for immediate UI feedback; cloud is a synchronized replica for signed-in users.
- Guest mode requires no account and never sends guest items to the cloud.
- On sign-in, offer an explicit import/merge preview; do not silently upload or overwrite local items.
- Generate stable UUIDs client-side and preserve existing IDs during migration.
- Persist pending mutations transactionally alongside local state; retry with exponential backoff when online.
- Each mutation has operation_id UUID, actor ID, list ID, payload and creation time.
- Server stores operation_id with uniqueness per actor to make retries idempotent.
- Server assigns monotonic list revision (or equivalent cursor) for incremental synchronization.
- Deletions need tombstones visible to authorized sync operations until clients can acknowledge them.
- For concurrent edits, use per-item version preconditions; reject stale updates with conflict payload instead of silently overwriting. UI can ask to resolve conflicts.
- Revocation takes effect on server immediately; previously downloaded offline data cannot be remotely erased while offline. Show access removed on next successful sync.

## Proposed service boundaries
- Domain: List, Item, Membership, Operation.
- LocalRepository: IndexedDB persistence and pending queue.
- RemoteRepository: backend-neutral interface (authenticate, list, pullChanges, pushOperations).
- SyncEngine: migration, push, pull, conflicts, retries and cursor handling.
- Provider adapter: Supabase-specific API/SDK behind RemoteRepository.
- Server endpoint: invitation acceptance and Siri actions, with authorization and rate limits.

## Siri
- Prefer HTTPS POST to a dedicated minimal endpoint with add-item scope and list binding.
- Shortcuts cannot inherit a PWA's browser session automatically.
- Enrollment from authenticated PWA should create a revocable device/shortcut credential, bound to the user and permitted list(s).
- Do not place service-role keys, database passwords, or unrestricted access tokens in Shortcuts.
- A credential in a user-visible Shortcut may be copied by someone with device access; minimize its privileges, support rotation/revocation, and rate-limit.
- Never put credentials or item names in URL query strings; send JSON over HTTPS.
- Request carries operation_id to deduplicate Siri retries.
- If Siri runs without internet, the Shortcut may not submit immediately; provide explicit failure feedback or a separately designed secure queue. Do not claim offline Siri works before tested.

## Open design questions
1. Invitation mechanism: verified email invite + authenticated acceptance.
2. RLS/SQL implementation for tombstones and server-issued list revisions.
3. User-facing merge policy when connecting an existing guest list.
4. Credential enrollment UX on iPhone, including security and revocation.
5. Email provider and deliverability limits; no paid services without approval.

## Verification gates
- SQL migrations run in isolated local/test Supabase with 3 identities and RLS negative tests.
- Offline queue survives app restart, retries without duplication, and handles conflicts.
- Siri can add to an authorized list but cannot read or delete items or add to unauthorized lists.
- Main branch and production PWA remain unchanged until acceptance.
