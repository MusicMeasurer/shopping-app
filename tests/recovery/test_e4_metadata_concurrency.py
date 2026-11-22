"""Disposable PostgreSQL concurrency regression for E4 list metadata RPC."""
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

PSQL = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At"]
OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
LIST = "11111111-1111-4111-8111-111111111111"


def sql(script, *, success=True):
    result = subprocess.run(
        PSQL, input=script, text=True, capture_output=True,
        env=os.environ.copy(), timeout=25,
    )
    if success and result.returncode:
        raise AssertionError(f"SQL failed: {result.stderr}")
    return result


def actor(operation, name):
    return sql(f"""
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','{OWNER}',false);
SELECT public.apply_e4_list_metadata(
 '{operation}','{LIST}',0,'{name}',null,null);
""", success=False)


def main():
    sql(f"""
INSERT INTO auth.users(id) VALUES ('{OWNER}');
INSERT INTO public.shopping_lists(id,owner_id,name,kind,position)
 VALUES ('{LIST}','{OWNER}','Before','permanent',0);
""")
    operations = [
        ("33333333-3333-4333-8333-333333333333", "First"),
        ("44444444-4444-4444-8444-444444444444", "Second"),
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda args: actor(*args), operations))
    assert sorted(result.returncode == 0 for result in results) == [False, True], [
        (result.returncode, result.stderr) for result in results
    ]
    winner = next(operations[i] for i, result in enumerate(results) if result.returncode == 0)
    loser = next(operations[i] for i, result in enumerate(results) if result.returncode != 0)
    assert "List revision conflict" in next(
        result.stderr for result in results if result.returncode != 0
    ), "Losing request must fail on revision conflict"
    # The winner can replay the same operation without advancing the revision.
    replay = actor(*winner)
    assert replay.returncode == 0, replay.stderr
    sql(f"""
DO $test$
BEGIN
 IF (SELECT revision FROM public.shopping_lists WHERE id='{LIST}')<>1
 OR (SELECT name FROM public.shopping_lists WHERE id='{LIST}')<>'{winner[1]}'
 OR (SELECT count(*) FROM public.e4_list_operations WHERE actor_id='{OWNER}')<>1
 OR EXISTS (SELECT 1 FROM public.e4_list_operations WHERE operation_id='{loser[0]}')
 THEN RAISE EXCEPTION 'Concurrent metadata update lost revision or duplicated receipt'; END IF;
END $test$;
DELETE FROM public.e4_list_operations WHERE actor_id='{OWNER}';
DELETE FROM public.shopping_lists WHERE id='{LIST}';
DELETE FROM auth.users WHERE id='{OWNER}';
""")
    print("Concurrent metadata changes: one commit, one conflict, replay stable")


if __name__ == "__main__":
    main()
