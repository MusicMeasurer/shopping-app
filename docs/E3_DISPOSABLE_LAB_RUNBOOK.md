# E3 disposable Supabase integration — manual activation

Status: **not yet executed against hosted Supabase**. The regular E3 CI only compiles and runs unit tests; `src/e3-local-cloud.integration.test.ts` skips when `E3_LAB_URL` is absent.

## Safety boundary
- Test target is **only** `https://gmrqeubhotjpmtwokfeq.supabase.co` (`shoppingapp-migration-lab`).
- The workflow checks the exact URL before running. The test checks it again.
- No service-role key or production credentials are needed. Use a disposable **authenticated test user** that owns a disposable shopping list.
- Tests create uniquely named items and delete them by RPC; tombstones and operation audit records remain. Never use a production account.
- Do not copy passwords or secret values into GitHub issues, commits, chat, or workflow logs.

## One-time GitHub setup (repository administrator)
1. In GitHub repository Settings → Environments, create `e3-lab`. Prefer required reviewer approval if available.
2. Under environment secrets, create:
   - `E3_LAB_URL`: `https://gmrqeubhotjpmtwokfeq.supabase.co`
   - `E3_LAB_PUBLISHABLE_KEY`: publishable `sb_publishable_...` key from the **disposable** lab.
   - `E3_USER_A_EMAIL`: disposable lab user email.
   - `E3_USER_A_PASSWORD`: disposable lab user password.
3. Ensure the disposable test user has a confirmed email and owns at least one non-deleted row in `shopping_lists`.
4. GitHub's manual `workflow_dispatch` workflow must be present on the repository's **default branch** before it appears as a manually runnable workflow. This file currently exists only on `feature/e3-cloud-auth`; **do not merge or deploy solely to make it runnable without reviewing the change**.
5. After the workflow is safely present on the default branch, open Actions → **E3 disposable cloud integration (manual only)** → Run workflow; select `feature/e3-cloud-auth` as the execution branch. Review the run and confirm both integration cases passed.

## Expected coverage
- Durable queued add → server RPC → simulated local receipt interruption → idempotent retry → conflict from another device.
- Server deletion tombstone → local item retained until explicit review → reviewed deletion and recorded version.

## Not covered
- Full iPhone/Siri end-to-end flow, production authentication, real simultaneous multi-user traffic, and the tiny race between last tombstone read and local commit.

Do not mark E3 complete on the basis of ordinary E3 typecheck CI. Record the **real cloud lab run URL and conclusion** first.
