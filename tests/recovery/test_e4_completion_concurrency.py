"""Isolated PostgreSQL concurrent completion regression; never targets hosted Supabase."""
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

PSQL = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At"]
OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
LIST = "11111111-1111-4111-8111-111111111111"


def sql(script, *, success=True):
    result = subprocess.run(PSQL, input=script, text=True, capture_output=True, env=os.environ.copy(), timeout=25)
    if success and result.returncode:
        raise AssertionError(f"SQL failed: {result.stderr}")
    return result


def actor(op):
    return sql(f"""
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','{OWNER}',false);
SELECT public.complete_e4_list('{op}','{LIST}',0,'all_purchased');
""", success=False)


def main():
    sql(f"""
INSERT INTO auth.users(id) VALUES ('{OWNER}');
INSERT INTO public.shopping_lists(id,owner_id,name)
 VALUES ('{LIST}','{OWNER}','Concurrent');
INSERT INTO public.shopping_items(id,list_id,name,purchased)
 VALUES ('22222222-2222-4222-8222-222222222222','{LIST}','Apple',true);
""")
    ops = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(actor, ops))
    assert sorted(r.returncode == 0 for r in outcomes) == [False, True], [
        (r.returncode, r.stderr) for r in outcomes
    ]
    sql(f"""
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.e4_archive_completions WHERE owner_id='{OWNER}')<>1
 OR (SELECT count(*) FROM public.e4_archive_items)<>1
 OR (SELECT count(*) FROM public.e4_completion_receipts WHERE owner_id='{OWNER}')<>1
 OR (SELECT revision FROM public.shopping_lists WHERE id='{LIST}')<>1
 OR (SELECT count(*) FROM public.list_changes WHERE list_id='{LIST}')<>1
 THEN RAISE EXCEPTION 'Concurrent completion duplicated or lost updates'; END IF;
END $test$;
DELETE FROM public.e4_completion_receipts;
DELETE FROM public.e4_archive_completions;
DELETE FROM public.shopping_lists WHERE id='{LIST}';
DELETE FROM auth.users WHERE id='{OWNER}';
""")
    print("Concurrent distinct completion operations: exactly one commit, one conflict, no duplicates")


if __name__ == "__main__":
    main()
