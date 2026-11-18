"""Read-only HTTP A/B checks for disposable Supabase. Never print credentials."""
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

def get_list(jwt, list_id):
    base = os.environ["SHOPPINGAPP_TEST_URL"].rstrip("/")
    path = "/rest/v1/shopping_lists?" + urllib.parse.urlencode({"select":"id", "id":"eq."+list_id})
    headers = {"apikey":os.environ["SHOPPINGAPP_TEST_ANON_KEY"],"Accept":"application/json"}
    if jwt:
        headers["Authorization"] = "Bearer " + jwt
    req = urllib.request.Request(base+path,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=15) as response:
            return response.status, json.loads(response.read(32768))
    except urllib.error.HTTPError as exc:
        return exc.code, None

def main():
    keys = ["SHOPPINGAPP_TEST_URL","SHOPPINGAPP_TEST_ANON_KEY","SHOPPINGAPP_TEST_JWT_A","SHOPPINGAPP_TEST_JWT_B","SHOPPINGAPP_TEST_LIST_A"]
    if any(not os.environ.get(k) for k in keys):
        print("NOT RUN: missing configuration")
        return 2
    if os.environ[keys[2]] == os.environ[keys[3]]:
        print("NOT RUN: users must be distinct")
        return 2
    target = os.environ[keys[4]]
    try:
        a = get_list(os.environ[keys[2]],target)
        b = get_list(os.environ[keys[3]],target)
        anon = get_list(None,target)
        assert a[0] == 200 and isinstance(a[1],list) and any(x.get("id")==target for x in a[1])
        assert b == (200, [])
        assert anon[0] in (401,403) or anon == (200,[])
    except Exception:
        print("FAIL: HTTP A/B isolation")
        return 1
    print("PASS: real HTTP A/B and anon read isolation")
    return 0

if __name__ == "__main__":
    sys.exit(main())
