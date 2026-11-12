#!/usr/bin/env python3
"""Report live-lab function source coverage; read-only and non-deploying."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "cloud" / "drafts"
SNAPSHOT = D / "E4_LAB_RECOVERY_INVENTORY_2026-11-12.md"
SOURCE_FILES = [
    "TEST_MIGRATIONS_ATOMIC_001_016.sql",
    "017_invitation_links_REVIEW_ONLY.sql",
    "018_acl_normalization_REVIEW_ONLY.sql",
    "020_siri_add_REVIEW_ONLY.sql",
    "022_e4_list_metadata_REVIEW_ONLY.sql",
    "023_e4_list_metadata_rpc_REVIEW_ONLY.sql",
]

def main():
    text = SNAPSHOT.read_text(encoding="utf-8")
    match = re.search(r"^## functions\s*\n\s*```json\s*\n(.*?)\n```", text, re.M | re.S)
    if not match:
        raise SystemExit("Missing live function snapshot")
    live = json.loads(match.group(1))
    sources = {}
    for filename in SOURCE_FILES:
        sql = (D / filename).read_text(encoding="utf-8")
        for name in re.findall(
            r"\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z_0-9]*)\s*\(",
            sql, re.I,
        ):
            sources.setdefault(name.lower(), set()).add(filename)
    missing = sorted({row["name"] for row in live} - set(sources))
    print(f"Live function definitions: {len(live)}")
    print(f"Function names found in reviewed draft subset: {len(live) - len(missing)}")
    print("Missing source definitions in reviewed subset:")
    for name in missing:
        print("  -", name)
    print("WARNING: Name coverage does not prove SQL body/signature parity or restore readiness.")
    # Missing functions are explicitly reported, not silently treated as a pass.
    expected_missing = {
        "create_siri_pairing", "exchange_siri_pairing",
        "list_pending_invitation_links", "list_siri_shortcuts",
        "revoke_all_siri_shortcuts", "rls_auto_enable",
    }
    if set(missing) != expected_missing:
        raise SystemExit("Coverage drift: update reconstruction inventory and investigate.")

if __name__ == "__main__":
    main()
