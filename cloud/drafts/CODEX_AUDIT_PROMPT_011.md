# Codex audit instruction — SQL 001–011

Repository: MusicMeasurer/shopping-app
Branch: feature/cloud-schema-draft
Read first: cloud/drafts/CODEX_AUDIT_GATE_011.md

Conduct an independent, detailed READ-ONLY audit of SQL migrations 001–011, including the complete migration sequence, PostgreSQL/Supabase privileges, SECURITY DEFINER boundaries, RLS, membership/ownership concurrency, and account deletion lifecycle.

Write the FULL audit report in ENGLISH, with exact file and line references, severity, exploit/failure scenarios, reproducibility status, minimal safe fixes, and a clear readiness verdict for isolated test DB and production. Distinguish proven-by-code defects, plausible runtime risks, and missing functionality. Do not claim runtime verification without running tests.

SAVE the complete report directly into this SAME branch at:
cloud/drafts/CODEX_AUDIT_REPORT_011.md

Commit ONLY the report file. Do not modify SQL, application files, other documentation, or main. Do not execute SQL against production. After saving, report the commit SHA and direct GitHub file URL. If saving fails, clearly state the failure and provide the report in the conversation instead.

The user's preferred communication language is Russian; the report itself must be English.
