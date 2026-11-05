#!/usr/bin/env python3
"""Hosted Supabase E2 READ-ONLY A/B/anon HTTP gate. No fixture creation."""
import json, os, sys, urllib.request, urllib.error
from urllib.parse import quote
keys=('TEST_SUPABASE_URL','TEST_SUPABASE_ANON_KEY','TEST_OWNER_JWT','TEST_INVITEE_JWT','TEST_OWNER_LIST_ID')
missing=[k for k in keys if not os.getenv(k)]
if missing: sys.exit('NOT RUN: missing GitHub secrets: '+', '.join(missing))
base=os.environ['TEST_SUPABASE_URL'].rstrip('/')
if base!='https://gmrqeubhotjpmtwokfeq.supabase.co': sys.exit('Safety guard: wrong lab URL')
key=os.environ['TEST_SUPABASE_ANON_KEY']; a=os.environ['TEST_OWNER_JWT']; b=os.environ['TEST_INVITEE_JWT']; lid=os.environ['TEST_OWNER_LIST_ID']
import uuid
uuid.UUID(lid)
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
