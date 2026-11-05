#!/usr/bin/env python3
"""Hosted Supabase E2 READ-ONLY A/B/anon HTTP gate. No fixture creation."""
import json, os, sys, urllib.request, urllib.error
from urllib.parse import quote
keys=('TEST_SUPABASE_URL','TEST_SUPABASE_ANON_KEY','TEST_EMAIL_A','TEST_EMAIL_B','TEST_PASSWORD_A','TEST_PASSWORD_B')
missing=[k for k in keys if not os.getenv(k)]
if missing: sys.exit('NOT RUN: missing GitHub secrets: '+', '.join(missing))
base=os.environ['TEST_SUPABASE_URL'].rstrip('/')
if base!='https://gmrqeubhotjpmtwokfeq.supabase.co': sys.exit('Safety guard: wrong lab URL')
key=os.environ['TEST_SUPABASE_ANON_KEY']
def sign_in(email,password):
    req=urllib.request.Request(base+'/auth/v1/token?grant_type=password',data=json.dumps({'email':email,'password':password}).encode(),headers={'apikey':key,'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=20) as res:
            payload=json.loads(res.read())
            return payload['access_token']
    except urllib.error.HTTPError as e:
        sys.exit('Auth sign-in failed (HTTP '+str(e.code)+'); credentials and response hidden')
a=sign_in(os.environ['TEST_EMAIL_A'],os.environ['TEST_PASSWORD_A'])
b=sign_in(os.environ['TEST_EMAIL_B'],os.environ['TEST_PASSWORD_B'])
def call(path,jwt=None,method='GET',body=None):
    h={'apikey':key,'Accept':'application/json'}
    if jwt: h['Authorization']='Bearer '+jwt
    if body is not None: h['Content-Type']='application/json'
    req=urllib.request.Request(base+path,headers=h,method=method,data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req,timeout=20) as res: return res.status,json.loads(res.read() or b'null')
    except urllib.error.HTTPError as e: return e.code,None

def check(condition,label):
    if not condition: raise AssertionError(label)
    print('PASS:',label)
sa,ua=call('/auth/v1/user',a);sb,ub=call('/auth/v1/user',b)
check(sa==200 and sb==200 and isinstance(ua,dict) and isinstance(ub,dict) and ua.get('id') and ub.get('id') and ua['id']!=ub['id'],'distinct valid Auth A/B JWT')
status,lists=call('/rest/v1/shopping_lists?select=id,owner_id&deleted_at=is.null&limit=2',a)
status_b,lists_b=call('/rest/v1/shopping_lists?select=id,owner_id&deleted_at=is.null&limit=2',b)
check(status==200 and status_b==200 and isinstance(lists,list) and isinstance(lists_b,list),'A/B can query their visible list inventory')
if len(lists)==0 and len(lists_b)==1 and lists_b[0]['owner_id']==ub['id']:
    a,b=b,a
    ua,ub=ub,ua
    lists=lists_b
    print('INFO: configured B is fixture owner; normalize roles to owner A / outsider B')
check(len(lists)==1 and lists[0]['owner_id']==ua['id'] and (not lists_b or lists_b[0]['owner_id']!=ub['id']),'exactly one owner fixture and no outsider-owned fixture')
lid=lists[0]['id']
path='/rest/v1/shopping_lists?id=eq.'+quote(lid)+'&select=id,owner_id'
sa,ra=call(path,a);sb,rb=call(path,b);sc,rc=call(path)
check(sa==200 and isinstance(ra,list) and len(ra)==1 and ra[0]['owner_id']==ua['id'],'A owns and reads fixture list')
check(sb==200 and rb==[],'B cannot read A list')
check(sc in (401,403) or (sc==200 and rc==[]),'anonymous cannot read A list')
for who,jwt,expected in [('A',a,True),('B',b,False)]:
    status,value=call('/rest/v1/rpc/can_access_list',jwt,'POST',{'p_list':lid})
    check(status==200 and value is expected,who+' RPC list access correct')
status,_=call('/rest/v1/rpc/can_access_list',None,'POST',{'p_list':lid})
check(status in (401,403,404),'anonymous cannot execute list access RPC')
print('Hosted E2 HTTP read/deny gate complete; no test data created.')
