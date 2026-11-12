#!/usr/bin/env python3
"""Read-only recovery inventory integrity and source coverage checks.

Does not execute SQL, provision Supabase, or claim a successful restore.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INVENTORY = ROOT / "cloud/drafts/E4_LAB_RECOVERY_INVENTORY_2026-11-12.md"
DRAFTS = ROOT / "cloud/drafts"


def section(document, name):
    match = re.search(r"^## " + re.escape(name) + r"\s*\n\s*```json\s*\n(.*?)\n```", document, re.M | re.S)
    if not match:
        raise ValueError(f"Missing inventory section: {name}")
    return json.loads(match.group(1))


class RecoveryInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = INVENTORY.read_text(encoding="utf-8")
        cls.functions = section(cls.text, "functions")
        cls.policies = section(cls.text, "policies")
        cls.triggers = section(cls.text, "triggers")
        cls.grants = section(cls.text, "grants")

    def test_all_function_bodies_present_and_unique(self):
        signatures = [(row["name"], row["args"]) for row in self.functions]
        self.assertEqual(len(signatures), len(set(signatures)))
        self.assertGreaterEqual(len(signatures), 20)
        for row in self.functions:
            with self.subTest(function=row["name"]):
                self.assertIn("CREATE OR REPLACE FUNCTION", row["definition"].upper())
                self.assertIn(row["name"], row["definition"])

    def test_access_controls_and_triggers_are_captured(self):
        self.assertGreater(len(self.policies), 0)
        self.assertGreater(len(self.triggers), 0)
        self.assertGreater(len(self.grants), 0)
        for row in self.policies:
            self.assertTrue(row["tablename"] and row["policyname"])

    def test_siri_edge_source_is_captured_without_runtime_secrets(self):
        for slug in ("siri-add", "siri-pair"):
            edge = section(self.text, "edge_" + slug)
            self.assertIn("verify_jwt", edge)
            self.assertTrue(any(f["name"] == "index.ts" and "Deno.serve" in f["content"] for f in edge["files"]))

    def test_baseline_and_inventory_sources_exist(self):
        self.assertTrue((DRAFTS / "TEST_MIGRATIONS_ATOMIC_001_016.sql").exists())
        self.assertTrue((DRAFTS / "018_acl_normalization_REVIEW_ONLY.sql").exists())
        self.assertTrue((DRAFTS / "020_siri_add_REVIEW_ONLY.sql").exists())
        self.assertIn("not a complete pg_dump", self.text.lower())

    def test_schema_metadata_snapshot_is_complete_enough_for_comparison(self):
        schema = (DRAFTS / "E4_LAB_SCHEMA_METADATA_2026-11-12.md").read_text(encoding="utf-8")
        columns = section(schema, "columns")
        constraints = section(schema, "constraints")
        indexes = section(schema, "indexes")
        extensions = section(schema, "extensions")
        self.assertGreaterEqual(len(columns), 60)
        self.assertGreaterEqual(len(constraints), 30)
        self.assertGreaterEqual(len(indexes), 15)
        self.assertGreaterEqual(len(extensions), 3)
        names = {(c["table_name"], c["column_name"]) for c in columns}
        for key in (("shopping_lists", "revision"), ("shopping_items", "quantity"),
                    ("shopping_items", "unit"), ("item_operations", "operation_id")):
            self.assertIn(key, names)
        self.assertFalse(any(c["table_name"].startswith("archive_") for c in columns))

    def test_recovery_inventory_has_no_known_token_patterns(self):
        self.assertNotRegex(self.text, r"(?i)(?:service_role|supabase_service_role_key)\s*[:=]\s*['\"][A-Za-z0-9._-]{25,}")
        self.assertNotRegex(self.text, r"postgres(?:ql)?://[^\s]+:[^\s]+@")

    def test_report_sql_function_name_coverage(self):
        # A name-level audit only: SQL definition equality and restore need a real DB.
        sources = "\n".join(p.read_text(encoding="utf-8") for p in DRAFTS.glob("*.sql"))
        declared = set(re.findall(r"\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z_0-9]*)\s*\(", sources, re.I))
        live = {row["name"] for row in self.functions}
        missing = sorted(live - declared)
        print(f"\nInventory functions: {len(live)}; present by name in draft SQL: {len(live)-len(missing)}")
        print("Not found by name in current draft SQL (manual reconstruction required):", missing)
        self.assertIn("apply_item_change", declared)
        self.assertIn("pull_item_changes", declared)


if __name__ == "__main__":
    unittest.main(verbosity=2)
