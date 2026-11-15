"""Restore a verified idle checkpoint into a NEW, stopped extraction; no credentials."""
import argparse, hashlib, json, pathlib, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=pathlib.Path);parser.add_argument('--sha256',required=True);parser.add_argument('--include-session-metadata',action='store_true');args=parser.parse_args()
    assert hashlib.sha256(args.archive.read_bytes()).hexdigest()==args.sha256,'PRIVATE_ARCHIVE_HASH_MISMATCH'
    target=ROOT/'core/runtime/integration/release-demo'
    assert not target.exists(),'Restore only into a NEW stopped extraction before its first normal launch; never overlay a live/existing store.'
    with zipfile.ZipFile(args.archive) as archive:
        assert archive.testzip() is None
        manifest=json.loads(archive.read('STATE_MANIFEST.json'));assert manifest['all_jobs_terminal'] is True
        rows=manifest['files_sha256'];selected=[]
        for name,digest in rows.items():
            rel=pathlib.PurePosixPath(name.replace('\\','/'));assert not rel.is_absolute() and '..' not in rel.parts and ':' not in name
            allowed=str(rel).startswith('core/runtime/integration/release-demo/') or args.include_session_metadata and str(rel).startswith('runtime/frontend-sessions/')
            assert rel.name not in {'operator-access.txt','frontend-access.txt','host.lock','.env'}
            raw=archive.read(name);assert hashlib.sha256(raw).hexdigest()==digest
            if name.endswith('/state.json'):assert json.loads(raw)['state']!='pending'
            if allowed:selected.append((rel,raw))
        assert selected
        assert all(not (ROOT/str(rel)).exists() for rel,raw in selected),'Restore would overwrite files'
        for rel,raw in selected:
            path=ROOT/str(rel);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    print(json.dumps({'restored_files':len(selected),'credentials_restored':False,'session_metadata_included':args.include_session_metadata,'new_credentials_generated_on_next_start':True}))

if __name__=='__main__':main()
