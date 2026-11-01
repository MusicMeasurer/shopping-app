#!/usr/bin/env python3
"""Read-only-to-infrastructure invitation RPC HTTP smoke test for disposable Supabase.

Requires an isolated test project with 017 installed, Data API enabled explicitly,
a list owned by A, and JWTs for A/B/C (C not a member). Never point at production.
This script creates and revokes invitation records and adds B to the test list.
"""
import json
import os
import sys
import urllib.error
import urllib.request

REQUIRED = ("TEST_SUPABASE_URL", "TEST_SUPABASE_ANON_KEY", "TEST_OWNER_JWT",
            "TEST_INVITEE_JWT", "TEST_OUTSIDER_JWT", "TEST_OWNER_LIST_ID")
missing = [key for key in REQUIRED if not os.getenv(key)]
if missing:
    sys.exit("Missing isolated-test environment variables: " + ", ".join(missing))
url = os.environ["TEST_SUPABASE_URL"].rstrip("/")
if not url.startswith("https://") or "localhost" in url:
    sys.exit("Expected a disposable HTTPS Supabase project URL")
key = os.environ["TEST_SUPABASE_ANON_KEY"]
a, b, c = (os.environ[x] for x in
           ("TEST_OWNER_JWT", "TEST_INVITEE_JWT", "TEST_OUTSIDER_JWT"))
list_id = os.environ["TEST_OWNER_LIST_ID"]

def rpc(name, payload, jwt=None):
    headers = {"apikey": key, "Content-Type": "application/json",
               "Accept": "application/json"}
    if jwt:
        headers["Authorization"] = "Bearer " + jwt
    request = urllib.request.Request(url + "/rest/v1/rpc/" + name,
                                     data=json.dumps(payload).encode(),
                                     headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        # Never print raw responses; they may contain sensitive details.
        return error.code, None

def require(ok, label):
    if not ok:
        raise AssertionError(label)
    print("PASS:", label)

# Negative tests first: they must not create invitation records.
status, _ = rpc("create_list_invitation_link", {"p_list": list_id}, c)
require(status >= 400, "outsider cannot create invitation")
status, _ = rpc("create_list_invitation_link", {"p_list": list_id})
require(status >= 400, "anonymous cannot create invitation")

status, token = rpc("create_list_invitation_link", {"p_list": list_id}, a)
require(status == 200 and isinstance(token, str) and len(token) == 64,
        "owner creates opaque 64-character token")
# Do not print token or its hash.
status, pending = rpc("list_pending_invitation_links", {"p_list": list_id}, a)
require(status == 200 and isinstance(pending, list) and len(pending) >= 1,
        "owner lists pending invitation metadata")
require(all("token_hash" not in item and "token" not in item for item in pending),
        "pending inventory excludes tokens and hashes")
status, _ = rpc("list_pending_invitation_links", {"p_list": list_id}, c)
require(status >= 400, "outsider cannot list pending invitations")

status, accepted = rpc("accept_list_invitation_link", {"p_token": token}, b)
require(status == 200 and accepted == list_id, "invitee accepts token")
status, _ = rpc("accept_list_invitation_link", {"p_token": token}, c)
require(status >= 400, "outsider cannot replay accepted token")

status, token2 = rpc("create_list_invitation_link", {"p_list": list_id}, a)
require(status == 200 and isinstance(token2, str), "owner creates revocable token")
status, pending = rpc("list_pending_invitation_links", {"p_list": list_id}, a)
require(status == 200 and isinstance(pending, list) and len(pending) == 1,
        "one pending token after first acceptance")
invitation_id = pending[0]["invitation_id"]
status, _ = rpc("revoke_list_invitation_link", {"p_invitation": invitation_id}, a)
require(status in (200, 204), "owner revokes pending token")
status, _ = rpc("accept_list_invitation_link", {"p_token": token2}, c)
require(status >= 400, "revoked token cannot be accepted")
print("HTTP smoke checks complete; disposable fixture requires cleanup.")
