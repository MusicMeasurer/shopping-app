#!/usr/bin/env python3
"""Preflight for disposable lab Auth sessions. Does not enable Data API or modify DB.
Use existing lab-only email/password accounts; no credentials in GitHub or logs.
"""
import json, os, sys, urllib.request, urllib.error, uuid
BASE="https://gmrqeubhotjpmtwokfeq.supabase.co"
KEY=os.getenv("TEST_SUPABASE_ANON_KEY","")
ROLES=("OWNER","INVITEE","OUTSIDER")
if not KEY: sys.exit("Missing TEST_SUPABASE_ANON_KEY")
sessions={}
for role in ROLES:
    email=os.getenv(f"TEST_{role}_EMAIL")
    password=os.getenv(f"TEST_{role}_PASSWORD")
    if not email or not password: sys.exit(f"Missing TEST_{role}_EMAIL/PASSWORD")
    req=urllib.request.Request(BASE+"/auth/v1/token?grant_type=password",
        data=json.dumps({"email":email,"password":password}).encode(),
        headers={"apikey":KEY,"Content-Type":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=15) as res:
            data=json.load(res)
    except urllib.error.HTTPError as exc:
        sys.exit(f"{role} authentication failed (HTTP {exc.code}); check account and email confirmation")
    token=data.get("access_token")
    user=data.get("user") or {}
    if not token or not user.get("id"): sys.exit(f"{role} missing real Auth session")
    sessions[role]={"jwt":token,"id":user["id"]}
if len({s["id"] for s in sessions.values()})!=3:
    sys.exit("Three distinct Auth accounts required")
print("PASS: three distinct genuine lab Auth sessions (JWTs not printed)")
# For security, keep tokens in process memory. Invoke the existing test in-process.
for role,envname in (("OWNER","TEST_OWNER_JWT"),("INVITEE","TEST_INVITEE_JWT"),("OUTSIDER","TEST_OUTSIDER_JWT")):
    os.environ[envname]=sessions[role]["jwt"]
os.environ["TEST_SUPABASE_URL"]=BASE
if os.getenv("TEST_RUN_INVITATION_HTTP")!="YES":
    print("Preflight only. Set TEST_RUN_INVITATION_HTTP=YES to execute mutating RPC tests.")
    sys.exit(0)
if not os.getenv("TEST_OWNER_LIST_ID"):
    sys.exit("Missing TEST_OWNER_LIST_ID; create a lab list owned by OWNER first")
import runpy
runpy.run_path(os.path.join(os.path.dirname(__file__),"test_invitation_rpc.py"),run_name="__main__")
