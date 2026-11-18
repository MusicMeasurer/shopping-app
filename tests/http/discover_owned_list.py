"""Discover an existing list owned by A; no writes and no secrets printed."""
import urllib.parse

def discover_owned_list(api, token):
    status, profile = api("/auth/v1/user", token=token)
    if status != 200 or not isinstance(profile, dict) or not profile.get("id"):
        raise AssertionError("Cannot verify owner identity")
    query = urllib.parse.urlencode({"select": "id", "owner_id": "eq." + profile["id"], "limit": "1"})
    status, rows = api("/rest/v1/shopping_lists?" + query, token=token)
    if status != 200 or not isinstance(rows, list) or not rows:
        raise AssertionError("No A-owned list found")
    return rows[0]["id"]
