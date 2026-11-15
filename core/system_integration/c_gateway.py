"""Server-side C host bridge. A pending dependency never pretends to be live chat."""
from copy import deepcopy
from types import SimpleNamespace
import threading
import uuid
from .codec import parse,write,now
from .store import Problem

class ChatGateway:
    def __init__(self,store,service=None,*,native_scope_verified=False,public_demo_enabled=False):
        self.store,self.service=store,service
        self.native_scope_verified=native_scope_verified
        self.public_demo_enabled=public_demo_enabled;self.verified_live={}
        self.sessions={};self.lock=threading.RLock();self.registered={}

    def status(self):
        return {'schema':'astragron.chat-capability.v1','available':self.service is not None,
                'reason_code':'C_INTEGRATION_PENDING' if self.service is None else 'REVIEWED_C_ADAPTER',
                'native_scope_verified':self.native_scope_verified,'live_inference_verified':bool(self.verified_live),'verified_live':dict(self.verified_live),'remote_data_scope':'EXACT_REVIEWED_PUBLIC_FIXTURE_ONLY',
                'primary_candidate':'Gemini Flash Lite','independent_fallback_candidate':'Groq',
                'keys':'SERVER_ENVIRONMENT_ONLY','research_report_available_without_chat':True}

    @staticmethod
    def principal(principal):
        return SimpleNamespace(tenant_id=principal.tenant,subject_id=principal.subject,farm_ids=frozenset(principal.farms))

    def _call(self,method,*args,**kwargs):
        try:return getattr(self.service,method)(*args,**kwargs)
        except Problem:raise
        except Exception as error:
            # Only stable machine codes/status cross the boundary; never vendor text or secrets.
            code=getattr(error,'code','CHAT_PROVIDER_UNAVAILABLE');status=getattr(error,'status',503)
            if not isinstance(code,str) or not code.replace('_','').isalnum():code='CHAT_PROVIDER_UNAVAILABLE'
            raise Problem(status if status in {400,404,409,422,429,503,504} else 503,code)

    def _register(self,principal,aid,parent=None):
        key=(principal.tenant,principal.subject,aid)
        if key in self.registered:
            try:
                self._call('_analysis',self.principal(principal),self.registered[key])
                return self.registered[key]
            except Problem as error:
                if error.status!=404:raise
                self.registered.pop(key,None)
        result=self.store.result(principal,aid)
        if self.service is None:raise Problem(503,'C_INTEGRATION_PENDING')
        if result.get('growth_evaluation') and not self.native_scope_verified:raise Problem(503,'NATIVE_C_CONTRACT_PENDING')
        request=parse((self.store._path(aid)/'request.json').read_text(encoding='utf-8'))
        if result.get('growth_evaluation'):
            from assistant_brain.snapshot import project_for_chat_v1
            try:result,receipt=project_for_chat_v1(result)
            except Exception:raise Problem(409,'CHAT_PROJECTION_INTEGRITY_FAILED')
            folder=self.store.root/'chat-projections'/aid;folder.mkdir(parents=True,exist_ok=True)
            write(folder/'projection_receipt.json',receipt)
        public=self.public_demo_enabled and self.store.state(principal,aid).get('execution_kind')=='VERIFIED_PUBLIC_FIXTURE'
        cid=self._call('register_analysis',self.principal(principal),result,request,parent_id=parent,public_research=public)
        self.registered[key]=cid
        return cid

    def create(self,principal,body):
        if not isinstance(body,dict) or set(body)-{'analysis_id','locale'} or 'analysis_id' not in body or body.get('locale','en')!='en':
            raise Problem(422,'INVALID_CONVERSATION_REQUEST')
        aid=body['analysis_id'];self.store.result(principal,aid)
        if self.service is None:raise Problem(503,'C_INTEGRATION_PENDING')
        cid=self._register(principal,aid)
        created=self._call('create_session',self.principal(principal),cid,locale=body.get('locale','en'))
        sid=uuid.uuid4().hex
        with self.lock:
            if len(self.sessions)>=256:raise Problem(429,'SESSION_LIMIT')
            self.sessions[sid]={'owner':principal,'analysis_id':aid,'c_session_id':created['session_id'],'c_analysis_id':cid,'original_analysis_id':aid}
        return {**created,'session_id':sid,'analysis_id':aid,'scientific_analysis_reference':aid}

    def report(self,principal,cid):
        ids=[aid for (tenant,subject,aid),value in self.registered.items() if tenant==principal.tenant and subject==principal.subject and value==cid]
        if len(ids)!=1:raise Problem(404,'ANALYSIS_NOT_FOUND')
        result=self.store.result(principal,ids[0])
        return {'analysis_id':cid,'scientific_analysis_reference':ids[0],'farm_id':result['farm_id'],'report_dto':result['report_dto'],'qualification':result['qualification']}

    def dispatch(self,method,parts,principal,body):
        is_chat=parts[:2]==['v1','conversations'] or parts==['v1','chat','status']
        is_report=len(parts)==4 and parts[:2]==['v1','analyses'] and parts[2].startswith('a_') and parts[3]=='report'
        if not is_chat and not is_report:return None
        with self.lock:return self._dispatch(method,parts,principal,body)

    def _dispatch(self,method,parts,principal,body):
        if parts==['v1','chat','status'] and method=='GET':return 200,self.status()
        if len(parts)==4 and parts[:2]==['v1','analyses'] and parts[2].startswith('a_') and parts[3]=='report' and method=='GET':
            return 200,self.report(principal,parts[2])
        if parts[:2]!=['v1','conversations']:return None
        if len(parts)==2 and method=='POST':return 201,self.create(principal,body())
        if self.service is None:raise Problem(503,'C_INTEGRATION_PENDING')
        if len(parts)<3:raise Problem(404,'SESSION_NOT_FOUND')
        sid=parts[2]
        with self.lock:item=self.sessions.get(sid)
        if not item or item['owner']!=principal:raise Problem(404,'SESSION_NOT_FOUND')
        self.store.state(principal,item['analysis_id']);cp=self.principal(principal);csid=item['c_session_id']
        if len(parts)==3:
            if method=='GET':return 200,self._call('history',cp,csid)
            if method=='DELETE':
                reply=self._call('delete_session',cp,csid)
                with self.lock:self.sessions.pop(sid,None)
                return 200,reply
        if method=='POST' and parts[3:]==['messages']:
            value=body()
            if not isinstance(value,dict) or set(value)-{'message','scope','quality_mode','change'} or not isinstance(value.get('message'),str) or not value['message'].strip() or len(value['message'])>4000:
                raise Problem(422,'INVALID_CHAT_MESSAGE')
            change=value.get('change')
            if change is None:
                from assistant_brain.intent import understand
                from assistant_brain.tools import parse_rain_change
                if understand(value['message'])=='what_if':
                    try:change=parse_rain_change(value['message'],self.service._analysis(cp,item['c_analysis_id']).context,value.get('scope') or {})
                    except Exception:change=None
            if change is not None:
                if not isinstance(change,dict) or change.get('operation')!='rain_factor':
                    return 200,{**self._call('send',cp,csid,value['message'],scope=deepcopy(value.get('scope')),change=change,quality_mode=value.get('quality_mode','standard')),'scientific_analysis_reference':item['analysis_id']}
                from assistant_brain.tools import changed_request
                request=parse((self.store._path(item['analysis_id'])/'request.json').read_text(encoding='utf-8'))
                try:child_request=changed_request(request,change)
                except Exception:
                    return 200,{**self._call('send',cp,csid,value['message'],scope=deepcopy(value.get('scope')),change=change,quality_mode=value.get('quality_mode','standard')),'scientific_analysis_reference':item['analysis_id']}
                child=self.store.create(principal,child_request,parent_id=item['analysis_id'])
                return 202,{'schema':'astragron.chat-job.response.v1','analysis_job':child,
                    'tool':{'status':'SCIENTIFIC_JOB_PENDING','analysis_id':child['analysis_id'],'parent_analysis_id':item['analysis_id'],'original_preserved':True,'attach_required':True},
                    'scientific_analysis_reference':item['analysis_id'],'live_inference':False}
            answer=self._call('send',cp,csid,value['message'],scope=deepcopy(value.get('scope')),quality_mode=value.get('quality_mode','standard'))
            if answer.get('mode') in {'LIVE_GEMINI','LIVE_GROQ'}:
                self.verified_live[answer['provider']]={'model':answer.get('model'),'verified_utc':now(),'scope':'EXACT_REVIEWED_PUBLIC_FIXTURE_ONLY'}
            return 200,{**answer,'scientific_analysis_reference':item['analysis_id']}
        if method=='POST' and parts[3:]==['analysis']:
            value=body()
            if not isinstance(value,dict) or set(value)!={'analysis_id'}:raise Problem(422,'INVALID_ATTACHMENT')
            aid=value['analysis_id'];state=self.store.state(principal,aid)
            current=self.store.state(principal,item['analysis_id'])
            if state['farm_id']!=current['farm_id']:raise Problem(404,'ANALYSIS_NOT_FOUND')
            cid=self._register(principal,aid)
            answer=self._call('attach',cp,csid,cid)
            item.update(analysis_id=aid,c_analysis_id=cid)
            return 200,{**answer,'session_id':sid,'analysis_id':aid}
        if method=='POST' and parts[3:]==['compare']:
            value=body()
            if not isinstance(value,dict) or set(value)!={'analysis_ids'} or not isinstance(value['analysis_ids'],list) or not 1<=len(value['analysis_ids'])<=2:raise Problem(422,'INVALID_COMPARISON')
            current=self.store.state(principal,item['analysis_id'])
            for aid in value['analysis_ids']:
                if self.store.state(principal,aid)['farm_id']!=current['farm_id']:raise Problem(404,'ANALYSIS_NOT_FOUND')
            ids=[self._register(principal,aid) for aid in value['analysis_ids']]
            return 200,{**self._call('compare',cp,csid,ids),'scientific_analysis_reference':item['analysis_id']}

        if method=='GET' and len(parts)==5 and parts[3]=='evidence':return 200,self._call('evidence',cp,csid,parts[4])
        raise Problem(404,'ROUTE_NOT_FOUND')

def build_service():
    from dataclasses import replace
    import os
    from assistant_brain.config import Settings
    from assistant_brain.service import ConversationService
    settings=Settings.from_env()
    if 'ASTRAGRON_CHAT_PROVIDER' not in os.environ:settings=replace(settings,provider='offline')
    # All science tools go through D's durable queue; no unbounded parallel C worker.
    return ConversationService(settings,backend=None)
