"""Small authenticated cached-only smoke; never submits a science job or hosted AI call."""
import argparse, http.cookiejar, io, json, pathlib, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:3000');a=p.parse_args();base=a.base.rstrip('/')
    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));checks=[]
    def check(name,value):
        assert value,name;checks.append(name)
    def call(path,body=None,binary=False):
        req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,
            headers={'Origin':base,**({'Content-Type':'application/json'} if body is not None else {})})
        with opener.open(req,timeout=45) as response:
            raw=response.read();return response.status,raw if binary else json.loads(raw),response.headers
    for route in ['/','/explore','/research']:
        status,raw,_=call(route,binary=True);check('HTTP_200_'+route,status==200 and raw.startswith(b'<!DOCTYPE html>'))
    code=(ROOT/'runtime/frontend-access.txt').read_text('utf-8-sig').strip()
    status,_,headers=call('/api/core/session',{'code':code});check('authenticated_login',status==200)
    check('HttpOnly_SameSite_cookie','httponly' in headers.get('Set-Cookie','').lower() and 'samesite=strict' in headers.get('Set-Cookie','').lower())
    if base.startswith('https:'):check('HTTPS_Secure_cookie','secure' in headers.get('Set-Cookie','').lower())
    ready=call('/api/core/status')[1];check('D_ready',ready['status']=='ready')
    check('Adaptive_disabled',ready['adaptive']['enabled'] is False)
    case=next(x for x in call('/api/core/catalog')[1]['analyses'] if x['demo_case']=='research');aid=case['analysis_id']
    check('cached_case_labeled',case['execution_kind']=='VERIFIED_CACHED_REPLAY')
    result=call('/api/core/analyses/'+aid+'/summary')[1]
    check('two_Pareto_no_winner',len(result['decision']['pareto_ids'])==2 and result['decision']['selected_ids']==[])
    check('scientific_hash',result['engine_result']['scientific_result_sha256']=='f812c32e72693cbf8b8da6e08f6f6a50d4a5de936133c85d999fa976edc44b08')
    status,pdf,_=call('/api/core/analyses/'+aid+'/pdf',binary=True)
    from pypdf import PdfReader
    check('scientific_PDF',status==200 and pdf.startswith(b'%PDF') and len(PdfReader(io.BytesIO(pdf)).pages)==5)
    check('queue_contract',call('/api/core/analyses/'+aid+'/queue')[1]['schema']=='astragron.queue-status.v1')
    sid=call('/api/core/conversations',{'analysis_id':aid})[1]['session_id']
    reply=call('/api/core/conversations/'+sid+'/messages',{'message':'Explain water','scope':{'field_id':'F1','source_year':2017,'scenario_id':'REFERENCE','policy_id':result['alternatives'][0]['policy_id']}})[1]
    check('same_analysis_cited_offline_chat',reply['scientific_analysis_reference']==aid and reply['mode']=='DETERMINISTIC_FALLBACK' and bool(reply['claims']))
    output={'passed':len(checks),'checks':checks,'base':base,'fresh_scientific_jobs':0,'hosted_LLM_calls':0,'remote_laptop_tested':False}
    (ROOT/'runtime').mkdir(exist_ok=True);(ROOT/'runtime/HANDOFF_SMOKE.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps(output,indent=2))

if __name__=='__main__':main()
