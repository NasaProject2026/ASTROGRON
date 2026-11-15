"""Read-only source/inventory verification; no installation or science execution."""
import argparse, hashlib, json, pathlib, platform, subprocess, sys, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--after-startup',action='store_true');args=parser.parse_args()
    manifest=json.loads((ROOT/'RELEASE_MANIFEST.json').read_text())['files_sha256']
    generated={'frontend/next-env.d.ts','frontend/tsconfig.json'} if args.after_startup else set()
    mismatches=[name for name,digest in manifest.items() if name not in generated and
        (not (ROOT/name).is_file() or hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest)]
    assert not mismatches, mismatches[:10]
    core=json.loads((ROOT/'core/SOURCE_MANIFEST.json').read_text())['files_sha256']
    assert all(hashlib.sha256((ROOT/'core'/n).read_bytes()).hexdigest()==h for n,h in core.items())
    assert len(core)==835
    assert not (ROOT/'core/.git').exists(), 'Git belongs at app root, never under core/'
    result={'source_manifest_entries':len(manifest),'mismatches':0,'CORE_files_verified':len(core),
        'after_startup_generated_frontend_files_exempted':sorted(generated),'python':platform.python_version(),
        'Windows_x64':platform.system()=='Windows' and platform.machine().lower() in {'amd64','x86_64'}}
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
