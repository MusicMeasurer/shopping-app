#!/usr/bin/env python3
"""Read-only verification of write ACL denials against disposable lab.

POSTs must be rejected by table privileges before any row is inserted.
No test writes are expected or permitted.
"""
import sys
from test_supabase_auth_ab import KEYS, api, sign_in, discover_owned_list
import os

def main():
    if any(not os.environ.get(key) for key in KEYS):
        print("NOT RUN: missing configuration")
        return 2
    try:
        a = sign_in("A")
        b = sign_in("B")
        list_id = discover_owned_list(api, a)
        cases = [
            ("A direct item INSERT", a, "/rest/v1/shopping_items",
             {"list_id": list_id, "name": "ACL_DENIAL_PROBE"}),
            ("B direct item INSERT", b, "/rest/v1/shopping_items",
             {"list_id": list_id, "name": "ACL_DENIAL_PROBE"}),
            ("B direct member INSERT", b, "/rest/v1/list_members",
             {"list_id": list_id, "user_id": "00000000-0000-4000-8000-000000000001"}),
            ("anon direct item INSERT", None, "/rest/v1/shopping_items",
             {"list_id": list_id, "name": "ACL_DENIAL_PROBE"}),
        ]
        for label, token, path, payload in cases:
            status, _ = api(path, method="POST", token=token, payload=payload)
            if status not in (401, 403):
                raise AssertionError(label + ": unexpected status " + str(status))
    except Exception:
        print("FAIL: direct write denial check; inspect permissions before retry")
        return 1
    print("PASS: direct item/member INSERT denied for A/B/anon")
    return 0

if __name__ == "__main__":
    sys.exit(main())
