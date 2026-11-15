"""Fill only withheld private-base assets in a new Git clone; never overwrite edited code."""
import argparse,hashlib,json,pathlib,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
EXPECTED='95a19217e4ce7abb75823f2d3b415e645e06ba90369b38a35ec7acaaad5ebe9e'

def main():
    p=argparse.ArgumentParser();p.add_argument('archive',type=pathlib.Path);a=p.parse_args()
    assert hashlib.sha256(a.archive.read_bytes()).hexdigest()==EXPECTED,'WRONG_OPERATIONAL_BASE'
    inventory=json.loads((ROOT/'PRIVATE_BASE_EXCLUSIONS.json').read_text())['files_sha256']
    with zipfile.ZipFile(a.archive) as z:
        assert z.testzip() is None
        for name,digest in inventory.items():
            rel=pathlib.PurePosixPath(name);assert not rel.is_absolute() and '..' not in rel.parts and ':' not in name
            raw=z.read('ASTROGRON_UNIFIED/'+name);assert hashlib.sha256(raw).hexdigest()==digest
            out=ROOT/name
            if out.exists():assert out.is_file() and hashlib.sha256(out.read_bytes()).hexdigest()==digest, 'EXISTING_BASE_FILE_DIFFERS:'+name
            else:out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(raw)
    core=json.loads((ROOT/'core/SOURCE_MANIFEST.json').read_text())['files_sha256']
    bad=[n for n,h in core.items() if not (ROOT/'core'/n).is_file() or hashlib.sha256((ROOT/'core'/n).read_bytes()).hexdigest()!=h]
    assert not bad, 'CORE source differs from competition baseline; review changes, never silently reseal locks: '+str(bad[:8])
    print(json.dumps({'private_base_files_hydrated_or_verified':len(inventory),'CORE_files_verified':len(core),'edited_source_overwritten':False}))

if __name__=='__main__':main()
