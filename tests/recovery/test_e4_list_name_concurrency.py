"""Check that concurrent requests cannot create the same active list name."""
from concurrent.futures import ThreadPoolExecutor
from test_e4_metadata_concurrency import OWNER, sql


def create(name):
    return sql(f"""
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','{OWNER}',false);
SELECT public.create_e4_list(gen_random_uuid(), '{name}', 'permanent');
""", success=False)


def main():
    sql(f"INSERT INTO auth.users(id) VALUES ('{OWNER}');")
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(create, ("Groceries", "  GROCERIES  ")))
        assert sum(result.returncode == 0 for result in results) == 1
        rejected = next(result for result in results if result.returncode != 0)
        assert "List name already exists" in rejected.stderr, rejected.stderr
        count = sql(f"SELECT count(*) FROM public.shopping_lists WHERE owner_id='{OWNER}';")
        assert count.stdout.strip() == "1"
    finally:
        sql(f"DELETE FROM public.shopping_lists WHERE owner_id='{OWNER}'; DELETE FROM auth.users WHERE id='{OWNER}';")


if __name__ == "__main__":
    main()
