# Independent Codex security audit: draft migrations 013–016

Repository: MusicMeasurer/shopping-app
Branch: feature/cloud-schema-draft
Baseline: cloud/drafts/CODEX_AUDIT_REPORT_011.md
Prior focused review: cloud/drafts/CODEX_REVIEW_012.md

## Task
Independently inspect the full migration chain 001–016, focusing on the newly added migrations 013, 014, 015 and 016. Read the actual repository files, not only summaries. This is a read-only code audit; do not execute SQL against production or edit application/SQL files.

Assess:
1. 013: whether the self-owner row-local SELECT policy fixes INSERT ... RETURNING without granting unauthorized access, including members, deleted lists, and PostgREST.
2. 014: whether replacing the administrative deletion function with a throwing body is fail-closed across privilege paths, whether CREATE OR REPLACE retains unsafe attributes or grants, and whether account deletion is still possible through another path.
3. 015 and 016: PostgreSQL transaction_isolation setting semantics, SQL/plpgsql syntax, preserved signatures/grants, compatibility with real Supabase requests, and whether the READ COMMITTED guards actually close baseline H-03 in the presence of old snapshots and locking.
4. Recheck baseline H-01 and H-02, classify whether disabled account deletion mitigates exposure or resolves the lifecycle.
5. Check regression risk across 001–016, including role privileges, function owner, migration ordering, previous 012, and all mutation/transfer/revocation RPCs. Identify unguarded operations and any assumptions needing runtime verification.

Clearly distinguish: proven static defects, conditional risks, and untested hypotheses. Use Critical/High/Medium/Low with file and line references, precise reproduction scenarios, recommended minimal fixes, and a disposable-database test matrix. Do not claim tests were run.

## Deliverable
Write the complete report in English to cloud/drafts/CODEX_AUDIT_REPORT_016.md on the same branch. Commit ONLY that report file. Do not change main, application source, SQL migrations, or other documents. Return the report URL and commit SHA. If a commit is not possible, provide the report in chat.
