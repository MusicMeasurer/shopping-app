# Supabase HTTP integration tests

Status: planned, not executed.

Use only an isolated disposable project with two distinct test users and one list owned by A. Verify that A can read it, B cannot, and anonymous requests cannot. No production access and no credentials in the repository.

The PostgreSQL CI shim is not a substitute for real JWT and PostgREST testing. An authenticated negative RPC test and concurrency checks will follow.
