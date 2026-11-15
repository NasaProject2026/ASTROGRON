import hashlib,importlib,importlib.metadata,json,os,platform,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 manifest=json.loads((ROOT/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
 for name,expected in manifest['files_sha256'].items():
  path=ROOT/name
  if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ValueError('SOURCE_MANIFEST_INTEGRITY:'+name)
 from brain.baseline import verify
 from system_integration.source_identity import identity
 modules=['brain','assistant_brain','customer_reports.render','system_integration.api','pcse','pandas','numpy','pydantic','yaml','jsonschema','pytest','pypdf']
 origins={}
 for name in modules:
  m=importlib.import_module(name);path=Path(m.__file__).resolve();assert path.is_relative_to(ROOT),('FOREIGN_IMPORT',name,str(path));origins[name]=str(path.relative_to(ROOT))
 assert Path(sys.prefix).resolve()==(ROOT/'.venv').resolve();assert not (ROOT/'.git').exists();assert not os.environ.get('PYTHONPATH');assert not os.environ.get('PYTHONHOME')
 lock=json.loads((ROOT/'coordination/GROWTH_INPUT_LOCK.json').read_text());assert all(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()==h for n,h in lock['files'].items())
 source=identity();assert source['all_runtime_sources_committed']
 receipt={'root':str(ROOT),'python':sys.executable,'python_version':platform.python_version(),'module_origins':origins,'protected':verify(),'scientific_pins':len(lock['files']),'source_commit':source['commit'],'git_directory_present':False,'foreign_imports':False}
 p=ROOT/'runtime/verification';p.mkdir(parents=True,exist_ok=True);(p/'PREFLIGHT.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8');print(json.dumps(receipt))
if __name__=='__main__':main()
