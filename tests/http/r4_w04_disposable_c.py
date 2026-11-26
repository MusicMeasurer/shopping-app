"""R4-W04: two real sessions of the pinned disposable C, user confirms deletion in PWA.
No tokens, passwords, codes, email addresses or device secrets printed or persisted.
"""
import base64, hashlib, json, os, re, time, urllib.error, urllib.request, uuid
from r4_w01_safe_http import BASE, KEY, opener, call

PIN = "009b707b2c6291b5746c4e0a80847d013f9e08602cff392877c056e073254528"
def check(ok, label):
    print(("PASS " if ok else "FAIL ") + label, flush=True)
    if not ok:
        raise SystemExit(1)
def rpc(name, body, token=None):
    return call("/rest/v1/rpc/" + name, body, token)
def claims(token):
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
def uid():
    return str(uuid.uuid4())
def rest(path, token):
    request = urllib.request.Request(BASE + path, headers={"apikey":KEY,"Authorization":"Bearer "+token})
    try:
        with opener.open(request,timeout=15) as result:
            return result.status,json.loads(result.read())
    except urllib.error.HTTPError as error:
        return error.code,json.loads(error.read())
    except (OSError,ValueError):
        return 0,None
def revoked(result):
    status, body = result
    return status in (401,403) and isinstance(body,dict) and body.get("code") == "42501" and body.get("message") == "Account access revoked"

def main():
    check(BASE == "https://gmrqeubhotjpmtwokfeq.supabase.co", "laboratory target")
    email=os.environ.get("E3_USER_C_EMAIL","").strip()
    password=os.environ.get("E3_USER_C_PASSWORD","")
    protected=[os.environ.get("E3_USER_"+letter+"_EMAIL","").strip().lower() for letter in ("A","B")]
    check(bool(email and password and all(protected)) and email.lower() not in protected,"C credentials distinct from A/B")
    status,data=call("/auth/v1/settings")
    check(status==200 and data.get("disable_signup") is True,"public signup remains disabled")
    sessions=[]
    seen_deleted=False
    try:
        for index in range(2):
            status,data=call("/auth/v1/token?grant_type=password",{"email":email,"password":password})
            check(status==200 and isinstance(data,dict) and bool(data.get("access_token")) and bool(data.get("refresh_token")),"C login "+str(index+1))
            access=data["access_token"]
            status,identity=call("/auth/v1/user",token=access)
            check(status==200 and isinstance(identity,dict) and hashlib.sha256(identity.get("id","").encode()).hexdigest()==PIN,"server-verified pinned C "+str(index+1))
            account=identity["id"]
            sessions.append((access,data["refresh_token"],claims(access)))
        check(sessions[0][2]["session_id"]!=sessions[1][2]["session_id"],"two independent Auth sessions")
        check(all(s[2]["exp"] > time.time()+660 for s in sessions),"access tokens valid throughout bounded test")
        proofs=[]
        for i,(access,_,_) in enumerate(sessions):
            p={"p_account":account,"p_device":uid(),"p_proof":uid()}
            check(rpc("register_account_deletion_installation",p,access)==(200,True),"installation proof registered "+str(i+1))
            check(rpc("account_deletion_installation_status",p)==(200,"active"),"installation active "+str(i+1))
            proofs.append(p)
        access=sessions[0][0]
        operation={"p_operation":uid(),"p_name":"R4-W04 disposable fixture","p_kind":"oneoff"}
        status,receipt=rpc("create_e4_list",operation,access)
        check(status==200 and isinstance(receipt,dict) and isinstance(receipt.get("list_id"),str),"create C-only disposable list")
        list_id=receipt["list_id"]
        path="/rest/v1/shopping_lists?select=id,owner_id&id=eq."+list_id
        for i,(access,_,_) in enumerate(sessions):
            status,rows=rest(path,access)
            check(status==200 and isinstance(rows,list) and len(rows)==1 and rows[0]["owner_id"]==account,"pre-delete read "+str(i+1))
        queue={"p_operation":uid(),"p_list":list_id,"p_action":"add","p_item":uid(),"p_name":"R4-W04 stale queue","p_purchased":False,"p_expected_version":None}
        # A separate, valid add demonstrates this RPC shape works before deletion.
        baseline=dict(queue,p_operation=uid(),p_item=uid(),p_name="R4-W04 baseline")
        status,data=rpc("apply_item_change",baseline,sessions[1][0])
        check(status==200 and isinstance(data,dict),"pre-delete item write")
        print("READY_FOR_USER_DELETE_C: two sessions held in memory; use PWA C, no reminder",flush=True)
        end=time.monotonic()+540
        while time.monotonic()<end:
            status,data=rpc("account_deletion_installation_status",proofs[0])
            if status==200 and data=="deleted":
                seen_deleted=True
                break
            if (status,data)!=(200,"active"):
                check(False,"unexpected installation status during wait")
            time.sleep(8)
        check(seen_deleted,"user-confirmed deletion observed")
        # Do not stop on first post-delete failure: preserve every result.
        checks=[]
        def outcome(ok,label):
            print(("PASS " if ok else "FAIL ")+label,flush=True)
            checks.append(ok)
        for i,(access,refresh,jwt) in enumerate(sessions):
            outcome(jwt["exp"]>time.time(),"old access token still within lifetime "+str(i+1))
            result=rest(path,access)
            outcome(revoked(result),"old access denied by API guard "+str(i+1)+" HTTP "+str(result[0]))
            result=rpc("apply_item_change",queue,access)
            outcome(revoked(result),"old queue denied by API guard "+str(i+1)+" HTTP "+str(result[0]))
            status,data=call("/auth/v1/token?grant_type=refresh_token",{"refresh_token":refresh})
            outcome(status in (400,401,403) and isinstance(data,dict) and not data.get("access_token"),"old refresh rejected "+str(i+1)+" HTTP "+str(status))
            outcome(rpc("account_deletion_installation_status",proofs[i])==(200,"deleted"),"correct proof sees deleted "+str(i+1))
            wrong=dict(proofs[i],p_proof=uid())
            outcome(rpc("account_deletion_installation_status",wrong)==(200,"unconfirmed"),"wrong proof neutral "+str(i+1))
            outcome(rpc("acknowledge_account_deletion_installation",wrong)==(200,False),"wrong proof cannot acknowledge "+str(i+1))
            outcome(rpc("acknowledge_account_deletion_installation",proofs[i])==(200,True),"valid cleanup acknowledgment "+str(i+1))
            outcome(rpc("acknowledge_account_deletion_installation",proofs[i])==(200,True),"repeated acknowledgment "+str(i+1))
        check(all(checks),"all post-delete assertions")
    finally:
        if not seen_deleted:
            for access,_,_ in sessions:
                status,_=call("/auth/v1/logout?scope=local",{},access)
                print("Local test session cleanup HTTP "+str(status),flush=True)

if __name__=="__main__":
    try:
        main()
    except Exception:
        print("FAIL: unexpected test exception (details suppressed to protect credentials)",flush=True)
        raise SystemExit(1) from None
