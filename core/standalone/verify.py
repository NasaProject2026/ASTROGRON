"""Package-only HTTP/scientific/queue/report/offline-chat acceptance; no remote calls."""
import argparse,hashlib,json,os,secrets,subprocess,sys,threading,time,uuid
from decimal import Decimal
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
ROOT=Path(__file__).resolve().parents[1]
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--fresh-native',action='store_true');parser.add_argument('--regressions',action='store_true');args=parser.parse_args()
 from standalone.preflight import main as preflight
 preflight()
 from brain.baseline import verify
 from system_integration.codec import read,write,canonical,parse,sha,now
 from system_integration.store import Store,Principal
 from system_integration.api import Server
 from system_integration.release_demo import fixture_requests,import_case
 out=ROOT/'runtime/verification';out.mkdir(parents=True,exist_ok=True);start=time.monotonic();checks=[]
 def check(name,value):
  checks.append({'check':name,'pass':bool(value)})
  if not value:raise AssertionError(name)
 settings=read(ROOT/'runtime/LOCAL_RUNTIME.json');env={k:v for k,v in os.environ.items() if k not in {'PYTHONPATH','PYTHONHOME'} and not any(x in k.upper() for x in ('API_KEY','TOKEN','SECRET','PASSWORD','AUTH_JSON'))}
 env.update(ASTRAGRON_PCSE_PYTHON=sys.executable,ASTRAGRON_NODE=settings['node'],ASTRAGRON_NODE_MODULES=settings['node_modules'],ASTRAGRON_BROWSER=settings['browser'],ASTRAGRON_CHAT_PROVIDER='offline',PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1',PYTHONUTF8='1',TEMP=str(ROOT/'runtime/tmp'),TMP=str(ROOT/'runtime/tmp'),USERPROFILE=str(ROOT/'runtime/user-home'))
 os.environ.update({k:v for k,v in env.items() if k.startswith('ASTRAGRON_') or k in {'USERPROFILE','TEMP','TMP','PYTHONNOUSERSITE','PYTHONDONTWRITEBYTECODE'}})
 requests=fixture_requests();principal=Principal('clean-room','owner',tuple(sorted({x['farm_id'] for x in requests.values()})));foreign=Principal('foreign','other',principal.farms);token=secrets.token_urlsafe(32);other=secrets.token_urlsafe(32)
 folder=ROOT/'runtime/integration'/('clean-proof-'+uuid.uuid4().hex);store=Store(folder,max_pending=3)
 cases={name:import_case(store,principal,name) for name in requests};server=Server(('127.0.0.1',0),store,{token:principal,other:foreign});threading.Thread(target=server.serve_forever,daemon=True).start()
 def call(method,path,body=None,key=token,binary=False):
  req=Request('http://127.0.0.1:'+str(server.server_port)+path,method=method,data=canonical(body) if body is not None else None,headers={'Authorization':'Bearer '+key,**({'Content-Type':'application/json'} if body is not None else {})})
  try:
   with urlopen(req,timeout=60) as response:
    raw=response.read();return response.status,raw if binary else parse(raw)
  except HTTPError as e:return e.code,parse(e.read())
 def wait(aid,limit=960):
  until=time.monotonic()+limit
  while time.monotonic()<until:
   status,state=call('GET','/v1/analyses/'+aid)
   if status==200 and state['state']!='pending':return state
   time.sleep(.2)
  raise AssertionError('PACKAGE_JOB_TIMEOUT')
 try:
  check('HTTP_health',call('GET','/health')[0]==200);check('HTTP_readiness',call('GET','/ready')[0]==200)
  aid=cases['research']['analysis_id'];original=sha(folder/aid/'result.json');result=call('GET','/v1/analyses/'+aid+'/result')[1]
  check('two_Pareto_no_winner',len(result['decision']['pareto_ids'])==2 and result['decision']['selected_ids']==[] and result['growth_evaluation']['profit'] is None)
  check('cross_tenant_denied',call('GET','/v1/analyses/'+aid+'/result',key=other)[0]==404)
  for endpoint in ['report','evidence','comparison','manifest','html','pdf','csv']:
   status,value=call('GET','/v1/analyses/'+aid+'/'+endpoint,binary=True);check('cached_'+endpoint,status==200 and len(value)>20)
  sid=call('POST','/v1/conversations',{'analysis_id':aid,'locale':'en'})[1]['session_id']
  policy=result['alternatives'][0]['policy_id'];answer=call('POST','/v1/conversations/'+sid+'/messages',{'message':'Explain water','scope':{'field_id':'F1','source_year':2017,'scenario_id':'REFERENCE','policy_id':policy}})[1]
  check('offline_C_grounding',answer['mode']=='DETERMINISTIC_FALLBACK' and bool(answer['claims']) and answer['scientific_analysis_reference']==aid)
  check('immutable_cached_original',sha(folder/aid/'result.json')==original)
  job=call('POST','/v1/analyses',requests['blocked'])[1];check('async_submission',job['state']=='pending')
  queued=call('GET','/v1/analyses/'+job['analysis_id']+'/queue')[1];check('queue_authenticated',queued['schema']=='astragron.queue-status.v1')
  cancelled=call('POST','/v1/analyses/'+job['analysis_id']+'/cancel',{})[1]
  if cancelled['state']=='pending':cancelled=wait(job['analysis_id'])
  check('cancel',cancelled['error']=='JOB_CANCELLED')
  retry=call('POST','/v1/analyses/'+job['analysis_id']+'/retry',{})[1];check('retry_same_identity',retry['analysis_id']==job['analysis_id'])
  blocked=wait(job['analysis_id']);check('real_evidence_gate_abstention',blocked['state']=='blocked' and not blocked['report_error'])
  # Generate PDFs anew from canonical input, not just read the captured sample.
  from system_integration.reports import generate
  generated=ROOT/'runtime/verification/new-report';generate(folder/aid/'result.json',generated,pdf=True,env=env)
  from pypdf import PdfReader
  check('fresh_PDF_generation',len(PdfReader(generated/'Farm_Decision_Summary.pdf').pages)==5)
  fresh=None
  if args.fresh_native:
   state=call('POST','/v1/analyses',requests['research'])[1];state=wait(state['analysis_id']);check('fresh_native_complete',state['state']=='complete_research' and not state['report_error'])
   response=call('GET','/v1/analyses/'+state['analysis_id']+'/result')[1]
   check('all_six_cases_recomputed',state['execution_receipt']['fresh_native_cases']==6 and state['execution_receipt']['verified_cache_replays']==0)
   check('scientific_hash_exact',response['engine_result']['scientific_result_sha256']==result['engine_result']['scientific_result_sha256'])
   check('decision_and_report_exact',response['decision']==result['decision'] and response['report_dto']==result['report_dto'])
   seams=balances=0
   for case in response['engine_result']['cases']:
    for year in range(2016,2020):
     assert case['year_end_states_mm'][str(year)]==case['year_start_states_mm'][str(year+1)]
     assert case['growth_years'][year-2016]['soil_N_end_kg_N_ha']==case['growth_years'][year-2015]['soil_N_start_kg_N_ha'];seams+=1
    assert abs(case['water_budget']['residual_mm'])<1e-7
    assert abs(case['accounting']['model_domain_N_residual_kg_N_ha'])<1e-6
   for row in response['report_dto']['five_year_rows']:
    assert row['predicted_yield'] is None and row['economics']['conditional_margin'] is None
    for annual in row['soil_accounting']:
     for element in ('P','K'):assert Decimal(annual['balance'][element]['mass_residual'])==0;balances+=1
   check('native_water_N_continuity_and_PK_conservation',seams==24 and balances==60)
   fresh={'annual_water_N_seams':seams,'elemental_balances':balances,'analysis_id':state['analysis_id'],'wall_seconds':state['wall_seconds'],'worker_peak_memory_bytes':state.get('peak_worker_job_memory_bytes'),'scientific_hash':response['engine_result']['scientific_result_sha256'],'fresh_native_cases':6,'replayed_native_cases':0}
  regressions=None
  if args.regressions:
   command=[sys.executable,'-B','-X','utf8','-m','pytest','assistant_brain/tests','integration/tests','tests/engine/test_client_api.py','tests/engine/test_runtime_paths.py','tests/engine/test_producing_rotation.py::RootTests','tests/independent','-q','-p','no:cacheprovider','--junitxml='+str(out/'REGRESSIONS.xml')]
   run=subprocess.run(command,cwd=ROOT,env=env,capture_output=True,text=True,timeout=480);(out/'pytest.stdout.txt').write_text(run.stdout,encoding='utf-8');(out/'pytest.stderr.txt').write_text(run.stderr,encoding='utf-8');print(run.stdout[-2200:],flush=True);check('focused_regressions',run.returncode==0);regressions={'exit_code':run.returncode,'command':command}
  run=subprocess.run([sys.executable,'-B','-X','utf8','-m','system_integration.verify_queue_process'],cwd=ROOT,env=env,capture_output=True,text=True,timeout=180);(out/'queue.stdout.txt').write_text(run.stdout,encoding='utf-8');(out/'queue.stderr.txt').write_text(run.stderr,encoding='utf-8');check('actual_FIFO_restart_browser',run.returncode==0)
  receipt={'schema':'astragron.extracted-core-verification.v1','created_utc':now(),'root':str(ROOT),'python':sys.executable,'checks':checks,'passed':len(checks),'fresh_native':fresh,'regressions':regressions,'protected':verify(),'remote_calls':0,'original_worktree_used':False,'wall_seconds':time.monotonic()-start,'servers_stopped_on_exit':True}
  write(out/'CLEAN_ROOM_ACCEPTANCE.json',receipt);print(json.dumps(receipt),flush=True)
 finally:server.shutdown();server.server_close();store.close()
if __name__=='__main__':main()
