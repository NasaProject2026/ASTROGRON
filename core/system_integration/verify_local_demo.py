"""Replay local browser acceptance without any remote provider call or new science."""
import os,secrets,subprocess,threading,json,time,uuid
from brain.baseline import ROOT
from .codec import read,write,sha,now
from .store import Store,Principal
from .api import Server

def main():
    from .release_demo import fixture_requests,import_case
    requests=fixture_requests();folder=ROOT/'runtime/integration'/('local-replay-'+uuid.uuid4().hex)
    farms=tuple(sorted({x['farm_id'] for x in requests.values()}));principal=Principal('release-synthetic','owner',farms);token=secrets.token_urlsafe(32)
    os.environ['ASTRAGRON_CHAT_PROVIDER']='offline';store=Store(folder,max_pending=6)
    cases={name:import_case(store,principal,name) for name in requests}
    original={s['analysis_id']:sha(folder/s['analysis_id']/'result.json') for s in cases.values()}
    server=Server(('127.0.0.1',0),store,{token:principal})
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();start=time.monotonic()
    try:
        env=dict(os.environ,ASTRAGRON_DEMO_TEST_URL='http://127.0.0.1:'+str(server.server_port),ASTRAGRON_DEMO_TEST_TOKEN=token)
        process=subprocess.run(['node',str(ROOT/'integration/release/verify_browser.cjs')],cwd=ROOT,env=env,capture_output=True,text=True,timeout=150)
        (folder/'browser-offline.stderr.log').write_text(process.stderr,encoding='utf-8');print(process.stdout,flush=True)
        if process.returncode:print(process.stderr[-2500:],flush=True)
        receipt={'schema':'astragron.local-farmer-journey.v1','created_utc':now(),'browser_exit_code':process.returncode,'wall_seconds':time.monotonic()-start,'cached_replay_explicit':True,'fresh_scientific_runs':0,'remote_provider_calls':0,'parent_results_unchanged':all(sha(folder/k/'result.json')==v for k,v in original.items()),'chat_after_host_restart':'A new scoped C session created on persisted D analysis; no chat-history persistence claimed.','storage':str(folder),'servers_stopped_on_exit':True}
        write(ROOT/'integration/release/FARMER_JOURNEY.json',receipt)
        if process.returncode:raise SystemExit(process.returncode)
    finally:server.shutdown();server.server_close();store.close()

if __name__=='__main__':main()
