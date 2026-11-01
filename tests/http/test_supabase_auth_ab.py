#!/usr/bin/env python3
"""Read-only A/B HTTP probe using Supabase Auth password grant.

Disposable lab only. Never prints tokens, passwords, response bodies or URLs.
Exit 2 means not configured, not a passing test.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from discover_owned_list import discover_owned_list

KEYS = ("SHOPPINGAPP_TEST_URL", "SHOPPINGAPP_TEST_ANON_KEY",
        "SHOPPINGAPP_TEST_EMAIL_A", "SHOPPINGAPP_TEST_PASSWORD_A",
        "SHOPPINGAPP_TEST_EMAIL_B", "SHOPPINGAPP_TEST_PASSWORD_B",
)

def api(path, method="GET", token=None, payload=None):
    url = os.environ["SHOPPINGAPP_TEST_URL"].rstrip("/") + path
    headers = {"apikey": os.environ["SHOPPINGAPP_TEST_ANON_KEY"],
               "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read(32768))
    except urllib.error.HTTPError as exc:
        return exc.code, None

def sign_in(who):
    status, body = api("/auth/v1/token?grant_type=password", method="POST",
        payload={"email": os.environ["SHOPPINGAPP_TEST_EMAIL_"+who],
                 "password": os.environ["SHOPPINGAPP_TEST_PASSWORD_"+who]})
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        raise AssertionError("Authentication failed for test user "+who)
    return body["access_token"]

def get_list(token, list_id):
    query = urllib.parse.urlencode({"select": "id", "id": "eq."+list_id})
    return api("/rest/v1/shopping_lists?"+query, token=token)

def main():
    if any(not os.environ.get(key) for key in KEYS):
        print("NOT RUN: missing required environment variables")
        return 2
    if os.environ["SHOPPINGAPP_TEST_EMAIL_A"] == os.environ["SHOPPINGAPP_TEST_EMAIL_B"]:
        print("NOT RUN: A and B must be distinct accounts")
        return 2
    if not os.environ["SHOPPINGAPP_TEST_URL"].startswith("https://"):
        print("NOT RUN: HTTPS project URL required")
        return 2
    try:
        a, b = sign_in("A"), sign_in("B")
        if a == b:
            raise AssertionError("Identical access tokens")
        list_id = discover_owned_list(api, a)
        owner = get_list(a, list_id)
        other = get_list(b, list_id)
        anonymous = get_list(None, list_id)
        if not (owner[0] == 200 and isinstance(owner[1], list) and
                any(isinstance(row, dict) and row.get("id") == list_id for row in owner[1])):
            raise AssertionError("A cannot read seeded list")
        if other != (200, []):
            raise AssertionError("B sees list or query failed")
        if not (anonymous[0] in (401, 403) or anonymous == (200, [])):
            raise AssertionError("Anonymous access exposed list or unexpected status")
    except Exception:
        print("FAIL: auth or read-isolation check failed; no sensitive details logged")
        return 1
    print("PASS: real Supabase Auth login and HTTP list isolation A/B/anon")
    return 0

if __name__ == "__main__":
    sys.exit(main())
