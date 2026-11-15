"""Save a private, immutable idle-queue checkpoint; credentials are never bundled."""
import datetime, hashlib, json, pathlib, zipfile
ROOT = pathlib.Path(__file__).resolve().parent

def main():
    store = ROOT / 'core/runtime/integration/release-demo'
    states = [json.loads(p.read_text()) for p in store.glob('*/state.json')]
    if any(state['state'] == 'pending' for state in states):
        raise SystemExit('WAIT_FOR_QUEUE_IDLE: let admitted jobs finish before the private competition checkpoint.')
    files = {}
    for folder in [store, ROOT / 'runtime/frontend-sessions']:
        if not folder.exists():
            continue
        for p in sorted(folder.rglob('*')):
            if not p.is_file() or p.name in {'operator-access.txt', 'host.lock'} or p.suffix in {'.log', '.tmp'}:
                continue
            files[p.relative_to(ROOT).as_posix()] = p
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = ROOT / 'runtime/checkpoints' / ('COMPETITION_PRIVATE_STATE_' + timestamp + '.zip')
    target.parent.mkdir(parents=True, exist_ok=True)
    hashes = {name: hashlib.sha256(p.read_bytes()).hexdigest() for name, p in files.items()}
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, p in files.items():
            raw = p.read_bytes()
            if hashlib.sha256(raw).hexdigest() != hashes[name]:
                raise RuntimeError('STATE_CHANGED_DURING_BACKUP')
            archive.writestr(name, raw)
        archive.writestr('STATE_MANIFEST.json', json.dumps({'files_sha256': hashes, 'all_jobs_terminal': True,
            'credentials_excluded': True, 'restore_requires_same_D_owner_principal': True}, indent=2))
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for name, digest in hashes.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    receipt = {'schema': 'astrogron.private-state-checkpoint.v1', 'path': str(target.relative_to(ROOT)),
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'files': len(files), 'jobs': len(states),
        'all_jobs_terminal': True, 'credentials_excluded': True, 'public_source_export_excludes_this_archive': True}
    (ROOT / 'integration_acceptance/PRIVATE_STATE_CHECKPOINT.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt))

if __name__ == '__main__':
    main()
