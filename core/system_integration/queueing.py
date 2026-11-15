"""Private-safe FIFO queue estimates from bounded actual measurements on this host."""
import hashlib,math,platform
from datetime import datetime,timezone
from .codec import digest,read,write

MIN_SAMPLES=3
MAX_PER_PROFILE=20

def host_fingerprint():
    return hashlib.sha256((platform.system()+"|"+platform.machine()+"|"+platform.node()).encode()).hexdigest()

def workload(request):
    engine=request['engine_request'];growth=request.get('growth_decision') or {}
    return digest({'kind':'native_growth' if growth else 'water','years':engine['horizon_years'],
        'fields':len(engine['fields']),'scenarios':len(engine['scenarios']),
        'growth_schema':growth.get('schema')})

class DurationHistory:
    def __init__(self,path):
        self.path=path;self.host=host_fingerprint();self.records=[]
        try:
            data=read(path)
            if data.get('schema')=='astragron.queue-observations.v1' and data.get('host_fingerprint')==self.host:
                self.records=[x for x in data.get('records',[]) if isinstance(x,dict) and isinstance(x.get('profile'),str) and type(x.get('seconds')) in (int,float) and math.isfinite(x['seconds']) and 0<x['seconds']<=3600][-80:]
        except (OSError,ValueError,TypeError):pass
    def add(self,profile,seconds,source):
        if not 0<seconds<=3600:return
        if any(x.get('source')==source for x in self.records):return
        self.records.append({'profile':profile,'seconds':round(seconds,3),'source':source})
        counts={};bounded=[]
        for x in reversed(self.records):
            counts[x['profile']]=counts.get(x['profile'],0)+1
            if counts[x['profile']]<=MAX_PER_PROFILE:bounded.append(x)
        self.records=list(reversed(bounded))[-80:]
        write(self.path,{'schema':'astragron.queue-observations.v1','host_fingerprint':self.host,'records':self.records})
    def interval(self,record,as_of):
        samples=[x['seconds'] for x in self.records if x['profile']==record.get('queue_workload')][-MAX_PER_PROFILE:]
        if len(samples)<MIN_SAMPLES:return None,len(samples)
        low=min(samples)*0.5;high=max(samples)*1.75
        elapsed=0
        if record.get('_running'):
            try:elapsed=max(0,(as_of-datetime.fromisoformat(record['started_utc'])).total_seconds())
            except (KeyError,ValueError,TypeError):return None,len(samples)
            # Checkpoint recovery and elapsed overruns do not imply a known fraction done.
            if record.get('attempts',0)>1:low=0
            if elapsed>=high:high=elapsed+max(samples)
        return (max(0,low-elapsed),max(0,high-elapsed)),len(samples)

def queue_dto(state,pending,running_id,history,capacity):
    stamp=datetime.now(timezone.utc);aid=state['analysis_id']
    status=('running' if aid==running_id else 'queued') if state['state']=='pending' else ('cancelled' if state.get('error')=='JOB_CANCELLED' else 'blocked' if state['state']=='blocked' else 'failed' if state['state']=='failed' else 'finished')
    dto={'schema':'astragron.queue-status.v1','analysis_id':aid,'status':status,'phase':state.get('phase'),
        'as_of_utc':stamp.isoformat(),'analyses_ahead':0,'queue_position':None,
        'estimated_start_wait_seconds':None,'estimated_start_wait_interval_seconds':None,
        'estimation_basis':{'status':'not_applicable','target':'START','method':'bounded_host_observations_v1','minimum_samples_per_workload':MIN_SAMPLES,'maximum_samples_per_workload':MAX_PER_PROFILE,'guaranteed':False},
        'capacity':{'running_limit':1,'running_plus_waiting_limit':capacity}}
    if status not in ('queued','running'):return dto
    if status=='running':
        dto['estimated_start_wait_seconds']=0;dto['estimated_start_wait_interval_seconds']={'lower':0,'upper':0};dto['estimation_basis']['status']='already_started';return dto
    order=sorted(pending,key=lambda x:x['queue_sequence'])
    active=[x for x in order if x['analysis_id']==running_id];order=active+[x for x in order if x['analysis_id']!=running_id]
    index=next(i for i,x in enumerate(order) if x['analysis_id']==aid)
    dto['analyses_ahead']=index;dto['queue_position']=index+1-len(active)
    low=high=0;counts=[]
    for record in order[:index]:
        interval,count=history.interval({**record,'_running':record['analysis_id']==running_id},stamp);counts.append(count)
        if interval is None:
            dto['estimation_basis'].update(status='insufficient_valid_host_observations',sample_counts=counts)
            return dto
        low+=interval[0];high+=interval[1]
    lower=int(math.floor(low/30)*30);upper=int(math.ceil(high/30)*30)
    dto['estimated_start_wait_interval_seconds']={'lower':lower,'upper':upper}
    dto['estimated_start_wait_seconds']=int(round(((lower+upper)/2)/30)*30)
    dto['estimation_basis'].update(status='estimated' if index else 'next_to_start',sample_counts=counts,
        assumptions='Current queue remains admitted; cancellations, host load, restart and evidence blocking can change this range. This is estimated START wait, not completion or confidence.')
    return dto
