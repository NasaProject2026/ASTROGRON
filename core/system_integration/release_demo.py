"""Operator-only replay of reviewed artifacts; no fabricated result or public upload route."""
import argparse,hashlib,json,os,re,secrets,subprocess,uuid
from pathlib import Path
from brain.baseline import ROOT,verify
from .codec import read,write,parse,sha,digest,now
from .store import Store,Principal,principal_tokens
BASE='fbd4968304ef7d0eade1bf96227f05e5daa7b767'

def blob(name):
    if not (ROOT/'.git').exists():
        index=read(ROOT/'standalone/accepted_snapshot_index.json')
        expected=index['files_sha256'].get(name)
        target=(ROOT/name).resolve()
        if not target.is_relative_to(ROOT.resolve()) or expected is None or sha(target)!=expected:raise ValueError('ACCEPTED_REPLAY_ASSET_INTEGRITY')
        return target.read_bytes()
    return subprocess.check_output(['git','-c','gc.auto=0','-C',str(ROOT),'show',BASE+':'+name],stderr=subprocess.DEVNULL)

def fixture_requests():
    return {'research':parse(blob('integration/production_readiness/samples/Latest_A/request.json')),
        'blocked':parse(blob('integration/production_readiness/samples/Blocked/request.json')),
        'public_chat':parse(blob('assistant_brain/examples/supported.request.json'))}

def import_case(store,principal,name):
    cases={'research':('Latest_A','Verified cached five-year research comparison'),
        'blocked':('Blocked','Verified cached missing-evidence abstention'),
        'public_chat':(None,'Approved public synthetic chat demonstration')}
    folder,label=cases[name]
    existing=[x for x in store.list(principal) if x.get('demo_case')==name]
    if existing:return existing[0]
    request=fixture_requests()[name]
    if request['farm_id'] not in principal.farms:raise ValueError('DEMO_FARM_NOT_AUTHORIZED')
    if folder:
        prefix='integration/production_readiness/samples/'+folder
        response_raw=blob(prefix+'/Canonical_API_Response.json');request_raw=blob(prefix+'/request.json')
        original_manifest=parse(blob(prefix+'/manifest.json'))
    else:
        prefix=None;response_raw=blob('assistant_brain/fixtures/valid.response.json');request_raw=blob('assistant_brain/examples/supported.request.json');original_manifest=None
    response=parse(response_raw)
    from common import digest as science_digest
    assert response['farm_id']==request['farm_id'] and response['provenance']['request_sha256']==science_digest(request)
    if not folder:
        from assistant_brain.codec import digest as c_digest
        from assistant_brain.privacy import PUBLIC_SNAPSHOT_SHA256
        assert c_digest(response) in PUBLIC_SNAPSHOT_SHA256
    aid=uuid.uuid4().hex;path=store.root/aid;path.mkdir();(path/'request.json').write_bytes(request_raw);(path/'result.json').write_bytes(response_raw)
    if folder:
        names=([n for n in read(ROOT/'standalone/accepted_snapshot_index.json')['files_sha256'] if n.startswith(prefix+'/')] if not (ROOT/'.git').exists() else subprocess.check_output(['git','-C',str(ROOT),'ls-tree','-r','--name-only',BASE,'--',prefix]).decode().splitlines())
        report=path/'report';report.mkdir()
        for n in names:
            filename=Path(n).name
            if filename not in {'request.json','state.json','manifest.json'}:(report/filename).write_bytes(blob(n))
    kind='VERIFIED_CACHED_REPLAY' if folder else 'VERIFIED_PUBLIC_FIXTURE'
    mapped={'CONDITIONAL_RESEARCH_COMPLETE':'complete_research','BOUNDED_PARTIAL':'partial','EVIDENCE_BLOCKED':'blocked'}
    state={'schema':'astragron.analysis-state.v1','analysis_id':aid,'request_id':uuid.uuid4().hex,'farm_id':request['farm_id'],
        'owner':{'tenant':principal.tenant,'subject':principal.subject},'request_sha256':digest(request),
        'scenario_ids':{s['scenario_id']:'scenario:'+digest({'analysis_id':aid,'scenario':s}) for s in request['engine_request']['scenarios']},
        'state':mapped[response['status']],'phase':'finished','created_utc':now(),'finished_utc':now(),'scientific_status':response['status'],
        'error':None,'report_error':None if folder else 'PUBLIC_CHAT_FIXTURE_NO_PDF','attempts':0,'recovery_count':0,'immutable':True,
        'parent_analysis_id':None,'run_id':response['run_id'],'response_sha256':sha(path/'result.json'),
        'scientific_result_sha256':response['engine_result'].get('scientific_result_sha256'),
        'execution_kind':kind,'demo_case':name,'demo_label':label,'original_source_commit':BASE,
        'progress':{'completed_stages':None,'total_stages':None},'wall_seconds':0,'execution_deadline_seconds':store.timeout}
    files={n:sha(path/n) for n in ['request.json','result.json']}
    files.update({x.relative_to(path).as_posix():sha(x) for x in (path/'report').rglob('*') if x.is_file()})
    manifest={'schema':'astragron.analysis-manifest.v1','analysis_id':aid,'created_utc':now(),'request_sha256':state['request_sha256'],
        'response_sha256':state['response_sha256'],'run_id':response['run_id'],'scientific_result_sha256':state['scientific_result_sha256'],
        'source_identity':store.source_identity,'execution_kind':kind,'import_origin':{'commit':BASE,'case':name,'original_manifest':original_manifest,
        'new_science_executed':False,'description':'Exact accepted Git-object bytes replayed; control-source identity does not claim a fresh scientific computation.'},'files':files}
    write(path/'manifest.json',manifest);write(path/'state.json',state)
    return store.public_state(principal,aid)

def seed_reviewed_history(store):
    if not (ROOT/'.git').exists():return {'imported':0,'reason':'NEW_EXTRACTED_HOST_ESTIMATES_UNAVAILABLE_UNTIL_MEASURED'}
    # Import only these existing successful full-fresh D runs on their recorded host.
    import platform,xml.etree.ElementTree as E
    profile=read(ROOT/'integration/production_readiness/acceptance/PERFORMANCE_BASELINE.json')
    recorded=E.parse(ROOT/'integration/production_readiness/acceptance/FINAL_D_FULL.xml').getroot().find('testsuite').get('hostname')
    if platform.node()!=recorded or platform.platform()!=profile['platform']:return {'imported':0,'reason':'DIFFERENT_OR_UNVERIFIED_HOST'}
    http=read(ROOT/'integration/production_readiness/acceptance/RELIABLE_HTTP.json');strict=read(ROOT/'integration/production_readiness/acceptance/STRICT_FINAL_REPLAY.json')
    sources=[Path(http['storage'])/http['latest_A'],Path(http['storage'])/http['rainfall_child'],Path(strict['storage'])/strict['analysis_id']]
    from .queueing import workload
    imported=0
    for source in sources:
        try:
            state=read(source/'state.json');manifest=read(source/'manifest.json');request=read(source/'request.json');execution=state['execution_receipt']
            assert state['state']=='complete_research' and state['attempts']==1 and not state.get('report_error')
            assert execution['fresh_native_cases']==6 and execution['verified_cache_replays']==0
            assert all(sha(source/n)==h for n,h in manifest['files'].items())
            assert manifest['source_identity']['scientific_A']=='7e64e67cf28d1bbe3910cff016580fd9379ef276'
            assert digest(request)==state['request_sha256'] and sha(source/'result.json')==state['response_sha256']
            store.history.add(workload(request),state['wall_seconds'],'reviewed:'+sha(source/'manifest.json'));imported+=1
        except (OSError,ValueError,AssertionError,KeyError):continue
    return {'imported':imported,'source':'Three real full-fresh accepted D jobs, same recorded Windows host; not synthetic tests or cache repetitions.'}

def main():
    from .api import Server
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8790);parser.add_argument('--store',type=Path,default=ROOT/'runtime/integration/release-demo');args=parser.parse_args()
    verify();requests=fixture_requests();token=os.environ.get('ASTRAGRON_DEMO_ACCESS_TOKEN') or secrets.token_urlsafe(32)
    principal=Principal('local-research-demo','operator',tuple(sorted({r['farm_id'] for r in requests.values()})))
    store=Store(args.store,max_pending=6)
    access=store.root/'operator-access.txt'
    if not os.environ.get('ASTRAGRON_DEMO_ACCESS_TOKEN') and access.is_file():
        saved=access.read_text(encoding='utf-8').strip()
        if 24<=len(saved)<=200:token=saved
    for name in requests:import_case(store,principal,name)
    seed_reviewed_history(store)
    # This is a local D access token, never a provider key; excluded private operator file.
    (store.root/'operator-access.txt').write_text(token,encoding='utf-8')
    origins=tuple(x for x in os.environ.get('ASTRAGRON_ALLOWED_ORIGINS','').split(',') if x)
    if any(not re.fullmatch(r'https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?',x) for x in origins):raise ValueError('EXACT_FRONTEND_ORIGIN_REQUIRED')
    server=Server(('127.0.0.1',args.port),store,{token:principal},origins=origins,public_demo_enabled=os.environ.get('ASTRAGRON_APPROVED_PUBLIC_DEMO_CHAT_ENABLED')=='1')
    print('Local research demonstration: http://127.0.0.1:'+str(server.server_port)+'/demo ; read private operator-access.txt for the scoped access code.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close();store.close()

if __name__=='__main__':main()
