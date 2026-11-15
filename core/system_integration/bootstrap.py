"""Verify scientific inputs and install the reviewed NASA source bytes locally, offline."""
from brain.baseline import ROOT, verify
from brain.growth_source import verify as verify_source
from .codec import parse


def main():
    print('Protected scientific files verified: ' + str(verify()['files_verified']))
    source = ROOT / 'integration/source_data'
    receipt_bytes = (source / 'growth-weather.receipt.json').read_bytes()
    receipt = parse(receipt_bytes.decode('utf-8'))
    filename = receipt['raw_sha256'] + '.raw.json'
    raw = (source / filename).read_bytes()
    verify_source(raw, receipt)
    lock = parse((ROOT / 'coordination/GROWTH_INPUT_LOCK.json').read_text(encoding='utf-8'))
    if any(receipt.get(k) != v for k, v in lock['NASA'].items()):
        raise ValueError('NASA_SNAPSHOT_NOT_ADMITTED')
    target = ROOT / 'runtime/agent-a/system-integration/source_snapshot'
    target.mkdir(parents=True, exist_ok=True)
    for name, content in [(filename, raw), ('growth-weather.receipt.json', receipt_bytes)]:
        path = target / name
        if path.exists():
            if path.read_bytes() != content:
                raise ValueError('IMMUTABLE_SOURCE_SNAPSHOT_CONFLICT')
        else:
            with path.open('xb') as stream:
                stream.write(content)
    print('Pinned NASA source snapshot verified and available offline.')


if __name__ == '__main__':
    main()
