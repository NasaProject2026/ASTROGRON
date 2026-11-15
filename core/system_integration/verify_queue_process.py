"""Actual host restart and HTTP FIFO acceptance; controlled fast workers do not publish science."""
import json,os,secrets,socket,subprocess,sys,time,uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from brain.baseline import ROOT
from .codec import read,write,canonical,parse,now
from .store import Store,Principal
from .release_demo import import_case,fixture_requests,seed_reviewed_history

class ControlledStore(Store):
    def _run(self,aid):
        path=self.root/aid
        def log(kind):
            with (self.root/'test-execution.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({'event':kind,'id':aid,'utc':now(),'pid':os.getpid()})+'\n')
        with self.lock:
            state=read(path/'state.json');self._running_id=aid;state.update(phase='computing',started_utc=now(),attempts=state.get('attempts',0)+1);write(path/'state.json',state);log('start')
        try:
            until=time.monotonic()+180
            while not (path/'test-release.flag').exists() and time.monotonic()<until:
                if self._shutdown.is_set():return
                if self._cancel[aid].is_set():break
                time.sleep(.03)
            with self.lock:
                state=read(path/'state.json');cancel=bool(state.get('cancel_requested_utc'))
                state.update(state='failed',phase='cancelled' if cancel else 'finished',error='JOB_CANCELLED' if cancel else 'CONTROLLED_TEST_WORKER_NO_SCIENCE',finished_utc=now());write(path/'state.json',state);log('finish')
        finally:
            with self.lock:self._running_id=None;self.pending-=1

def child(folder,port):
    from .api import Server
    from .store import principal_tokens
    store=ControlledStore(folder,max_pending=3,render_pdf=False);server=Server(('127.0.0.1',port),store,principal_tokens(os.environ['ASTRAGRON_INTEGRATION_AUTH_JSON']))
    try:server.serve_forever()
    finally:server.server_close();store.close()

def main():
    if len(sys.argv)>1 and sys.argv[1]=='--child':return child(Path(sys.argv[2]),int(sys.argv[3]))
    folder=ROOT/'runtime/integration'/('fifo-process-'+uuid.uuid4().hex);payload=fixture_requests()['research'];farm=payload['farm_id']
    users=[Principal('fifo'+str(i),'owner'+str(i),(farm,)) for i in range(4)];tokens=[secrets.token_urlsafe(32) for _ in users]
    auth={key:{'tenant':p.tenant,'subject':p.subject,'farms':list(p.farms)} for key,p in zip(tokens,users)}
    store=Store(folder,render_pdf=False)
    for i in [0,2]:import_case(store,users[i],'research')
    calibration=seed_reviewed_history(store);store.close()
    env=dict(os.environ,ASTRAGRON_INTEGRATION_AUTH_JSON=json.dumps(auth),ASTRAGRON_CHAT_PROVIDER='offline')
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    proc=None;checks=[]
    def check(label,value):
        checks.append({'check':label,'pass':bool(value)})
        if not value:raise AssertionError(label)
    def call(method,path,body=None,user=0):
        request=Request('http://127.0.0.1:'+str(port)+path,method=method,data=canonical(body) if body is not None else None,headers={'Authorization':'Bearer '+tokens[user],**({'Content-Type':'application/json'} if body is not None else {})})
        try:
            with urlopen(request,timeout=30) as response:return response.status,parse(response.read())
        except HTTPError as error:return error.code,parse(error.read())
    def start():
        nonlocal proc
        proc=subprocess.Popen([sys.executable,'-B','-m','system_integration.verify_queue_process','--child',str(folder),str(port)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        until=time.monotonic()+45
        while time.monotonic()<until:
            if proc.poll() is not None:raise AssertionError('Queue test host did not start')
            try:
                if call('GET','/health')[0]==200:return
            except OSError:pass
            time.sleep(.1)
        raise AssertionError('Queue test startup timeout')
    def wait_running(aid,user):
        until=time.monotonic()+15
        while time.monotonic()<until:
            status,state=call('GET','/v1/analyses/'+aid,user=user)
            if status==200 and state['queue']['status']=='running':return state
            time.sleep(.08)
        raise AssertionError('Expected FIFO job did not start')
    def release(aid):(folder/aid/'test-release.flag').write_text('controlled-test-only',encoding='utf-8')
    try:
        start();jobs=[]
        for i in range(3):status,state=call('POST','/v1/analyses',payload,user=i);check('submit_'+str(i),status==202);jobs.append(state['analysis_id'])
        wait_running(jobs[0],0)
        queues=[call('GET','/v1/analyses/'+aid+'/queue',user=i)[1] for i,aid in enumerate(jobs)]
        check('known_FIFO_ahead_counts',[q['analyses_ahead'] for q in queues]==[0,1,2]);check('running_has_no_wait_position',queues[0]['queue_position'] is None)
        check('waiting_positions',[q['queue_position'] for q in queues[1:]]==[1,2]);check('cross_tenant_queue_hidden',call('GET','/v1/analyses/'+jobs[0]+'/queue',user=1)[0]==404)
        check('same_request_coalesces',call('POST','/v1/analyses',payload)[1]['analysis_id']==jobs[0])
        status,full=call('POST','/v1/analyses',payload,user=3);check('bounded_saturation',status==429 and full['queue']['status']=='full' and bool(full['message']))
        check('private_safe_queue',all(not any(aid in json.dumps(q) for aid in jobs if aid!=q['analysis_id']) and 'farm_id' not in json.dumps(q) and 'tenant' not in json.dumps(q) for q in queues))
        check('ETA_null_or_valid',all(q['estimated_start_wait_interval_seconds'] is None or 0<=q['estimated_start_wait_interval_seconds']['lower']<=q['estimated_start_wait_interval_seconds']['upper'] for q in queues))
        browser_env=dict(env,ASTRAGRON_DEMO_TEST_URL='http://127.0.0.1:'+str(port),ASTRAGRON_DEMO_TEST_TOKEN=tokens[2],ASTRAGRON_QUEUE_ONLY='1',ASTRAGRON_QUEUE_JOB_ID=jobs[2])
        if os.name=='nt':browser_env.pop('USERPROFILE',None)
        browser=subprocess.run(['node',str(ROOT/'integration/release/verify_browser.cjs')],cwd=ROOT,env=browser_env,capture_output=True,text=True,timeout=150);(folder/'browser.stderr.log').write_text(browser.stderr,encoding='utf-8');check('queue_desktop_mobile_browser',browser.returncode==0)
        proc.terminate();proc.wait(timeout=10);start();recovered=wait_running(jobs[0],0);check('actual_process_restart',recovered['recovery_count']==1)
        check('waiting_order_survives_restart',call('GET','/v1/analyses/'+jobs[2]+'/queue',user=2)[1]['analyses_ahead']==2)
        release(jobs[0]);wait_running(jobs[1],1)
        check('queued_cancel',call('POST','/v1/analyses/'+jobs[2]+'/cancel',{},user=2)[1]['queue']['status']=='cancelled')
        status,extra=call('POST','/v1/analyses',payload,user=3);check('capacity_released',status==202)
        retried=call('POST','/v1/analyses/'+jobs[2]+'/retry',{},user=2)[1];check('retry_at_tail',retried['queue']['analyses_ahead']==2)
        release(jobs[1]);wait_running(extra['analysis_id'],3);release(extra['analysis_id']);wait_running(jobs[2],2);release(jobs[2]);time.sleep(.2)
        log=[json.loads(x) for x in (folder/'test-execution.jsonl').read_text().splitlines()];order=[x['id'] for x in log if x['event']=='start']
        check('actual_start_order',order==[jobs[0],jobs[0],jobs[1],extra['analysis_id'],jobs[2]])
        receipt={'schema':'astragron.actual-FIFO-process-acceptance.v1','created_utc':now(),'checks':checks,'passed':len(checks),'actual_restart':True,'initial_queue_DTOs':queues,'queue_full_response':full,'calibration':calibration,'execution_log':log,'scope':'Real HTTP, OS restart and executor scheduling; test workers are controlled fast jobs and never publish scientific results. Existing scientific worker implementation unchanged.','new_scientific_runs':0,'storage':str(folder),'all_hosts_stopped_on_exit':True}
        write(ROOT/'integration/release/QUEUE_HTTP_RESTART.json',receipt);print(json.dumps({'checks_passed':len(checks),'actual_restart':True,'new_science':0,'storage':str(folder)}),flush=True)
    finally:
        if proc and proc.poll() is None:proc.terminate();proc.wait(timeout=10)

if __name__=='__main__':main()
