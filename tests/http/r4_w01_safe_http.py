"""R4-W01 laboratory-only negative HTTP acceptance. Never prints bodies or credentials."""
import json
import os
import pathlib
import re
import secrets
import sys
import urllib.error
import urllib.request
import uuid

BASE = "https://gmrqeubhotjpmtwokfeq.supabase.co"
EMAIL = "r4-w01-20261126@example.invalid"
# Reuse the already published client key from the pinned laboratory workflow.
source = pathlib.Path(".github/workflows/e3-e4-cloud-browser.yml").read_text()
key = re.search(r"(?m)^\s*E3E4_LAB_PUBLISHABLE_KEY:\s*(sb_publishable_[A-Za-z0-9_-]+)\s*$", source)
assert key, "Missing existing laboratory publishable key"
KEY = key.group(1)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
opener = urllib.request.build_opener(NoRedirect())
failures = 0

def call(path, body=None, token=None, method=None):
    assert path.startswith(("/auth/v1/", "/rest/v1/rpc/", "/functions/v1/"))
    h = {"apikey": KEY, "Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers=h, method=method or ("GET" if body is None else "POST"))
    try:
        with opener.open(req, timeout=15) as response:
            status, data = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, data = error.code, error.read()
    except (OSError, ValueError):
        return 0, None
    try:
        return status, json.loads(data)
    except (ValueError, UnicodeError):
        return status, None

def report(label, status, data, passed, inconclusive=False):
    global failures
    code = ""
    if isinstance(data, dict):
        val = data.get("error_code") or data.get("code")
        if isinstance(val, str) and re.fullmatch(r"[A-Za-z0-9_]{1,60}", val):
            code = val
    result = "PASS" if passed else "INCONCLUSIVE" if inconclusive else "FAIL"
    print(f"{result} {label}: HTTP {status} {code}", flush=True)
    if not passed:
        failures += 1

def denied(status, data):
    return status in (401, 403) and isinstance(data, dict) and data.get("code") == "42501"

def rpc_negative(label, body, token=None):
    status, data = call("/rest/v1/rpc/" + label, body, token)
    report(label, status, data, denied(status, data),
           status == 404 and isinstance(data, dict) and data.get("code") == "PGRST202")

def old_and_service_rpcs(token=None):
    account, device, proof, job, lease = [str(uuid.uuid4()) for _ in range(5)]
    triple = {"p_account": account, "p_device": device, "p_proof": proof}
    rpc_negative("registration_email_status", {"p_email": EMAIL}, token)
    rpc_negative("account_deletion_status", {"p_account": account}, token)
    rpc_negative("acknowledge_account_deletion", triple, token)
    # No real registration/queue entries; null source prevents enqueue even if wrongly callable.
    rpc_negative("enqueue_private_registration", {"p_email": EMAIL, "p_source": None}, token)
    rpc_negative("consume_private_registration_code", {"p_email": EMAIL, "p_code": "000000"}, token)
    for name in ("complete_account_deletion_mail", "reserve_account_deletion_reminder",
                 "retry_rejected_account_deletion_reminder"):
        rpc_negative(name, {"p_job": job, "p_lease": lease}, token)
    for name, expected in (("account_deletion_installation_status", "unconfirmed"),
                           ("acknowledge_account_deletion_installation", False)):
        if token:
            rpc_negative(name, triple, token)
        else:
            status, data = call("/rest/v1/rpc/" + name, triple)
            report(name + " synthetic proof", status, data, status == 200 and data == expected)

def anonymous():
    status, data = call("/auth/v1/settings")
    ready = status == 200 and isinstance(data, dict) and data.get("disable_signup") is True
    report("Auth signup disabled", status, data, ready)
    if ready:
        # Reserved .invalid recipient, verified absent before test. Abort on unexpected success.
        status, data = call("/auth/v1/signup", {"email": EMAIL, "password": secrets.token_urlsafe(24)})
        passed = status in (400, 403, 422) and isinstance(data, dict) and data.get("error_code") == "signup_disabled"
        report("direct signup", status, data, passed, status >= 400 and not passed)
        if not (200 <= status < 300):
            status, data = call("/auth/v1/otp", {"email": EMAIL, "create_user": True})
            passed = status in (400, 403, 422) and isinstance(data, dict) and data.get("error_code") in ("signup_disabled", "otp_disabled")
            report("direct OTP create_user", status, data, passed, status >= 400 and not passed)
        else:
            print("SKIP OTP: unexpected signup success; investigate", flush=True)
    old_and_service_rpcs()
    for label, token, method, expected in (("worker GET", None, "GET", 405),
                                           ("worker POST no authorization", None, "POST", 401),
                                           ("worker POST wrong authorization", "r4-invalid-control", "POST", 401)):
        status, data = call("/functions/v1/account-deletion-worker",
                            {} if method == "POST" else None, token, method)
        report(label, status, data, status == expected)

def authenticated():
    email, password = os.environ.get("E3_USER_A_EMAIL"), os.environ.get("E3_USER_A_PASSWORD")
    if not email or not password:
        report("existing laboratory A test credentials unavailable", 0, None, False, True)
        return
    status, data = call("/auth/v1/token?grant_type=password", {"email": email, "password": password})
    token = data.get("access_token") if isinstance(data, dict) else None
    report("laboratory A disposable session", status, None, status == 200 and isinstance(token, str) and bool(token))
    if status != 200 or not token:
        return
    try:
        old_and_service_rpcs(token)
        status, data = call("/functions/v1/account-deletion-worker", {}, token)
        report("worker with ordinary authenticated token", status, data, status == 401)
    finally:
        status, data = call("/auth/v1/logout?scope=local", {}, token)
        report("revoke only new test session", status, None, status in (200, 204))

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("anon", "authenticated"):
        raise SystemExit(2)
    if sys.argv[1] == "anon":
        anonymous()
    else:
        authenticated()
    print(f"Non-passing checks: {failures}", flush=True)
    sys.exit(1 if failures else 0)
