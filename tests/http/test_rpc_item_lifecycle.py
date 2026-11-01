#!/usr/bin/env python3
"""Disposable-lab RPC lifecycle: authorized add/update/delete, replay and B denial.
Writes a uniquely named item to A's existing test list; soft-deletes it in finally.
A failed cleanup must be investigated in the lab. Never run on production.
"""
import os
import sys
import uuid
from test_supabase_auth_ab import KEYS, api, sign_in, get_list
from discover_owned_list import discover_owned_list

def rpc(token, operation, list_id, action, item_id, name=None, purchased=None, version=None):
    payload = {"p_operation": str(operation), "p_list": list_id,
               "p_action": action, "p_item": str(item_id),
               "p_name": name, "p_purchased": purchased,
               "p_expected_version": version}
    return api("/rest/v1/rpc/apply_item_change", method="POST", token=token, payload=payload)

def require_success(label, result):
    status, body = result
    if status != 200 or not isinstance(body, dict) or not isinstance(body.get("item_version"), int):
        raise AssertionError(label + " failed (HTTP " + str(status) + ")")
    return body

def main():
    if any(not os.environ.get(k) for k in KEYS):
        print("NOT RUN: missing required secrets")
        return 2
    if not os.environ["SHOPPINGAPP_TEST_URL"].startswith("https://"):
        print("NOT RUN: HTTPS required")
        return 2
    if os.environ["SHOPPINGAPP_TEST_EMAIL_A"] == os.environ["SHOPPINGAPP_TEST_EMAIL_B"]:
        print("NOT RUN: test users must differ")
        return 2
    # Restrict the endpoint to the known disposable Supabase lab.
    if os.environ["SHOPPINGAPP_TEST_URL"].rstrip("/") != "https://gmrqeubhotjpmtwokfeq.supabase.co":
        print("NOT RUN: endpoint is not the approved disposable lab")
        return 2
    item_id = uuid.uuid4()
    add_operation = uuid.uuid4()
    label = "SHOPPINGAPP_RPC_TEST_" + item_id.hex[:12]
    created = False
    deleted = False
    last_version = None
    try:
        a, b = sign_in("A"), sign_in("B")
        list_id = discover_owned_list(api, a)
        status, owned = api("/rest/v1/shopping_lists?select=id,name&id=eq." + list_id, token=a)
        if status != 200 or not isinstance(owned, list) or len(owned) != 1 or owned[0].get("name") != "SHOPPINGAPP_HTTP_TEST_A":
            raise AssertionError("Refusing to modify a list other than the seeded disposable test list")
        if get_list(b, list_id) != (200, []):
            raise AssertionError("B list isolation prerequisite failed")
        denied = rpc(b, uuid.uuid4(), list_id, "add", uuid.uuid4(), "UNAUTHORIZED_PROBE")
        if denied[0] in (200, 201, 204):
            raise AssertionError("B unauthorized add was accepted")
        add = require_success("A add", rpc(a, add_operation, list_id, "add", item_id, label))
        created = True
        last_version = add["item_version"]
        replay = require_success("A idempotent replay", rpc(a, add_operation, list_id, "add", item_id, label))
        if replay != add:
            raise AssertionError("idempotent replay changed result")
        changed = require_success("A update", rpc(a, uuid.uuid4(), list_id, "update", item_id,
                                                    purchased=True, version=add["item_version"]))
        last_version = changed["item_version"]
        if changed["item_version"] != add["item_version"] + 1:
            raise AssertionError("item version did not advance")
        removed = require_success("A delete", rpc(a, uuid.uuid4(), list_id, "delete", item_id,
                                                    version=changed["item_version"]))
        deleted = True
        last_version = removed["item_version"]
        if removed["item_version"] != changed["item_version"] + 1:
            raise AssertionError("delete version did not advance")
    except Exception as exc:
        print("FAIL: RPC lifecycle (" + type(exc).__name__ + "); no tokens or response bodies logged")
        return 1
    finally:
        if created and not deleted:
            try:
                cleanup = rpc(a, uuid.uuid4(), list_id, "delete", item_id, version=last_version)
                deleted = cleanup[0] == 200
            except Exception:
                pass
            if not deleted:
                print("CLEANUP REQUIRED: synthetic item may remain; inspect disposable lab before rerun")
    print("PASS: A RPC add/update/delete, idempotent replay and B unauthorized add denied")
    print("NOTE: item is soft-deleted; operation/change audit rows remain in disposable lab")
    return 0

if __name__ == "__main__":
    sys.exit(main())
