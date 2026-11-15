"""Durable, principal-scoped jobs with immutable scientific results and bounded workers."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass
import hmac
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import uuid

from brain.baseline import ROOT
from brain.service import validate
from .codec import digest, now, parse, sha, write, read, read_bytes

ID = re.compile(r'[a-f0-9]{32}')
TERMINAL = {'complete_research', 'partial', 'blocked', 'failed'}
SAFE_ERROR = {'WORKER_TIMEOUT', 'WORKER_FAILED', 'SERVER_RESTART_INTERRUPTED_JOB', 'REPORT_GENERATION_FAILED', 'RESULT_INTEGRITY_FAILED'}


class Problem(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(code)


@dataclass(frozen=True)
class Principal:
    tenant: str
    subject: str
    farms: tuple


def principal_tokens(raw):
    tokens = parse(raw)
    if not isinstance(tokens, dict) or not tokens:
        raise ValueError('SERVER_AUTH_CONFIGURATION_REQUIRED')
    result = {}
    for token, value in tokens.items():
        if not isinstance(token, str) or len(token) < 24 or not isinstance(value, dict) or set(value) != {'tenant', 'subject', 'farms'}:
            raise ValueError('INVALID_SERVER_AUTH_CONFIGURATION')
        if not all(isinstance(value[x], str) and 0 < len(value[x]) <= 100 for x in ('tenant', 'subject')):
            raise ValueError('INVALID_SERVER_AUTH_CONFIGURATION')
        if not isinstance(value['farms'], list) or not value['farms'] or any(not isinstance(f, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}', f) for f in value['farms']):
            raise ValueError('INVALID_SERVER_AUTH_CONFIGURATION')
        result[token] = Principal(value['tenant'], value['subject'], tuple(value['farms']))
    return result


def authenticate(header, tokens):
    if not header or not header.startswith('Bearer '):
        raise Problem(401, 'AUTHENTICATION_REQUIRED')
    secret = header[7:]
    for candidate, principal in tokens.items():
        if hmac.compare_digest(secret, candidate):
            return principal
    raise Problem(401, 'AUTHENTICATION_REQUIRED')


class Store:
    """Single-host durable queue. Scientific gates stay in A; outer job deadline is independent."""
    def __init__(self, directory, *, timeout=900, max_jobs=24, max_pending=3, max_bytes=2_000_000_000,
                 render_pdf=True, max_attempts=3, recover=True, memory_bytes=3*1024**3):
        self.root = Path(directory).resolve()
        if not self.root.is_relative_to((ROOT/'runtime/integration').resolve()):
            raise ValueError('PRIVATE_D_STORAGE_REQUIRED')
        if not 1 <= timeout <= 3600 or not 1 <= max_jobs <= 100 or not 1 <= max_pending <= 8 or not 1 <= max_attempts <= 3:
            raise ValueError('BOUNDED_RESOURCE_CONFIGURATION_REQUIRED')
        if not 256*1024**2 <= memory_bytes <= 8*1024**3:
            raise ValueError('BOUNDED_MEMORY_CONFIGURATION_REQUIRED')
        self.root.mkdir(parents=True,exist_ok=True)
        self.timeout,self.max_jobs,self.max_pending,self.max_bytes=timeout,max_jobs,max_pending,max_bytes
        self.render_pdf,self.max_attempts,self.memory_bytes=render_pdf,max_attempts,memory_bytes
        self.lock=threading.RLock();self.pending=0;self.closed=False
        self._shutdown=threading.Event();self._cancel={};self._futures={}
        self.lock_path=self.root/'host.lock';self.host_lock=self.lock_path.open('a+b')
        if self.lock_path.stat().st_size==0:
            self.host_lock.write(b'0');self.host_lock.flush()
        self.host_lock.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.host_lock.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.host_lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.host_lock.close();raise ValueError('STORAGE_ALREADY_OWNED')
        self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='integration-job')
        from .source_identity import identity
        self.source_identity=identity()
        from .queueing import DurationHistory
        self.history=DurationHistory(self.root/'queue_observations.json');self._running_id=None
        paths=list(self.root.glob('*/state.json'));states=[(path,read(path)) for path in paths]
        sequences=[s['queue_sequence'] for _,s in states if 'queue_sequence' in s]
        if any(type(x) is not int or x<1 for x in sequences) or len(sequences)!=len(set(sequences)):
            raise ValueError('QUEUE_ORDER_INTEGRITY_FAILED')
        meta=read(self.root/'queue_meta.json') if (self.root/'queue_meta.json').exists() else {'next_sequence':1}
        if type(meta.get('next_sequence')) is not int or meta['next_sequence']<1:raise ValueError('QUEUE_ORDER_INTEGRITY_FAILED')
        self._sequence=max([meta['next_sequence']]+[x+1 for x in sequences])
        for path,state in sorted(states,key=lambda item:(item[1].get('created_utc',''),item[1]['analysis_id'])):
            if state['state']=='pending' and 'queue_sequence' not in state:
                from .queueing import workload
                state.update(queue_sequence=self._next_sequence(),enqueued_utc=state['created_utc'],queue_workload=workload(read(path.parent/'request.json')))
                write(path,state)
        # ThreadPoolExecutor is the sole FIFO; persist and sort admissions before submitting.
        with self.lock:
            for path,state in sorted(states,key=lambda item:item[1].get('queue_sequence',0)):
                self._recover_state(path,state,recover)

    def _next_sequence(self):
        value=self._sequence;self._sequence+=1
        write(self.root/'queue_meta.json',{'schema':'astragron.queue-order.v1','next_sequence':self._sequence})
        return value

    def _recover_state(self,path,state,recover):
        if state['state']!='pending':return
        self._recover_process(state,path.parent)
        state['recovery_count']=state.get('recovery_count',0)+1
        if state.get('cancel_requested_utc'):
            state.update(state='failed',phase='cancelled',error='JOB_CANCELLED',finished_utc=now())
        elif state.get('attempts',0)>=self.max_attempts:
            state.update(state='failed',phase='finished',error='RECOVERY_ATTEMPTS_EXHAUSTED',finished_utc=now())
        else:
            try:
                recovered=self._recover_publication(state,path.parent)
            except (ValueError,KeyError,OSError,TypeError):
                state.update(state='failed',phase='finished',error='RECOVERY_INTEGRITY_FAILED',finished_utc=now())
                write(path,state)
                return
            if recovered:
                write(path,state)
                return
            state.update(phase='queued',last_error='SERVER_RESTART_INTERRUPTED_JOB',error=None)
        write(path,state)
        if recover and state['state']=='pending':self._schedule(state['analysis_id'])

    def _recover_publication(self,state,path):
        # manifest is the publication commit marker; finish interrupted metadata atomically.
        manifest_path=path/'manifest.json'
        if manifest_path.is_file() and (path/'result.json').is_file():
            manifest=parse(manifest_path.read_text(encoding='utf-8'))
            if all((path/name).is_file() and sha(path/name)==value for name,value in manifest['files'].items()):
                response=parse((path/'result.json').read_text(encoding='utf-8'))
                request=parse((path/'request.json').read_text(encoding='utf-8'))
                from common import digest as science_digest
                if manifest['request_sha256']!=state['request_sha256'] or digest(request)!=state['request_sha256']:
                    raise ValueError('RECOVERY_REQUEST_INTEGRITY')
                if response['farm_id']!=state['farm_id'] or response['provenance']['request_sha256']!=science_digest(request) or sha(path/'result.json')!=manifest['response_sha256']:
                    raise ValueError('RECOVERY_RESULT_INTEGRITY')
                mapped={'CONDITIONAL_RESEARCH_COMPLETE':'complete_research','BOUNDED_PARTIAL':'partial','EVIDENCE_BLOCKED':'blocked'}
                state.update(state=mapped[response['status']],phase='finished',scientific_status=response['status'],run_id=response['run_id'],
                             response_sha256=manifest['response_sha256'],scientific_result_sha256=manifest['scientific_result_sha256'],
                             execution_receipt=manifest.get('execution_receipt'),report_error=manifest.get('report_error'),finished_utc=manifest['created_utc'])
                return True
        # Files without a valid manifest have never been exposed through a completed analysis.
        target=path/'attempts'/str(state.get('attempts',0))
        target.mkdir(parents=True,exist_ok=True)
        for name in ['result.json','report','manifest.json']:
            source=path/name;destination=target/('interrupted-'+name)
            if source.exists():
                if not source.resolve().is_relative_to(self.root) or not destination.resolve().is_relative_to(self.root):
                    raise ValueError('RECOVERY_PATH_OUTSIDE_STORE')
                if destination.exists():destination=target/(uuid.uuid4().hex+'-'+name)
                source.rename(destination)
        return False

    def _recover_process(self,state,path):
        if os.name=='nt':return  # Kernel job close kills the entire prior worker tree.
        pid=state.get('worker_pid');start=state.get('worker_start_token')
        if not pid or not start:return
        try:
            proc=Path('/proc')/str(pid)
            command=(proc/'cmdline').read_bytes()
            actual=(proc/'stat').read_text().split(') ',1)[1].split()[19]
            if actual==start and b'system_integration.worker' in command and str(path/'request.json').encode() in command:
                import signal
                os.killpg(pid,signal.SIGKILL)
        except (OSError,ValueError,IndexError):pass

    def _schedule(self,analysis_id):
        self._cancel[analysis_id]=threading.Event();self.pending+=1
        self._futures[analysis_id]=self.executor.submit(self._run,analysis_id)
        self._futures[analysis_id].add_done_callback(lambda future:self._record_future_failure(analysis_id,future))

    def _record_future_failure(self,analysis_id,future):
        if future.cancelled():return
        error=future.exception()
        if error is not None:
            import traceback
            path=self._path(analysis_id)/'controller.stderr.log'
            try:
                with path.open('a',encoding='utf-8') as stream:traceback.print_exception(type(error),error,error.__traceback__,file=stream)
            except OSError:pass

    def close(self):
        if self.closed:return
        with self.lock:
            self.closed=True;self._shutdown.set()
            for future in self._futures.values():future.cancel()
        self.executor.shutdown(wait=True,cancel_futures=True)
        self.host_lock.close()

    def _path(self,analysis_id):
        if not isinstance(analysis_id,str) or not ID.fullmatch(analysis_id):raise Problem(404,'ANALYSIS_NOT_FOUND')
        return self.root/analysis_id

    def state(self,principal,analysis_id):
        path=self._path(analysis_id)
        try:state=read(path/'state.json')
        except FileNotFoundError:raise Problem(404,'ANALYSIS_NOT_FOUND')
        owner=state['owner']
        if owner['tenant']!=principal.tenant or owner['subject']!=principal.subject or state['farm_id'] not in principal.farms:
            raise Problem(404,'ANALYSIS_NOT_FOUND')
        future=self._futures.get(analysis_id)
        if state['state']=='pending' and future is not None and future.done() and not future.cancelled() and future.exception() is not None:
            raise Problem(503,'JOB_STATE_STORAGE_UNAVAILABLE')
        owner=state['owner']
        if owner['tenant']!=principal.tenant or owner['subject']!=principal.subject or state['farm_id'] not in principal.farms:
            raise Problem(404,'ANALYSIS_NOT_FOUND')
        return deepcopy(state)

    def queue_status(self,principal,analysis_id):
        from .queueing import queue_dto
        with self.lock:
            state=self.state(principal,analysis_id)
            pending=[read(path) for path in self.root.glob('*/state.json')]
            pending=[s for s in pending if s['state']=='pending']
            return queue_dto(state,pending,self._running_id,self.history,self.max_pending)

    def public_state(self,principal,analysis_id):
        with self.lock:
            state=self.state(principal,analysis_id)
            state['queue']=self.queue_status(principal,analysis_id)
            for key in ('owner','worker_pid','worker_start_token','source_identity_at_submission','queue_sequence','queue_workload','execution_host_fingerprint'):state.pop(key,None)
            return state

    def list(self,principal):
        result=[]
        for path in sorted(self.root.glob('*/state.json')):
            try:result.append(self.public_state(principal,path.parent.name))
            except Problem:pass
        return result

    def create(self,principal,payload,*,parent_id=None):
        try:validate(payload)
        except (ValueError,TypeError,KeyError,OverflowError):raise Problem(422,'INVALID_SCIENTIFIC_REQUEST')
        if payload['farm_id'] not in principal.farms:raise Problem(404,'FARM_NOT_FOUND')
        if payload['engine_request']['source']['acquisition']!='CACHE_ONLY':raise Problem(422,'OFFLINE_CACHE_ONLY_REQUIRED')
        if parent_id and self.state(principal,parent_id)['farm_id']!=payload['farm_id']:raise Problem(404,'ANALYSIS_NOT_FOUND')
        request_hash=digest(payload)
        with self.lock:
            if self.closed:raise Problem(503,'SERVER_STOPPING')
            # Only same-principal, same-parent in-flight jobs coalesce; no cross-user disclosure.
            for existing in self.list(principal):
                if existing['state']=='pending' and existing['request_sha256']==request_hash and existing.get('parent_analysis_id')==parent_id:
                    return existing
            self._capacity()
            analysis_id=uuid.uuid4().hex;path=self._path(analysis_id);path.mkdir()
            write(path/'request.json',payload)
            from .queueing import workload
            state={'queue_sequence':self._next_sequence(),'enqueued_utc':now(),'queue_workload':workload(payload),'schema':'astragron.analysis-state.v1','analysis_id':analysis_id,'request_id':uuid.uuid4().hex,
                   'request_sha256':request_hash,'farm_id':payload['farm_id'],'owner':{'tenant':principal.tenant,'subject':principal.subject},
                   'parent_analysis_id':parent_id,'scenario_ids':{s['scenario_id']:'scenario:'+digest({'analysis_id':analysis_id,'scenario':s}) for s in payload['engine_request']['scenarios']},
                   'state':'pending','phase':'queued','created_utc':now(),'scientific_status':None,'error':None,'report_error':None,
                   'immutable':True,'attempts':0,'recovery_count':0,'execution_deadline_seconds':self.timeout,
                   'source_identity_at_submission':self.source_identity,'progress':{'completed_stages':0,'total_stages':None}}
            write(path/'state.json',state);self._schedule(analysis_id)
            return self.public_state(principal,analysis_id)

    def _capacity(self,new=True):
        if self.pending>=self.max_pending:raise Problem(429,'COMPUTE_QUEUE_LIMIT')
        if new and len(list(self.root.glob('*/state.json')))>=self.max_jobs:raise Problem(429,'STORAGE_CASE_LIMIT')
        if self._storage_bytes()>=self.max_bytes:raise Problem(507,'STORAGE_BYTE_LIMIT')

    def _storage_bytes(self):
        total=sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file())
        for path in self.root.glob('*/state.json'):
            runtime=ROOT/'runtime/agent-a/system-integration/jobs'/path.parent.name
            if runtime.exists():total+=sum(p.stat().st_size for p in runtime.rglob('*') if p.is_file())
        return total

    def cancel(self,principal,analysis_id):
        with self.lock:
            state=self.state(principal,analysis_id)
            if state['state']!='pending':raise Problem(409,'ANALYSIS_ALREADY_TERMINAL')
            state.update(cancel_requested_utc=now(),phase='cancelling')
            write(self._path(analysis_id)/'state.json',state)
            self._cancel[analysis_id].set()
            future=self._futures.get(analysis_id)
            if future is not None and future.cancel():
                state.update(state='failed',phase='cancelled',error='JOB_CANCELLED',finished_utc=now())
                write(self._path(analysis_id)/'state.json',state);self.pending-=1
            return self.public_state(principal,analysis_id)

    def retry(self,principal,analysis_id):
        with self.lock:
            state=self.state(principal,analysis_id)
            if self.closed:raise Problem(503,'SERVER_STOPPING')
            if state['state']!='failed' or state.get('error') not in {'WORKER_TIMEOUT','WORKER_FAILED','SERVER_RESTART_INTERRUPTED_JOB','HOST_STOPPING','JOB_CANCELLED','RECOVERY_ATTEMPTS_EXHAUSTED','PROCESS_RESOURCE_BOUNDARY_UNAVAILABLE'}:
                raise Problem(409,'ANALYSIS_NOT_RETRYABLE')
            try:
                if self._recover_publication(state,self._path(analysis_id)):
                    write(self._path(analysis_id)/'state.json',state)
                    return self.public_state(principal,analysis_id)
            except (ValueError,KeyError,OSError,TypeError):raise Problem(409,'RECOVERY_INTEGRITY_FAILED')
            if state.get('attempts',0)>=self.max_attempts:raise Problem(409,'RECOVERY_ATTEMPTS_EXHAUSTED')
            self._capacity(new=False)
            request=parse((self._path(analysis_id)/'request.json').read_text(encoding='utf-8'))
            if digest(request)!=state['request_sha256']:raise Problem(409,'REQUEST_INTEGRITY_FAILED')
            state.update(state='pending',phase='queued',last_error=state.get('error'),error=None,cancel_requested_utc=None,queue_sequence=self._next_sequence(),enqueued_utc=now())
            write(self._path(analysis_id)/'state.json',state);self._schedule(analysis_id)
            return self.public_state(principal,analysis_id)

    def _run(self,analysis_id):
        from .processes import OwnedProcess
        path=self._path(analysis_id);started=time.monotonic();owned=None
        runtime=ROOT/'runtime/agent-a/system-integration/jobs'/analysis_id
        scratch=runtime/'private';scratch.mkdir(parents=True,exist_ok=True)
        try:
            with self.lock:
                state=read(path/'state.json')
                if self._shutdown.is_set():raise Problem(503,'HOST_STOPPING')
                if state.get('cancel_requested_utc'):raise Problem(409,'JOB_CANCELLED')
                self._running_id=analysis_id
                state.update(phase='preparing',attempts=state.get('attempts',0)+1,started_utc=now(),execution_deadline_seconds=self.timeout)
                write(path/'state.json',state)
            request=parse((path/'request.json').read_text(encoding='utf-8'))
            if digest(request)!=state['request_sha256']:raise Problem(409,'REQUEST_INTEGRITY_FAILED')
            attempt=path/'attempts'/str(state['attempts']);attempt.mkdir(parents=True,exist_ok=True)
            output=attempt/'result.json';progress=runtime/'progress.json';progress.unlink(missing_ok=True)
            env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',PYTHONUTF8='1',TEMP=str(scratch),TMP=str(scratch),OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1')
            env={k:v for k,v in env.items() if not any(x in k.upper() for x in ('API_KEY','TOKEN','SECRET','PASSWORD','AUTH_JSON'))}
            self.seed(runtime)
            env['ASTRAGRON_JOB_ATTEMPT']=str(state['attempts'])
            owned=OwnedProcess([sys.executable,'-B','-X','utf8','-m','system_integration.worker',str(path/'request.json'),str(output),str(runtime)],cwd=ROOT,env=env,memory_bytes=self.memory_bytes,stderr_path=attempt/'worker.stderr.log')
            with self.lock:
                state=read(path/'state.json')
                token=None
                if os.name!='nt':
                    try:token=(Path('/proc')/str(owned.process.pid)/'stat').read_text().split(') ',1)[1].split()[19]
                    except OSError:pass
                state.update(phase='computing',worker_pid=owned.process.pid,worker_start_token=token)
                write(path/'state.json',state)
            last_progress=None;last_quota_check=time.monotonic()
            while owned.process.poll() is None:
                if self._shutdown.is_set():raise Problem(503,'HOST_STOPPING')
                if self._cancel[analysis_id].is_set():raise Problem(409,'JOB_CANCELLED')
                if time.monotonic()-started>self.timeout:raise Problem(504,'WORKER_TIMEOUT')
                if time.monotonic()-last_quota_check>5:
                    if self._storage_bytes()>self.max_bytes:raise Problem(507,'STORAGE_BYTE_LIMIT')
                    last_quota_check=time.monotonic()
                if progress.exists():
                    raw=read_bytes(progress)
                    if raw!=last_progress:
                        value=parse(raw);last_progress=raw
                        with self.lock:
                            state=read(path/'state.json');state.update(progress=value,phase=value.get('phase','computing'));write(path/'state.json',state)
                time.sleep(.1)
            if owned.process.returncode or not output.is_file():raise Problem(500,'WORKER_FAILED')
            owned.close()
            response=parse(output.read_text(encoding='utf-8'))
            from common import digest as science_digest
            if response['farm_id']!=state['farm_id'] or response['provenance']['request_sha256']!=science_digest(request):raise Problem(500,'RESULT_INTEGRITY_FAILED')
            mapped={'CONDITIONAL_RESEARCH_COMPLETE':'complete_research','BOUNDED_PARTIAL':'partial','EVIDENCE_BLOCKED':'blocked'}
            if response['status'] not in mapped:raise Problem(500,'RESULT_INTEGRITY_FAILED')
            with self.lock:
                state=read(path/'state.json');state.update(phase='reporting');write(path/'state.json',state)
            try:
                from .reports import generate
                generate(output,attempt/'report',pdf=self.render_pdf,env=env,cancel=self._cancel[analysis_id],stop=self._shutdown)
            except Exception:state['report_error']='REPORT_GENERATION_FAILED'
            if self._shutdown.is_set():raise Problem(503,'HOST_STOPPING')
            if self._cancel[analysis_id].is_set():raise Problem(409,'JOB_CANCELLED')
            with self.lock:
                current=read(path/'state.json')
                if current.get('cancel_requested_utc'):raise Problem(409,'JOB_CANCELLED')
                # Publish exactly once, after request binding and all scientific gates.
                if (path/'result.json').exists():raise Problem(409,'RESULT_ALREADY_PUBLISHED')
                output.replace(path/'result.json')
                if (attempt/'report').exists():(attempt/'report').replace(path/'report')
                files={'request.json':sha(path/'request.json'),'result.json':sha(path/'result.json')}
                files.update({p.relative_to(path).as_posix():sha(p) for p in (path/'report').rglob('*') if p.is_file()})
                execution=parse((runtime/'execution_receipt.json').read_text(encoding='utf-8')) if (runtime/'execution_receipt.json').exists() else None
                if execution and execution['request_sha256']!=state['request_sha256']:raise Problem(409,'RESULT_INTEGRITY_FAILED')
                manifest={'schema':'astragron.analysis-manifest.v1','analysis_id':analysis_id,'request_sha256':state['request_sha256'],'response_sha256':sha(path/'result.json'),'run_id':response['run_id'],'scientific_result_sha256':response['engine_result'].get('scientific_result_sha256'),'source_identity':self.source_identity,'execution_receipt':execution,'report_error':state.get('report_error'),'files':files,'created_utc':now()}
                write(path/'manifest.json',manifest)
                state.update(state=mapped[response['status']],phase='finished',scientific_status=response['status'],run_id=response['run_id'],response_sha256=manifest['response_sha256'],scientific_result_sha256=manifest['scientific_result_sha256'],execution_receipt=execution,progress={'phase':'finished','completed_stages':(execution or {}).get('completed_stages'),'total_stages':(execution or {}).get('total_stages')})
        except Problem as error:
            state=read(path/'state.json')
            if error.code=='HOST_STOPPING':state.update(state='pending',phase='interrupted',last_error=error.code,error=None)
            else:state.update(state='failed',phase='cancelled' if error.code=='JOB_CANCELLED' else 'finished',error=error.code)
        except Exception:
            state=read(path/'state.json');state.update(state='failed',phase='finished',error='WORKER_FAILED')
        finally:
            if owned:
                if owned.process.poll() is None:owned.terminate()
                owned.close();state['peak_worker_job_memory_bytes']=owned.peak_memory_bytes
            state.update(finished_utc=now() if state['state']!='pending' else None,wall_seconds=round(time.monotonic()-started,3))
            write(path/'state.json',state)
            with self.lock:
                self.pending-=1
                if self._running_id==analysis_id:self._running_id=None
                if state['state'] in {'complete_research','partial'} and state.get('attempts')==1 and not state.get('report_error'):
                    execution=state.get('execution_receipt') or {}
                    if not execution or (execution.get('fresh_native_cases')==6 and execution.get('verified_cache_replays')==0):
                        try:self.history.add(state['queue_workload'],state['wall_seconds'],analysis_id+':1')
                        except OSError:pass

    @staticmethod
    def _kill_tree(proc):
        if os.name=='nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True,timeout=15)
        else:
            import signal
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        proc.wait(timeout=15)

    @staticmethod
    def seed(runtime):
        """Copy only verified NASA source bytes, never another agent's computed results."""
        from brain import growth_source
        cache = ROOT / 'runtime/agent-a/system-integration/source_snapshot'
        if not (cache / 'growth-weather.receipt.json').is_file():
            return  # The engine will return a genuine evidence blocker.
        receipt = parse((cache / 'growth-weather.receipt.json').read_text(encoding='utf-8'))
        raw = (cache / (receipt['raw_sha256'] + '.raw.json')).read_bytes()
        growth_source.verify(raw, receipt)
        lock = parse((ROOT / 'coordination/GROWTH_INPUT_LOCK.json').read_text(encoding='utf-8'))
        if any(receipt.get(k) != v for k, v in lock['NASA'].items()):
            raise ValueError('SOURCE_SNAPSHOT_NOT_ADMITTED')
        target = runtime / 'growth-decision/provider/source_cache'
        target.mkdir(parents=True, exist_ok=True)
        for name, content in [(receipt['raw_sha256'] + '.raw.json', raw), ('growth-weather.receipt.json', (cache / 'growth-weather.receipt.json').read_bytes())]:
            path = target / name
            if path.exists():
                if path.read_bytes() != content: raise ValueError('IMMUTABLE_SOURCE_SNAPSHOT_CONFLICT')
            else:
                with path.open('xb') as stream: stream.write(content)

    def result(self, principal, analysis_id):
        state = self.state(principal, analysis_id)
        if state['state'] == 'pending':
            raise Problem(409, 'ANALYSIS_PENDING')
        if state['state'] == 'failed':
            raise Problem(409, state['error'])
        path = self._path(analysis_id) / 'result.json'
        request = parse((path.parent / 'request.json').read_text(encoding='utf-8'))
        if digest(request) != state['request_sha256'] or sha(path) != state['response_sha256']:
            raise Problem(409, 'RESULT_INTEGRITY_FAILED')
        return read(path)

    def artifact(self, principal, analysis_id, name):
        self.result(principal, analysis_id)
        allowed = {'html': ('report/Farm_Decision_Summary.html', 'text/html; charset=utf-8'),
                   'pdf': ('report/Farm_Decision_Summary.pdf', 'application/pdf'),
                   'csv': ('report/Canonical_Report_Rows.csv', 'text/csv; charset=utf-8'),
                   'json': ('result.json', 'application/json'), 'manifest': ('manifest.json', 'application/json'),
                   'bindings': ('report/Numeric_Source_Bindings.json', 'application/json'),
                   'appendix': ('report/Technical_Evidence_Appendix.json', 'application/json')}
        if name not in allowed:
            raise Problem(404, 'EXPORT_NOT_FOUND')
        relative, mime = allowed[name]
        path = self._path(analysis_id) / relative
        if not path.is_file():
            raise Problem(503, 'REPORT_NOT_AVAILABLE')
        manifest = parse((self._path(analysis_id) / 'manifest.json').read_text(encoding='utf-8'))
        if relative != 'manifest.json' and sha(path) != manifest['files'].get(relative):
            raise Problem(409, 'RESULT_INTEGRITY_FAILED')
        return path.read_bytes(), mime
