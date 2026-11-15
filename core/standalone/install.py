"""Install only package-local hash-verified assets; never inherit old worktree environments."""
from pathlib import Path
import argparse,hashlib,json,os,platform,shutil,subprocess,sys,tarfile
ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--preflight',action='store_true');args=parser.parse_args()
 if platform.system()!='Windows' or platform.machine().lower() not in {'amd64','x86_64'}:raise SystemExit('This release is verified on Windows x64 only.')
 if platform.python_version()!='3.14.3':raise SystemExit('Install CPython 3.14.3 x64; other interpreter versions are not numerically qualified.')
 env={k:v for k,v in os.environ.items() if k not in {'PYTHONPATH','PYTHONHOME'} and not k.startswith('ASTRAGRON_')}
 home=ROOT/'runtime/user-home';home.mkdir(parents=True,exist_ok=True);tmp=ROOT/'runtime/tmp';tmp.mkdir(exist_ok=True)
 env.update(USERPROFILE=str(home),TEMP=str(tmp),TMP=str(tmp),PIP_CACHE_DIR=str(ROOT/'runtime/pip-cache'))
 for folder in ['runtime/integration','runtime/agent-a','runtime/agent-b']:(ROOT/folder).mkdir(parents=True,exist_ok=True)
 env.update(PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1',PYTHONUTF8='1',PIP_CONFIG_FILE=os.devnull)
 venv=ROOT/'.venv';python=venv/'Scripts/python.exe';assets=json.loads((ROOT/'dependencies/ASSET_LOCK.json').read_text(encoding='utf-8'))
 for name,expected in assets['files_sha256'].items():
  path=ROOT/name
  if not path.is_file() or sha(path)!=expected:raise SystemExit('Dependency asset missing or changed: '+name)
 if not args.preflight:
  if not python.is_file():subprocess.run([sys.executable,'-I','-m','venv',str(venv)],env=env,check=True)
  subprocess.run([str(python),'-I','-m','pip','install','--no-compile','--no-index','--no-deps','--require-hashes','--find-links',str(ROOT/'dependencies/wheels'),'-r',str(ROOT/'dependencies/requirements.lock')],env=env,check=True)
  modules=ROOT/'runtime/tools/node_modules';modules.mkdir(parents=True,exist_ok=True)
  for name in ['playwright','playwright-core']:
   target=modules/name;target.mkdir(exist_ok=True)
   with tarfile.open(ROOT/'dependencies/node'/assets['node_tarballs'][name]) as archive:
    for member in archive.getmembers():
     if not member.isfile():continue
     parts=Path(member.name).parts
     if not parts or parts[0]!='package' or '..' in parts:raise ValueError('NODE_ASSET_PATH_REJECTED')
     path=target.joinpath(*parts[1:]);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(archive.extractfile(member).read())
 if not python.is_file():raise SystemExit('Run bootstrap first; package-local .venv is missing.')
 node=shutil.which('node')
 if not node:raise SystemExit('Install Node.js 24.14.1 x64 (external licensed prerequisite).')
 version=subprocess.check_output([node,'--version'],env=env,text=True).strip()
 if version!='v24.14.1':raise SystemExit('Expected Node.js v24.14.1, found '+version)
 browser=None
 for root in [os.environ.get('ProgramFiles(x86)',''),os.environ.get('ProgramFiles','')]:
  candidate=Path(root)/'Microsoft/Edge/Application/msedge.exe'
  if candidate.is_file():browser=candidate;break
 if browser is None:raise SystemExit('Install Microsoft Edge. Browser binaries are not redistributed in this source release.')
 settings={'python':str(python),'node':node,'node_modules':str(ROOT/'runtime/tools/node_modules'),'browser':str(browser)}
 (ROOT/'runtime').mkdir(exist_ok=True);(ROOT/'runtime/LOCAL_RUNTIME.json').write_text(json.dumps(settings,indent=2)+'\n',encoding='utf-8')
 env.update(ASTRAGRON_PCSE_PYTHON=str(python),ASTRAGRON_NODE=node,ASTRAGRON_NODE_MODULES=settings['node_modules'],ASTRAGRON_BROWSER=str(browser),ASTRAGRON_CHAT_PROVIDER='offline')
 subprocess.run([str(python),'-B','-X','utf8','-m','system_integration.bootstrap'],cwd=ROOT,env=env,check=True)
 subprocess.run([str(python),'-B','-X','utf8','-m','standalone.preflight'],cwd=ROOT,env=env,check=True)
 print('Package-local bootstrap and preflight passed. No original worktree dependency.')
if __name__=='__main__':main()
