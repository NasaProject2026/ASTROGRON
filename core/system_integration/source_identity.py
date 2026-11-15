"""Committed runtime identity, including immutable release images without .git."""
import hashlib
import re
import subprocess
from brain.baseline import ROOT


def runtime_files():
    paths=[p for p in (ROOT/'system_integration').glob('*') if p.suffix in ('.py','.cjs')]
    paths+=[ROOT/'customer_reports/render.py']
    if (ROOT/'assistant_brain').is_dir():paths+=list((ROOT/'assistant_brain').glob('*.py'))
    return sorted(paths)


def identity():
    files={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in runtime_files()}
    if not (ROOT/'.git').exists():
        from .codec import read
        manifest=read(ROOT/'integration/production_readiness/deployment/release_source_identity.json')
        if manifest.get('schema')!='astragron.release-source-identity.v1' or not re.fullmatch('[a-f0-9]{40}',manifest.get('commit','')) or manifest.get('files_sha256')!=files or manifest.get('all_runtime_sources_committed') is not True or manifest.get('scientific_A')!='7e64e67cf28d1bbe3910cff016580fd9379ef276' or manifest.get('report_B')!='1be2a9fe6081dcadb1e6d6d4c7f61fab870ff837' or manifest.get('conversational_C')!='7c2e0a4cadb2d7f447b2ee2e697814d475743bdc':
            raise ValueError('RELEASE_SOURCE_INTEGRITY_FAILED')
        return manifest
    def git(*args):
        return subprocess.check_output(['git','-c','gc.auto=0','-C',str(ROOT),*args],stderr=subprocess.DEVNULL,timeout=15)
    head=git('rev-parse','HEAD').decode().strip();committed=True
    for name in files:
        try:committed=committed and hashlib.sha256(git('show',head+':'+name)).hexdigest()==files[name]
        except subprocess.SubprocessError:committed=False
    return {'commit':head,'files_sha256':files,'all_runtime_sources_committed':committed,
            'scientific_A':'7e64e67cf28d1bbe3910cff016580fd9379ef276',
            'report_B':'1be2a9fe6081dcadb1e6d6d4c7f61fab870ff837',
            'conversational_C':'7c2e0a4cadb2d7f447b2ee2e697814d475743bdc'}
