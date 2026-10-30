# Sync protocol v0.2

Design draft. Not deployed.

Every item mutation uses an operation UUID and expected item version. The server checks current list access, records a durable result for idempotent retries, increments a list revision, and appends a change event in one transaction. Deletion uses a tombstone, not a direct physical delete. Incremental pulls return ordered events including tombstones. Direct client writes must be blocked. Concurrent operations and membership changes require coordinated locking.

Open: retention, initial snapshot, RLS tests, migration from IndexedDB, account isolation, Siri credentials.
