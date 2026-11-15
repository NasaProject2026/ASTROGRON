"""Durable scenario checkpoints around unchanged A; final qualification uses the full request."""
import argparse
from copy import deepcopy
from pathlib import Path
import time
import os

from .codec import digest,parse,write

def execute(request_path,output,runtime):
    from brain.service import ClientDecisionService
    payload=parse(Path(request_path).read_text(encoding='utf-8'))
    if payload['engine_request']['source']['acquisition']!='CACHE_ONLY':raise ValueError('OFFLINE_CACHE_ONLY_REQUIRED')
    runtime=Path(runtime);runtime.mkdir(parents=True,exist_ok=True)
    client=ClientDecisionService(runtime);started=time.monotonic();records=[]
    scenarios=payload['engine_request']['scenarios'];growth=payload.get('growth_decision')
    checkpointed=(isinstance(growth,dict) and isinstance(growth.get('scenarios'),list) and len(scenarios)>1
                  and {s['scenario_id'] for s in scenarios}=={s['scenario_id'] for s in growth['scenarios']})
    total=len(scenarios)+1 if checkpointed else 1
    attempt=int(os.environ.get('ASTRAGRON_JOB_ATTEMPT','1'))
    journal=runtime/('execution-attempt-'+str(attempt)+'.json')
    def progress(phase,done,scenario=None):
        write(runtime/'progress.json',{'phase':phase,'completed_stages':done,'total_stages':total,
                                      'scenario_id':scenario,'elapsed_seconds':round(time.monotonic()-started,3)})
    if checkpointed:
        for index,scenario in enumerate(scenarios):
            progress('computing',index,scenario['scenario_id'])
            part=deepcopy(payload)
            part['engine_request']['scenarios']=[deepcopy(scenario)]
            part['growth_decision']['scenarios']=[deepcopy(s) for s in growth['scenarios'] if s['scenario_id']==scenario['scenario_id']]
            tick=time.monotonic();result=client.run(part,use_cache=False)
            records.append({'scenario_id':scenario['scenario_id'],'status':result['status'],
                            'execution':result['engine_result'].get('execution',{}),'run_id':result['run_id'],
                            'wall_seconds':round(time.monotonic()-tick,3)})
            # Each successful case is committed by A's integrity-checked scientific cache.
            # Never publish a subset as the original full analysis.
            del result
            write(journal,{'attempt':attempt,'request_sha256':digest(payload),'stages':records,'complete':False})
            progress('computing',index+1,scenario['scenario_id'])
    progress('qualifying',len(records))
    tick=time.monotonic();result=client.run(payload,use_cache=False)
    write(output,result)
    receipt={'schema':'astragron.job-execution.v1','request_sha256':digest(payload),'checkpointed':checkpointed,
             'stages':records,'completed_stages':total,'total_stages':total,
             'fresh_native_cases':sum(s['execution'].get('physics_cases_executed',0) for s in records)+result['engine_result'].get('execution',{}).get('physics_cases_executed',0),
             'verified_cache_replays':sum(s['execution'].get('numerical_cache_replays',0) for s in records),
             'full_request_execution':result['engine_result'].get('execution'),
             'full_request_qualification_seconds':round(time.monotonic()-tick,3),
             'scientific_result_sha256':result['engine_result'].get('scientific_result_sha256'),
             'wall_seconds':round(time.monotonic()-started,3),
             'scientific_gates':'Original A request/worker budgets, inputs, equations, conservation gates and complete-matrix qualification unchanged.'}
    receipt['attempt']=attempt
    write(journal,{**receipt,'complete':True})
    write(runtime/'execution_receipt.json',receipt)
    progress('qualifying',total)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('request',type=Path);p.add_argument('output',type=Path);p.add_argument('runtime',type=Path)
    a=p.parse_args();execute(a.request,a.output,a.runtime)
