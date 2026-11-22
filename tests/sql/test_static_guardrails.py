#!/usr/bin/env python3
"""Static SQL guardrails. Does NOT execute PostgreSQL or validate RLS behavior."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "cloud/drafts/TEST_MIGRATIONS_ATOMIC_001_016.sql"
PATCH = ROOT / "cloud/drafts/018_acl_normalization_REVIEW_ONLY.sql"
PREFLIGHT = ROOT / "cloud/drafts/SECURITY_PREFLIGHT_READ_ONLY.sql"

def norm(path):
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8").lower())

class SQLStaticGuards(unittest.TestCase):
    def test_files_present(self):
        for path in (BASE, PATCH, PREFLIGHT):
            with self.subTest(path=path.name):
                self.assertTrue(path.is_file())

    def test_atomic_base(self):
        sql = norm(BASE)
        self.assertRegex(sql, r"\bbegin\s*;")
        self.assertTrue(sql.rstrip().endswith("commit;"))

    def test_critical_functions_security_definer(self):
        sql = norm(BASE)
        for fn in ("apply_item_change", "pull_item_changes", "remove_list_member", "transfer_list_ownership"):
            with self.subTest(function=fn):
                self.assertRegex(sql, rf"create or replace function public\.{fn}\s*\(")
                self.assertRegex(sql, rf"revoke all on function public\.{fn}\s*\(")

    def test_patch_grants_only_required_tables(self):
        sql = norm(PATCH)
        self.assertIn("grant select on table", sql)
        self.assertIn("grant insert on table public.shopping_lists to authenticated", sql)
        self.assertIn("revoke references, trigger on all tables in schema public", sql)
        self.assertNotRegex(sql, r"grant\s+(?:all|update|delete|truncate)\s+on\s+table")

    def test_preflight_checks_effective_privileges(self):
        sql = norm(PREFLIGHT)
        for phrase in ("has_table_privilege", "has_function_privilege", "relrowsecurity",
                       "prepare_account_deletion", "unsafe_effective_anon_read_or_write"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, sql)

if __name__ == "__main__":
    unittest.main(verbosity=2)
